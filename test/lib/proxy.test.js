import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  applyProxySettings,
  buildPacCondition,
  createUnknownProxyLocation,
  fetchJson,
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
  sanitizePacComment,
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

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
  delete globalThis.loadConfig;
  delete globalThis.normalizeDomainPattern;
  delete globalThis.getDomainPatternParts;
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
  expect(normalizeProxyPort(0)).toBeNull();
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
    await fetchProxyLocation("proxy example", "token value"),
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
    "https://ipinfo.io/proxy%20example?token=token%20value",
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
    location: { city: "Saved" },
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

test("uses globally supplied domain helpers in browser-style bundles", () => {
  globalThis.normalizeDomainPattern = vi.fn(() => "browser.test");
  globalThis.getDomainPatternParts = vi.fn(() => ({
    pattern: "browser.test",
    type: "plain",
    value: "browser.test",
  }));

  expect(normalizeProxyPattern("anything")).toBe("browser.test");
  expect(buildPacCondition("anything")).toContain("browser.test");
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

  expect(pac).toContain('return "DIRECT"');
  expect(pac).toContain('return "SOCKS5 proxy.test:1080"');
  expect(pac.match(/trusted\.test/g)).toHaveLength(2);
  expect(pac).toContain("Route *.route.test -> Main");
  expect(pac).not.toContain("missing.test");
  expect(directPac).toContain('return "DIRECT"');
  expect(emptyPac).toContain('return "DIRECT"');
  expect(skippedPac).toContain('return "DIRECT"');
  expect(sanitizePacComment("Line 1\nLine 2\t☃")).toBe("Line 1 Line 2??");
});

test("proxy settings helpers resolve and reject browser errors", async () => {
  const calls = installChromeMock();
  await setProxySettingsValue({ mode: "system" });
  await setSystemProxySettings();
  expect(calls.map((call) => call.value.mode)).toEqual(["system", "system"]);

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
      domainRoutes: [{ pattern: "*.route.test", profile: "Main" }],
      bypassList: [],
    },
  });

  expect(calls.map((call) => call.value.mode)).toEqual([
    "system",
    "system",
    "fixed_servers",
    "fixed_servers",
    "pac_script",
  ]);
  expect(calls[2].value.rules.bypassList).toContain("*.example.com");
  expect(calls[4].value.pacScript.data).toContain("*.trusted.test");
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
  ).rejects.toThrow("no valid active profile or domain route");
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
  ).rejects.toThrow("no valid active profile or domain route");
});
