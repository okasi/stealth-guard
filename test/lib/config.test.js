import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../../lib/config.js");

function loadConfigModule(
  navigatorValue = { platform: "Win32", userAgent: "Chrome/125" },
) {
  delete require.cache[configPath];
  Object.defineProperty(globalThis, "navigator", {
    value: navigatorValue,
    configurable: true,
  });
  return require("../../lib/config.js");
}

afterEach(() => {
  delete globalThis.storage;
  vi.restoreAllMocks();
});

test("getDefaultUserAgentPreset maps platform and browser combinations", () => {
  const configModule = loadConfigModule();

  Object.defineProperty(globalThis, "navigator", {
    value: { platform: "MacIntel", userAgent: "Chrome/140" },
    configurable: true,
  });
  const macChrome = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", {
    value: { platform: "MacIntel", userAgent: "Safari/17" },
    configurable: true,
  });
  const macSafari = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", {
    value: { platform: "Win32", userAgent: "Chrome/140" },
    configurable: true,
  });
  const windows = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", {
    value: { platform: null, userAgent: null },
    configurable: true,
  });
  const nonStringNavigator = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", {
    value: undefined,
    configurable: true,
  });
  const missingNavigator = configModule.getDefaultUserAgentPreset();

  expect([
    macChrome,
    macSafari,
    windows,
    nonStringNavigator,
    missingNavigator,
  ]).toEqual(["macos_chrome", "macos", "windows", "windows", "windows"]);
});

test("User-Agent and content config helpers expose only trusted runtime data", () => {
  const {
    BUILTIN_TRACKER_DOMAINS,
    LANGUAGE_PRESETS,
    PROTECTION_FEATURES,
    USER_AGENT_CLIENT_HINTS,
    USER_AGENT_STRINGS,
    cloneConfig,
    createContentConfig,
    getUserAgentString,
  } = loadConfigModule();
  const source = {
    enabled: false,
    proxy: {
      enabled: true,
      profiles: [
        { name: "Private", host: "secret.proxy", port: 1080, scheme: "socks5" },
      ],
    },
    canvas: { enabled: false },
    unknown: { secret: true },
  };

  const contentConfig = createContentConfig(source);
  const cloned = cloneConfig(contentConfig);
  const emptyClone = cloneConfig(null);
  cloned.canvas.enabled = true;

  expect(PROTECTION_FEATURES).toContain("canvas");
  expect(PROTECTION_FEATURES).toContain("geolocation");
  expect(PROTECTION_FEATURES).toContain("language");
  expect(BUILTIN_TRACKER_DOMAINS).toContain("*.google-analytics.com");
  expect(LANGUAGE_PRESETS["en-US"].acceptLanguage).toBe("en-US,en;q=0.9");
  expect(getUserAgentString("macos")).toBe(USER_AGENT_STRINGS.macos);
  expect(getUserAgentString("missing")).toBeNull();
  expect(USER_AGENT_CLIENT_HINTS.android).toMatchObject({
    platform: "Android",
    model: "Pixel 4",
    mobile: true,
  });
  expect(USER_AGENT_CLIENT_HINTS.macos).toBeUndefined();
  expect(contentConfig.enabled).toBe(false);
  expect(contentConfig.canvas.enabled).toBe(false);
  expect(contentConfig.proxy).toBeUndefined();
  expect(contentConfig.vpnLocation).toBeNull();
  expect(contentConfig.language.identity).toEqual({
    locale: "en-US",
    languages: ["en-US", "en"],
    acceptLanguage: "en-US,en;q=0.9",
    source: "preset",
  });
  expect(contentConfig.unknown).toBeUndefined();
  expect(cloned.canvas.enabled).toBe(true);
  expect(contentConfig.canvas.enabled).toBe(false);
  expect(emptyClone).toEqual({});
});

test("content config resolves only coarse effective proxy location data", () => {
  const {
    createContentConfig,
    normalizeProxyLocation,
    parseCoarseCoordinates,
    resolveContentVpnLocation,
  } = loadConfigModule();
  const config = {
    enabled: true,
    globalWhitelist: "direct.test",
    proxy: {
      enabled: true,
      routingMode: "bypass-selected",
      activeProfile: "Main",
      fallbackProfiles: [],
      bypassList: ["bypass.test"],
      domainRoutes: [{ pattern: "*.video.test", profile: "Video" }],
      syncTimezone: true,
      syncGeolocation: true,
      syncLanguage: true,
      profiles: [
        {
          name: "Main",
          host: "secret.proxy",
          port: 443,
          scheme: "https",
          location: {
            city: " Paris ",
            country: "France",
            countryCode: "fr",
            loc: "48.8566,2.3522",
            timezone: "Europe/Paris",
          },
        },
        {
          name: "Video",
          host: "video.proxy",
          port: 443,
          scheme: "https",
          location: {
            city: "Tokyo",
            country: "Japan",
            countryCode: "JP",
            loc: "35.6762,139.6503",
            timezone: "Asia/Tokyo",
          },
        },
      ],
    },
  };

  const contentConfig = createContentConfig(config, "www.example.test");
  expect(contentConfig.vpnLocation).toEqual({
    city: "Paris",
    country: "France",
    countryCode: "FR",
    timezone: "Europe/Paris",
    syncTimezone: true,
    syncGeolocation: true,
    syncLanguage: true,
    latitude: 48.86,
    longitude: 2.35,
  });
  expect(JSON.stringify(contentConfig)).not.toContain("secret.proxy");
  expect(createContentConfig(config, "cdn.video.test").vpnLocation).toMatchObject({
    city: "Tokyo",
    timezone: "Asia/Tokyo",
    latitude: 35.68,
    longitude: 139.65,
  });
  expect(resolveContentVpnLocation(config, "direct.test")).toBeNull();
  expect(resolveContentVpnLocation(config, "bypass.test")).toBeNull();
  expect(resolveContentVpnLocation(config, "localhost")).toBeNull();
  expect(resolveContentVpnLocation({ ...config, enabled: false }, "site.test")).toBeNull();
  expect(resolveContentVpnLocation(config, "")).toBeNull();
  expect(parseCoarseCoordinates({ loc: "invalid" })).toBeNull();
  expect(parseCoarseCoordinates({ loc: "91,181" })).toBeNull();
  expect(normalizeProxyLocation(null)).toEqual({
    city: "",
    region: "",
    country: "",
    countryCode: "",
    loc: "",
    org: "",
    timezone: "",
    source: "",
  });

  globalThis.isDomainAllowlisted = () => false;
  expect(resolveContentVpnLocation(config, "site.test")).toMatchObject({
    city: "Paris",
  });
  delete globalThis.isDomainAllowlisted;

  const selected = structuredClone(config);
  selected.proxy.routingMode = "protect-selected";
  expect(resolveContentVpnLocation(selected, "unmatched.test")).toBeNull();
  expect(resolveContentVpnLocation(selected, "cdn.video.test")).toMatchObject({
    city: "Tokyo",
  });
});

test("normalizeConfig restores safe values for malformed configuration", () => {
  const { DEFAULT_CONFIG, normalizeConfig } = loadConfigModule();
  const malformed = {
    enabled: "yes",
    globalWhitelist: 7,
    notifications: "broken",
    proxy: {
      enabled: "yes",
      routingMode: "invalid",
      syncTimezone: "yes",
      syncGeolocation: null,
      syncLanguage: "yes",
      activeProfile: "  Main  ",
      profiles: {},
      domainRoutes: null,
      bypassList: "localhost",
    },
    useragent: { enabled: 1, whitelist: [], preset: "unknown" },
    language: { enabled: 1, whitelist: [], preset: "unknown" },
    tracker: { enabled: 1, whitelist: [], useBuiltIn: "yes", customDomains: [] },
    timezone: { enabled: null, whitelist: false, offset: 9999, name: "  " },
    webrtc: { policy: "invalid" },
    canvas: { noiseLevel: "extreme" },
    clientrects: [],
    font: null,
    audiocontext: "invalid",
    webgl: { preset: "invalid" },
    webgpu: 5,
  };

  const normalized = normalizeConfig(malformed);
  const empty = normalizeConfig(null);
  const unknownFields = normalizeConfig({
    globalWhitelist: "trusted.test",
    notifications: { showFingerprints: true },
    proxy: {
      profiles: [
        {
          name: " Main ",
          host: " proxy.test ",
          port: 1080,
          scheme: " SOCKS5 ",
          remoteDNS: true,
          location: { city: "Paris" },
        },
        {
          name: "Backup",
          host: "backup.test",
          port: 8080,
          scheme: "http",
          location: [],
        },
        { name: null, host: null, port: 1, scheme: null },
      ],
      domainRoutes: [
        null,
        { pattern: " *.route.test ", profile: " Main " },
        { pattern: null, profile: null },
      ],
      bypassList: [" localhost ", null],
    },
    unknown: true,
    __proto__: { polluted: true },
  });

  expect(normalized.enabled).toBe(true);
  expect(normalized.globalWhitelist).toBe("");
  expect(normalized.notifications).toEqual(DEFAULT_CONFIG.notifications);
  expect(normalized.proxy).toMatchObject({
    enabled: false,
    routingMode: "bypass-selected",
    syncTimezone: true,
    syncGeolocation: true,
    syncLanguage: true,
    activeProfile: "Main",
    profiles: [],
    domainRoutes: [],
    bypassList: [],
  });
  expect(normalized.useragent).toMatchObject({
    enabled: true,
    whitelist: "",
    preset: DEFAULT_CONFIG.useragent.preset,
  });
  expect(normalized.language).toEqual(DEFAULT_CONFIG.language);
  expect(normalized.tracker).toEqual(DEFAULT_CONFIG.tracker);
  expect(normalized.timezone).toMatchObject({
    enabled: true,
    whitelist: DEFAULT_CONFIG.timezone.whitelist,
    offset: 60,
    name: "Europe/Paris",
  });
  expect(normalized.webrtc.policy).toBe(DEFAULT_CONFIG.webrtc.policy);
  expect(normalized.canvas.noiseLevel).toBe(DEFAULT_CONFIG.canvas.noiseLevel);
  expect(normalized.webgl.preset).toBe(DEFAULT_CONFIG.webgl.preset);
  expect(normalized.clientrects).toEqual(DEFAULT_CONFIG.clientrects);
  expect(normalized.font).toEqual(DEFAULT_CONFIG.font);
  expect(normalized.audiocontext).toEqual(DEFAULT_CONFIG.audiocontext);
  expect(normalized.webgpu).toEqual(DEFAULT_CONFIG.webgpu);
  expect(empty).toEqual(DEFAULT_CONFIG);
  expect(unknownFields.unknown).toBeUndefined();
  expect(unknownFields.polluted).toBeUndefined();
  expect({}.polluted).toBeUndefined();
  expect(unknownFields.globalWhitelist).toBe("trusted.test");
  expect(unknownFields.notifications.showFingerprints).toBeUndefined();
  expect(unknownFields.proxy.profiles).toEqual([
    {
      name: "Main",
      host: "proxy.test",
      port: 1080,
      scheme: "socks5",
      location: {
        city: "Paris",
        region: "",
        country: "",
        countryCode: "",
        loc: "",
        org: "",
        timezone: "",
        source: "",
      },
    },
    {
      name: "Backup",
      host: "backup.test",
      port: 8080,
      scheme: "http",
    },
    { name: "", host: "", port: 1, scheme: "" },
  ]);
  expect(unknownFields.proxy.domainRoutes).toEqual([
    {
      pattern: "*.route.test",
      profile: "Main",
    },
    { pattern: "", profile: "" },
  ]);
  expect(unknownFields.proxy.bypassList).toEqual(["localhost"]);
});

test("normalizeConfig preserves supported values and bounds user-controlled strings", () => {
  const { normalizeConfig } = loadConfigModule();
  const longValue = "x".repeat(200);
  const config = {
    useragent: { preset: "iphone" },
    webgl: { preset: "apple" },
    canvas: { noiseLevel: "high" },
    language: { preset: "sv-SE" },
    tracker: {
      enabled: true,
      whitelist: "trusted.metrics.test",
      useBuiltIn: false,
      customDomains: `*.metrics.test,${"x".repeat(20000)}`,
    },
    webrtc: { policy: "default_public_interface_only" },
    timezone: { offset: "-840", name: `  ${longValue}  ` },
    proxy: {
      routingMode: "protect-all",
      syncTimezone: false,
      syncGeolocation: false,
      syncLanguage: false,
      activeProfile: `  ${longValue}  `,
      fallbackProfiles: [" Backup ", "", 7, ...Array(12).fill("Extra")],
      profiles: [],
      domainRoutes: [],
      bypassList: [],
    },
  };

  const normalized = normalizeConfig(config);

  expect(normalized.useragent.preset).toBe("iphone");
  expect(normalized.webgl.preset).toBe("apple");
  expect(normalized.canvas.noiseLevel).toBe("high");
  expect(normalized.language.preset).toBe("sv-SE");
  expect(normalized.tracker).toMatchObject({
    enabled: true,
    whitelist: "trusted.metrics.test",
    useBuiltIn: false,
  });
  expect(normalized.tracker.customDomains).toHaveLength(16384);
  expect(normalized.webrtc.policy).toBe("default_public_interface_only");
  expect(normalized.timezone.offset).toBe(-840);
  expect(normalized.timezone.name).toBe(longValue.slice(0, 128));
  expect(normalized.proxy.activeProfile).toBe(longValue.slice(0, 128));
  expect(normalized.proxy.routingMode).toBe("protect-all");
  expect(normalized.proxy.syncTimezone).toBe(false);
  expect(normalized.proxy.syncGeolocation).toBe(false);
  expect(normalized.proxy.syncLanguage).toBe(false);
  expect(normalized.proxy.fallbackProfiles).toEqual([
    "Backup",
    ...Array(9).fill("Extra"),
  ]);
});

test("language identities stay internally consistent and can follow proxy countries", () => {
  const { getLanguagePreset, resolveLanguageIdentity } = loadConfigModule();
  const preset = getLanguagePreset("fr-FR");
  preset.languages.push("mutated");

  expect(getLanguagePreset("fr-FR")).toEqual({
    locale: "fr-FR",
    languages: ["fr-FR", "fr", "en"],
    acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
  });
  expect(getLanguagePreset("missing")).toBeNull();
  expect(
    resolveLanguageIdentity({ language: { preset: "sv-SE" } }),
  ).toEqual({
    locale: "sv-SE",
    languages: ["sv-SE", "sv", "en"],
    acceptLanguage: "sv-SE,sv;q=0.9,en;q=0.8",
    source: "preset",
  });

  const routed = {
    enabled: true,
    language: { preset: "en-US" },
    proxy: {
      enabled: true,
      routingMode: "protect-all",
      activeProfile: "Paris",
      profiles: [
        {
          name: "Paris",
          host: "proxy.test",
          port: 443,
          scheme: "https",
          location: { countryCode: "FR" },
        },
      ],
      domainRoutes: [],
      bypassList: [],
      syncLanguage: true,
    },
  };
  expect(resolveLanguageIdentity(routed, "site.test")).toMatchObject({
    locale: "fr-FR",
    source: "proxy",
  });
  routed.proxy.syncLanguage = false;
  expect(resolveLanguageIdentity(routed, "site.test")).toMatchObject({
    locale: "en-US",
    source: "preset",
  });
});

test("legacy route-only proxy settings migrate to protect-selected mode", () => {
  const { normalizeConfig } = loadConfigModule();
  const migrated = normalizeConfig({
    proxy: {
      enabled: true,
      activeProfile: null,
      profiles: [
        { name: "Route", host: "proxy.test", port: 443, scheme: "https" },
      ],
      domainRoutes: [{ pattern: "*.selected.test", profile: "Route" }],
      bypassList: [],
    },
  });
  expect(migrated.proxy.routingMode).toBe("protect-selected");
});

test("loadConfig fills missing fields without re-adding explicit allowlist values", async () => {
  const { DEFAULT_CONFIG, STORAGE_KEY, loadConfig } = loadConfigModule();
  globalThis.storage = {
    read: vi.fn().mockResolvedValue({
      [STORAGE_KEY]: {
        enabled: false,
        canvas: { whitelist: "custom.canvas" },
        proxy: { bypassList: ["localhost"] },
      },
    }),
  };

  const config = await loadConfig();

  expect(config.enabled).toBe(false);
  expect(config.canvas.whitelist).toBe("custom.canvas");
  expect(config.webgpu.whitelist).toBe(DEFAULT_CONFIG.webgpu.whitelist);
  expect(config.proxy.enabled).toBe(DEFAULT_CONFIG.proxy.enabled);
  expect(config.proxy.bypassList).toEqual(["localhost"]);
  expect(globalThis.storage.read).toHaveBeenCalledWith(STORAGE_KEY);
});

test("loadConfig uses defaults when storage has no saved config", async () => {
  const { DEFAULT_CONFIG, STORAGE_KEY, loadConfig } = loadConfigModule();
  globalThis.storage = {
    read: vi.fn().mockResolvedValue({}),
  };

  const config = await loadConfig();

  expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
  expect(config.canvas.whitelist).toBe(DEFAULT_CONFIG.canvas.whitelist);
  expect(globalThis.storage.read).toHaveBeenCalledWith(STORAGE_KEY);
});

test("saveConfig normalizes data through the configured storage API", async () => {
  const { STORAGE_KEY, saveConfig } = loadConfigModule();
  globalThis.storage = {
    write: vi.fn().mockResolvedValue(undefined),
  };

  await saveConfig({ enabled: false, unknown: true });

  expect(globalThis.storage.write.mock.calls[0][0][STORAGE_KEY]).toMatchObject(
    { enabled: false },
  );
  expect(globalThis.storage.write.mock.calls[0][0][STORAGE_KEY].unknown).toBeUndefined();
});

test("loadConfig reports a clear error when no storage API is available", async () => {
  const { loadConfig } = loadConfigModule();

  const result = loadConfig();

  await expect(result).rejects.toThrow("storage API is unavailable");
});
