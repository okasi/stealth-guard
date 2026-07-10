// Configuration schema and defaults

const STORAGE_KEY = "stealth-guard-config";
const BLOCKED_CONFIG_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const VALID_USER_AGENT_PRESETS = new Set(["macos", "macos_chrome", "windows", "iphone", "android"]);
const VALID_WEBGL_PRESETS = new Set(["auto", "apple", "pixel_4", "surface_pro_7"]);
const VALID_CANVAS_NOISE_LEVELS = new Set(["low", "medium", "high"]);
const VALID_WEBRTC_POLICIES = new Set(["default", "disable_non_proxied_udp", "default_public_interface_only"]);

function getDefaultUserAgentPreset() {
  const nav = typeof navigator !== "undefined" ? navigator : { platform: "", userAgent: "" };
  const platform = typeof nav.platform === "string" ? nav.platform : "";
  const userAgent = typeof nav.userAgent === "string" ? nav.userAgent : "";
  const isMac = platform.includes("Mac");
  const isChrome = userAgent.includes("Chrome");

  if (isMac && isChrome) return "macos_chrome";
  if (isMac) return "macos";
  return "windows";
}

function getStorageApi() {
  if (typeof storage !== "undefined") {
    return storage;
  }

  throw new Error("Stealth Guard storage API is unavailable");
}

const DEFAULT_CONFIG = {
  // Global settings
  enabled: true,
  globalWhitelist: "",  // Comma-separated whitelist/allowlist: domains where ALL protections are disabled
  notifications: {
    enabled: false,
    showFingerprints: true
  },

  // Feature: SOCKS5 Proxy Support
  proxy: {
    enabled: false,
    activeProfile: null,  // Currently active proxy profile name
    profiles: [],  // Array of proxy profiles: { name, host, port, scheme, remoteDNS, location }
    domainRoutes: [],  // Array of domain routing rules: { pattern, profile }
    bypassList: ["localhost", "127.0.0.1", "192.168.*", "10.*"]  // Domains/IPs to bypass proxy
  },

  // Feature: User-Agent Spoofing
  useragent: {
    enabled: true,
    whitelist: "",
    // Auto-detect: macOS Chrome for Chromium-based, macOS Safari otherwise
    preset: getDefaultUserAgentPreset()
  },

  // Feature: Timezone Spoofing
  timezone: {
    enabled: true,
    whitelist: "app.slack.com, webmail.*",
    offset: 60,    // Minutes from UTC (e.g., 60 = UTC+1)
    name: "Europe/Paris"  // IANA timezone name
  },

  // Feature: WebRTC Leak Protection
  webrtc: {
    enabled: true,
    whitelist: "meet.google.com, zoom.us, teams.microsoft.com, discord.com, web.whatsapp.com, messenger.com, web.telegram.org, figma.com",  // Note: Domains where WebRTC is ALLOWED
    policy: "disable_non_proxied_udp"  // "default", "disable_non_proxied_udp", "default_public_interface_only"
  },

  // Feature: Canvas Fingerprint Protection
  canvas: {
    enabled: true,
    whitelist: "*.notion.so, *.lovable.dev",  // Per-feature whitelist/allowlist
    noiseLevel: "medium"  // low, medium, high
  },

  // Feature: ClientRects Fingerprint Protection
  clientrects: {
    enabled: true,
    whitelist: "*.figma.com, *.miro.com, *.canva.com"
  },

  // Feature: Font Fingerprint Protection
  font: {
    enabled: true,
    whitelist: "docs.google.com, *.figma.com, *.discord.com, *.notion.so",
  },

  // Feature: AudioContext Fingerprint Protection
  audiocontext: {
    enabled: true,
    whitelist: ""
  },

  // Feature: WebGL Fingerprint Protection
  webgl: {
    enabled: true,
    whitelist: "*.figma.com, *.miro.com, *.adguard-mail.com",
    preset: "auto"  // "auto", "apple", "pixel_4", "surface_pro_7"
  },

  // Feature: WebGPU Fingerprint Protection
  webgpu: {
    enabled: true,
    whitelist: "*.lovable.dev"
  }
};

/**
 * Load configuration from storage, merging with defaults
 * @returns {Promise<Object>} Configuration object
 */
async function loadConfig() {
  const stored = await getStorageApi().read(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

/**
 * Save configuration to storage
 * @param {Object} config - Configuration object to save
 * @returns {Promise<void>}
 */
async function saveConfig(config) {
  return getStorageApi().write({ [STORAGE_KEY]: normalizeConfig(config) });
}

/**
 * Reset configuration to defaults
 * @returns {Promise<void>}
 */
async function resetConfig() {
  return saveConfig(DEFAULT_CONFIG);
}

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function normalizeConfig(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const normalized = deepMerge(cloneDefaultConfig(), source);

  normalized.enabled = typeof normalized.enabled === "boolean" ? normalized.enabled : DEFAULT_CONFIG.enabled;
  normalized.globalWhitelist = typeof normalized.globalWhitelist === "string" ? normalized.globalWhitelist : "";

  const booleanSections = [
    "notifications",
    "proxy",
    "useragent",
    "timezone",
    "webrtc",
    "canvas",
    "clientrects",
    "font",
    "audiocontext",
    "webgl",
    "webgpu"
  ];
  for (const sectionName of booleanSections) {
    const candidate = normalized[sectionName];
    const section = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate
      : { ...DEFAULT_CONFIG[sectionName] };
    normalized[sectionName] = section;
    section.enabled = typeof section.enabled === "boolean"
      ? section.enabled
      : DEFAULT_CONFIG[sectionName].enabled;
  }

  normalized.notifications.showFingerprints = typeof normalized.notifications.showFingerprints === "boolean"
    ? normalized.notifications.showFingerprints
    : DEFAULT_CONFIG.notifications.showFingerprints;

  const whitelistSections = [
    "useragent",
    "timezone",
    "webrtc",
    "canvas",
    "clientrects",
    "font",
    "audiocontext",
    "webgl",
    "webgpu"
  ];
  for (const sectionName of whitelistSections) {
    const section = normalized[sectionName];
    section.whitelist = typeof section.whitelist === "string"
      ? section.whitelist
      : DEFAULT_CONFIG[sectionName].whitelist;
  }

  normalized.useragent.preset = normalizeEnum(
    normalized.useragent.preset,
    VALID_USER_AGENT_PRESETS,
    DEFAULT_CONFIG.useragent.preset
  );
  normalized.webgl.preset = normalizeEnum(
    normalized.webgl.preset,
    VALID_WEBGL_PRESETS,
    DEFAULT_CONFIG.webgl.preset
  );
  normalized.canvas.noiseLevel = normalizeEnum(
    normalized.canvas.noiseLevel,
    VALID_CANVAS_NOISE_LEVELS,
    DEFAULT_CONFIG.canvas.noiseLevel
  );
  normalized.webrtc.policy = normalizeEnum(
    normalized.webrtc.policy,
    VALID_WEBRTC_POLICIES,
    DEFAULT_CONFIG.webrtc.policy
  );

  const timezoneOffset = Number(normalized.timezone.offset);
  normalized.timezone.offset = Number.isFinite(timezoneOffset) && timezoneOffset >= -840 && timezoneOffset <= 840
    ? timezoneOffset
    : DEFAULT_CONFIG.timezone.offset;
  normalized.timezone.name = typeof normalized.timezone.name === "string" && normalized.timezone.name.trim()
    ? normalized.timezone.name.trim().slice(0, 128)
    : DEFAULT_CONFIG.timezone.name;

  normalized.proxy.activeProfile = typeof normalized.proxy.activeProfile === "string" && normalized.proxy.activeProfile.trim()
    ? normalized.proxy.activeProfile.trim().slice(0, 128)
    : null;
  normalized.proxy.profiles = Array.isArray(normalized.proxy.profiles) ? normalized.proxy.profiles : [];
  normalized.proxy.domainRoutes = Array.isArray(normalized.proxy.domainRoutes) ? normalized.proxy.domainRoutes : [];
  normalized.proxy.bypassList = Array.isArray(normalized.proxy.bypassList) ? normalized.proxy.bypassList : [];

  return normalized;
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object (defaults)
 * @param {Object} source - Source object (overrides)
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || BLOCKED_CONFIG_KEYS.has(key)) {
      continue;
    }

    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    getDefaultUserAgentPreset,
    normalizeConfig,
    normalizeEnum,
    loadConfig,
    saveConfig,
    resetConfig,
    deepMerge
  };
}

