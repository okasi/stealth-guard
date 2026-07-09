import { afterEach, expect, test, vi } from "vitest";
import {
  addDomainRoute,
  addProxyProfile,
  applyProxySettings,
  createUnknownProxyLocation,
  disableProxy,
  enableProxy,
  fetchProxyLocation,
  formatProxyServer,
  generatePACScript,
  generateProfileName,
  getDomainRoutes,
  getProxyProfiles,
  normalizeBypassList,
  normalizeProxyHost,
  normalizeProxyPattern,
  normalizeProxyPort,
  normalizeProxyProfile,
  normalizeProxyScheme,
  removeDomainRoute,
  removeProxyProfile,
  sanitizePacComment,
  setProxySettingsValue,
  setSystemProxySettings,
  testProxyConnection
} from "../../lib/proxy.js";

function installProxyChromeMock(originalValue = { mode: "system" }) {
  const setCalls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        set(details, callback) {
          setCalls.push(details);
          if (callback) callback();
        },
        get(details, callback) {
          callback({ value: originalValue });
        }
      }
    }
  };
  return setCalls;
}

function installConfigMock(initialConfig) {
  let config = structuredClone(initialConfig);
  globalThis.loadConfig = vi.fn(async () => structuredClone(config));
  globalThis.saveConfig = vi.fn(async (nextConfig) => {
    config = structuredClone(nextConfig);
  });
  return () => config;
}

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
  delete globalThis.loadConfig;
  delete globalThis.saveConfig;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("proxy normalizers accept valid values and reject unsafe imported values", () => {
  // Arrange
  const validProfile = { name: "Main", scheme: " SOCKS5 ", host: "proxy.example", port: "1080" };
  const invalidProfile = { scheme: "ftp", host: "bad host", port: "70000" };

  // Act
  const scheme = normalizeProxyScheme(validProfile.scheme);
  const emptyScheme = normalizeProxyScheme(null);
  const badScheme = normalizeProxyScheme(invalidProfile.scheme);
  const port = normalizeProxyPort(validProfile.port);
  const badPort = normalizeProxyPort(invalidProfile.port);
  const host = normalizeProxyHost(validProfile.host);
  const emptyHost = normalizeProxyHost(null);
  const badHost = normalizeProxyHost('evil";return"DIRECT"');
  const urlHost = normalizeProxyHost("http://proxy.test/path");
  const profile = normalizeProxyProfile(validProfile);
  const missingProfile = normalizeProxyProfile(null);
  const formatted = formatProxyServer(validProfile);
  const missingFormatted = formatProxyServer(invalidProfile);

  // Assert
  expect([scheme, emptyScheme, badScheme, port, badPort, host, emptyHost, badHost, urlHost, missingProfile]).toEqual([
    "socks5",
    null,
    null,
    1080,
    null,
    "proxy.example",
    null,
    null,
    null,
    null
  ]);
  expect(profile).toMatchObject({ scheme: "socks5", host: "proxy.example", port: 1080 });
  expect(normalizeProxyProfile(invalidProfile)).toBeNull();
  expect(formatted).toBe("SOCKS5 proxy.example:1080");
  expect(missingFormatted).toBeNull();
});

test("normalizeBypassList expands plain domains and deduplicates patterns", () => {
  // Arrange
  const bypass = "example.com, *.site.test, 127.0.0.1, 10.*, https://invalid.test, example.com";

  // Act
  const normalized = normalizeBypassList(bypass);
  const arrayNormalized = normalizeBypassList(["", " spaced.test "]);
  const empty = normalizeBypassList(null);

  // Assert
  expect(normalized).toEqual([
    "example.com",
    "*.example.com",
    "*example.com",
    "*.site.test",
    "*site.test",
    "127.0.0.1",
    "10.*"
  ]);
  expect(arrayNormalized).toEqual(["spaced.test", "*.spaced.test", "*spaced.test"]);
  expect(empty).toEqual([]);
});

test("normalizeProxyPattern accepts known route shapes and rejects unsafe patterns", () => {
  // Arrange
  const values = [
    " Example.COM ",
    "*.example.com",
    "webmail.*",
    "*route.test",
    "*localhost*",
    "bad host",
    "bad\nhost",
    "**.example.com",
    "*",
    "example..com",
    "https://example.com",
    null
  ];

  // Act
  const normalized = values.map(value => normalizeProxyPattern(value));

  // Assert
  expect(normalized).toEqual([
    "example.com",
    "*.example.com",
    "webmail.*",
    "*route.test",
    "*localhost*",
    null,
    null,
    null,
    null,
    null,
    null,
    null
  ]);
});

test("generatePACScript routes valid profiles escapes output and skips unsafe profiles", () => {
  // Arrange
  const profiles = [
    { name: "Main", scheme: "socks5", host: "proxy.example", port: 1080 },
    { name: "Bad\nName", scheme: "socks5", host: 'evil";return "DIRECT"', port: 1080 }
  ];
  const routes = [
    { pattern: "*.example.com", profile: "Main" },
    { pattern: "webmail.*", profile: "Main" },
    { pattern: "*route.test", profile: "Main" },
    { pattern: "plain.test", profile: "Main" },
    { pattern: "*localhost*", profile: "Main" },
    { pattern: "bad.test", profile: "Bad\nName" }
  ];

  // Act
  const pac = generatePACScript(profiles, routes, "Main", "trusted.com", ["localhost"]);
  const directPac = generatePACScript([], [{ pattern: "", profile: "Main" }, { pattern: null, profile: "Main" }], null, null, [
    "webmail.*",
    "*example.com",
    "*localhost*"
  ]);
  const noDirectPac = generatePACScript([{ name: "Main", scheme: "http", host: "proxy.test", port: 8080 }], [], "Main", "", []);

  // Assert
  expect(pac).toContain('host = host.toLowerCase();');
  expect(pac).toContain('return "DIRECT";');
  expect(pac).toContain('return "SOCKS5 proxy.example:1080";');
  expect(pac).toContain('shExpMatch(host, "*.example.com")');
  expect(pac).toContain('shExpMatch(host, "webmail.*")');
  expect(pac).toContain('shExpMatch(host, "*.route.test")');
  expect(pac).toContain('host === "plain.test"');
  expect(pac).toContain('shExpMatch(host, "*localhost*")');
  expect(pac).not.toContain("evil");
  expect(directPac).toContain('shExpMatch(host, "webmail.*")');
  expect(directPac).toContain('shExpMatch(host, "*.example.com")');
  expect(directPac).toContain('shExpMatch(host, "*localhost*")');
  expect(directPac).toContain('return "DIRECT";');
  expect(noDirectPac).toContain('return "HTTP proxy.test:8080";');
});

test("PAC comments are printable single-line text", () => {
  // Arrange
  const comment = "Line 1\nLine 2\t☃";

  // Act
  const sanitized = sanitizePacComment(comment);
  const empty = sanitizePacComment(null);

  // Assert
  expect(sanitized).toBe("Line 1 Line 2??");
  expect(empty).toBe("");
});

test("fetchProxyLocation uses ipinfo success then encoded fallback and final fallback", async () => {
  // Arrange
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ city: "Paris", country: "FR" }) })
    .mockRejectedValueOnce(new Error("ipinfo down"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ city: "Berlin", country_name: "Germany", latitude: 1, longitude: 2 }) })
    .mockRejectedValueOnce(new Error("ipinfo down"))
    .mockRejectedValueOnce(new Error("ipapi down"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValue({ ok: false });

  // Act
  const ipinfo = await fetchProxyLocation("proxy example", "token value");
  const ipapi = await fetchProxyLocation("fallback.example");
  const caughtFallback = await fetchProxyLocation("broken.example");
  const ipinfoDefaults = await fetchProxyLocation("empty-ipinfo.example");
  const ipapiDefaults = await fetchProxyLocation("empty-ipapi.example");
  const fallback = await fetchProxyLocation("unknown.example");
  const empty = await fetchProxyLocation("");

  // Assert
  expect(ipinfo).toMatchObject({ city: "Paris", country: "FR", source: "ipinfo.io" });
  expect(ipapi).toMatchObject({ city: "Berlin", country: "Germany", loc: "1,2", source: "ipapi.co" });
  expect(caughtFallback).toEqual(createUnknownProxyLocation("fallback"));
  expect(ipinfoDefaults).toMatchObject({ city: "Unknown", region: "", country: "Unknown", loc: "", org: "", timezone: "", source: "ipinfo.io" });
  expect(ipapiDefaults).toMatchObject({ city: "Unknown", region: "", country: "Unknown", loc: "undefined,undefined", org: "", timezone: "", source: "ipapi.co" });
  expect(fallback).toEqual(createUnknownProxyLocation("fallback"));
  expect(empty).toEqual(createUnknownProxyLocation("fallback"));
  expect(fetch).toHaveBeenNthCalledWith(1, "https://ipinfo.io/proxy%20example?token=token%20value");
  expect(warn).toHaveBeenCalledTimes(2);
  expect(error).toHaveBeenCalledOnce();
});

test("profile names prefer known location city and fall back to host", () => {
  // Arrange
  const known = { city: "San Francisco", country: "United States" };
  const unknown = { city: "Unknown", country: "US" };

  // Act
  const knownName = generateProfileName(known, "1.2.3.4");
  const fallbackName = generateProfileName(unknown, "1.2.3.4");

  // Assert
  expect(knownName).toBe("San Francisco, UN");
  expect(fallbackName).toBe("Proxy 1.2.3.4");
});

test("profile and route helpers mutate persisted proxy config", async () => {
  // Arrange
  const getConfig = installConfigMock({
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [{ name: "Main", host: "one.test", port: 1, scheme: "http" }],
      domainRoutes: [{ pattern: "*.old.test", profile: "Main" }]
    }
  });

  // Act
  const added = await addProxyProfile({ name: "Main", host: "two.test", port: 2, scheme: "https" });
  await addDomainRoute("*.new.test", added.name);
  await addDomainRoute("*.new.test", "Main");
  const profiles = await getProxyProfiles();
  const routes = await getDomainRoutes();
  await removeDomainRoute("*.old.test");
  await removeProxyProfile("Main");

  // Assert
  expect(added.name).toBe("Main (1)");
  expect(profiles.map((profile) => profile.name)).toEqual(["Main", "Main (1)"]);
  expect(routes.find((route) => route.pattern === "*.new.test").profile).toBe("Main");
  expect(getConfig().proxy.enabled).toBe(false);
  expect(getConfig().proxy.activeProfile).toBeNull();
  expect(getConfig().proxy.domainRoutes).toEqual([]);
});

test("proxy config helpers tolerate missing optional arrays", async () => {
  // Arrange
  const getConfig = installConfigMock({
    proxy: {
      enabled: true,
      activeProfile: "Other",
      profiles: [{ name: "Main", host: "one.test", port: 1, scheme: "http" }]
    }
  });

  // Act
  await addProxyProfile({ name: "Added", host: "two.test", port: 2, scheme: "https" });
  const profiles = await getProxyProfiles();
  await removeProxyProfile("Main");
  await addDomainRoute("*.added.test", "Added");
  const routes = await getDomainRoutes();
  await removeDomainRoute("*.missing.test");
  globalThis.loadConfig = vi.fn(async () => ({}));
  const emptyProfiles = await getProxyProfiles();
  const emptyRoutes = await getDomainRoutes();

  // Assert
  expect(profiles.map((profile) => profile.name)).toEqual(["Main", "Added"]);
  expect(getConfig().proxy.activeProfile).toBe("Other");
  expect(routes).toEqual([{ pattern: "*.added.test", profile: "Added" }]);
  expect(emptyProfiles).toEqual([]);
  expect(emptyRoutes).toEqual([]);
});

test("proxy config mutators initialize missing profile and route arrays", async () => {
  // Arrange
  installConfigMock({ proxy: {} });

  // Act
  await addProxyProfile({ name: "Added", host: "two.test", port: 2, scheme: "https" });
  const addSave = globalThis.saveConfig;
  installConfigMock({ proxy: {} });
  await removeProxyProfile("Missing");
  const removeSave = globalThis.saveConfig;
  installConfigMock({ proxy: {} });
  await addDomainRoute("*.added.test", "Added");
  const addRouteSave = globalThis.saveConfig;
  installConfigMock({ proxy: {} });
  await removeDomainRoute("*.missing.test");
  const removeRouteSave = globalThis.saveConfig;

  // Assert
  expect(addSave).toHaveBeenCalledWith({
    proxy: {
      profiles: [{ name: "Added", host: "two.test", port: 2, scheme: "https" }]
    }
  });
  expect(removeSave).toHaveBeenCalledWith({ proxy: { profiles: [], domainRoutes: [] } });
  expect(addRouteSave).toHaveBeenCalledWith({ proxy: { domainRoutes: [{ pattern: "*.added.test", profile: "Added" }] } });
  expect(removeRouteSave).toHaveBeenCalledWith({ proxy: { domainRoutes: [] } });
});

test("addProxyProfile fetches a generated name when the profile name is empty", async () => {
  // Arrange
  installConfigMock({
    proxy: {
      enabled: false,
      activeProfile: null,
      profiles: [],
      domainRoutes: []
    }
  });
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ city: "Paris", country: "FR" })
  });

  // Act
  const added = await addProxyProfile({ name: " ", host: "proxy.test", port: 1080, scheme: "socks5" });

  // Assert
  expect(added.name).toBe("Paris, FR");
  expect(added.location).toMatchObject({ city: "Paris", country: "FR" });
});

test("enableProxy and disableProxy persist state and apply browser settings", async () => {
  // Arrange
  const setCalls = installProxyChromeMock();
  const getConfig = installConfigMock({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: false,
      activeProfile: null,
      profiles: [{ name: "Main", host: "proxy.test", port: 1080, scheme: "socks5" }],
      domainRoutes: [],
      bypassList: []
    }
  });

  // Act
  await enableProxy("Main");
  await disableProxy();

  // Assert
  expect(getConfig().proxy.enabled).toBe(false);
  expect(getConfig().proxy.activeProfile).toBeNull();
  expect(setCalls[0].value.mode).toBe("fixed_servers");
  expect(setCalls[1].value.mode).toBe("system");
});

test("applyProxySettings chooses system mode for disabled configurations and rejects enabled empty configurations", async () => {
  // Arrange
  const setCalls = installProxyChromeMock();
  const configs = [
    { enabled: false },
    { enabled: true, proxy: { enabled: false } },
    { enabled: true, proxy: { enabled: true, profiles: [], domainRoutes: [], activeProfile: null, bypassList: [] } },
    { enabled: true, proxy: { enabled: true } }
  ];
  globalThis.loadConfig = vi.fn(async () => configs.shift());

  // Act
  await applyProxySettings();
  await applyProxySettings();

  // Assert
  expect(setCalls.map((call) => call.value.mode)).toEqual(["system", "system"]);
  await expect(applyProxySettings()).rejects.toThrow("no valid active profile or domain route");
  await expect(applyProxySettings()).rejects.toThrow("no valid active profile or domain route");
});

test("applyProxySettings applies fixed servers and rejects invalid active profile", async () => {
  // Arrange
  const setCalls = installProxyChromeMock();
  const configs = [
    {
      enabled: true,
      globalWhitelist: "",
      proxy: {
        enabled: true,
        activeProfile: "Main",
        profiles: [
          { name: "Main", host: "proxy.test", port: 1080, scheme: "socks5" },
          { host: "unnamed-proxy.test", port: 1080, scheme: "socks5" }
        ],
        domainRoutes: [],
        bypassList: ["example.com"]
      }
    },
    {
      enabled: true,
      globalWhitelist: "",
      proxy: {
        enabled: true,
        activeProfile: "Missing",
        profiles: [],
        domainRoutes: [],
        bypassList: []
      }
    }
  ];
  globalThis.loadConfig = vi.fn(async () => configs.shift());

  // Act
  await applyProxySettings();

  // Assert
  expect(setCalls[0].value).toMatchObject({ mode: "fixed_servers" });
  expect(setCalls[0].value.rules.bypassList).toContain("*.example.com");
  await expect(applyProxySettings()).rejects.toThrow("Active profile not found or invalid");
});

test("applyProxySettings uses PAC mode when routes or global allowlist require it", async () => {
  // Arrange
  const setCalls = installProxyChromeMock();
  globalThis.loadConfig = vi.fn(async () => ({
    enabled: true,
    globalWhitelist: "*.trusted.test",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [{ name: "Main", host: "proxy.test", port: 8080, scheme: "http" }],
      domainRoutes: [{ pattern: "*.route.test", profile: "Main" }],
      bypassList: []
    }
  }));

  // Act
  await applyProxySettings();

  // Assert
  expect(setCalls[0].value.mode).toBe("pac_script");
  expect(setCalls[0].value.pacScript.data).toContain("*.trusted.test");
  expect(setCalls[0].value.pacScript.data).toContain("*.route.test");
});

test("applyProxySettings rejects enabled configs with invalid domain routes", async () => {
  // Arrange
  installProxyChromeMock();
  globalThis.loadConfig = vi.fn(async () => ({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [{ name: "Main", host: "proxy.test", port: 8080, scheme: "http" }],
      domainRoutes: [
        null,
        { pattern: "   ", profile: null },
        { pattern: "*.route.test", profile: "Main" },
        { pattern: "*.leak.test", profile: "Missing" }
      ],
      bypassList: []
    }
  }));

  // Act
  const result = applyProxySettings();

  // Assert
  await expect(result).rejects.toThrow('Domain route "*.leak.test" references missing or invalid profile');
});

test("applyProxySettings rejects enabled configs with invalid route patterns", async () => {
  // Arrange
  installProxyChromeMock();
  globalThis.loadConfig = vi.fn(async () => ({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: null,
      profiles: [{ name: "Main", host: "proxy.test", port: 8080, scheme: "http" }],
      domainRoutes: [{ pattern: "bad host", profile: "Main" }],
      bypassList: []
    }
  }));

  // Act
  const result = applyProxySettings();

  // Assert
  await expect(result).rejects.toThrow("Invalid domain route pattern: bad host");
});

test("applyProxySettings rejects enabled configs with invalid bypass patterns", async () => {
  // Arrange
  installProxyChromeMock();
  globalThis.loadConfig = vi.fn(async () => ({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [{ name: "Main", host: "proxy.test", port: 8080, scheme: "http" }],
      domainRoutes: [],
      bypassList: ["", "https://leak.test"]
    }
  }));

  // Act
  const result = applyProxySettings();

  // Assert
  await expect(result).rejects.toThrow("Invalid bypass pattern: https://leak.test");
});

test("setProxySettingsValue resolves success and rejects chrome errors", async () => {
  // Arrange
  const setCalls = installProxyChromeMock();

  // Act
  await setProxySettingsValue({ mode: "system" });
  chrome.runtime.lastError = { message: "denied" };
  const failed = setSystemProxySettings();
  await expect(failed).rejects.toThrow("denied");
  chrome.runtime.lastError = "string denied";
  const stringFailed = setSystemProxySettings();

  // Assert
  expect(setCalls[0].value).toEqual({ mode: "system" });
  await expect(stringFailed).rejects.toThrow("string denied");
});

test("testProxyConnection validates input applies temporary proxy and restores settings on success", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = installProxyChromeMock({ mode: "direct" });
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: "203.0.113.10" }) });

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const success = await pending;

  // Assert
  expect(success).toBe(true);
  expect(setCalls[0].value.mode).toBe("fixed_servers");
  expect(setCalls[1].value).toEqual({ mode: "direct" });
});

test("testProxyConnection returns false when the response has no IP and restores missing original value to system", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        get(details, callback) {
          callback({});
        },
        set(details, callback) {
          setCalls.push(details);
          callback();
        }
      }
    }
  };
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const success = await pending;

  // Assert
  expect(success).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
});

test("testProxyConnection returns false and restores settings on invalid input or request failure", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = installProxyChromeMock({ mode: "system" });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

  // Act
  const invalid = await testProxyConnection("bad host", "1080", "socks5");
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const failed = await pending;

  // Assert
  expect(invalid).toBe(false);
  expect(failed).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
  expect(error).toHaveBeenCalled();
});

test("testProxyConnection treats non-OK responses as failures", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = installProxyChromeMock({ mode: "system" });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 });

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const failed = await pending;

  // Assert
  expect(failed).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
  expect(error).toHaveBeenCalledWith("[Proxy] Test failed:", expect.any(Error));
});

test("testProxyConnection falls back to system restore and reports restore failures", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = [];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        get(details, callback) {
          callback(null);
        },
        set(details, callback) {
          setCalls.push(details);
          if (setCalls.length === 2) {
            chrome.runtime.lastError = { message: "restore denied" };
          }
          callback();
        }
      }
    }
  };
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const failed = await pending;

  // Assert
  expect(failed).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
  expect(error).toHaveBeenCalledWith("[Proxy] Failed to restore settings:", expect.any(Error));
});

test("testProxyConnection uses system fallback when a failed request has original settings without a value", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = [];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        get(details, callback) {
          callback({});
        },
        set(details, callback) {
          setCalls.push(details);
          callback();
        }
      }
    }
  };
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(500);
  const failed = await pending;

  // Assert
  expect(failed).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
  expect(error).toHaveBeenCalledWith("[Proxy] Test failed:", expect.any(Error));
});

test("testProxyConnection aborts timed out connectivity checks", async () => {
  // Arrange
  vi.useFakeTimers();
  const setCalls = installProxyChromeMock({ mode: "system" });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi.fn((url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });

  // Act
  const pending = testProxyConnection("proxy.test", "1080", "socks5");
  await vi.advanceTimersByTimeAsync(10500);
  const failed = await pending;

  // Assert
  expect(failed).toBe(false);
  expect(setCalls.at(-1).value).toEqual({ mode: "system" });
  expect(error).toHaveBeenCalledWith("[Proxy] Test failed:", expect.any(Error));
});
