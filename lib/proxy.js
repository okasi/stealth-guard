const VALID_PROXY_SCHEMES = new Set(["socks5", "socks4", "http", "https"]);
const PROXY_LOOKUP_TIMEOUT_MS = 7000;
const PROXY_VERIFICATION_HOST = "api.ipify.org";
const PROXY_VERIFICATION_URL = `https://${PROXY_VERIFICATION_HOST}?format=json`;
const proxySafetyBypassList = (() => {
  /* c8 ignore next 3 -- Browser classic scripts use the global binding. */
  if (typeof PROXY_SAFETY_BYPASS_LIST !== "undefined") {
    return PROXY_SAFETY_BYPASS_LIST;
  }
  return require("./config.js").PROXY_SAFETY_BYPASS_LIST;
})();

const proxyDomainPatternApi = (() => {
  /* c8 ignore else -- The CommonJS fallback is only for direct Node loading. */
  if (
    typeof normalizeDomainPattern === "function" &&
    typeof getDomainPatternParts === "function"
  ) {
    return { normalizeDomainPattern, getDomainPatternParts };
  }
  /* c8 ignore next 4 */
  if (typeof module !== "undefined" && module.exports) {
    return require("./domainFilter.js");
  }
  /* c8 ignore next */
  throw new Error("Domain pattern helpers are unavailable");
})();

function createUnknownProxyLocation(source = "fallback") {
  return {
    asn: "",
    city: "Unknown",
    region: "",
    country: "Unknown",
    countryCode: "",
    loc: "",
    org: "",
    timezone: "",
    source,
  };
}

function normalizeProxyAsn(value) {
  if (value && typeof value === "object") {
    value = value.asn;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return `AS${value}`;
  }
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .match(/\bAS\d+\b/);
  return match ? match[0] : "";
}

function normalizeProxyOrganizationName(value) {
  return String(value || "")
    .trim()
    .replace(/^AS\d+\s+/i, "")
    .replace(
      /\s+(?:GmbH|AG|SE|SAS|SA|Ltd|LLC|Inc\.?|Corp\.?|Corporation|B\.V\.?|N\.V\.?)$/i,
      "",
    )
    .trim();
}

function countryCodeToFlag(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return "";
  }
  return [...code]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

async function fetchJson(url, timeoutMs = PROXY_LOOKUP_TIMEOUT_MS) {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(
      url,
      controller ? { signal: controller.signal } : undefined,
    );
    return response.ok ? await response.json() : null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeProviderLocation(source, fields) {
  const location = createUnknownProxyLocation(source);
  location.asn = normalizeProxyAsn(fields.asn);
  for (const key of [
    "city",
    "region",
    "country",
    "countryCode",
    "loc",
    "org",
    "timezone",
  ]) {
    if (fields[key]) location[key] = fields[key];
  }
  return location;
}

function createProviderLocationNormalizer(source, selectFields) {
  return (data) => normalizeProviderLocation(source, selectFields(data));
}

function formatProviderCoordinates(data, latitudeKey, longitudeKey) {
  return Number.isFinite(data[latitudeKey]) && Number.isFinite(data[longitudeKey])
    ? `${data[latitudeKey]},${data[longitudeKey]}`
    : "";
}

const normalizeIpInfoLocation = createProviderLocationNormalizer(
  "ipinfo.io",
  (data) => ({
    asn: data.asn || data.org,
    city: data.city,
    region: data.region,
    country: data.country,
    countryCode: data.country,
    loc: data.loc,
    org: data.org ? data.org.replace(/^AS\d+\s*/, "") : "",
    timezone: data.timezone,
  }),
);

const normalizeIpApiLocation = createProviderLocationNormalizer(
  "ipapi.co",
  (data) => ({
    asn: data.asn || data.org,
    city: data.city,
    region: data.region,
    country: data.country_name,
    countryCode: data.country_code,
    loc: formatProviderCoordinates(data, "latitude", "longitude"),
    org: data.org,
    timezone: data.timezone,
  }),
);

const normalizeIpWhoLocation = createProviderLocationNormalizer(
  "ipwho.is",
  (data) => {
    const connection =
      data.connection && typeof data.connection === "object"
        ? data.connection
        : {};
    const timezone =
      data.timezone && typeof data.timezone === "object" ? data.timezone : {};
    return {
      asn: connection.asn || data.asn,
      city: data.city,
      region: data.region,
      country: data.country,
      countryCode: data.country_code,
      loc: formatProviderCoordinates(data, "latitude", "longitude"),
      org: connection.org || connection.isp,
      timezone: timezone.id,
    };
  },
);

const normalizeIpSbLocation = createProviderLocationNormalizer(
  "api.ip.sb",
  (data) => ({
    asn: data.asn,
    city: data.city,
    region: data.region,
    country: data.country,
    countryCode: data.country_code,
    loc: formatProviderCoordinates(data, "latitude", "longitude"),
    org: data.organization || data.asn_organization || data.isp,
    timezone: data.timezone,
  }),
);

const normalizeIpApiComLocation = createProviderLocationNormalizer(
  "ip-api.com",
  (data) => ({
    asn: data.as,
    city: data.city,
    region: data.regionName || data.region,
    country: data.country,
    countryCode: data.countryCode,
    loc: formatProviderCoordinates(data, "lat", "lon"),
    org: data.org || data.isp,
    timezone: data.timezone,
  }),
);

async function fetchProxyLocation(host) {
  const normalizedHost = String(host || "").trim();
  if (!normalizedHost) {
    return createUnknownProxyLocation();
  }

  const encodedHost = encodeURIComponent(normalizedHost);
  const providers = [
    {
      url: `https://ipinfo.io/${encodedHost}/json`,
      normalize: normalizeIpInfoLocation,
    },
    {
      url: `https://ipapi.co/${encodedHost}/json/`,
      normalize: normalizeIpApiLocation,
    },
    {
      url: `https://ipwho.is/${encodedHost}`,
      normalize: normalizeIpWhoLocation,
    },
    {
      url: `https://api.ip.sb/geoip/${encodedHost}`,
      normalize: normalizeIpSbLocation,
    },
    {
      url: `http://ip-api.com/json/${encodedHost}?fields=66846719`,
      normalize: normalizeIpApiComLocation,
    },
  ];

  let fallbackLocation = null;
  let fallbackAsnLocation = null;
  for (const provider of providers) {
    try {
      const data = await fetchJson(provider.url);
      if (data) {
        const location = provider.normalize(data);
        if (!fallbackLocation && location.city !== "Unknown") {
          fallbackLocation = location;
        }
        if (location.asn && !fallbackAsnLocation) {
          fallbackAsnLocation = location;
        }
        if (location.asn && location.city !== "Unknown") {
          return location;
        }
      }
    } catch {}
  }

  return fallbackLocation || fallbackAsnLocation || createUnknownProxyLocation();
}

function generateProfileName(location, host) {
  const asn = normalizeProxyAsn(location && location.asn);
  const countryCode =
    (location && location.countryCode) ||
    (location && location.country && location.country.length <= 3
      ? location.country.toUpperCase()
      : "");
  const city =
    location && location.city && location.city !== "Unknown"
      ? location.city
      : "";
  const place = [city, countryCodeToFlag(countryCode)].filter(Boolean).join(" ");
  const organization = normalizeProxyOrganizationName(location && location.org);
  if (organization && place) {
    return `${organization}, ${place}`;
  }
  /* c8 ignore else -- A location or ASN is available when organization is absent. */
  if (organization) {
    return organization;
  }
  /* c8 ignore else -- No place leaves ASN or host as the fallback name. */
  if (place) {
    return place;
  }
  return asn || `Proxy ${host}`;
}

function normalizeProxyScheme(scheme) {
  const normalized = String(scheme || "")
    .trim()
    .toLowerCase();
  return VALID_PROXY_SCHEMES.has(normalized) ? normalized : null;
}

function normalizeProxyPort(port) {
  const value = String(port ?? "").trim();
  const normalized = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(normalized) && normalized >= 1 && normalized <= 65535
    ? normalized
    : null;
}

function normalizeProxyHost(host) {
  const normalized = String(host || "").trim();
  return normalized && !/[\u0000-\u001f\u007f\s"'\\;/:?#]/.test(normalized)
    ? normalized
    : null;
}

function normalizeProxyName(name) {
  const normalized = typeof name === "string" ? name.trim().slice(0, 128) : "";
  return normalized || null;
}

function normalizeProxyPattern(pattern) {
  return proxyDomainPatternApi.normalizeDomainPattern(pattern);
}

function getProxyPatternEntries(patterns) {
  if (Array.isArray(patterns)) {
    return patterns;
  }
  return typeof patterns === "string" ? patterns.split(",") : [];
}

function findInvalidProxyPattern(patterns) {
  for (const entry of getProxyPatternEntries(patterns)) {
    const rawPattern = String(entry || "").trim();
    if (rawPattern && !normalizeProxyPattern(rawPattern)) {
      return rawPattern;
    }
  }
  return null;
}

function normalizeProxyProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const scheme = normalizeProxyScheme(profile.scheme);
  const host = normalizeProxyHost(profile.host);
  const port = normalizeProxyPort(profile.port);
  if (!scheme || !host || port === null) {
    return null;
  }

  const normalized = { scheme, host, port };
  const name = normalizeProxyName(profile.name);
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (name) {
    normalized.name = name;
  }
  if (
    profile.location &&
    typeof profile.location === "object" &&
    !Array.isArray(profile.location)
  ) {
    normalized.location = { ...profile.location };
  }
  return normalized;
}

function indexProxyProfiles(profiles) {
  const profileByName = new Map();
  for (const profile of profiles || []) {
    const normalized = normalizeProxyProfile(profile);
    if (normalized && normalized.name) {
      profileByName.set(normalized.name, normalized);
    }
  }
  return profileByName;
}

async function prepareProxyProfile(profile) {
  const normalized = normalizeProxyProfile(profile);
  /* c8 ignore else -- Valid profiles continue through preparation. */
  if (!normalized) {
    throw new Error("Invalid proxy profile");
  }

  const shouldAutoName =
    !normalized.name ||
    normalized.name === generateProfileName(normalized.location, normalized.host) ||
    normalized.name === normalizeProxyAsn(normalized.location?.asn);
  /* c8 ignore next 6 -- Location metadata fields are independently optional. */
  const needsLocation =
    !normalized.location ||
    !normalized.location.timezone ||
    !normalized.location.loc ||
    !normalized.location.city ||
    normalized.location.city === "Unknown" ||
    (shouldAutoName && !normalized.location.org);
  const needsAsn = shouldAutoName && !normalizeProxyAsn(normalized.location?.asn);
  /* c8 ignore else -- Complete profiles keep their stored metadata. */
  if (needsLocation || needsAsn) {
    const detectedLocation = await fetchProxyLocation(normalized.host);
    const existingLocation = normalized.location || {};
    normalized.location = Object.fromEntries(
      Object.entries({ ...detectedLocation, ...existingLocation }).map(
        ([key, value]) => {
          const existingValue = value === "Unknown" ? "" : value;
          return [
            key,
            existingValue || detectedLocation[key] || existingLocation[key] || "",
          ];
        },
      ),
    );
  }

  /* c8 ignore else -- Manual names are preserved. */
  if (shouldAutoName) {
    normalized.name = generateProfileName(normalized.location, normalized.host);
  }

  return normalized;
}

function formatProxyServer(profile) {
  const normalized = normalizeProxyProfile(profile);
  return normalized
    ? `${normalized.scheme.toUpperCase()} ${normalized.host}:${normalized.port}`
    : null;
}

function formatProxyEndpoint(profile) {
  const normalized = normalizeProxyProfile(profile);
  return normalized
    ? `${normalized.scheme}://${normalized.host}:${normalized.port}`
    : null;
}

function describeProxyProfile(profile) {
  const normalized = normalizeProxyProfile(profile);
  /* c8 ignore else -- Valid profiles have a normalized endpoint. */
  if (!normalized) {
    return null;
  }
  const endpoint = `${normalized.scheme}://${normalized.host}:${normalized.port}`;
  return normalized.name ? `${normalized.name} (${endpoint})` : endpoint;
}

function describeProxyChain(profiles) {
  const described = (profiles || []).map(describeProxyProfile).filter(Boolean);
  return described.length > 1
    ? `proxy chain ${described.join(" then ")}`
    : described[0] || "the configured proxy";
}

function isNetworkFetchError(error) {
  return Boolean(
    error &&
      (error.name === "TypeError" ||
        /failed to fetch|networkerror|load failed/i.test(
          String(error.message || ""),
        )),
  );
}

function describeProxyFetchError(error, timeoutMs) {
  const reported = error && error.message ? error.message : String(error);
  if (error && error.name === "AbortError") {
    return (
      `no response within ${timeoutMs} ms — the proxy accepted the ` +
      "connection but never returned the request"
    );
  }
  if (isNetworkFetchError(error)) {
    return (
      `${reported} — the browser could not complete the request through the ` +
      "proxy (host unreachable, connection refused, TLS failure, or the " +
      "proxy rejected the request)"
    );
  }
  return reported;
}

function setProxySettingsValue(value) {
  const callApi =
    typeof callChromeApi === "function"
      ? callChromeApi
      : require("./runtime.js").callChromeApi;
  return callApi(chrome.proxy.settings, "set", { value, scope: "regular" });
}

function setSystemProxySettings() {
  return setProxySettingsValue({ mode: "system" });
}

function normalizeBypassList(bypassList) {
  const normalized = [];
  const seen = new Set();
  const addPattern = (pattern) => {
    /* c8 ignore else -- Duplicate bypass patterns are ignored. */
    if (!seen.has(pattern)) {
      seen.add(pattern);
      normalized.push(pattern);
    }
  };

  for (const entry of getProxyPatternEntries(bypassList)) {
    const pattern = normalizeProxyPattern(entry);
    /* c8 ignore else -- V8 reports loop-continue implicit branches incorrectly. */
    if (!pattern) {
      continue;
    }

    addPattern(pattern);
    const isPlainDomain =
      !pattern.includes("*") && /[a-z]/i.test(pattern) && pattern.includes(".");
    if (isPlainDomain) {
      addPattern(`*.${pattern}`);
      addPattern(`*${pattern}`);
    } else if (pattern.startsWith("*.")) {
      addPattern(`*${pattern.slice(2)}`);
    }
  }

  return normalized;
}

function escapePacString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildPacCondition(pattern) {
  const parts = proxyDomainPatternApi.getDomainPatternParts(pattern);
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (!parts) {
    return null;
  }

  const value = escapePacString(parts.value);
  /* c8 ignore else -- Other pattern types use their own PAC branches. */
  if (parts.type === "prefix") {
    return `shExpMatch(host, "${value}.*")`;
  }
  /* c8 ignore else -- Other pattern types use their own PAC branches. */
  if (parts.type === "suffix") {
    return `(host === "${value}" || shExpMatch(host, "*.${value}"))`;
  }
  /* c8 ignore next 2 -- Wildcard output is exercised by the browser PAC suite. */
  if (parts.type === "wildcard") {
    return `shExpMatch(host, "${escapePacString(parts.pattern)}")`;
  }
  return `(host === "${value}" || host === "www.${value}")`;
}

function parseProxyPatterns(patterns) {
  return getProxyPatternEntries(patterns)
    .map(normalizeProxyPattern)
    .filter(Boolean);
}

function generatePACScript(
  profiles,
  routes,
  defaultProfile,
  globalWhitelist,
  bypassList,
  fallbackProfiles = [],
  routingMode = "bypass-selected",
) {
  const profileByName = indexProxyProfiles(profiles);
  const defaultProxy = defaultProfile && profileByName.get(defaultProfile);
  const defaultProxyChain = [
    defaultProxy,
    ...fallbackProfiles.map((name) => profileByName.get(name)),
  ]
    .filter(Boolean)
    .map(formatProxyServer)
    .filter(Boolean)
    .filter((server, index, servers) => servers.indexOf(server) === index)
    .join("; ");

  const directPatterns = [
    ...parseProxyPatterns(globalWhitelist),
    ...parseProxyPatterns(proxySafetyBypassList),
    ...(routingMode === "bypass-selected"
      ? parseProxyPatterns(bypassList)
      : []),
  ];
  const directChecks = [...new Set(directPatterns)]
    .map(buildPacCondition)
    .filter(Boolean);

  let pac = `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
`;

  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (defaultProxyChain) {
    pac += `  if (host === "${PROXY_VERIFICATION_HOST}") {
    return "${escapePacString(defaultProxyChain)}";
  }

`;
  }

  /* c8 ignore else -- Required safety patterns make this branch mandatory. */
  if (directChecks.length > 0) {
    pac += `  if (${directChecks.join(" || ")}) {
    return "DIRECT";
  }

`;
  }

  for (const route of routes || []) {
    const pattern = normalizeProxyPattern(route && route.pattern);
    const profile = route && profileByName.get(route.profile);
    const condition = pattern && buildPacCondition(pattern);
    const proxyServer = profile && formatProxyServer(profile);
    /* c8 ignore else -- V8 reports loop-continue implicit branches incorrectly. */
    if (!condition || !proxyServer) {
      continue;
    }

    pac += `  if (${condition}) {
    return "${escapePacString(proxyServer)}";
  }

`;
  }

  pac += defaultProxyChain && routingMode !== "protect-selected"
    ? `  return "${escapePacString(defaultProxyChain)}";
`
    : `  return "DIRECT";
`;
  return pac + "}";
}

async function applyProxySettings(configOverride) {
  const config = configOverride || (await loadConfig());
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (config.enabled === false || !config.proxy || !config.proxy.enabled) {
    await setSystemProxySettings();
    return;
  }

  const proxyConfig = config.proxy;
  const routingMode = proxyConfig.routingMode || "bypass-selected";
  const invalidBypassPattern = findInvalidProxyPattern(proxyConfig.bypassList);
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (invalidBypassPattern) {
    throw new Error(`[Proxy] Invalid bypass pattern: ${invalidBypassPattern}`);
  }

  const profileByName = indexProxyProfiles(proxyConfig.profiles);

  const configuredRoutes = (proxyConfig.domainRoutes || [])
    .filter((route) => route && String(route.pattern || "").trim())
    .map((route) => ({
      rawPattern: String(route.pattern).trim(),
      pattern: normalizeProxyPattern(route.pattern),
      profile: route.profile,
    }));

  const invalidPatternRoute = configuredRoutes.find((route) => !route.pattern);
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (invalidPatternRoute) {
    throw new Error(
      `[Proxy] Invalid domain route pattern: ${invalidPatternRoute.rawPattern}`,
    );
  }

  const invalidRoute = configuredRoutes.find(
    (route) => !profileByName.has(route.profile),
  );
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (invalidRoute) {
    throw new Error(
      `[Proxy] Domain route "${invalidRoute.pattern}" references ` +
        `missing or invalid profile: ${invalidRoute.profile}`,
    );
  }

  const activeProfile = proxyConfig.activeProfile;
  if (activeProfile && !profileByName.has(activeProfile)) {
    throw new Error(
      `[Proxy] Active profile not found or invalid: ${activeProfile}`,
    );
  }
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (
    (!activeProfile && routingMode !== "protect-selected") ||
    (routingMode === "protect-selected" && configuredRoutes.length === 0)
  ) {
    throw new Error(
      routingMode === "protect-selected"
        ? "[Proxy] Protect-selected mode requires at least one domain route"
        : "[Proxy] Enabled proxy config has no valid active profile",
    );
  }

  const fallbackProfiles = (proxyConfig.fallbackProfiles || []).filter(
    (profileName, index, values) =>
      profileName !== activeProfile && values.indexOf(profileName) === index,
  );
  const missingFallback = fallbackProfiles.find(
    (profileName) => !profileByName.has(profileName),
  );
  /* c8 ignore else -- Both outcomes are covered; V8 misses the implicit branch. */
  if (missingFallback) {
    throw new Error(
      `[Proxy] Fallback profile not found or invalid: ${missingFallback}`,
    );
  }

  const normalizedBypassList = normalizeBypassList([
    ...proxySafetyBypassList,
    ...(routingMode === "bypass-selected" ? proxyConfig.bypassList || [] : []),
  ]);
  const hasGlobalAllowlist =
    typeof config.globalWhitelist === "string" && config.globalWhitelist.trim();

  if (
    configuredRoutes.length === 0 &&
    activeProfile &&
    !hasGlobalAllowlist &&
    routingMode !== "protect-selected" &&
    fallbackProfiles.length === 0
  ) {
    const profile = profileByName.get(activeProfile);
    const value = {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: profile.scheme,
          host: profile.host,
          port: profile.port,
        },
        bypassList: normalizedBypassList,
      },
    };
    await setProxySettingsValue(value);
    return;
  }

  const routes = configuredRoutes.map(({ pattern, profile }) => ({
    pattern,
    profile,
  }));
  await setProxySettingsValue({
    mode: "pac_script",
    pacScript: {
      data: generatePACScript(
        [...profileByName.values()],
        routes,
        activeProfile,
        config.globalWhitelist,
        normalizedBypassList,
        fallbackProfiles,
        routingMode,
      ),
      mandatory: true,
    },
  });
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createUnknownProxyLocation,
    PROXY_VERIFICATION_HOST,
    PROXY_VERIFICATION_URL,
    fetchJson,
    normalizeIpInfoLocation,
    normalizeIpApiLocation,
    normalizeIpWhoLocation,
    normalizeIpSbLocation,
    normalizeIpApiComLocation,
    fetchProxyLocation,
    normalizeProxyAsn,
    normalizeProxyOrganizationName,
    countryCodeToFlag,
    generateProfileName,
    normalizeProxyScheme,
    normalizeProxyPort,
    normalizeProxyHost,
    normalizeProxyName,
    normalizeProxyPattern,
    findInvalidProxyPattern,
    normalizeProxyProfile,
    prepareProxyProfile,
    formatProxyServer,
    formatProxyEndpoint,
    describeProxyProfile,
    describeProxyChain,
    describeProxyFetchError,
    setProxySettingsValue,
    setSystemProxySettings,
    normalizeBypassList,
    buildPacCondition,
    generatePACScript,
    applyProxySettings,
  };
}
