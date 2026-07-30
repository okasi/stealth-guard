const STORAGE_KEY = "stealth-guard-config";
const PROTECTION_FEATURES = [
  "canvas",
  "clientrects",
  "font",
  "audiocontext",
  "webgl",
  "webgpu",
  "geolocation",
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
const VALID_PROXY_ROUTING_MODES = new Set([
  "protect-all",
  "bypass-selected",
  "protect-selected",
]);
const PROXY_SAFETY_BYPASS_LIST = [
  "localhost",
  "127.0.0.1",
  "192.168.*",
  "10.*",
];
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
    "Mozilla/5.0 (Linux; Android 13; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
};
const USER_AGENT_CLIENT_HINTS = {
  macos_chrome: {
    brand: "Google Chrome",
    platform: "macOS",
    platformVersion: "10.15.7",
    architecture: "x86",
    bitness: "64",
    model: "",
    mobile: false,
    wow64: false,
    formFactors: ["Desktop"],
  },
  windows: {
    brand: "Microsoft Edge",
    platform: "Windows",
    platformVersion: "10.0.0",
    architecture: "x86",
    bitness: "64",
    model: "",
    mobile: false,
    wow64: false,
    formFactors: ["Desktop"],
  },
  android: {
    brand: "Google Chrome",
    platform: "Android",
    platformVersion: "13.0.0",
    architecture: "arm",
    bitness: "64",
    model: "Pixel 4",
    mobile: true,
    wow64: false,
    formFactors: ["Mobile"],
  },
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
    routingMode: "bypass-selected",
    activeProfile: null,
    fallbackProfiles: [],
    profiles: [],
    domainRoutes: [],
    bypassList: [...PROXY_SAFETY_BYPASS_LIST],
    syncTimezone: true,
    syncGeolocation: true,
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
  geolocation: {
    enabled: true,
    whitelist: "",
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

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function normalizeEnabledSection(value, defaults) {
  const source = isRecord(value) ? value : {};
  return {
    enabled:
      typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
  };
}

function normalizeFeature(value, defaults) {
  const source = isRecord(value) ? value : {};
  return {
    ...normalizeEnabledSection(source, defaults),
    whitelist:
      typeof source.whitelist === "string"
        ? source.whitelist
        : defaults.whitelist,
  };
}

function normalizeProxyProfiles(value) {
  return Array.isArray(value)
    ? value.filter(isRecord).map((profile) => {
        const normalized = {
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
        if (isRecord(profile.location)) {
          normalized.location = normalizeProxyLocation(profile.location);
        }
        return normalized;
      })
    : [];
}

function normalizeProxyLocation(value) {
  const source = isRecord(value) ? value : {};
  const text = (key, maxLength = 128) =>
    typeof source[key] === "string"
      ? source[key].trim().slice(0, maxLength)
      : "";
  return {
    city: text("city"),
    region: text("region"),
    country: text("country"),
    countryCode: text("countryCode", 8).toUpperCase(),
    loc: text("loc", 64),
    org: text("org", 256),
    timezone: text("timezone", 128),
    source: text("source", 64),
  };
}

function normalizeDomainRoutes(value) {
  return Array.isArray(value)
    ? value.filter(isRecord).map((route) => ({
        pattern: typeof route.pattern === "string" ? route.pattern.trim() : "",
        profile: typeof route.profile === "string" ? route.profile.trim() : "",
      }))
    : [];
}

function normalizeStringList(value, defaults = []) {
  if (value === undefined) {
    return [...defaults];
  }
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];
}

function normalizeConfig(config) {
  const source = isRecord(config) ? config : {};
  const proxySource = isRecord(source.proxy) ? source.proxy : {};
  const legacyRoutingMode =
    proxySource.routingMode === undefined &&
    !(typeof proxySource.activeProfile === "string" &&
      proxySource.activeProfile.trim()) &&
    Array.isArray(proxySource.domainRoutes) &&
    proxySource.domainRoutes.length > 0
      ? "protect-selected"
      : DEFAULT_CONFIG.proxy.routingMode;
  const normalized = {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_CONFIG.enabled,
    globalWhitelist:
      typeof source.globalWhitelist === "string" ? source.globalWhitelist : "",
    notifications: normalizeEnabledSection(
      source.notifications,
      DEFAULT_CONFIG.notifications,
    ),
    proxy: {
      ...normalizeEnabledSection(source.proxy, DEFAULT_CONFIG.proxy),
      routingMode: normalizeEnum(
        proxySource.routingMode,
        VALID_PROXY_ROUTING_MODES,
        legacyRoutingMode,
      ),
      activeProfile:
        typeof proxySource.activeProfile === "string" &&
        proxySource.activeProfile.trim()
          ? proxySource.activeProfile.trim().slice(0, 128)
          : null,
      fallbackProfiles: normalizeStringList(proxySource.fallbackProfiles).slice(
        0,
        10,
      ),
      profiles: normalizeProxyProfiles(proxySource.profiles),
      domainRoutes: normalizeDomainRoutes(proxySource.domainRoutes),
      bypassList: normalizeStringList(
        proxySource.bypassList,
        DEFAULT_CONFIG.proxy.bypassList,
      ),
      syncTimezone:
        typeof proxySource.syncTimezone === "boolean"
          ? proxySource.syncTimezone
          : DEFAULT_CONFIG.proxy.syncTimezone,
      syncGeolocation:
        typeof proxySource.syncGeolocation === "boolean"
          ? proxySource.syncGeolocation
          : DEFAULT_CONFIG.proxy.syncGeolocation,
    },
  };

  for (const featureName of PROTECTION_FEATURES) {
    normalized[featureName] = normalizeFeature(
      source[featureName],
      DEFAULT_CONFIG[featureName],
    );
  }

  const userAgentSource = isRecord(source.useragent) ? source.useragent : {};
  normalized.useragent.preset = normalizeEnum(
    userAgentSource.preset,
    VALID_USER_AGENT_PRESETS,
    DEFAULT_CONFIG.useragent.preset,
  );
  const webglSource = isRecord(source.webgl) ? source.webgl : {};
  normalized.webgl.preset = normalizeEnum(
    webglSource.preset,
    VALID_WEBGL_PRESETS,
    DEFAULT_CONFIG.webgl.preset,
  );
  const canvasSource = isRecord(source.canvas) ? source.canvas : {};
  normalized.canvas.noiseLevel = normalizeEnum(
    canvasSource.noiseLevel,
    VALID_CANVAS_NOISE_LEVELS,
    DEFAULT_CONFIG.canvas.noiseLevel,
  );
  const webRtcSource = isRecord(source.webrtc) ? source.webrtc : {};
  normalized.webrtc.policy = normalizeEnum(
    webRtcSource.policy,
    VALID_WEBRTC_POLICIES,
    DEFAULT_CONFIG.webrtc.policy,
  );

  const timezoneSource = isRecord(source.timezone) ? source.timezone : {};
  const timezoneOffset = Number(timezoneSource.offset);
  normalized.timezone.offset =
    Number.isFinite(timezoneOffset) &&
    timezoneOffset >= -840 &&
    timezoneOffset <= 840
      ? timezoneOffset
      : DEFAULT_CONFIG.timezone.offset;
  normalized.timezone.name =
    typeof timezoneSource.name === "string" && timezoneSource.name.trim()
      ? timezoneSource.name.trim().slice(0, 128)
      : DEFAULT_CONFIG.timezone.name;
  return normalized;
}

function getDomainAllowlistMatcher() {
  if (typeof isDomainAllowlisted === "function") {
    return isDomainAllowlisted;
  }
  /* c8 ignore next 3 */
  if (typeof module !== "undefined" && module.exports) {
    return require("./domainFilter.js").isDomainAllowlisted;
  }
  /* c8 ignore next */
  return () => false;
}

function parseCoarseCoordinates(location) {
  const parts = String((location && location.loc) || "").split(",");
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
  };
}

function resolveContentVpnLocation(config, hostname) {
  const normalized = normalizeConfig(config);
  const proxy = normalized.proxy;
  if (!normalized.enabled || !proxy.enabled || !hostname) {
    return null;
  }

  const matches = getDomainAllowlistMatcher();
  if (
    matches(hostname, normalized.globalWhitelist) ||
    matches(hostname, PROXY_SAFETY_BYPASS_LIST.join(",")) ||
    (proxy.routingMode === "bypass-selected" &&
      matches(hostname, proxy.bypassList.join(",")))
  ) {
    return null;
  }

  const matchingRoute = proxy.domainRoutes.find((route) =>
    matches(hostname, route.pattern),
  );
  const profileName = matchingRoute
    ? matchingRoute.profile
    : proxy.routingMode === "protect-selected"
      ? null
      : proxy.activeProfile;
  const profile = proxy.profiles.find((entry) => entry.name === profileName);
  if (!profile || !profile.location) {
    return null;
  }

  const coordinates = parseCoarseCoordinates(profile.location);
  return {
    city: profile.location.city,
    country: profile.location.country,
    countryCode: profile.location.countryCode,
    timezone: profile.location.timezone,
    syncTimezone: proxy.syncTimezone,
    syncGeolocation: proxy.syncGeolocation,
    ...(coordinates || {}),
  };
}

function createContentConfig(config, hostname = "") {
  const normalized = normalizeConfig(config);
  const contentConfig = {
    enabled: normalized.enabled,
    globalWhitelist: normalized.globalWhitelist,
    notifications: cloneConfig(normalized.notifications),
  };

  for (const featureName of PROTECTION_FEATURES) {
    contentConfig[featureName] = cloneConfig(normalized[featureName]);
  }

  contentConfig.vpnLocation = resolveContentVpnLocation(normalized, hostname);

  return contentConfig;
}

function getUserAgentString(preset) {
  return USER_AGENT_STRINGS[preset] || null;
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEY,
    PROTECTION_FEATURES,
    DEFAULT_CONFIG,
    USER_AGENT_STRINGS,
    USER_AGENT_CLIENT_HINTS,
    VALID_PROXY_ROUTING_MODES,
    PROXY_SAFETY_BYPASS_LIST,
    getDefaultUserAgentPreset,
    getUserAgentString,
    cloneConfig,
    normalizeConfig,
    normalizeProxyLocation,
    parseCoarseCoordinates,
    resolveContentVpnLocation,
    createContentConfig,
    loadConfig,
    saveConfig,
  };
}
