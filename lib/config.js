const STORAGE_KEY = "stealth-guard-config";
const BLOCKED_CONFIG_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PROTECTION_FEATURES = [
  "canvas",
  "clientrects",
  "font",
  "audiocontext",
  "webgl",
  "webgpu",
  "timezone",
  "useragent",
  "webrtc",
];
const VALID_USER_AGENT_PRESETS = new Set([
  "macos",
  "macos_chrome",
  "windows",
  "iphone",
  "android",
]);
const VALID_WEBGL_PRESETS = new Set([
  "auto",
  "apple",
  "pixel_4",
  "surface_pro_7",
]);
const VALID_CANVAS_NOISE_LEVELS = new Set(["low", "medium", "high"]);
const VALID_WEBRTC_POLICIES = new Set([
  "default",
  "disable_non_proxied_udp",
  "default_public_interface_only",
]);
const USER_AGENT_STRINGS = {
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  macos_chrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
};

function getDefaultUserAgentPreset() {
  const nav =
    typeof navigator !== "undefined"
      ? navigator
      : { platform: "", userAgent: "" };
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
  enabled: true,
  globalWhitelist: "",
  notifications: {
    enabled: false,
  },
  proxy: {
    enabled: false,
    activeProfile: null,
    profiles: [],
    domainRoutes: [],
    bypassList: ["localhost", "127.0.0.1", "192.168.*", "10.*"],
  },
  useragent: {
    enabled: true,
    whitelist: "",
    preset: getDefaultUserAgentPreset(),
  },
  timezone: {
    enabled: true,
    whitelist: "app.slack.com, webmail.*",
    offset: 60,
    name: "Europe/Paris",
  },
  webrtc: {
    enabled: true,
    whitelist:
      "meet.google.com, zoom.us, teams.microsoft.com, discord.com, web.whatsapp.com, messenger.com, web.telegram.org, figma.com",
    policy: "disable_non_proxied_udp",
  },
  canvas: {
    enabled: true,
    whitelist: "*.notion.so, *.lovable.dev",
    noiseLevel: "medium",
  },
  clientrects: {
    enabled: true,
    whitelist: "*.figma.com, *.miro.com, *.canva.com",
  },
  font: {
    enabled: true,
    whitelist: "docs.google.com, *.figma.com, *.discord.com, *.notion.so",
  },
  audiocontext: {
    enabled: true,
    whitelist: "",
  },
  webgl: {
    enabled: true,
    whitelist: "*.figma.com, *.miro.com, *.adguard-mail.com",
    preset: "auto",
  },
  webgpu: {
    enabled: true,
    whitelist: "*.lovable.dev",
  },
};

async function loadConfig() {
  const stored = await getStorageApi().read(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

async function saveConfig(config) {
  return getStorageApi().write({ [STORAGE_KEY]: normalizeConfig(config) });
}

async function resetConfig() {
  return saveConfig(DEFAULT_CONFIG);
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function normalizeConfig(config) {
  const source =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};
  const normalized = deepMerge(cloneConfig(DEFAULT_CONFIG), source);

  normalized.enabled =
    typeof normalized.enabled === "boolean"
      ? normalized.enabled
      : DEFAULT_CONFIG.enabled;
  normalized.globalWhitelist =
    typeof normalized.globalWhitelist === "string"
      ? normalized.globalWhitelist
      : "";

  const sectionsWithEnabled = [
    "notifications",
    "proxy",
    ...PROTECTION_FEATURES,
  ];
  for (const sectionName of sectionsWithEnabled) {
    const candidate = normalized[sectionName];
    const section =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? candidate
        : cloneConfig(DEFAULT_CONFIG[sectionName]);
    normalized[sectionName] = section;
    section.enabled =
      typeof section.enabled === "boolean"
        ? section.enabled
        : DEFAULT_CONFIG[sectionName].enabled;
  }

  for (const sectionName of PROTECTION_FEATURES) {
    const section = normalized[sectionName];
    section.whitelist =
      typeof section.whitelist === "string"
        ? section.whitelist
        : DEFAULT_CONFIG[sectionName].whitelist;
  }

  normalized.useragent.preset = normalizeEnum(
    normalized.useragent.preset,
    VALID_USER_AGENT_PRESETS,
    DEFAULT_CONFIG.useragent.preset,
  );
  normalized.webgl.preset = normalizeEnum(
    normalized.webgl.preset,
    VALID_WEBGL_PRESETS,
    DEFAULT_CONFIG.webgl.preset,
  );
  normalized.canvas.noiseLevel = normalizeEnum(
    normalized.canvas.noiseLevel,
    VALID_CANVAS_NOISE_LEVELS,
    DEFAULT_CONFIG.canvas.noiseLevel,
  );
  normalized.webrtc.policy = normalizeEnum(
    normalized.webrtc.policy,
    VALID_WEBRTC_POLICIES,
    DEFAULT_CONFIG.webrtc.policy,
  );

  const timezoneOffset = Number(normalized.timezone.offset);
  normalized.timezone.offset =
    Number.isFinite(timezoneOffset) &&
    timezoneOffset >= -840 &&
    timezoneOffset <= 840
      ? timezoneOffset
      : DEFAULT_CONFIG.timezone.offset;
  normalized.timezone.name =
    typeof normalized.timezone.name === "string" &&
    normalized.timezone.name.trim()
      ? normalized.timezone.name.trim().slice(0, 128)
      : DEFAULT_CONFIG.timezone.name;

  normalized.proxy.activeProfile =
    typeof normalized.proxy.activeProfile === "string" &&
    normalized.proxy.activeProfile.trim()
      ? normalized.proxy.activeProfile.trim().slice(0, 128)
      : null;
  normalized.proxy.profiles = Array.isArray(normalized.proxy.profiles)
    ? normalized.proxy.profiles
        .filter(
          (profile) =>
            profile && typeof profile === "object" && !Array.isArray(profile),
        )
        .map((profile) => {
          const cleanProfile = {
            name:
              typeof profile.name === "string"
                ? profile.name.trim().slice(0, 128)
                : "",
            host: typeof profile.host === "string" ? profile.host.trim() : "",
            port: profile.port,
            scheme:
              typeof profile.scheme === "string"
                ? profile.scheme.trim().toLowerCase()
                : "",
          };
          if (
            profile.location &&
            typeof profile.location === "object" &&
            !Array.isArray(profile.location)
          ) {
            cleanProfile.location = cloneConfig(profile.location);
          }
          return cleanProfile;
        })
    : [];
  normalized.proxy.domainRoutes = Array.isArray(normalized.proxy.domainRoutes)
    ? normalized.proxy.domainRoutes
        .filter(
          (route) =>
            route && typeof route === "object" && !Array.isArray(route),
        )
        .map((route) => ({
          pattern:
            typeof route.pattern === "string" ? route.pattern.trim() : "",
          profile:
            typeof route.profile === "string" ? route.profile.trim() : "",
        }))
    : [];
  normalized.proxy.bypassList = Array.isArray(normalized.proxy.bypassList)
    ? normalized.proxy.bypassList
        .filter((pattern) => typeof pattern === "string" && pattern.trim())
        .map((pattern) => pattern.trim())
    : [];

  const cleanConfig = {
    enabled: normalized.enabled,
    globalWhitelist: normalized.globalWhitelist,
    notifications: {
      enabled: normalized.notifications.enabled,
    },
    proxy: {
      enabled: normalized.proxy.enabled,
      activeProfile: normalized.proxy.activeProfile,
      profiles: normalized.proxy.profiles,
      domainRoutes: normalized.proxy.domainRoutes,
      bypassList: normalized.proxy.bypassList,
    },
  };
  for (const featureName of PROTECTION_FEATURES) {
    cleanConfig[featureName] = {
      enabled: normalized[featureName].enabled,
      whitelist: normalized[featureName].whitelist,
    };
  }
  cleanConfig.canvas.noiseLevel = normalized.canvas.noiseLevel;
  cleanConfig.webgl.preset = normalized.webgl.preset;
  cleanConfig.timezone.offset = normalized.timezone.offset;
  cleanConfig.timezone.name = normalized.timezone.name;
  cleanConfig.useragent.preset = normalized.useragent.preset;
  cleanConfig.webrtc.policy = normalized.webrtc.policy;
  return cleanConfig;
}

function createContentConfig(config) {
  const normalized = normalizeConfig(config);
  const contentConfig = {
    enabled: normalized.enabled,
    globalWhitelist: normalized.globalWhitelist,
    notifications: cloneConfig(normalized.notifications),
  };

  for (const featureName of PROTECTION_FEATURES) {
    contentConfig[featureName] = cloneConfig(normalized[featureName]);
  }

  return contentConfig;
}

function getUserAgentString(preset) {
  return USER_AGENT_STRINGS[preset] || null;
}

function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (
      !Object.prototype.hasOwnProperty.call(source, key) ||
      BLOCKED_CONFIG_KEYS.has(key)
    ) {
      continue;
    }

    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
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
    PROTECTION_FEATURES,
    DEFAULT_CONFIG,
    USER_AGENT_STRINGS,
    getDefaultUserAgentPreset,
    getUserAgentString,
    cloneConfig,
    normalizeConfig,
    createContentConfig,
    normalizeEnum,
    loadConfig,
    saveConfig,
    resetConfig,
    deepMerge,
  };
}
