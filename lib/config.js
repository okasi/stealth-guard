// Configuration schema and defaults

const STORAGE_KEY = "stealth-guard-config";

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
    whitelist: "*.figma.com, *.miro.com",
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
  const config = stored[STORAGE_KEY] || {};

  // Deep merge with defaults
  // We deep clone DEFAULT_CONFIG first to prevent mutation of the defaults object
  // because deepMerge implementation does a shallow copy of keys missing in source
  const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), config);

  return merged;
}

/**
 * Save configuration to storage
 * @param {Object} config - Configuration object to save
 * @returns {Promise<void>}
 */
async function saveConfig(config) {
  return getStorageApi().write({ [STORAGE_KEY]: config });
}

/**
 * Reset configuration to defaults
 * @returns {Promise<void>}
 */
async function resetConfig() {
  return saveConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
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
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
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
    loadConfig,
    saveConfig,
    resetConfig,
    deepMerge
  };
}

