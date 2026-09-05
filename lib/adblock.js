const ADBLOCK_CACHE_KEY = "stealth-guard-filter-cache";
const ADBLOCK_CACHE_VERSION = 2;
const MAX_FILTER_TEXT_LENGTH = 16 * 1024 * 1024;

const adblockFilterListApi = (() => {
  /* c8 ignore next 5 -- Browser globals are covered by background/bundle integration checks. */
  if (
    typeof DEFAULT_FILTER_LISTS !== "undefined" &&
    typeof normalizeFilterListEntries === "function"
  ) {
    return { DEFAULT_FILTER_LISTS, normalizeFilterListEntries };
  }
  /* c8 ignore next 3 */
  if (typeof module !== "undefined" && module.exports) {
    return require("./filterLists.js");
  }
  /* c8 ignore next */
  throw new Error("Stealth Guard filter-list API is unavailable");
})();

const NETWORK_TYPES = new Set([
  "document",
  "font",
  "image",
  "media",
  "object",
  "other",
  "ping",
  "script",
  "stylesheet",
  "subdocument",
  "websocket",
  "xmlhttprequest",
]);

const NETWORK_TYPE_ALIASES = Object.freeze({
  css: "stylesheet",
  doc: "document",
  frame: "subdocument",
  xhr: "xmlhttprequest",
});

const UNSUPPORTED_OPTIONS = new Set([
  "badfilter",
  "csp",
  "cookie",
  "header",
  "permissions",
  "popup",
  "redirect",
  "redirect-rule",
  "removeheader",
  "removeparam",
  "replace",
  "urlskip",
  "urltransform",
]);
const IGNORED_OPTIONS = new Set([
  "generichide",
  "genericblock",
  "elemhide",
  "ehide",
]);
const DOMAIN_MATCH_REGEX_CACHE = new Map();
const DOMAIN_MATCH_REGEX_CACHE_LIMIT = 256;

function createEmptyCompiledRules() {
  return {
    version: ADBLOCK_CACHE_VERSION,
    network: { block: [], allow: [] },
    cosmetic: { hide: [], allow: [] },
    stats: { network: 0, cosmetic: 0, ignored: 0 },
  };
}

function normalizeFilterSubscriptions(value) {
  return adblockFilterListApi.normalizeFilterListEntries(value);
}

function normalizeRuleDomains(value) {
  const include = [];
  const exclude = [];
  for (const raw of value.split("|")) {
    const negated = raw.startsWith("~");
    const domain = raw.replace(/^~/, "").trim().toLowerCase();
    const normalizedDomain = domain.replace(/^\*\./, "");
    // AdGuard domain options also use a trailing wildcard (for example
    // `domain=daft.*`). Dropping that value silently turns a scoped rule into
    // a global rule, which can block application bundles such as `/index.js`.
    if (
      !normalizedDomain ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?:\.\*)?$/.test(normalizedDomain)
    ) {
      continue;
    }
    (negated ? exclude : include).push(normalizedDomain);
  }
  return { include, exclude };
}

function parseNetworkOptions(text) {
  const result = {
    types: [],
    excludedTypes: [],
    thirdParty: null,
    domains: [],
    excludedDomains: [],
    matchCase: false,
    important: false,
  };
  if (!text) return result;

  for (const rawOption of text.split(",")) {
    const option = rawOption.trim();
    if (!option) continue;
    const negated = option.startsWith("~");
    const unprefixed = option.replace(/^~/, "");
    const separator = unprefixed.indexOf("=");
    const name = (separator < 0 ? unprefixed : unprefixed.slice(0, separator))
      .toLowerCase();
    const value = separator < 0 ? "" : unprefixed.slice(separator + 1);
    const normalizedName = NETWORK_TYPE_ALIASES[name] || name;
    if (UNSUPPORTED_OPTIONS.has(normalizedName)) return null;
    if (NETWORK_TYPES.has(normalizedName)) {
      (negated ? result.excludedTypes : result.types).push(normalizedName);
    } else if (normalizedName === "third-party" || normalizedName === "3p") {
      result.thirdParty = !negated;
    } else if (normalizedName === "first-party" || normalizedName === "1p") {
      result.thirdParty = negated;
    } else if (normalizedName === "domain" || normalizedName === "from") {
      const domains = normalizeRuleDomains(value);
      if (!domains.include.length && !domains.exclude.length) return null;
      result.domains.push(...domains.include);
      result.excludedDomains.push(...domains.exclude);
    } else if (normalizedName === "match-case") {
      result.matchCase = !negated;
    } else if (normalizedName === "important") {
      result.important = !negated;
    } else if (!IGNORED_OPTIONS.has(normalizedName)) {
      return null;
    }
  }
  return result;
}

function splitNetworkRule(line) {
  if (line.startsWith("/") && line.lastIndexOf("/") > 0) {
    const closingSlash = line.lastIndexOf("/");
    return {
      pattern: line.slice(0, closingSlash + 1),
      options: line.slice(closingSlash + 1).replace(/^\$/, ""),
    };
  }
  const optionIndex = line.lastIndexOf("$");
  return optionIndex > 0
    ? { pattern: line.slice(0, optionIndex), options: line.slice(optionIndex + 1) }
    : { pattern: line, options: "" };
}

function isSafeRegexPattern(pattern) {
  return Boolean(
    pattern &&
      pattern.length <= 512 &&
      !/\\[1-9]/.test(pattern) &&
      !/\(\?<([=!])/.test(pattern) &&
      !/\([^)]*[*+][^)]*\)[*+{]/.test(pattern)
  );
}

function parseNetworkRule(line) {
  const allow = line.startsWith("@@");
  const source = allow ? line.slice(2) : line;
  const { pattern, options: optionText } = splitNetworkRule(source);
  const options = parseNetworkOptions(optionText);
  if (!options || !pattern || /\s/.test(pattern)) return null;
  if (/^\/(?:[^/\\]|\\.)+\/[imuys]*$/.test(pattern)) {
    const finalSlash = pattern.lastIndexOf("/");
    const regexPattern = pattern.slice(1, finalSlash);
    if (!isSafeRegexPattern(regexPattern)) return null;
    return {
      allow,
      kind: "regex",
      pattern: regexPattern,
      flags: pattern.slice(finalSlash + 1).replace(/[^imu]/g, ""),
      options,
    };
  }

  const domainMatch = pattern.match(/^\|\|([a-z0-9_.-]+)(?:\^|\|)?$/i);
  if (domainMatch) {
    return {
      allow,
      kind: "domain",
      pattern: domainMatch[1].toLowerCase().replace(/^\.+|\.+$/g, ""),
      options,
    };
  }

  if (
    pattern.length > 2048 ||
    (pattern.match(/\*/g) || []).length > 16 ||
    (pattern === "*" && !options.types.length && options.thirdParty === null)
  ) {
    return null;
  }
  return { allow, kind: "url", pattern, options };
}

function parseCosmeticRule(line) {
  const allowMarker = line.indexOf("#@#");
  const hideMarker = line.indexOf("##");
  const markerIndex = allowMarker >= 0 ? allowMarker : hideMarker;
  const markerLength = allowMarker >= 0 ? 3 : 2;
  if (markerIndex < 0) return null;
  const selector = line.slice(markerIndex + markerLength).trim();
  if (
    !selector ||
    selector.length > 2048 ||
    /[{}]/.test(selector) ||
    /(?:#\%#|#\?#|\+js\(|:has-text\(|:remove\(|:style\()/i.test(selector)
  ) {
    return null;
  }
  const rawDomains = line.slice(0, markerIndex);
  const domains = [];
  const excludedDomains = [];
  for (const raw of rawDomains.split(",")) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    const target = value.startsWith("~") ? excludedDomains : domains;
    const domain = value.replace(/^~/, "").replace(/^\*\./, "");
    if (/^[a-z0-9.*-]+$/.test(domain)) target.push(domain);
  }
  if (rawDomains.trim() && !domains.length && !excludedDomains.length) return null;
  return {
    allow: allowMarker >= 0,
    selector,
    domains,
    excludedDomains,
  };
}

function parseHostsRule(line) {
  const match = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1|::)\s+([^\s#]+)$/);
  return !match || match[1] === "localhost"
    ? null
    : {
        allow: false,
        kind: "domain",
        pattern: match[1].toLowerCase(),
        options: parseNetworkOptions(""),
      };
}

function parseFilterList(text) {
  if (typeof text !== "string") return createEmptyCompiledRules();
  const compiled = createEmptyCompiledRules();
  const boundedText = text.slice(0, MAX_FILTER_TEXT_LENGTH);
  for (const rawLine of boundedText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    const cosmetic = parseCosmeticRule(line);
    if (cosmetic) {
      compiled.cosmetic[cosmetic.allow ? "allow" : "hide"].push(cosmetic);
      compiled.stats.cosmetic += 1;
      continue;
    }
    if (/##|#[@?$%]#/.test(line)) {
      compiled.stats.ignored += 1;
      continue;
    }
    const network = parseHostsRule(line) || parseNetworkRule(line);
    if (network) {
      compiled.network[network.allow ? "allow" : "block"].push(network);
      compiled.stats.network += 1;
    } else {
      compiled.stats.ignored += 1;
    }
  }
  return compiled;
}

function mergeCompiledRules(values) {
  const merged = createEmptyCompiledRules();
  for (const value of values || []) {
    if (!value || value.version !== ADBLOCK_CACHE_VERSION) continue;
    // Large filter subscriptions can contain hundreds of thousands of rules.
    // Passing those arrays through spread turns every rule into a function
    // argument and exceeds Chromium's call-stack limit during startup.
    for (const rule of value.network?.block || []) {
      merged.network.block.push(rule);
    }
    for (const rule of value.network?.allow || []) {
      merged.network.allow.push(rule);
    }
    for (const rule of value.cosmetic?.hide || []) {
      merged.cosmetic.hide.push(rule);
    }
    for (const rule of value.cosmetic?.allow || []) {
      merged.cosmetic.allow.push(rule);
    }
    merged.stats.network += Number(value.stats?.network) || 0;
    merged.stats.cosmetic += Number(value.stats?.cosmetic) || 0;
    merged.stats.ignored += Number(value.stats?.ignored) || 0;
  }
  return merged;
}

function hostnameSuffixes(hostname) {
  const parts = String(hostname || "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  return parts.map((_, index) => parts.slice(index).join("."));
}

function domainMatches(hostname, domain) {
  const normalized = String(hostname || "").toLowerCase();
  if (domain && domain.includes("*")) {
    const cached = DOMAIN_MATCH_REGEX_CACHE.get(domain);
    if (cached) {
      return Boolean(normalized && cached.test(normalized));
    } else {
      const escaped = domain
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^.]+");
      const regex = new RegExp(`(?:^|\\.)${escaped}$`, "i");
      if (DOMAIN_MATCH_REGEX_CACHE.size >= DOMAIN_MATCH_REGEX_CACHE_LIMIT) {
        DOMAIN_MATCH_REGEX_CACHE.delete(
          DOMAIN_MATCH_REGEX_CACHE.keys().next().value,
        );
      }
      DOMAIN_MATCH_REGEX_CACHE.set(domain, regex);
      return Boolean(normalized && regex.test(normalized));
    }
  }
  return Boolean(
    normalized &&
      domain &&
      (normalized === domain || normalized.endsWith(`.${domain}`)),
  );
}

function longestPatternToken(pattern) {
  const tokens = String(pattern || "").toLowerCase().match(/[a-z0-9_%.-]{4,}/g);
  return (tokens || []).reduce(
    (longest, token) => token.length > longest.length ? token : longest,
    "",
  );
}

function compileUrlPattern(rule) {
  if (rule.kind === "regex") {
    try {
      return new RegExp(
        rule.pattern,
        rule.flags || (rule.options.matchCase ? "" : "i"),
      );
    } catch (error) {
      return null;
    }
  }
  let pattern = rule.pattern;
  const domainAnchored = pattern.startsWith("||");
  const startsAtBeginning = !domainAnchored && pattern.startsWith("|");
  const endsAtEnd = pattern.endsWith("|") && !pattern.endsWith("||");
  pattern = pattern
    .replace(domainAnchored ? /^\|\|/ : /^\|/, "")
    .replace(/\|$/, "");
  const escaped = pattern
    .replace(/[.+?${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\^/g, "(?:[^a-z0-9_.%-]|$)");
  try {
    const prefix = domainAnchored
      ? "^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]+\\.)?"
      : startsAtBeginning
        ? "^"
        : "";
    const suffix = endsAtEnd ? "$" : "";
    const flags = rule.options.matchCase ? "" : "i";
    return new RegExp(`${prefix}${escaped}${suffix}`, flags);
  } catch (error) {
    return null;
  }
}

function addIndexedRule(index, key, rule) {
  const bucket = index.get(key) || [];
  bucket.push(rule);
  index.set(key, bucket);
}

function createRuleIndex(rules) {
  const domains = new Map();
  const tokens = new Map();
  const fallback = [];
  for (const rule of rules || []) {
    const runtimeRule = { ...rule };
    if (rule.kind === "domain") {
      addIndexedRule(domains, rule.pattern, runtimeRule);
      continue;
    }
    runtimeRule.regex = compileUrlPattern(rule);
    if (!runtimeRule.regex) continue;
    // Index a fixed-width fragment: a literal may occur inside a longer URL
    // token (for example /adserver/ in /my-adserver-bundle.js).
    const token = rule.kind === "url" ? longestPatternToken(rule.pattern).slice(0, 4) : "";
    if (token) {
      addIndexedRule(tokens, token, runtimeRule);
    } else {
      fallback.push(runtimeRule);
    }
  }
  return { domains, tokens, fallback };
}

function cosmeticToken(selector) {
  const matches = String(selector).match(/[#.]([a-z0-9_-]{2,})/gi);
  if (!matches || !matches.length) {
    return "";
  } else {
    return matches
      .map((value) => value.slice(1).toLowerCase())
      .sort((left, right) => right.length - left.length)[0];
  }
}

function createAdblockEngine(compiled) {
  const safe = compiled && compiled.version === ADBLOCK_CACHE_VERSION
    ? compiled
    : createEmptyCompiledRules();
  const cosmeticSpecific = new Map();
  const cosmeticWildcard = [];
  const cosmeticGeneric = new Map();
  const cosmeticFallback = [];
  const cosmeticAllow = new Map();
  const cosmeticAllowWildcard = [];
  for (const rule of safe.cosmetic.hide || []) {
    if (rule.domains.length) {
      for (const domain of rule.domains) {
        if (domain.includes("*")) {
          cosmeticWildcard.push(rule);
        } else {
          addIndexedRule(cosmeticSpecific, domain, rule);
        }
      }
    } else {
      const token = cosmeticToken(rule.selector);
      if (token) {
        addIndexedRule(cosmeticGeneric, token, rule);
      } else if (cosmeticFallback.length < 500) {
        cosmeticFallback.push(rule);
      }
    }
  }
  for (const rule of safe.cosmetic.allow || []) {
    const domains = rule.domains.length ? rule.domains : [""];
    for (const domain of domains) {
      if (domain.includes("*")) {
        cosmeticAllowWildcard.push(rule);
      } else {
        addIndexedRule(cosmeticAllow, domain, rule);
      }
    }
  }
  return {
    compiled: safe,
    block: createRuleIndex(safe.network.block),
    allow: createRuleIndex(safe.network.allow),
    cosmeticSpecific,
    cosmeticWildcard,
    cosmeticGeneric,
    cosmeticFallback,
    cosmeticAllow,
    cosmeticAllowWildcard,
  };
}

function requestType(details) {
  return {
    main_frame: "document",
    sub_frame: "subdocument",
  }[details?.type] || details?.type || "other";
}

function createRequestMatchContext(details, pageHostname, requestHostname) {
  const url = details.url;
  const normalizedPageHostname = String(pageHostname || "").toLowerCase();
  const normalizedRequestHostname = String(requestHostname || "").toLowerCase();
  return {
    url,
    pageHostname: normalizedPageHostname,
    type: requestType(details),
    thirdParty:
      !domainMatches(normalizedRequestHostname, normalizedPageHostname) &&
      !domainMatches(normalizedPageHostname, normalizedRequestHostname),
    hostnameSuffixes: hostnameSuffixes(normalizedRequestHostname),
    urlTokens: new Set(
      Array.from(String(url).toLowerCase().matchAll(/(?=([a-z0-9_%.-]{4}))/g),
        (match) => match[1]),
    ),
  };
}

function ruleMatches(rule, context) {
  const options = rule.options;
  const rejected =
    (options.types.length && !options.types.includes(context.type)) ||
    options.excludedTypes.includes(context.type) ||
    (options.thirdParty !== null && options.thirdParty !== context.thirdParty) ||
    (options.domains.length &&
      !options.domains.some((domain) =>
        domainMatches(context.pageHostname, domain),
      )) ||
    options.excludedDomains.some((domain) =>
      domainMatches(context.pageHostname, domain),
    );
  return Boolean(
    !rejected && (rule.kind === "domain" || rule.regex?.test(context.url)),
  );
}

function candidateRules(index, context) {
  const result = new Set(index.fallback);
  for (const suffix of context.hostnameSuffixes) {
    for (const rule of index.domains.get(suffix) || []) result.add(rule);
  }
  for (const token of context.urlTokens) {
    for (const rule of index.tokens.get(token) || []) result.add(rule);
  }
  return result;
}

function indexMatches(index, context, candidates = null) {
  return Array.from(candidates || candidateRules(index, context)).some((rule) =>
    ruleMatches(rule, context),
  );
}

function blockIndexMatches(index, context) {
  let matched = false;
  for (const rule of candidateRules(index, context)) {
    if (ruleMatches(rule, context)) {
      // Keep important matches distinct so allow rules cannot override them.
      if (rule.options.important) {
        return 2;
      } else {
        matched = true;
      }
    }
  }
  return matched ? 1 : 0;
}

function shouldBlockRequest(engine, details, pageHostname, requestHostname) {
  if (!engine || !details || !details.url || !pageHostname || !requestHostname) {
    return false;
  }
  const context = createRequestMatchContext(
    details,
    pageHostname,
    requestHostname,
  );
  const blockMatch = blockIndexMatches(engine.block, context);
  return (
    blockMatch === 2 ||
    (blockMatch === 1 && !indexMatches(engine.allow, context))
  );
}

function cosmeticRuleApplies(rule, hostname) {
  return (
    !rule.excludedDomains.some((domain) => domainMatches(hostname, domain)) &&
    (!rule.domains.length ||
      rule.domains.some((domain) => domainMatches(hostname, domain)))
  );
}

function getCosmeticSelectors(engine, hostname, tokens = []) {
  return engine && hostname
    ? collectCosmeticSelectors(engine, hostname, tokens)
    : [];
}

function collectCosmeticSelectors(engine, hostname, tokens) {
  const candidates = new Set(engine.cosmeticFallback);
  for (const rule of engine.cosmeticWildcard) candidates.add(rule);
  for (const suffix of hostnameSuffixes(hostname)) {
    for (const rule of engine.cosmeticSpecific.get(suffix) || []) {
      candidates.add(rule);
    }
  }
  for (const token of tokens || []) {
    const rules = engine.cosmeticGeneric.get(String(token).toLowerCase()) || [];
    for (const rule of rules) {
      candidates.add(rule);
    }
  }
  const exceptions = new Set();
  for (const rule of engine.cosmeticAllowWildcard) {
    cosmeticRuleApplies(rule, hostname) && exceptions.add(rule.selector);
  }
  for (const suffix of ["", ...hostnameSuffixes(hostname)]) {
    for (const rule of engine.cosmeticAllow.get(suffix) || []) {
      cosmeticRuleApplies(rule, hostname) && exceptions.add(rule.selector);
    }
  }
  return Array.from(candidates)
    .filter(
      (rule) =>
        cosmeticRuleApplies(rule, hostname) &&
        !exceptions.has(rule.selector),
    )
    .map((rule) => rule.selector)
    .slice(0, 5000);
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ADBLOCK_CACHE_KEY,
    ADBLOCK_CACHE_VERSION,
    MAX_FILTER_TEXT_LENGTH,
    createEmptyCompiledRules,
    normalizeFilterSubscriptions,
    parseNetworkOptions,
    parseNetworkRule,
    isSafeRegexPattern,
    parseCosmeticRule,
    parseFilterList,
    mergeCompiledRules,
    createAdblockEngine,
    shouldBlockRequest,
    getCosmeticSelectors,
    domainMatches,
  };
}
