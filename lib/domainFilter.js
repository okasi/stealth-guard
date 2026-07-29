function createDomainPatternTools() {
  const parsedListCache = new Map();
  const wildcardRegexCache = new Map();
  const CACHE_LIMIT = 256;

  function cacheSet(cache, key, value) {
    if (cache.size >= CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
  }

  function normalizeHostname(hostname) {
    return typeof hostname === "string"
      ? hostname.trim().toLowerCase().replace(/\.$/, "")
      : "";
  }

  function normalizePattern(pattern) {
    const normalized = normalizeHostname(String(pattern || ""));
    if (!normalized || /[\u0000-\u001f\u007f\s"'\\;/:?#]/.test(normalized)) {
      return null;
    }

    const wildcardCount = (normalized.match(/\*/g) || []).length;
    const supportedShape =
      wildcardCount === 0 ||
      (wildcardCount === 1 &&
        normalized.startsWith("*.") &&
        normalized.length > 2) ||
      (wildcardCount === 1 &&
        normalized.endsWith(".*") &&
        normalized.length > 2) ||
      (wildcardCount === 1 &&
        normalized.startsWith("*") &&
        normalized.length > 1) ||
      (wildcardCount === 2 &&
        normalized.startsWith("*") &&
        normalized.endsWith("*") &&
        normalized.length > 2);
    if (!supportedShape) {
      return null;
    }

    const hostnameCandidate = normalized
      .replace(/\*/g, "")
      .replace(/^\./, "")
      .replace(/\.$/, "");
    return hostnameCandidate && !hostnameCandidate.includes("..")
      ? normalized
      : null;
  }

  function parsePatterns(patternString) {
    const cacheKey = typeof patternString === "string" ? patternString : "";
    if (parsedListCache.has(cacheKey)) {
      return parsedListCache.get(cacheKey);
    }

    const patterns = cacheKey.split(",").map(normalizePattern).filter(Boolean);
    cacheSet(parsedListCache, cacheKey, patterns);
    return patterns;
  }

  function getParts(pattern) {
    const normalized = normalizePattern(pattern);
    if (!normalized) {
      return null;
    }

    const hasOnlyLeadingWildcard =
      normalized.startsWith("*") &&
      !normalized.startsWith("*.") &&
      normalized.indexOf("*", 1) === -1;

    if (normalized.endsWith(".*")) {
      return {
        pattern: normalized,
        type: "prefix",
        value: normalized.slice(0, -2),
      };
    }
    if (normalized.startsWith("*.")) {
      return {
        pattern: normalized,
        type: "suffix",
        value: normalized.slice(2),
      };
    }
    if (hasOnlyLeadingWildcard) {
      return {
        pattern: normalized,
        type: "suffix",
        value: normalized.slice(1),
      };
    }
    if (normalized.includes("*")) {
      return { pattern: normalized, type: "wildcard", value: normalized };
    }
    return { pattern: normalized, type: "plain", value: normalized };
  }

  function getWildcardRegex(pattern) {
    if (wildcardRegexCache.has(pattern)) {
      return wildcardRegexCache.get(pattern);
    }

    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);
    cacheSet(wildcardRegexCache, pattern, regex);
    return regex;
  }

  function matches(hostname, pattern) {
    const normalizedHostname = normalizeHostname(hostname);
    const parts = getParts(pattern);
    if (!normalizedHostname || !parts) {
      return false;
    }

    if (normalizedHostname === parts.pattern) {
      return true;
    }
    if (parts.type === "prefix") {
      return normalizedHostname.startsWith(parts.value + ".");
    }
    if (parts.type === "suffix") {
      return (
        normalizedHostname === parts.value ||
        normalizedHostname.endsWith("." + parts.value)
      );
    }
    if (parts.type === "wildcard") {
      return getWildcardRegex(parts.value).test(normalizedHostname);
    }
    return normalizedHostname === "www." + parts.value;
  }

  function isAllowlisted(hostname, allowlist) {
    const normalizedHostname = normalizeHostname(hostname);
    return Boolean(
      normalizedHostname &&
        typeof allowlist === "string" &&
        allowlist.trim() &&
        parsePatterns(allowlist).some((pattern) =>
          matches(normalizedHostname, pattern),
        ),
    );
  }

  return {
    normalizeHostname,
    normalizePattern,
    parsePatterns,
    getParts,
    matches,
    isAllowlisted,
  };
}

const domainPatternTools = createDomainPatternTools();
const normalizeHostname = domainPatternTools.normalizeHostname;
const normalizeDomainPattern = domainPatternTools.normalizePattern;
const parseDomainPatterns = domainPatternTools.parsePatterns;
const getDomainPatternParts = domainPatternTools.getParts;
const matchesDomainPattern = domainPatternTools.matches;

function isDomainAllowlisted(hostname, allowlist) {
  return domainPatternTools.isAllowlisted(hostname, allowlist);
}

function isFeatureActiveForHostname(config, featureName, hostname) {
  const feature = config && config[featureName];
  return Boolean(
    config &&
      config.enabled &&
      feature &&
      feature.enabled &&
      hostname &&
      !isDomainAllowlisted(hostname, config.globalWhitelist) &&
      !isDomainAllowlisted(hostname, feature.whitelist),
  );
}

function addDomainToAllowlist(domain, allowlist) {
  const normalizedDomain = normalizeDomainPattern(domain);
  if (
    !normalizedDomain ||
    normalizedDomain.includes("*") ||
    isDomainAllowlisted(normalizedDomain, allowlist || "")
  ) {
    return allowlist;
  }

  const entry = `*.${normalizedDomain}`;
  return typeof allowlist === "string" && allowlist.trim()
    ? `${allowlist.trim()}, ${entry}`
    : entry;
}

function removeDomainFromAllowlist(domain, allowlist) {
  const normalizedDomain = normalizeHostname(domain);
  if (!normalizedDomain || typeof allowlist !== "string") {
    return allowlist;
  }

  return parseDomainPatterns(allowlist)
    .filter((pattern) => !matchesDomainPattern(normalizedDomain, pattern))
    .join(", ");
}

function isCloudflareChallengeHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "challenges.cloudflare.com" ||
    normalized.endsWith(".challenges.cloudflare.com")
  );
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createDomainPatternTools,
    normalizeHostname,
    normalizeDomainPattern,
    parseDomainPatterns,
    getDomainPatternParts,
    matchesDomainPattern,
    isDomainAllowlisted,
    isFeatureActiveForHostname,
    addDomainToAllowlist,
    removeDomainFromAllowlist,
    isCloudflareChallengeHostname,
  };
}
