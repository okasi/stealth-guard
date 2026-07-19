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

class DomainFilter {
  constructor(config = {}) {
    this.config = config;
  }

  shouldActivateFeature(url, featureName) {
    const featureConfig = this.config[featureName];
    const hostname = this.extractHostname(url);
    return Boolean(
      this.config.enabled &&
        featureConfig &&
        featureConfig.enabled &&
        hostname &&
        !this.isAllowlisted(hostname, this.config.globalWhitelist) &&
        !this.isAllowlisted(hostname, featureConfig.whitelist),
    );
  }

  isAllowlisted(hostname, allowlist) {
    return domainPatternTools.isAllowlisted(hostname, allowlist);
  }

  matchesPattern(hostname, pattern) {
    return matchesDomainPattern(hostname, pattern);
  }

  extractHostname(url) {
    try {
      return normalizeHostname(new URL(url).hostname);
    } catch (error) {
      return null;
    }
  }

  addDomainToAllowlist(domain, allowlist) {
    const normalizedDomain = normalizeDomainPattern(domain);
    if (
      !normalizedDomain ||
      normalizedDomain.includes("*") ||
      this.isAllowlisted(normalizedDomain, allowlist || "")
    ) {
      return allowlist;
    }

    const entry = `*.${normalizedDomain}`;
    return typeof allowlist === "string" && allowlist.trim()
      ? `${allowlist.trim()}, ${entry}`
      : entry;
  }

  removeDomainFromAllowlist(domain, allowlist) {
    const normalizedDomain = normalizeHostname(domain);
    if (!normalizedDomain || typeof allowlist !== "string") {
      return allowlist;
    }

    return parseDomainPatterns(allowlist)
      .filter((pattern) => !matchesDomainPattern(normalizedDomain, pattern))
      .join(", ");
  }
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createDomainPatternTools,
    DomainFilter,
    normalizeHostname,
    normalizeDomainPattern,
    parseDomainPatterns,
    getDomainPatternParts,
    matchesDomainPattern,
  };
}
