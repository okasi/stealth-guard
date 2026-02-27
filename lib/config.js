// Configuration schema and defaults

const STORAGE_KEY = "stealth-guard-config";

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
    preset: (() => {
      const isMac = navigator.platform.includes("Mac");
      const isChrome = navigator.userAgent.includes("Chrome");
      if (isMac && isChrome) return "macos_chrome";
      if (isMac) return "macos";
      return "windows";
    })()
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
    whitelist: "*.notion.so",  // Per-feature whitelist/allowlist
    noiseLevel: "medium"  // low, medium, high
  },

  // Feature: ClientRects Fingerprint Protection
  clientrects: {
    enabled: true,
    whitelist: ""
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
    whitelist: ""
  }
};

/**
 * Load configuration from storage, merging with defaults
 * @returns {Promise<Object>} Configuration object
 */
async function loadConfig() {
  const stored = await storage.read(STORAGE_KEY);
  const config = stored[STORAGE_KEY] || {};

  // Deep merge with defaults
  // We deep clone DEFAULT_CONFIG first to prevent mutation of the defaults object
  // because deepMerge implementation does a shallow copy of keys missing in source
  const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), config);

  // Merge default whitelist entries with user's existing whitelists.
  // This keeps new safe defaults while preserving user customizations.
  const whitelistFeatures = [
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

  for (const featureName of whitelistFeatures) {
    merged[featureName].whitelist = mergeWhitelists(
      DEFAULT_CONFIG[featureName].whitelist,
      config[featureName]?.whitelist
    );
  }

  return merged;
}

/**
 * Save configuration to storage
 * @param {Object} config - Configuration object to save
 * @returns {Promise<void>}
 */
async function saveConfig(config) {
  return storage.write({ [STORAGE_KEY]: config });
}

/**
 * Reset configuration to defaults
 * @returns {Promise<void>}
 */
async function resetConfig() {
  return saveConfig(DEFAULT_CONFIG);
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

/**
 * Merge default whitelist entries with user's whitelist
 * Adds any missing default entries to user's list without duplicates
 * @param {string} defaultWhitelist - Default whitelist from DEFAULT_CONFIG
 * @param {string} userWhitelist - User's stored whitelist (may be undefined)
 * @returns {string} Merged whitelist
 */
function mergeWhitelists(defaultWhitelist, userWhitelist) {
  // Parse both whitelists into arrays
  const defaultEntries = (defaultWhitelist || "").split(",").map(s => s.trim()).filter(Boolean);
  const userEntries = (userWhitelist || "").split(",").map(s => s.trim()).filter(Boolean);

  // Create a Set from user entries for fast lookup (case-insensitive)
  const userEntriesLower = new Set(userEntries.map(e => e.toLowerCase()));

  // Add default entries that aren't already in user's list
  const merged = [...userEntries];
  for (const entry of defaultEntries) {
    if (!userEntriesLower.has(entry.toLowerCase())) {
      merged.push(entry);
    }
  }

  return merged.join(", ");
}

