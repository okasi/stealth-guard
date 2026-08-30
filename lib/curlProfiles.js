const CURL_PROFILE_CACHE_KEY = "stealth-guard-curl-profiles";
const CURL_PROFILE_CACHE_VERSION = 1;
const CURL_PROFILE_DIRECTORY_URL =
  "https://github.com/lexiforest/curl-impersonate/tree/main/bin";
const CURL_PROFILE_UPDATE_SOURCE =
  "https://api.github.com/repos/lexiforest/curl-impersonate/contents/bin?ref=main";
const CURL_PROFILE_RAW_BASE_URL =
  "https://raw.githubusercontent.com/lexiforest/curl-impersonate/main/bin/";
const CURL_PROFILE_UPDATE_PERIOD_MINUTES = 4 * 60;
const CURL_PROFILE_MAX_AGE_MS = CURL_PROFILE_UPDATE_PERIOD_MINUTES * 60 * 1000;
const CURL_PROFILE_MAX_COUNT = 24;
const CURL_PROFILE_MAX_SOURCE_LENGTH = 128 * 1024;
const CURL_PROFILE_ALLOWED_TARGETS = Object.freeze([
  "chrome131",
  "chrome150",
  "chrome131_android",
  "edge101",
  "safari184",
  "safari260",
  "safari184_ios",
  "safari260_ios",
]);
const CURL_PROFILE_ALLOWED_TARGET_SET = new Set(CURL_PROFILE_ALLOWED_TARGETS);
const CURL_PROFILE_EXCLUDED_TARGETS = Object.freeze([
  "chrome142",
  "chrome145",
  "chrome146",
]);
const USER_AGENT_PRESET_DEFINITIONS = Object.freeze([
  Object.freeze({
    preset: "macos",
    label: "macOS Safari",
    family: "safari",
    mobile: false,
  }),
  Object.freeze({
    preset: "iphone",
    label: "iPhone Safari",
    family: "safari",
    mobile: true,
  }),
  Object.freeze({
    preset: "macos_chrome",
    label: "macOS Chrome",
    family: "chrome",
    mobile: false,
    modern: true,
  }),
  Object.freeze({
    preset: "windows",
    label: "Windows Edge",
    family: "edge",
    mobile: false,
    modern: true,
    latestOnly: true,
  }),
  Object.freeze({
    preset: "android",
    label: "Android Chrome",
    family: "chrome",
    mobile: true,
    modern: true,
  }),
]);

function getUserAgentDefinition(preset) {
  return (
    USER_AGENT_PRESET_DEFINITIONS.find(
      (definition) => definition.preset === preset,
    ) || null
  );
}

function isModernUserAgentPreset(preset) {
  return Boolean(getUserAgentDefinition(preset)?.modern);
}

function isSafariUserAgentPreset(preset) {
  return getUserAgentDefinition(preset)?.family === "safari";
}

function isChromiumUserAgentPreset(preset) {
  const definition = getUserAgentDefinition(preset);
  return Boolean(definition && definition.family !== "safari");
}

function createUserAgentSelectionValue(preset, curlProfile = "auto") {
  return isModernUserAgentPreset(preset) ||
    (isSafariUserAgentPreset(preset) && curlProfile && curlProfile !== "auto")
    ? `${preset}|${curlProfile || "auto"}`
    : preset;
}

function parseUserAgentSelection(value) {
  const [preset, curlProfile = "auto"] = String(value).split("|");
  if (!getUserAgentDefinition(preset)) {
    return { preset: "windows", curlProfile: "auto" };
  }
  const compatibleProfile =
    ((preset === "windows" &&
      (curlProfile === "auto" || /^edge\d+$/.test(curlProfile))) ||
      (preset !== "windows" &&
        isChromiumUserAgentPreset(preset) &&
        (curlProfile === "auto" || /^chrome\d+(?:_android)?$/.test(curlProfile)))) ||
    (isSafariUserAgentPreset(preset) &&
      (curlProfile === "auto" || /^safari\d+(?:_ios)?$/.test(curlProfile)));
  return {
    preset,
    curlProfile: compatibleProfile ? curlProfile : "auto",
  };
}

function getUserAgentPresetVersionLabel(preset, userAgentStrings = {}) {
  const userAgent =
    userAgentStrings && typeof userAgentStrings[preset] === "string"
      ? userAgentStrings[preset]
      : "";
  const safariVersion = userAgent.match(/Version\/([\d.]+)/);
  if (safariVersion) {
    return preset === "iphone"
      ? `iOS ${safariVersion[1]}`
      : `Safari ${safariVersion[1]}`;
  }
  const iPhoneOsVersion = userAgent.match(/iPhone OS ([\d_]+)/);
  return iPhoneOsVersion
    ? `iOS ${iPhoneOsVersion[1].replace(/_/g, ".")}`
    : "";
}

function getLatestProfileEntry(entries, family, mobile) {
  return entries
    .filter(
      (profile) =>
        profile.family === family && Boolean(profile.mobile) === Boolean(mobile),
    )
    .sort((a, b) => Number(b.version) - Number(a.version))[0];
}

function getProfileOptionLabel(definition, profile, latest = false) {
  const browserLabel =
    definition.family === "safari"
      ? definition.mobile
        ? "iOS"
        : "Safari"
      : definition.preset === "windows"
        ? "Edge"
        : "Chrome";
  return `${definition.label} · ${browserLabel} ${profile.version}${
    latest ? " (latest)" : ""
  }`;
}

function getUserAgentSelectionValue(catalog, preset, curlProfile = "auto") {
  const entries = getCurlProfileEntries(catalog);
  const definition = getUserAgentDefinition(preset);
  if (!definition || !curlProfile || curlProfile === "auto") {
    return createUserAgentSelectionValue(preset, curlProfile);
  }
  const selected = entries.find((profile) => profile.target === curlProfile);
  const latest = getLatestProfileEntry(
    entries,
    definition.family,
    definition.mobile,
  );
  return selected && latest && selected.target === latest.target
    ? createUserAgentSelectionValue(preset)
    : createUserAgentSelectionValue(preset, curlProfile);
}

function getUserAgentSelectionOptions(
  catalog,
  selectedUserAgent = {},
  userAgentStrings = {},
) {
  const entries = getCurlProfileEntries(catalog);
  const options = [];

  for (const definition of USER_AGENT_PRESET_DEFINITIONS) {
    const matchingEntries = entries.filter(
      (profile) =>
        profile.family === definition.family &&
        Boolean(profile.mobile) === definition.mobile,
    );
    const latest = getLatestProfileEntry(
      matchingEntries,
      definition.family,
      definition.mobile,
    );
    /* c8 ignore next -- Catalog normalization always supplies each supported family. */
    if (!latest) continue;
    options.push({
      value: createUserAgentSelectionValue(definition.preset),
      label: getProfileOptionLabel(definition, latest, true),
    });
    if (definition.latestOnly) continue;
    for (const profile of matchingEntries) {
      if (profile.target === latest.target) continue;
      options.push({
        value: createUserAgentSelectionValue(definition.preset, profile.target),
        label: getProfileOptionLabel(definition, profile),
      });
    }
  }

  const currentValue = getUserAgentSelectionValue(
    catalog,
    selectedUserAgent.preset,
    selectedUserAgent.curlProfile,
  );
  if (!options.some((option) => option.value === currentValue)) {
    const definition = getUserAgentDefinition(selectedUserAgent.preset);
    if (definition) {
      options.push({
        value: currentValue,
        label: `${definition.label} · ${selectedUserAgent.curlProfile} · unavailable`,
      });
    }
  }
  return options;
}

function quoteCurlHeaderValue(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function formatCurlBrands(brands) {
  return brands
    .map((entry) => `${quoteCurlHeaderValue(entry.brand)};v=${quoteCurlHeaderValue(entry.version)}`)
    .join(", ");
}

function createCurlBrands(brand, version, greaseBrand = "Not.A/Brand") {
  return [
    { brand: "Chromium", version },
    { brand, version },
    { brand: greaseBrand, version: "99" },
  ];
}

function createCurlProfile(
  target,
  version,
  {
    mobile = false,
    platform = mobile ? "Android" : "macOS",
    brand = "Google Chrome",
    platformVersion = mobile ? "10.0.0" : "10.15.7",
    navigatorPlatform = mobile ? "Linux armv8l" : "MacIntel",
    oscpu = mobile ? "Linux; Android 10" : "Intel Mac OS X 10.15.7",
    userAgent,
    brands,
    sourceUrl = null,
    updatedAt = 0,
  } = {},
) {
  const majorVersion = String(version);
  const resolvedUserAgent =
    userAgent ||
    (mobile
      ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Mobile Safari/537.36`
      : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`);
  const resolvedBrands = brands || createCurlBrands(brand, majorVersion);
  const clientHints = {
    brand,
    platform,
    platformVersion,
    architecture: mobile ? "arm" : "x86",
    bitness: "64",
    model: mobile ? "K" : "",
    mobile,
    wow64: false,
    formFactors: mobile ? ["Mobile"] : ["Desktop"],
    brands: resolvedBrands,
    fullVersionList: resolvedBrands.map((entry) => ({
      brand: entry.brand,
      version: entry.version.includes(".")
        ? entry.version
        : `${entry.version}.0.0.0`,
    })),
  };
  const httpHeaders = {
    "sec-ch-ua": formatCurlBrands(resolvedBrands),
    "sec-ch-ua-mobile": mobile ? "?1" : "?0",
    "sec-ch-ua-platform": quoteCurlHeaderValue(platform),
    "sec-ch-ua-arch": quoteCurlHeaderValue(clientHints.architecture),
    "sec-ch-ua-bitness": quoteCurlHeaderValue(clientHints.bitness),
    "sec-ch-ua-form-factors": clientHints.formFactors
      .map(quoteCurlHeaderValue)
      .join(", "),
    "sec-ch-ua-full-version": quoteCurlHeaderValue(
      `${majorVersion}.0.0.0`,
    ),
    "sec-ch-ua-full-version-list": formatCurlBrands(
      clientHints.fullVersionList,
    ),
    "sec-ch-ua-model": quoteCurlHeaderValue(clientHints.model),
    "sec-ch-ua-platform-version": quoteCurlHeaderValue(platformVersion),
    "sec-ch-ua-wow64": "?0",
  };
  return {
    id: target,
    target,
    family: "chrome",
    version: majorVersion,
    platform,
    mobile,
    userAgent: resolvedUserAgent,
    httpHeaders,
    clientHints,
    navigator: {
      platform: navigatorPlatform,
      oscpu,
      vendor: "Google Inc.",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: mobile ? 5 : 0,
    },
    sourceUrl,
    updatedAt,
  };
}

function createEdgeProfile(
  target,
  version,
  { userAgent, brands, sourceUrl = null, updatedAt = 0 } = {},
) {
  const profile = createCurlProfile(target, version, {
    platform: "Windows",
    platformVersion: "10.0.0",
    navigatorPlatform: "Win32",
    oscpu: "Windows NT 10.0; Win64; x64",
    brand: "Microsoft Edge",
    userAgent,
    brands,
    sourceUrl,
    updatedAt,
  });
  profile.family = "edge";
  return profile;
}

function getSafariVersionFromTarget(target) {
  const digits = String(target || "").match(/^safari(\d+)(?:_ios)?$/)[1];
  const majorLength = digits.length > 3 ? 2 : digits.length - 1;
  return `${digits.slice(0, majorLength)}.${Number(digits.slice(majorLength))}`;
}

function createSafariProfile(
  target,
  version,
  { mobile = /_ios$/.test(String(target)), userAgent, sourceUrl = null, updatedAt = 0 } = {},
) {
  const versionString = String(version);
  const iosVersion = versionString.replace(/\./g, "_");
  const resolvedUserAgent =
    userAgent ||
    (mobile
      ? `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${versionString} Mobile/15E148 Safari/604.1`
      : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${versionString} Safari/605.1.15`);
  return {
    id: target,
    target,
    family: "safari",
    version: versionString,
    platform: mobile ? "iOS" : "macOS",
    mobile,
    userAgent: resolvedUserAgent,
    httpHeaders: {},
    clientHints: null,
    navigator: {
      platform: mobile ? "iPhone" : "MacIntel",
      oscpu: mobile ? `iPhone OS ${versionString}` : "Intel Mac OS X 10.15.7",
      vendor: "Apple Computer, Inc.",
      hardwareConcurrency: mobile ? 6 : 8,
      deviceMemory: undefined,
      maxTouchPoints: mobile ? 5 : 0,
    },
    sourceUrl,
    updatedAt,
  };
}

const DEFAULT_CURL_PROFILE_CATALOG = {
  version: CURL_PROFILE_CACHE_VERSION,
  updatedAt: 0,
  profiles: [
    createCurlProfile("chrome131", 131),
    createCurlProfile("chrome150", 150),
    createCurlProfile("chrome131_android", 131, {
      mobile: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      brands: [
        { brand: "Google Chrome", version: "131" },
        { brand: "Chromium", version: "131" },
        { brand: "Not_A Brand", version: "24" },
      ],
    }),
    createEdgeProfile("edge101", "101", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36 Edg/101.0.1210.47",
      brands: [
        { brand: " Not A;Brand", version: "99" },
        { brand: "Chromium", version: "101" },
        { brand: "Microsoft Edge", version: "101" },
      ],
    }),
    createSafariProfile("safari184", "18.4"),
    createSafariProfile("safari184_ios", "18.4", { mobile: true }),
    createSafariProfile("safari260", "26.0"),
    createSafariProfile("safari260_ios", "26.0", { mobile: true }),
  ],
};

function cloneCurlProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

function isSafeCurlText(value, maxLength = 512) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\r\n]/.test(value)
  );
}

function isModernCurlProfileTarget(target) {
  const normalizedTarget = String(target || "");
  if (CURL_PROFILE_EXCLUDED_TARGETS.includes(normalizedTarget)) return false;
  return CURL_PROFILE_ALLOWED_TARGET_SET.has(normalizedTarget);
}

function normalizeCurlBrands(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    return null;
  }
  const brands = value
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        isSafeCurlText(entry.brand, 128) &&
        isSafeCurlText(entry.version, 32),
    )
    .map((entry) => ({ brand: entry.brand, version: entry.version }));
  return brands.length === value.length ? brands : null;
}

function parseCurlBrands(value) {
  if (!isSafeCurlText(value, 1024)) return null;
  const brands = [];
  const pattern = /"([^"]+)";v="([^"]+)"/g;
  for (const match of value.matchAll(pattern)) {
    brands.push({ brand: match[1], version: match[2] });
  }
  return normalizeCurlBrands(brands);
}

function normalizeCurlProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const target = typeof value.target === "string" ? value.target : value.id;
  const targetString = String(target);
  const safariMatch = targetString.match(/^safari(\d+)(_ios)?$/);
  if (safariMatch && isModernCurlProfileTarget(targetString)) {
    const mobile = Boolean(safariMatch[2]);
    const fallbackVersion = getSafariVersionFromTarget(targetString);
    const base = createSafariProfile(targetString, fallbackVersion, { mobile });
    const userAgentCandidate = isSafeCurlText(value.userAgent, 1024)
      ? value.userAgent
      : "";
    const userAgentMatch = userAgentCandidate.match(/Version\/([\d.]+).*Safari\//);
    const validUserAgent =
      userAgentMatch &&
      Number(userAgentMatch[1]) === Number(base.version) &&
      (mobile ? /\biPhone;/.test(userAgentCandidate) : /\(Macintosh;/.test(userAgentCandidate));
    return createSafariProfile(targetString, base.version, {
      mobile,
      userAgent: validUserAgent ? userAgentCandidate : base.userAgent,
      sourceUrl: isSafeCurlText(value.sourceUrl, 512) ? value.sourceUrl : null,
      updatedAt: Number.isFinite(Number(value.updatedAt))
        ? Number(value.updatedAt)
        : 0,
    });
  }
  const edgeMatch = targetString.match(/^edge(\d+)$/);
  if (edgeMatch && isModernCurlProfileTarget(targetString)) {
    const version = Number(edgeMatch[1]);
    const userAgentCandidate = isSafeCurlText(value.userAgent, 1024)
      ? value.userAgent
      : "";
    const userAgentMatch = userAgentCandidate.match(/Edg\/([\d.]+)/);
    if (
      !userAgentMatch ||
      userAgentMatch[1].split(".")[0] !== String(version) ||
      !/\(Windows NT 10\.0; Win64; x64\)/.test(userAgentCandidate)
    ) {
      return null;
    }
    return createEdgeProfile(targetString, String(version), {
      userAgent: userAgentCandidate,
      brands: normalizeCurlBrands(value.clientHints?.brands),
      sourceUrl: isSafeCurlText(value.sourceUrl, 512) ? value.sourceUrl : null,
      updatedAt: Number.isFinite(Number(value.updatedAt))
        ? Number(value.updatedAt)
        : 0,
    });
  }
  const match = targetString.match(/^(chrome)(\d+)(_android)?$/);
  if (!match || !isModernCurlProfileTarget(target)) return null;
  const version = Number(match[2]);
  const mobile = Boolean(match[3]);

  const base = createCurlProfile(target, version, {
    mobile,
    platform: mobile ? "Android" : "macOS",
  });
  const userAgentCandidate = isSafeCurlText(value.userAgent, 1024)
    ? value.userAgent
    : "";
  const userAgentMatch = userAgentCandidate.match(/Chrome\/([\d.]+)/);
  const userAgent =
    userAgentMatch && userAgentMatch[1].split(".")[0] === String(version)
      ? userAgentCandidate.replace(
          /Chrome\/[\d.]+/,
          `Chrome/${version}.0.0.0`,
        )
      : base.userAgent;
  const clientHints = value.clientHints || {};
  const brands = normalizeCurlBrands(clientHints.brands) || base.clientHints.brands;
  const sourceUrl = isSafeCurlText(value.sourceUrl, 512) ? value.sourceUrl : null;
  const platform =
    isSafeCurlText(value.platform, 64) && value.platform === "Android"
      ? "Android"
      : base.platform;
  const normalized = createCurlProfile(target, version, {
    mobile,
    platform,
    userAgent,
    brands,
    sourceUrl,
    updatedAt: Number.isFinite(Number(value.updatedAt))
      ? Number(value.updatedAt)
      : 0,
  });
  return normalized;
}

function normalizeCurlProfileCatalog(value) {
  const source = value && typeof value === "object" ? value : {};
  const entries = Array.isArray(source.profiles)
    ? source.profiles.map(normalizeCurlProfile).filter(Boolean)
    : [];
  const byTarget = new Map();
  for (const profile of entries) byTarget.set(profile.target, profile);
  for (const profile of DEFAULT_CURL_PROFILE_CATALOG.profiles) {
    if (!byTarget.has(profile.target)) {
      byTarget.set(profile.target, cloneCurlProfile(profile));
    }
  }
  return {
    version: CURL_PROFILE_CACHE_VERSION,
    updatedAt: Number.isFinite(Number(source.updatedAt))
      ? Number(source.updatedAt)
      : 0,
    profiles: Array.from(byTarget.values())
      .filter((profile) => CURL_PROFILE_ALLOWED_TARGET_SET.has(profile.target))
      .sort((a, b) => Number(b.version) - Number(a.version))
      .slice(0, CURL_PROFILE_MAX_COUNT),
  };
}

function getCurlProfileEntries(catalog) {
  return normalizeCurlProfileCatalog(catalog).profiles.map(cloneCurlProfile);
}

function parseCurlShellHeaders(source) {
  const headers = {};
  const matches = String(source).matchAll(/(?:-H|--header)\s+(['"])(.*?)\1/gs);
  for (const match of matches) {
    const separator = match[2].indexOf(":");
    if (separator < 1) continue;
    const name = match[2].slice(0, separator).trim().toLowerCase();
    const value = match[2].slice(separator + 1).trim();
    if (
      ["user-agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"].includes(name) &&
      isSafeCurlText(value, 1024)
    ) {
      headers[name] = value;
    }
  }
  return headers;
}

function getCurlTargetFromWrapper(name, source) {
  const filenameTarget = String(name || "").replace(/^curl_/, "");
  const impersonateMatch = String(source || "").match(
    /--impersonate\s+["']?([a-z0-9_]+)/i,
  );
  return (impersonateMatch ? impersonateMatch[1] : filenameTarget).toLowerCase();
}

function createCurlProfileFromWrapper(name, source, updatedAt = Date.now()) {
  const target = getCurlTargetFromWrapper(name, source);
  const safariMatch = target.match(/^safari(\d+)(_ios)?$/);
  if (safariMatch && isModernCurlProfileTarget(target)) {
    const headers = parseCurlShellHeaders(source);
    return normalizeCurlProfile({
      target,
      userAgent: headers["user-agent"],
      sourceUrl: `${CURL_PROFILE_RAW_BASE_URL}${encodeURIComponent(`curl_${target}`)}`,
      updatedAt,
    });
  }
  const edgeMatch = target.match(/^edge(\d+)$/);
  if (edgeMatch && isModernCurlProfileTarget(target)) {
    const headers = parseCurlShellHeaders(source);
    return normalizeCurlProfile({
      target,
      userAgent: headers["user-agent"],
      clientHints: { brands: parseCurlBrands(headers["sec-ch-ua"]) || undefined },
      sourceUrl: `${CURL_PROFILE_RAW_BASE_URL}${encodeURIComponent(`curl_${target}`)}`,
      updatedAt,
    });
  }
  const match = target.match(/^(chrome)(\d+)(_android)?$/);
  if (!match || !isModernCurlProfileTarget(target)) return null;
  const version = Number(match[2]);
  const mobile = Boolean(match[3]);
  const headers = parseCurlShellHeaders(source);
  const brands = parseCurlBrands(headers["sec-ch-ua"]);
  return normalizeCurlProfile({
    ...createCurlProfile(target, version, {
      mobile,
      userAgent: headers["user-agent"],
      brands: brands || undefined,
      sourceUrl: `${CURL_PROFILE_RAW_BASE_URL}${encodeURIComponent(`curl_${target}`)}`,
      updatedAt,
    }),
    userAgent: headers["user-agent"],
    platform: mobile ? "Android" : "macOS",
    clientHints: {
      brands: brands || undefined,
    },
  });
}

function getCurlProfileByTarget(catalog, target) {
  const requested = String(target || "").toLowerCase();
  return getCurlProfileEntries(catalog).find((profile) => profile.target === requested) || null;
}

function createCurlProfileVariant(profile, preset) {
  if (!profile || !["macos_chrome", "windows", "android"].includes(preset)) {
    return null;
  }
  const mobile = preset === "android";
  if (mobile !== Boolean(profile.mobile)) return null;
  if (preset === "windows") {
    return profile.family === "edge" ? cloneCurlProfile(profile) : null;
  }
  const version = profile.version;
  const brand = "Google Chrome";
  const platform = mobile ? "Android" : "macOS";
  const userAgent = mobile
    ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Mobile Safari/537.36`
    : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  const brands = createCurlBrands(brand, version);
  const variant = createCurlProfile(profile.target, version, {
    mobile,
    platform,
    brand,
    platformVersion: mobile ? "10.0.0" : "10.15.7",
    navigatorPlatform: mobile ? "Linux armv8l" : "MacIntel",
    oscpu: mobile
      ? "Linux; Android 10"
      : "Intel Mac OS X 10.15.7",
    userAgent,
    brands,
    sourceUrl: profile.sourceUrl,
    updatedAt: profile.updatedAt,
  });
  variant.id = profile.id;
  variant.target = profile.target;
  return variant;
}

function getCurlProfileForConfig(config, catalog) {
  const userAgent = config && config.useragent ? config.useragent : {};
  const preset = typeof userAgent.preset === "string" ? userAgent.preset : null;
  if (isSafariUserAgentPreset(preset)) {
    const requested =
      typeof userAgent.curlProfile === "string" ? userAgent.curlProfile : "auto";
    const entries = getCurlProfileEntries(catalog);
    const profile =
      entries.find(
        (entry) =>
          entry.family === "safari" &&
          Boolean(entry.mobile) === (preset === "iphone") &&
          (requested === "auto" || entry.target === requested),
      ) ||
      getLatestProfileEntry(entries, "safari", preset === "iphone");
    return profile;
  }
  if (!isChromiumUserAgentPreset(preset)) return null;
  const requested =
    typeof userAgent.curlProfile === "string" ? userAgent.curlProfile : "auto";
  const entries = getCurlProfileEntries(catalog);
  const mobile = preset === "android";
  const family = preset === "windows" ? "edge" : "chrome";
  const profile =
    entries.find(
      (entry) =>
        entry.target === requested &&
        Boolean(entry.mobile) === mobile &&
        entry.family === family,
    ) ||
    entries.find(
      (entry) =>
        Boolean(entry.mobile) === mobile &&
        entry.family === family,
    );
  return createCurlProfileVariant(profile, preset);
}

function isCurlProfileCatalogStale(catalog, now = Date.now()) {
  const updatedAt = Number(catalog && catalog.updatedAt);
  return !Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt >= CURL_PROFILE_MAX_AGE_MS;
}

function createCurlProfilePublicEntry(profile) {
  return {
    id: profile.id,
    target: profile.target,
    family: profile.family,
    version: profile.version,
    platform: profile.platform,
    mobile: profile.mobile,
    userAgent: profile.userAgent,
    sourceUrl: profile.sourceUrl,
    updatedAt: profile.updatedAt,
  };
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CURL_PROFILE_CACHE_KEY,
    CURL_PROFILE_CACHE_VERSION,
    CURL_PROFILE_DIRECTORY_URL,
    CURL_PROFILE_UPDATE_SOURCE,
    CURL_PROFILE_RAW_BASE_URL,
    CURL_PROFILE_UPDATE_PERIOD_MINUTES,
    CURL_PROFILE_MAX_AGE_MS,
    CURL_PROFILE_ALLOWED_TARGETS,
    CURL_PROFILE_EXCLUDED_TARGETS,
    USER_AGENT_PRESET_DEFINITIONS,
    DEFAULT_CURL_PROFILE_CATALOG,
    createUserAgentSelectionValue,
    parseUserAgentSelection,
    getUserAgentPresetVersionLabel,
    getUserAgentSelectionValue,
    getUserAgentSelectionOptions,
    cloneCurlProfile,
    normalizeCurlProfile,
    normalizeCurlProfileCatalog,
    getCurlProfileEntries,
    parseCurlShellHeaders,
    parseCurlBrands,
    getCurlTargetFromWrapper,
    createCurlProfileFromWrapper,
    getCurlProfileByTarget,
    createCurlProfileVariant,
    getCurlProfileForConfig,
    isModernCurlProfileTarget,
    isCurlProfileCatalogStale,
    createCurlProfilePublicEntry,
  };
}
