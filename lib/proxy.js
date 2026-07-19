const VALID_PROXY_SCHEMES = new Set(["socks5", "socks4", "http", "https"]);
const PROXY_LOOKUP_TIMEOUT_MS = 7000;

function getDomainPatternApi() {
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
}

function createUnknownProxyLocation(source = "fallback") {
  return {
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
    return response.ok ? response.json() : null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeIpInfoLocation(data) {
  const location = createUnknownProxyLocation("ipinfo.io");
  location.city = data.city || location.city;
  location.region = data.region || "";
  location.country = data.country || location.country;
  location.countryCode = data.country || "";
  location.loc = data.loc || "";
  location.org = data.org ? data.org.replace(/^AS\d+\s*/, "") : "";
  location.timezone = data.timezone || "";
  return location;
}

function normalizeIpApiLocation(data) {
  const location = createUnknownProxyLocation("ipapi.co");
  location.city = data.city || location.city;
  location.region = data.region || "";
  location.country = data.country_name || location.country;
  location.countryCode = data.country_code || "";
  location.loc =
    Number.isFinite(data.latitude) && Number.isFinite(data.longitude)
      ? `${data.latitude},${data.longitude}`
      : "";
  location.org = data.org || "";
  location.timezone = data.timezone || "";
  return location;
}

async function fetchProxyLocation(host, token = "") {
  const normalizedHost = String(host || "").trim();
  if (!normalizedHost) {
    return createUnknownProxyLocation();
  }

  const encodedHost = encodeURIComponent(normalizedHost);
  const providers = [
    {
      url: token
        ? `https://ipinfo.io/${encodedHost}?token=${encodeURIComponent(token)}`
        : `https://ipinfo.io/${encodedHost}/json`,
      normalize: normalizeIpInfoLocation,
    },
    {
      url: `https://ipapi.co/${encodedHost}/json/`,
      normalize: normalizeIpApiLocation,
    },
  ];

  for (const provider of providers) {
    try {
      const data = await fetchJson(provider.url);
      if (data) {
        return provider.normalize(data);
      }
    } catch (error) {
      // Try the next provider.
    }
  }

  return createUnknownProxyLocation();
}

function generateProfileName(location, host) {
  if (!location || !location.city || location.city === "Unknown") {
    return `Proxy ${host}`;
  }

  const countryCode =
    location.countryCode ||
    (location.country && location.country.length <= 3
      ? location.country.toUpperCase()
      : "");
  const place = countryCode
    ? `${location.city}, ${countryCode}`
    : location.city;
  return location.org ? `${place} (${location.org})` : place;
}

function normalizeProxyScheme(scheme) {
  const normalized = String(scheme || "")
    .trim()
    .toLowerCase();
  return VALID_PROXY_SCHEMES.has(normalized) ? normalized : null;
}

function normalizeProxyPort(port) {
  const normalized = Number.parseInt(port, 10);
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
  return getDomainPatternApi().normalizeDomainPattern(pattern);
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

async function prepareProxyProfile(profile) {
  const normalized = normalizeProxyProfile(profile);
  if (!normalized) {
    throw new Error("Invalid proxy profile");
  }

  if (!normalized.name) {
    normalized.location = await fetchProxyLocation(normalized.host);
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

function sanitizePacComment(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "?")
    .slice(0, 120);
}

function setProxySettingsValue(value) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: "regular" }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(
          new Error(
            chrome.runtime.lastError.message ||
              String(chrome.runtime.lastError),
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function setSystemProxySettings() {
  return setProxySettingsValue({ mode: "system" });
}

function normalizeBypassList(bypassList) {
  const normalized = [];
  const seen = new Set();
  const addPattern = (pattern) => {
    if (!seen.has(pattern)) {
      seen.add(pattern);
      normalized.push(pattern);
    }
  };

  for (const entry of getProxyPatternEntries(bypassList)) {
    const pattern = normalizeProxyPattern(entry);
    /* c8 ignore else */
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
  const parts = getDomainPatternApi().getDomainPatternParts(pattern);
  /* c8 ignore else */
  if (!parts) {
    return null;
  }

  const value = escapePacString(parts.value);
  if (parts.type === "prefix") {
    return `shExpMatch(host, "${value}.*")`;
  }
  if (parts.type === "suffix") {
    return `(host === "${value}" || shExpMatch(host, "*.${value}"))`;
  }
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
) {
  const profileByName = new Map();
  for (const profile of profiles || []) {
    const normalized = normalizeProxyProfile(profile);
    if (normalized && normalized.name) {
      profileByName.set(normalized.name, normalized);
    }
  }

  const directPatterns = [
    ...parseProxyPatterns(globalWhitelist),
    ...parseProxyPatterns(bypassList),
  ];
  const directChecks = [...new Set(directPatterns)]
    .map(buildPacCondition)
    .filter(Boolean);

  let pac = `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
`;

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
    /* c8 ignore else */
    if (!condition || !proxyServer) {
      continue;
    }

    pac += `  // Route ${sanitizePacComment(pattern)} -> ${sanitizePacComment(profile.name)}
  if (${condition}) {
    return "${escapePacString(proxyServer)}";
  }

`;
  }

  const defaultProxy = defaultProfile && profileByName.get(defaultProfile);
  pac += defaultProxy
    ? `  return "${escapePacString(formatProxyServer(defaultProxy))}";
`
    : `  return "DIRECT";
`;
  return pac + "}";
}

async function applyProxySettings(configOverride) {
  const config = configOverride || (await loadConfig());
  /* c8 ignore else */
  if (config.enabled === false || !config.proxy || !config.proxy.enabled) {
    await setSystemProxySettings();
    return;
  }

  const proxyConfig = config.proxy;
  const invalidBypassPattern = findInvalidProxyPattern(proxyConfig.bypassList);
  if (invalidBypassPattern) {
    throw new Error(`[Proxy] Invalid bypass pattern: ${invalidBypassPattern}`);
  }

  const profileByName = new Map();
  for (const profile of proxyConfig.profiles || []) {
    const normalized = normalizeProxyProfile(profile);
    if (normalized && normalized.name) {
      profileByName.set(normalized.name, normalized);
    }
  }

  const configuredRoutes = (proxyConfig.domainRoutes || [])
    .filter((route) => route && String(route.pattern || "").trim())
    .map((route) => ({
      rawPattern: String(route.pattern).trim(),
      pattern: normalizeProxyPattern(route.pattern),
      profile: route.profile,
    }));

  const invalidPatternRoute = configuredRoutes.find((route) => !route.pattern);
  /* c8 ignore else */
  if (invalidPatternRoute) {
    throw new Error(
      `[Proxy] Invalid domain route pattern: ${invalidPatternRoute.rawPattern}`,
    );
  }

  const invalidRoute = configuredRoutes.find(
    (route) => !profileByName.has(route.profile),
  );
  /* c8 ignore else */
  if (invalidRoute) {
    throw new Error(
      `[Proxy] Domain route "${invalidRoute.pattern}" references missing or invalid profile: ${invalidRoute.profile}`,
    );
  }

  const activeProfile = proxyConfig.activeProfile;
  if (activeProfile && !profileByName.has(activeProfile)) {
    throw new Error(
      `[Proxy] Active profile not found or invalid: ${activeProfile}`,
    );
  }
  /* c8 ignore else */
  if (!activeProfile && configuredRoutes.length === 0) {
    throw new Error(
      "[Proxy] Enabled proxy config has no valid active profile or domain route",
    );
  }

  const normalizedBypassList = normalizeBypassList(proxyConfig.bypassList);
  const hasGlobalAllowlist =
    typeof config.globalWhitelist === "string" && config.globalWhitelist.trim();

  if (configuredRoutes.length === 0 && activeProfile && !hasGlobalAllowlist) {
    const profile = profileByName.get(activeProfile);
    const value = {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: profile.scheme,
          host: profile.host,
          port: profile.port,
        },
      },
    };
    if (normalizedBypassList.length > 0) {
      value.rules.bypassList = normalizedBypassList;
    }
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
      ),
      mandatory: true,
    },
  });
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createUnknownProxyLocation,
    fetchJson,
    normalizeIpInfoLocation,
    normalizeIpApiLocation,
    fetchProxyLocation,
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
    sanitizePacComment,
    setProxySettingsValue,
    setSystemProxySettings,
    normalizeBypassList,
    buildPacCondition,
    generatePACScript,
    applyProxySettings,
  };
}
