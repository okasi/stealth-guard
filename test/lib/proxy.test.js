import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const domainPatterns = require("../../lib/domainFilter.js");
globalThis.normalizeDomainPattern = domainPatterns.normalizeDomainPattern;
globalThis.getDomainPatternParts = domainPatterns.getDomainPatternParts;
const {
  applyProxySettings,
  buildPacCondition,
  createUnknownProxyLocation,
  describeProxyChain,
  describeProxyFetchError,
  describeProxyProfile,
  fetchJson,
  formatProxyEndpoint,
  fetchProxyLocation,
  findInvalidProxyPattern,
  formatProxyServer,
  generatePACScript,
  generateProfileName,
  normalizeBypassList,
  normalizeIpApiLocation,
  normalizeIpInfoLocation,
  normalizeProxyHost,
  normalizeProxyName,
  normalizeProxyPattern,
  normalizeProxyPort,
  normalizeProxyProfile,
  normalizeProxyScheme,
  prepareProxyProfile,
  PROXY_VERIFICATION_HOST,
  PROXY_VERIFICATION_URL,
  setProxySettingsValue,
  setSystemProxySettings,
} = require("../../lib/proxy.js");

function installChromeMock() {
  const setCalls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        set(details, callback) {
          setCalls.push(details);
          callback();
        },
      },
    },
  };
  return setCalls;
}

function runPacScript(script, hostname) {
  const shExpMatch = (value, pattern) => {
    const expression = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${expression}$`).test(value);
  };
  const findProxy = new Function(
    "shExpMatch",
    `${script}; return FindProxyForURL;`,
  )(shExpMatch);
  return findProxy(`https://${hostname}/`, hostname);
}

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
  delete globalThis.loadConfig;
  delete globalThis.normalizeDomainPattern;
  delete globalThis.getDomainPatternParts;
  delete globalThis.callChromeApi;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("normalizes proxy values and strips unsupported profile fields", () => {
  const profile = normalizeProxyProfile({
    name: " Main ",
    scheme: " SOCKS5 ",
    host: " proxy.test ",
    port: "1080",
    remoteDNS: true,
    location: { city: "Paris" },
  });

  expect(normalizeProxyScheme(" HTTPS ")).toBe("https");
  expect(normalizeProxyScheme("ftp")).toBeNull();
  expect(normalizeProxyPort("65535")).toBe(65535);
  expect(normalizeProxyPort(null)).toBeNull();
  expect(normalizeProxyPort(0)).toBeNull();
  expect(normalizeProxyPort("1080junk")).toBeNull();
  expect(normalizeProxyHost("proxy.test")).toBe("proxy.test");
  expect(normalizeProxyHost("bad host")).toBeNull();
  expect(normalizeProxyName("  Main  ")).toBe("Main");
  expect(normalizeProxyName(" ")).toBeNull();
  expect(profile).toEqual({
    name: "Main",
    scheme: "socks5",
    host: "proxy.test",
    port: 1080,
    location: { city: "Paris" },
  });
  expect(normalizeProxyProfile(null)).toBeNull();
  expect(
    normalizeProxyProfile({ scheme: "ftp", host: "bad host", port: 0 }),
  ).toBeNull();
  expect(formatProxyServer(profile)).toBe("SOCKS5 proxy.test:1080");
  expect(formatProxyServer(null)).toBeNull();
});

test("normalizes locations and generates useful profile names", () => {
  expect(normalizeIpInfoLocation({})).toEqual({
    ...createUnknownProxyLocation("ipinfo.io"),
  });
  expect(
    normalizeIpInfoLocation({
      city: "Paris",
      country: "FR",
      org: "AS123 Example Org",
    }),
  ).toMatchObject({
    city: "Paris",
    country: "FR",
    countryCode: "FR",
    org: "Example Org",
    source: "ipinfo.io",
  });
  expect(
    normalizeIpApiLocation({
      city: "Berlin",
      country_name: "Germany",
      country_code: "DE",
      latitude: 1,
      longitude: 2,
    }),
  ).toMatchObject({
    city: "Berlin",
    country: "Germany",
    countryCode: "DE",
    loc: "1,2",
    source: "ipapi.co",
  });
  expect(normalizeIpApiLocation({}).loc).toBe("");
  expect(
    generateProfileName(
      { city: "Paris", countryCode: "FR", org: "Example" },
      "proxy.test",
    ),
  ).toBe("Paris, FR (Example)");
  expect(
    generateProfileName({ city: "Paris", country: "FR" }, "proxy.test"),
  ).toBe("Paris, FR");
  expect(
    generateProfileName({ city: "Paris", country: "France" }, "proxy.test"),
  ).toBe("Paris");
  expect(generateProfileName(createUnknownProxyLocation(), "proxy.test")).toBe(
    "Proxy proxy.test",
  );
});

test("fetchJson handles successful non-OK and no-AbortController requests", async () => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    .mockResolvedValueOnce({ ok: false });

  expect(await fetchJson("https://example.test")).toEqual({ ok: true });
  expect(await fetchJson("https://example.test/missing")).toBeNull();

  const originalAbortController = globalThis.AbortController;
  delete globalThis.AbortController;
  globalThis.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ fallback: true }),
  });
  expect(await fetchJson("https://example.test/fallback")).toEqual({
    fallback: true,
  });
  globalThis.AbortController = originalAbortController;
});

test("fetchJson aborts requests that exceed the timeout", async () => {
  vi.useFakeTimers();
  globalThis.fetch = vi.fn(
    (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );

  const pending = fetchJson("https://slow.test", 25);
  const rejection = expect(pending).rejects.toThrow("aborted");
  await vi.advanceTimersByTimeAsync(25);
  await rejection;
});

test("fetchProxyLocation tries providers in order and tolerates failures", async () => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ city: "Paris", country: "FR" }),
    })
    .mockRejectedValueOnce(new Error("ipinfo down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ city: "Berlin", country_code: "DE" }),
    })
    .mockResolvedValueOnce({ ok: false })
    .mockRejectedValueOnce(new Error("ipapi down"));

  expect(
    await fetchProxyLocation("proxy example"),
  ).toMatchObject({
    city: "Paris",
    source: "ipinfo.io",
  });
  expect(await fetchProxyLocation("fallback.test")).toMatchObject({
    city: "Berlin",
    source: "ipapi.co",
  });
  expect(await fetchProxyLocation("broken.test")).toEqual(
    createUnknownProxyLocation(),
  );
  expect(await fetchProxyLocation("")).toEqual(createUnknownProxyLocation());
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "https://ipinfo.io/proxy%20example/json",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("prepareProxyProfile validates and auto-names unnamed profiles", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ city: "Paris", country: "FR" }),
  });

  await expect(
    prepareProxyProfile({ host: "bad host", port: 1, scheme: "http" }),
  ).rejects.toThrow("Invalid proxy profile");
  expect(
    await prepareProxyProfile({
      name: "Main",
      host: "proxy.test",
      port: 8080,
      scheme: "http",
      location: { city: "Saved" },
    }),
  ).toEqual({
    name: "Main",
    host: "proxy.test",
    port: 8080,
    scheme: "http",
    location: {
      city: "Saved",
      region: "",
      country: "FR",
      countryCode: "FR",
      loc: "",
      org: "",
      timezone: "",
      source: "ipinfo.io",
    },
  });
  expect(
    await prepareProxyProfile({
      host: "proxy.test",
      port: 1080,
      scheme: "socks5",
    }),
  ).toMatchObject({
    name: "Paris, FR",
    location: { city: "Paris" },
  });
  globalThis.fetch.mockClear();
  expect(
    await prepareProxyProfile({
      name: "Complete",
      host: "complete.proxy.test",
      port: 443,
      scheme: "https",
      location: {
        city: "Tokyo",
        timezone: "Asia/Tokyo",
        loc: "35.68,139.65",
      },
    }),
  ).toMatchObject({ name: "Complete", location: { city: "Tokyo" } });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test("normalizes domain patterns and bypass lists", () => {
  expect(
    [
      "example.com",
      "*.example.com",
      "webmail.*",
      "*example.com",
      "*local*",
    ].map(normalizeProxyPattern),
  ).toEqual([
    "example.com",
    "*.example.com",
    "webmail.*",
    "*example.com",
    "*local*",
  ]);
  expect(normalizeProxyPattern("bad host")).toBeNull();
  expect(normalizeProxyHost(null)).toBeNull();
  expect(findInvalidProxyPattern(["", "example.com", "bad host"])).toBe(
    "bad host",
  );
  expect(findInvalidProxyPattern(null)).toBeNull();
  expect(
    normalizeBypassList(
      "bad host, example.com, *.site.test, 127.0.0.1, 10.*, example.com",
    ),
  ).toEqual([
    "example.com",
    "*.example.com",
    "*example.com",
    "*.site.test",
    "*site.test",
    "127.0.0.1",
    "10.*",
  ]);
  expect(normalizeBypassList(null)).toEqual([]);
});

test("builds PAC conditions and scripts for every pattern type", () => {
  expect(buildPacCondition("webmail.*")).toBe('shExpMatch(host, "webmail.*")');
  expect(buildPacCondition("*.example.com")).toContain(
    'host === "example.com"',
  );
  expect(buildPacCondition("*example.com")).toContain(
    'shExpMatch(host, "*.example.com")',
  );
  expect(buildPacCondition("*local*")).toBe('shExpMatch(host, "*local*")');
  expect(buildPacCondition("example.com")).toContain(
    'host === "www.example.com"',
  );
  expect(buildPacCondition("bad host")).toBeNull();

  const profiles = [
    { name: "Main", scheme: "socks5", host: "proxy.test", port: 1080 },
    { name: "Backup", scheme: "https", host: "backup.test", port: 443 },
    { name: "Duplicate", scheme: "socks5", host: "proxy.test", port: 1080 },
    { name: "Invalid", scheme: "ftp", host: "bad host", port: 0 },
  ];
  const pac = generatePACScript(
    profiles,
    [
      { pattern: "*.route.test", profile: "Main" },
      { pattern: "", profile: "Main" },
      { pattern: "missing.test", profile: "Missing" },
    ],
    "Main",
    "trusted.test",
    ["localhost", "trusted.test"],
    ["Backup", "Duplicate", "Invalid", "Missing"],
  );
  const directPac = generatePACScript([], [], null, "", []);
  const emptyPac = generatePACScript(undefined, undefined, null, null, null);
  const skippedPac = generatePACScript(
    [{ host: "proxy.test", port: 1080, scheme: "socks5" }],
    [null],
    null,
    "",
    [],
  );
  const forcedVerificationPac = generatePACScript(
    profiles,
    [],
    "Main",
    "*.org",
    [],
    ["Backup"],
  );
  const protectSelectedPac = generatePACScript(
    profiles,
    [{ pattern: "*.route.test", profile: "Backup" }],
    "Main",
    "",
    ["ignored-bypass.test"],
    [],
    "protect-selected",
  );
  const protectAllPac = generatePACScript(
    profiles,
    [],
    "Main",
    "",
    ["ignored-bypass.test"],
    [],
    "protect-all",
  );

  expect(pac).toContain('return "DIRECT"');
  expect(pac).toContain('return "SOCKS5 proxy.test:1080"');
  expect(pac).toContain(
    'return "SOCKS5 proxy.test:1080; HTTPS backup.test:443"',
  );
  expect(pac.match(/trusted\.test/g)).toHaveLength(2);
  expect(pac).not.toContain("missing.test");
  expect(runPacScript(pac, "trusted.test")).toBe("DIRECT");
  expect(runPacScript(pac, "api.route.test")).toBe(
    "SOCKS5 proxy.test:1080",
  );
  expect(runPacScript(pac, "unrelated.test")).toBe(
    "SOCKS5 proxy.test:1080; HTTPS backup.test:443",
  );
  expect(runPacScript(directPac, "unrelated.test")).toBe("DIRECT");
  expect(directPac).toContain('return "DIRECT"');
  expect(directPac).not.toContain(PROXY_VERIFICATION_HOST);
  expect(runPacScript(directPac, PROXY_VERIFICATION_HOST)).toBe("DIRECT");
  expect(emptyPac).toContain('return "DIRECT"');
  expect(emptyPac).not.toContain(PROXY_VERIFICATION_HOST);
  expect(skippedPac).toContain('return "DIRECT"');
  expect(PROXY_VERIFICATION_URL).toContain(PROXY_VERIFICATION_HOST);
  expect(runPacScript(forcedVerificationPac, "example.org")).toBe("DIRECT");
  expect(runPacScript(forcedVerificationPac, PROXY_VERIFICATION_HOST)).toBe(
    "SOCKS5 proxy.test:1080; HTTPS backup.test:443",
  );
  expect(runPacScript(protectSelectedPac, "cdn.route.test")).toBe(
    "HTTPS backup.test:443",
  );
  expect(runPacScript(protectSelectedPac, "unmatched.test")).toBe("DIRECT");
  expect(runPacScript(protectAllPac, "ignored-bypass.test")).toBe(
    "SOCKS5 proxy.test:1080",
  );
});

test("proxy settings helpers resolve and reject browser errors", async () => {
  const calls = installChromeMock();
  await setProxySettingsValue({ mode: "system" });
  await setSystemProxySettings();
  globalThis.callChromeApi = require("../../lib/runtime.js").callChromeApi;
  await setSystemProxySettings();
  expect(calls.map((call) => call.value.mode)).toEqual([
    "system",
    "system",
    "system",
  ]);

  chrome.runtime.lastError = { message: "denied" };
  await expect(setSystemProxySettings()).rejects.toThrow("denied");
  chrome.runtime.lastError = "string denied";
  await expect(setSystemProxySettings()).rejects.toThrow("string denied");
});

test("applyProxySettings selects system fixed and PAC modes", async () => {
  const calls = installChromeMock();
  await applyProxySettings({ enabled: false });
  await applyProxySettings({ enabled: true, proxy: { enabled: false } });
  await applyProxySettings({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [
        { name: "Main", host: "proxy.test", port: 1080, scheme: "socks5" },
      ],
      domainRoutes: [],
      bypassList: ["example.com"],
    },
  });
  await applyProxySettings({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      routingMode: "protect-all",
      activeProfile: "Main",
      profiles: [
        { name: "Main", host: "proxy.test", port: 443, scheme: "https" },
      ],
      domainRoutes: [{ pattern: "*.secure.test", profile: "Main" }],
      bypassList: ["ignored.test"],
    },
  });
  await applyProxySettings({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [
        { name: "Main", host: "proxy.test", port: 1080, scheme: "socks5" },
        { host: "unnamed.test", port: 8080, scheme: "http" },
        { host: "bad host", port: 0, scheme: "ftp" },
      ],
      domainRoutes: [],
      bypassList: [],
    },
  });
  await applyProxySettings({
    enabled: true,
    globalWhitelist: "*.trusted.test",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [
        { name: "Main", host: "proxy.test", port: 8080, scheme: "http" },
      ],
      domainRoutes: [
        null,
        { pattern: null, profile: "Main" },
        { pattern: "*.route.test", profile: "Main" },
      ],
      bypassList: [],
    },
  });
  await applyProxySettings({
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      fallbackProfiles: ["Backup", "Main", "Backup"],
      profiles: [
        { name: "Main", host: "proxy.test", port: 443, scheme: "https" },
        { name: "Backup", host: "backup.test", port: 443, scheme: "https" },
      ],
      domainRoutes: [],
      bypassList: [],
    },
  });

  expect(calls.map((call) => call.value.mode)).toEqual([
    "system",
    "system",
    "fixed_servers",
    "pac_script",
    "fixed_servers",
    "pac_script",
    "pac_script",
  ]);
  expect(calls[2].value.rules.bypassList).toContain("*.example.com");
  expect(calls[5].value.pacScript.data).toContain("*.trusted.test");
  expect(calls[6].value.pacScript.data).toContain(
    "HTTPS proxy.test:443; HTTPS backup.test:443",
  );
  expect(calls[3].value.pacScript.data).not.toContain("ignored.test");
});

test("applyProxySettings loads config and rejects every invalid enabled state", async () => {
  installChromeMock();
  globalThis.loadConfig = vi.fn(async () => ({ enabled: false }));
  await applyProxySettings();
  expect(loadConfig).toHaveBeenCalledOnce();

  const base = {
    enabled: true,
    globalWhitelist: "",
    proxy: {
      enabled: true,
      activeProfile: "Main",
      profiles: [
        { name: "Main", host: "proxy.test", port: 8080, scheme: "http" },
      ],
      domainRoutes: [],
      bypassList: [],
    },
  };

  await expect(
    applyProxySettings({
      ...base,
      proxy: { ...base.proxy, bypassList: ["https://bad.test"] },
    }),
  ).rejects.toThrow("Invalid bypass pattern");
  await expect(
    applyProxySettings({
      ...base,
      proxy: {
        ...base.proxy,
        domainRoutes: [{ pattern: "bad host", profile: "Main" }],
      },
    }),
  ).rejects.toThrow("Invalid domain route pattern");
  await expect(
    applyProxySettings({
      ...base,
      proxy: {
        ...base.proxy,
        domainRoutes: [{ pattern: "*.route.test", profile: "Missing" }],
      },
    }),
  ).rejects.toThrow("references missing or invalid profile");
  await expect(
    applyProxySettings({
      ...base,
      proxy: { ...base.proxy, activeProfile: "Missing" },
    }),
  ).rejects.toThrow("Active profile not found");
  await expect(
    applyProxySettings({
      ...base,
      proxy: { ...base.proxy, activeProfile: null },
    }),
  ).rejects.toThrow("no valid active profile");
  await expect(
    applyProxySettings({
      ...base,
      proxy: {
        ...base.proxy,
        routingMode: "protect-selected",
        activeProfile: null,
        domainRoutes: [],
      },
    }),
  ).rejects.toThrow("requires at least one domain route");
  await expect(
    applyProxySettings({
      ...base,
      proxy: { ...base.proxy, fallbackProfiles: ["Missing"] },
    }),
  ).rejects.toThrow("Fallback profile not found");
  await expect(
    applyProxySettings({
      ...base,
      proxy: {
        enabled: true,
        activeProfile: null,
        profiles: undefined,
        domainRoutes: undefined,
        bypassList: [],
      },
    }),
  ).rejects.toThrow("no valid active profile");
});

test("proxy profiles describe themselves for connection errors", () => {
  const profile = { name: "Paris", scheme: "socks5", host: "1.2.3.4", port: 1080 };
  expect(formatProxyEndpoint(profile)).toBe("socks5://1.2.3.4:1080");
  expect(formatProxyEndpoint({ host: "bad host" })).toBeNull();
  expect(describeProxyProfile(profile)).toBe("Paris (socks5://1.2.3.4:1080)");
  expect(describeProxyProfile({ ...profile, name: "  " })).toBe(
    "socks5://1.2.3.4:1080",
  );
  expect(describeProxyProfile(null)).toBeNull();

  expect(describeProxyChain()).toBe("the configured proxy");
  expect(describeProxyChain([{ host: "bad host" }])).toBe(
    "the configured proxy",
  );
  expect(describeProxyChain([profile])).toBe("Paris (socks5://1.2.3.4:1080)");
  expect(
    describeProxyChain([
      profile,
      { name: "Berlin", scheme: "http", host: "p.test", port: 80 },
    ]),
  ).toBe(
    "proxy chain Paris (socks5://1.2.3.4:1080) then Berlin (http://p.test:80)",
  );
});

test("proxy fetch failures explain the underlying cause", () => {
  const abortError = Object.assign(new Error("aborted"), {
    name: "AbortError",
  });
  expect(describeProxyFetchError(abortError, 5000)).toBe(
    "no response within 5000 ms — the proxy accepted the connection but " +
      "never returned the request",
  );

  expect(describeProxyFetchError(new TypeError("Failed to fetch"), 5000)).toBe(
    "Failed to fetch — the browser could not complete the request through " +
      "the proxy (host unreachable, connection refused, TLS failure, or the " +
      "proxy rejected the request)",
  );
  expect(describeProxyFetchError(new TypeError(""), 5000)).toMatch(
    /^TypeError — the browser could not complete/,
  );
  expect(
    describeProxyFetchError(new Error("NetworkError while fetching"), 5000),
  ).toMatch(/^NetworkError while fetching — the browser could not complete/);

  expect(describeProxyFetchError(new Error("boom"), 5000)).toBe("boom");
  expect(describeProxyFetchError(new Error(""), 5000)).toBe("Error");
  expect(describeProxyFetchError(null, 5000)).toBe("null");
});
