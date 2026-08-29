import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const profiles = require("../../lib/curlProfiles.js");

test("bundled catalog prefers modern desktop and Android profiles", () => {
  const catalog = profiles.normalizeCurlProfileCatalog(null);
  const entries = profiles.getCurlProfileEntries(catalog);

  expect(entries.map((entry) => entry.target)).toEqual(
    expect.arrayContaining([
      "chrome150",
      "chrome131",
      "chrome131_android",
      "edge101",
      "safari184",
      "safari184_ios",
      "safari260",
      "safari260_ios",
    ]),
  );
  expect(entries.map((entry) => entry.target)).not.toEqual(
    expect.arrayContaining(["chrome142", "chrome145", "chrome146"]),
  );
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "windows", curlProfile: "auto" } },
      catalog,
    ),
  ).toMatchObject({ target: "edge101", platform: "Windows", version: "101" });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "android", curlProfile: "auto" } },
      catalog,
    ),
  ).toMatchObject({
    target: "chrome131_android",
    mobile: true,
    platform: "Android",
  });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "macos", curlProfile: "auto" } },
      catalog,
    ),
  ).toMatchObject({
    target: "safari260",
    version: "26.0",
    family: "safari",
  });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "macos", curlProfile: "safari184" } },
      catalog,
    ),
  ).toMatchObject({
    target: "safari184",
    family: "safari",
    version: "18.4",
    userAgent: expect.stringContaining("Version/18.4 Safari/605.1.15"),
    clientHints: null,
    navigator: { platform: "MacIntel", vendor: "Apple Computer, Inc." },
  });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "macos", curlProfile: "safari999" } },
      catalog,
    ),
  ).toMatchObject({ target: "safari260" });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "iphone", curlProfile: "safari260_ios" } },
      catalog,
    ),
  ).toMatchObject({
    target: "safari260_ios",
    version: "26.0",
    userAgent: expect.stringContaining("CPU iPhone OS 26_0"),
    navigator: { platform: "iPhone", maxTouchPoints: 5 },
  });
});

test("wrapper parsing keeps safe modern browser metadata and rejects old or unsupported targets", () => {
  const source = String.raw`"$dir/curl-impersonate" \
  -H 'sec-ch-ua: "Chromium";v="150", "Google Chrome";v="150", "Not.A/Brand";v="99"' \
  -H 'User-Agent: Mozilla/5.0 Chrome/150.3.4.5' \
  --impersonate "chrome150"`;
  const profile = profiles.createCurlProfileFromWrapper("curl_chrome150", source, 123);

  expect(profile).toMatchObject({
    target: "chrome150",
    version: "150",
    updatedAt: 123,
    sourceUrl: expect.stringContaining("curl_chrome150"),
  });
  expect(profile.clientHints.brands[1]).toEqual({
    brand: "Google Chrome",
    version: "150",
  });
  expect(profile.userAgent).toContain("Chrome/150.0.0.0");
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_chrome136",
      source.replace('chrome150"', 'chrome136"'),
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_firefox147",
      '--impersonate "firefox147"',
    ),
  ).toBeNull();
  const edgeSource = String.raw`"$dir/curl-impersonate" \
  -H 'sec-ch-ua: " Not A;Brand";v="99", "Chromium";v="101", "Microsoft Edge";v="101"' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36 Edg/101.0.1210.47' \
  --impersonate "edge101"`;
  expect(
    profiles.createCurlProfileFromWrapper("curl_edge101", edgeSource, 789),
  ).toMatchObject({
    target: "edge101",
    family: "edge",
    version: "101",
    updatedAt: 789,
    userAgent: expect.stringContaining("Edg/101.0.1210.47"),
    clientHints: {
      brands: expect.arrayContaining([
        { brand: "Microsoft Edge", version: "101" },
      ]),
    },
  });
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_edge101",
      edgeSource.replace("Edg/101.0.1210.47", "Edg/99.0.1150.30"),
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_edge99",
      edgeSource.replaceAll("edge101", "edge99").replaceAll("101", "99"),
    ),
  ).toBeNull();
  const safariSource = String.raw`"$dir/curl-impersonate" \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15' \
  --impersonate "safari184"`;
  expect(
    profiles.createCurlProfileFromWrapper("curl_safari184", safariSource, 456),
  ).toMatchObject({
    target: "safari184",
    family: "safari",
    version: "18.4",
    updatedAt: 456,
    userAgent: expect.stringContaining("Version/18.4 Safari/605.1.15"),
  });
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_safari180",
      '--impersonate "safari180"',
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_safari172_ios",
      safariSource.replace("safari184", "safari172_ios"),
    ),
  ).toBeNull();
});

test("profile normalization strips unsafe remote values and supports explicit variants", () => {
  expect(
    profiles.normalizeCurlProfile({
      target: "chrome131",
      userAgent: "bad\nheader",
      sourceUrl: "https://example.test/profile",
      clientHints: {
        brands: [
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
        ],
        fullVersionList: [
          { brand: "Chromium", version: "131.0.0.0" },
          { brand: "Google Chrome", version: "131.0.0.0" },
        ],
      },
    }),
  ).toMatchObject({ target: "chrome131", version: "131" });
  expect(
    profiles.normalizeCurlProfile({
      target: "chrome131",
      userAgent:
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/999.0.0.0 Safari/537.36",
    }),
  ).toMatchObject({
    target: "chrome131",
    userAgent: expect.stringContaining("Chrome/131.0.0.0"),
  });
  expect(profiles.normalizeCurlProfile({ target: "chrome99" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "chrome142" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "chrome145" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "chrome146" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "safari180" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "safari260" })).toMatchObject({
    family: "safari",
    version: "26.0",
  });
  expect(profiles.normalizeCurlProfile({ target: "firefox147" })).toBeNull();
  expect(profiles.normalizeCurlProfile({ target: "safari172_ios" })).toBeNull();
  expect(
    profiles.normalizeCurlProfileCatalog({
      profiles: [
        {
          target: "safari184",
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.4 Safari/605.1.15",
        },
      ],
    }).profiles.find((entry) => entry.target === "safari184"),
  ).toMatchObject({ version: "18.4" });
  expect(profiles.normalizeCurlProfile({ target: "chrome131_android" })).toMatchObject({
    mobile: true,
    platform: "Android",
  });

  const explicit = profiles.getCurlProfileForConfig(
    { useragent: { preset: "macos_chrome", curlProfile: "chrome131" } },
    profiles.DEFAULT_CURL_PROFILE_CATALOG,
  );
  expect(explicit).toMatchObject({ target: "chrome131", version: "131" });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "windows", curlProfile: "edge101" } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toMatchObject({
    platform: "Windows",
    userAgent: expect.stringContaining("Edg/101.0.1210.47"),
    clientHints: {
      brand: "Microsoft Edge",
      platform: "Windows",
      platformVersion: "10.0.0",
    },
    navigator: {
      platform: "Win32",
      oscpu: "Windows NT 10.0; Win64; x64",
    },
    httpHeaders: {
      "sec-ch-ua": expect.stringContaining('"Microsoft Edge";v="101"'),
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
    },
  });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "android", curlProfile: "chrome131_android" } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toMatchObject({
    userAgent: expect.stringContaining("Chrome/131.0.0.0"),
    clientHints: {
      brand: "Google Chrome",
      platform: "Android",
      platformVersion: "10.0.0",
      mobile: true,
    },
  });
  expect(profiles.getCurlProfileByTarget(null, "chrome131")).toMatchObject({
    target: "chrome131",
  });
  expect(profiles.isModernCurlProfileTarget("chrome131")).toBe(true);
  expect(profiles.isModernCurlProfileTarget("chrome142")).toBe(false);
  expect(profiles.isModernCurlProfileTarget("chrome145")).toBe(false);
  expect(profiles.isModernCurlProfileTarget("chrome146")).toBe(false);
  expect(profiles.isModernCurlProfileTarget("safari180")).toBe(false);
  expect(profiles.isModernCurlProfileTarget("safari184_ios")).toBe(true);
  expect(profiles.isModernCurlProfileTarget("safari260")).toBe(true);
  expect(profiles.isModernCurlProfileTarget("edge101")).toBe(true);
  expect(profiles.isModernCurlProfileTarget("safari172_ios")).toBe(false);
  expect(profiles.isModernCurlProfileTarget("firefox147")).toBe(false);
  expect(profiles.isModernCurlProfileTarget(null)).toBe(false);
  expect(profiles.normalizeCurlProfile(null)).toBeNull();
  expect(profiles.normalizeCurlProfile([])).toBeNull();
  expect(profiles.normalizeCurlProfile({ id: "chrome131" })).toMatchObject({
    target: "chrome131",
  });
  expect(
    profiles.normalizeCurlProfile({
      target: "chrome131",
      clientHints: {
        brands: [
          { brand: "", version: "131" },
          { brand: "Google Chrome", version: "131" },
        ],
      },
    }),
  ).toMatchObject({ target: "chrome131" });
  expect(
    profiles.parseCurlShellHeaders("-H 'malformed' -H 'X-Test: ignored'"),
  ).toEqual({});
  expect(profiles.parseCurlBrands("")).toBeNull();
  expect(profiles.getCurlTargetFromWrapper("curl_chrome131", "")).toBe(
    "chrome131",
  );
  expect(profiles.getCurlTargetFromWrapper(null, "")).toBe("");
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_chrome147",
      '--impersonate "chrome147"',
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfileFromWrapper(
      "curl_chrome131_android",
      '--impersonate "chrome131_android"',
    ),
  ).toMatchObject({ target: "chrome131_android", mobile: true });
  expect(profiles.getCurlProfileByTarget(null, null)).toBeNull();
  expect(profiles.createCurlProfileVariant(null, "windows")).toBeNull();
  expect(
    profiles.createCurlProfileVariant(
      profiles.DEFAULT_CURL_PROFILE_CATALOG.profiles[0],
      "macos",
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfileVariant(
      profiles.DEFAULT_CURL_PROFILE_CATALOG.profiles[0],
      "android",
    ),
  ).toBeNull();
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: 7 } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toBeNull();
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "windows", curlProfile: 7 } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toMatchObject({ target: "edge101" });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "windows", curlProfile: "chrome131_android" } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toMatchObject({ target: "edge101" });
  expect(
    profiles.getCurlProfileForConfig(
      { useragent: { preset: "unknown", curlProfile: "chrome131" } },
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
    ),
  ).toBeNull();
  expect(
    profiles.createCurlProfilePublicEntry(
      profiles.DEFAULT_CURL_PROFILE_CATALOG.profiles[0],
    ),
  ).toMatchObject({ target: "chrome131", family: "chrome" });
  expect(
    profiles.normalizeCurlProfile({
      target: "chrome131",
      clientHints: {
        brands: [
          { brand: "Chromium", version: "131.0" },
          { brand: "Google Chrome", version: "131" },
        ],
      },
    }),
  ).toMatchObject({ target: "chrome131" });
  expect(
    profiles.isCurlProfileCatalogStale(
      { updatedAt: 1 },
      profiles.CURL_PROFILE_MAX_AGE_MS + 1001,
    ),
  ).toBe(true);
  expect(
    profiles.isCurlProfileCatalogStale(
      { updatedAt: Date.now() },
      Date.now(),
    ),
  ).toBe(false);
});

test("shared identity options expose versioned preset and modern profile choices", () => {
  expect(profiles.createUserAgentSelectionValue("windows", "")).toBe(
    "windows|auto",
  );
  expect(
    profiles.createUserAgentSelectionValue("macos", "safari184"),
  ).toBe("macos|safari184");
  expect(profiles.parseUserAgentSelection("macos|safari184")).toEqual({
    preset: "macos",
    curlProfile: "safari184",
  });
  expect(profiles.parseUserAgentSelection("windows|edge101")).toEqual({
    preset: "windows",
    curlProfile: "edge101",
  });
  expect(profiles.parseUserAgentSelection("macos_chrome|auto")).toEqual({
    preset: "macos_chrome",
    curlProfile: "auto",
  });
  expect(profiles.parseUserAgentSelection("macos_chrome|chrome131")).toEqual({
    preset: "macos_chrome",
    curlProfile: "chrome131",
  });
  expect(profiles.parseUserAgentSelection("iphone|chrome136")).toEqual({
    preset: "iphone",
    curlProfile: "auto",
  });
  expect(profiles.parseUserAgentSelection("firefox|auto")).toEqual({
    preset: "windows",
    curlProfile: "auto",
  });
  expect(profiles.parseUserAgentSelection("invalid")).toEqual({
    preset: "windows",
    curlProfile: "auto",
  });
  expect(profiles.getUserAgentPresetVersionLabel("macos", {})).toBe("");
  expect(
    profiles.getUserAgentPresetVersionLabel("macos", {
      macos: "Mozilla/5.0 Version/17.6 Safari/605.1.15",
    }),
  ).toBe("Safari 17.6");
  expect(
    profiles.getUserAgentPresetVersionLabel("iphone", {
      iphone: "Mozilla/5.0 Version/18.4 Mobile Safari/604.1",
    }),
  ).toBe("iOS 18.4");
  expect(
    profiles.getUserAgentPresetVersionLabel("iphone", {
      iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X)",
    }),
  ).toBe("iOS 17.4.1");

  const strings = {
    macos:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.6 Safari/605.1.15",
    iphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) Version/17.4.1 Mobile/15E148 Safari/604.1",
  };
  const options = profiles.getUserAgentSelectionOptions(
    profiles.DEFAULT_CURL_PROFILE_CATALOG,
    { preset: "windows", curlProfile: "auto" },
    strings,
  );
  const labels = options.map((option) => option.label);
  expect(labels).toEqual(
    expect.arrayContaining([
      "macOS Safari · Safari 26.0 (latest)",
      "macOS Safari · Safari 18.4",
      "iPhone Safari · iOS 26.0 (latest)",
      "iPhone Safari · iOS 18.4",
      "macOS Chrome · Chrome 150 (latest)",
      "Windows Edge · Edge 101 (latest)",
      "macOS Chrome · Chrome 131",
      "Android Chrome · Chrome 131 (latest)",
    ]),
  );
  expect(options.some((option) => option.value === "windows|edge101")).toBe(false);
  expect(options.some((option) => option.value === "macos_chrome|chrome150")).toBe(false);
  expect(options.some((option) => option.label.includes("Firefox"))).toBe(false);
  expect(
    profiles.getUserAgentSelectionValue(
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
      "windows",
      "chrome150",
    ),
  ).toBe("windows|chrome150");
  expect(
    profiles.getUserAgentSelectionValue(
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
      "windows",
      "edge101",
    ),
  ).toBe("windows|auto");
  expect(
    profiles.getUserAgentSelectionOptions(
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
      { preset: "windows", curlProfile: "chrome999" },
      strings,
    ).at(-1),
  ).toMatchObject({
    value: "windows|chrome999",
    label: "Windows Edge · chrome999 · unavailable",
  });
  expect(
    profiles.getCurlProfileForConfig(null, profiles.DEFAULT_CURL_PROFILE_CATALOG),
  ).toBeNull();
  expect(
    profiles.getUserAgentSelectionOptions(
      profiles.DEFAULT_CURL_PROFILE_CATALOG,
      { preset: "unknown", curlProfile: "auto" },
      strings,
    ).some((option) => option.value === "unknown"),
  ).toBe(false);
});
