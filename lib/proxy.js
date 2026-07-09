// Proxy management for SOCKS5 proxy support with domain routing

/**
 * Fetch location information for a proxy IP address
 * @param {string} host - Proxy host IP or domain
 * @param {string} token - Optional ipinfo.io token
 * @returns {Promise<Object>} Location info with city, country, etc.
 */
async function fetchProxyLocation(host, token = '') {
  const normalizedHost = String(host || '').trim();
  if (!normalizedHost) {
    return createUnknownProxyLocation('fallback');
  }

  const encodedHost = encodeURIComponent(normalizedHost);

  try {
    // Try ipinfo.io first
    const ipinfoUrl = token
      ? `https://ipinfo.io/${encodedHost}?token=${encodeURIComponent(token)}`
      : `https://ipinfo.io/${encodedHost}/json`;
    const response = await fetch(ipinfoUrl);

    if (response.ok) {
      const data = await response.json();
      return {
        city: data.city || 'Unknown',
        region: data.region || '',
        country: data.country || 'Unknown',
        loc: data.loc || '',
        org: data.org || '',
        timezone: data.timezone || '',
        source: 'ipinfo.io'
      };
    }
  } catch (e) {
    console.warn('[Proxy] ipinfo.io failed, trying fallback:', e);
  }

  // Fallback to ipapi.co
  try {
    const ipapiUrl = `https://ipapi.co/${encodedHost}/json/`;
    const response = await fetch(ipapiUrl);

    if (response.ok) {
      const data = await response.json();
      return {
        city: data.city || 'Unknown',
        region: data.region || '',
        country: data.country_name || 'Unknown',
        loc: `${data.latitude},${data.longitude}`,
        org: data.org || '',
        timezone: data.timezone || '',
        source: 'ipapi.co'
      };
    }
  } catch (e) {
    console.error('[Proxy] Both location APIs failed:', e);
  }

  // Fallback to manual name
  return createUnknownProxyLocation('fallback');
}

function createUnknownProxyLocation(source) {
  return {
    city: 'Unknown',
    region: '',
    country: 'Unknown',
    loc: '',
    org: '',
    timezone: '',
    source
  };
}

/**
 * Generate a descriptive name for a proxy profile
 * @param {Object} location - Location info from fetchProxyLocation
 * @param {string} host - Proxy host
 * @returns {string} Profile name like "San Francisco, US" or "Paris, FR"
 */
function generateProfileName(location, host) {
  if (location.city && location.city !== 'Unknown') {
    const countryCode = location.country.length > 2 ? location.country.substring(0, 2).toUpperCase() : location.country;
    return `${location.city}, ${countryCode}`;
  }
  return `Proxy ${host}`;
}

/**
 * Add a new proxy profile
 * @param {Object} profile - Proxy profile object
 * @param {string} profile.name - Profile name (optional, auto-generated if not provided)
 * @param {string} profile.host - Proxy host
 * @param {number} profile.port - Proxy port
 * @param {string} profile.scheme - Proxy scheme (socks5, socks4, http, https)
 * @param {boolean} profile.remoteDNS - Use remote DNS (for SOCKS5)
 * @returns {Promise<Object>} Updated profile with location info
 */
async function addProxyProfile(profile) {
  // Fetch location if name not provided
  if (!profile.name || profile.name.trim() === '') {
    const location = await fetchProxyLocation(profile.host);
    profile.name = generateProfileName(location, profile.host);
    profile.location = location;
  }

  // Load existing profiles
  const config = await loadConfig();
  const profiles = config.proxy?.profiles || [];

  // Check for duplicate names
  let finalName = profile.name;
  let counter = 1;
  while (profiles.some(p => p.name === finalName)) {
    finalName = `${profile.name} (${counter})`;
    counter++;
  }
  profile.name = finalName;

  // Add profile
  profiles.push(profile);
  config.proxy.profiles = profiles;

  // Save
  await saveConfig(config);
  return profile;
}

/**
 * Remove a proxy profile by name
 * @param {string} profileName - Name of profile to remove
 * @returns {Promise<void>}
 */
async function removeProxyProfile(profileName) {
  const config = await loadConfig();
  const profiles = config.proxy?.profiles || [];

  config.proxy.profiles = profiles.filter(p => p.name !== profileName);

  // If active profile was removed, disable proxy
  if (config.proxy.activeProfile === profileName) {
    config.proxy.enabled = false;
    config.proxy.activeProfile = null;
  }

  // Remove from domain routing rules
  const routes = config.proxy?.domainRoutes || [];
  config.proxy.domainRoutes = routes.filter(r => r.profile !== profileName);

  await saveConfig(config);
}

/**
 * Get all proxy profiles
 * @returns {Promise<Array>} Array of proxy profiles
 */
async function getProxyProfiles() {
  const config = await loadConfig();
  return config.proxy?.profiles || [];
}

/**
 * Add a domain routing rule
 * @param {string} pattern - Domain pattern (e.g., "*.example.com", "example.com")
 * @param {string} profileName - Profile name to route to
 * @returns {Promise<void>}
 */
async function addDomainRoute(pattern, profileName) {
  const config = await loadConfig();
  const routes = config.proxy?.domainRoutes || [];

  // Check if pattern already exists
  const existing = routes.find(r => r.pattern === pattern);
  if (existing) {
    existing.profile = profileName;
  } else {
    routes.push({ pattern, profile: profileName });
  }

  config.proxy.domainRoutes = routes;
  await saveConfig(config);
}

/**
 * Remove a domain routing rule
 * @param {string} pattern - Domain pattern to remove
 * @returns {Promise<void>}
 */
async function removeDomainRoute(pattern) {
  const config = await loadConfig();
  const routes = config.proxy?.domainRoutes || [];

  config.proxy.domainRoutes = routes.filter(r => r.pattern !== pattern);
  await saveConfig(config);
}

/**
 * Get all domain routing rules
 * @returns {Promise<Array>} Array of routing rules
 */
async function getDomainRoutes() {
  const config = await loadConfig();
  return config.proxy?.domainRoutes || [];
}

const VALID_PROXY_SCHEMES = new Set(['socks5', 'socks4', 'http', 'https']);

function normalizeProxyScheme(scheme) {
  const normalized = String(scheme || '').trim().toLowerCase();
  return VALID_PROXY_SCHEMES.has(normalized) ? normalized : null;
}

function normalizeProxyPort(port) {
  const normalized = Number.parseInt(port, 10);
  return Number.isInteger(normalized) && normalized >= 1 && normalized <= 65535 ? normalized : null;
}

function normalizeProxyHost(host) {
  const normalized = String(host || '').trim();
  if (!normalized || /[\u0000-\u001f\u007f\s"'\\;/:?#]/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeProxyPattern(pattern) {
  const normalized = String(pattern || '').trim().toLowerCase();
  if (!normalized || /[\u0000-\u001f\u007f\s"'\\;/:?#]/.test(normalized)) {
    return null;
  }

  const wildcardCount = (normalized.match(/\*/g) || []).length;
  const wildcardShapeAllowed =
    wildcardCount === 0 ||
    (wildcardCount === 1 && normalized.startsWith('*.') && normalized.length > 2) ||
    (wildcardCount === 1 && normalized.endsWith('.*') && normalized.length > 2) ||
    (wildcardCount === 1 && normalized.startsWith('*') && normalized.length > 1) ||
    (wildcardCount === 2 && normalized.startsWith('*') && normalized.endsWith('*') && normalized.length > 2);

  if (!wildcardShapeAllowed) {
    return null;
  }

  const hostnameCandidate = normalized.replace(/\*/g, '').replace(/^\./, '').replace(/\.$/, '');
  if (!hostnameCandidate || hostnameCandidate.includes('..')) {
    return null;
  }

  return normalized;
}

function getProxyPatternEntries(patterns) {
  if (Array.isArray(patterns)) {
    return patterns;
  }
  if (typeof patterns === 'string') {
    return patterns.split(',');
  }
  return [];
}

function findInvalidProxyPattern(patterns) {
  const entries = getProxyPatternEntries(patterns);
  for (const entry of entries) {
    const rawPattern = String(entry || '').trim();
    if (rawPattern && !normalizeProxyPattern(rawPattern)) {
      return rawPattern;
    }
  }
  return null;
}

function normalizeProxyProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const scheme = normalizeProxyScheme(profile.scheme);
  const host = normalizeProxyHost(profile.host);
  const port = normalizeProxyPort(profile.port);

  if (!scheme || !host || port === null) {
    return null;
  }

  return {
    ...profile,
    scheme,
    host,
    port
  };
}

function formatProxyServer(profile) {
  const normalized = normalizeProxyProfile(profile);
  if (!normalized) {
    return null;
  }
  return `${normalized.scheme.toUpperCase()} ${normalized.host}:${normalized.port}`;
}

function sanitizePacComment(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 120);
}

function setProxySettingsValue(value) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({
      value,
      scope: 'regular'
    }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
        return;
      }
      resolve();
    });
  });
}

async function setSystemProxySettings() {
  await setProxySettingsValue({ mode: 'system' });
}

/**
 * Expand bypass patterns so plain domains also include wildcard subdomains.
 * This keeps fixed_servers behavior aligned with PAC/domain matching.
 * @param {Array|string} bypassList - Raw bypass list from config
 * @returns {Array<string>} Normalized bypass list
 */
function normalizeBypassList(bypassList) {
  const raw = getProxyPatternEntries(bypassList);

  const normalized = [];
  const seen = new Set();

  const isIPv4 = (value) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  const isLikelyDomain = (value) => /[a-z]/i.test(value) && value.includes('.') && !value.includes(':');
  const addPattern = (value) => {
    if (!seen.has(value)) {
      normalized.push(value);
      seen.add(value);
    }
  };

  for (const entry of raw) {
    const pattern = normalizeProxyPattern(entry);
    if (!pattern) continue;

    addPattern(pattern);

    const hasWildcard = pattern.includes('*');
    const isDomain = isLikelyDomain(pattern);
    if (!hasWildcard && isDomain && !isIPv4(pattern)) {
      addPattern(`*.${pattern}`);
      addPattern(`*${pattern}`);
    }

    if (pattern.startsWith('*.') && isDomain && !isIPv4(pattern.substring(2))) {
      addPattern(`*${pattern.substring(2)}`);
    }
  }

  return normalized;
}

/**
 * Generate PAC script for domain-based proxy routing
 * @param {Array} profiles - Array of proxy profiles
 * @param {Array} routes - Array of domain routes
 * @param {string} defaultProfile - Default profile name (null for DIRECT)
 * @param {string} globalWhitelist - Comma-separated allowlist patterns
 * @param {Array|string} bypassList - Proxy bypass patterns
 * @returns {string} PAC script content
 */
function generatePACScript(profiles, routes, defaultProfile, globalWhitelist, bypassList) {
  const pacEscape = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const parsePatternList = (value) => {
    if (Array.isArray(value)) {
      return value.map(normalizeProxyPattern).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map(normalizeProxyPattern)
        .filter(Boolean);
    }
    return [];
  };

  const allowlistPatterns = parsePatternList(globalWhitelist);
  const bypassPatterns = parsePatternList(bypassList);
  const directPatterns = [...allowlistPatterns, ...bypassPatterns];
  const dedupedDirectPatterns = [...new Set(directPatterns)];

  const buildPatternCheck = (pattern) => {
    const escaped = pacEscape(pattern);
    const hasOnlyLeadingWildcard =
      pattern.startsWith("*") &&
      !pattern.startsWith("*.") &&
      pattern.indexOf("*", 1) === -1;

    if (pattern.endsWith(".*")) {
      const prefix = pacEscape(pattern.slice(0, -2));
      return `shExpMatch(host, "${prefix}.*")`;
    }

    if (pattern.startsWith("*.")) {
      const domain = pacEscape(pattern.slice(2));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (hasOnlyLeadingWildcard) {
      const domain = pacEscape(pattern.slice(1));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (pattern.includes("*")) {
      return `shExpMatch(host, "${escaped}")`;
    }

    return `(host === "${escaped}" || host === "www.${escaped}")`;
  };

  const buildDirectConditions = () => {
    if (dedupedDirectPatterns.length === 0) {
      return "";
    }

    const checks = dedupedDirectPatterns.map(buildPatternCheck);
    return `  if (${checks.join(" || ")}) {\n    return "DIRECT";\n  }\n\n`;
  };

  const buildRouteCheck = (pattern) => {
    const hasOnlyLeadingWildcard =
      pattern.startsWith("*") &&
      !pattern.startsWith("*.") &&
      pattern.indexOf("*", 1) === -1;

    if (pattern.startsWith('*.')) {
      const domain = pacEscape(pattern.substring(2));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (pattern.endsWith('.*')) {
      const prefix = pacEscape(pattern.slice(0, -2));
      return `shExpMatch(host, "${prefix}.*")`;
    }

    if (hasOnlyLeadingWildcard) {
      const domain = pacEscape(pattern.substring(1));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (pattern.includes('*')) {
      return `shExpMatch(host, "${pacEscape(pattern)}")`;
    }

    return `(host === "${pacEscape(pattern)}" || host === "www.${pacEscape(pattern)}")`;
  };

  // Build profile map
  const profileMap = {};
  profiles.forEach(p => {
    const normalizedProfile = normalizeProxyProfile(p);
    if (normalizedProfile && p.name) {
      profileMap[p.name] = normalizedProfile;
    }
  });

  // Build PAC script
  let pac = `function FindProxyForURL(url, host) {
  // Stealth Guard - Auto-generated PAC script for domain-based proxy routing

  // Normalize host to lowercase
  host = host.toLowerCase();

${buildDirectConditions()}`;

  // Add routing rules
  routes.forEach(route => {
    const pattern = route && typeof route.pattern === 'string' ? route.pattern.trim().toLowerCase() : '';
    if (!pattern) return;

    const profile = profileMap[route.profile];
    if (!profile) return;

    const proxyString = formatProxyServer(profile);

    pac += `  // Route ${sanitizePacComment(pattern)} -> ${sanitizePacComment(profile.name)}\n`;
    pac += `  if (${buildRouteCheck(pattern)}) {\n`;
    pac += `    return "${pacEscape(proxyString)}";\n`;
    pac += `  }\n\n`;
  });

  // Default fallback
  if (defaultProfile && profileMap[defaultProfile]) {
    const profile = profileMap[defaultProfile];
    const proxyString = formatProxyServer(profile);
    pac += `  // Default: Route all other traffic -> ${sanitizePacComment(defaultProfile)}\n`;
    pac += `  return "${pacEscape(proxyString)}";\n`;
  } else {
    pac += `  // Default: Direct connection for all other traffic\n`;
    pac += `  return "DIRECT";\n`;
  }

  pac += `}`;

  return pac;
}

/**
 * Apply proxy settings based on current configuration
 * @returns {Promise<void>}
 */
async function applyProxySettings() {
  const config = await loadConfig();

  if (config.enabled === false) {
    await setSystemProxySettings();
    console.log('[Proxy] Global disabled - using system settings');
    return;
  }

  if (!config.proxy || !config.proxy.enabled) {
    // Disable proxy - use system settings
    await setSystemProxySettings();
    console.log('[Proxy] Disabled - using system settings');
    return;
  }

  const profiles = config.proxy.profiles || [];
  const routes = config.proxy.domainRoutes || [];
  const activeProfile = config.proxy.activeProfile;
  const invalidBypassPattern = findInvalidProxyPattern(config.proxy.bypassList || []);
  if (invalidBypassPattern) {
    throw new Error(`[Proxy] Invalid bypass pattern: ${invalidBypassPattern}`);
  }

  const normalizedBypassList = normalizeBypassList(config.proxy.bypassList || []);
  const profileByName = new Map();
  profiles.forEach(profile => {
    const normalizedProfile = normalizeProxyProfile(profile);
    if (normalizedProfile && profile.name) {
      profileByName.set(profile.name, normalizedProfile);
    }
  });
  const hasValidActiveProfile = Boolean(activeProfile && profileByName.has(activeProfile));
  const configuredRoutes = routes
    .map(route => ({
      rawPattern: route && typeof route.pattern === 'string' ? route.pattern.trim() : '',
      pattern: normalizeProxyPattern(route && route.pattern),
      profile: route ? route.profile : null
    }))
    .filter(route => route.rawPattern);
  const invalidPatternRoute = configuredRoutes.find(route => !route.pattern);

  if (invalidPatternRoute) {
    throw new Error(`[Proxy] Invalid domain route pattern: ${invalidPatternRoute.rawPattern}`);
  }

  const normalizedRoutes = configuredRoutes
    .map(route => ({
      pattern: route.pattern,
      profile: route.profile
    }))
    .filter(route => route.pattern);
  const invalidRoute = normalizedRoutes.find(route => !profileByName.has(route.profile));

  if (invalidRoute) {
    throw new Error(`[Proxy] Domain route "${invalidRoute.pattern}" references missing or invalid profile: ${invalidRoute.profile}`);
  }

  const hasValidRoute = normalizedRoutes.length > 0;

  if (activeProfile && !hasValidActiveProfile) {
    throw new Error(`[Proxy] Active profile not found or invalid: ${activeProfile}`);
  }

  if (!hasValidActiveProfile && !hasValidRoute) {
    throw new Error('[Proxy] Enabled proxy config has no valid active profile or domain route');
  }

  const hasGlobalWhitelist = typeof config.globalWhitelist === 'string' && config.globalWhitelist.trim() !== "";

  // If only active profile (no domain routing), use fixed_servers mode unless allowlist needs PAC
  if (routes.length === 0 && activeProfile && !hasGlobalWhitelist) {
    const profile = profileByName.get(activeProfile);

    const proxyConfig = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: profile.scheme,
          host: profile.host,
          port: profile.port
        }
      }
    };

    // Add bypass list if configured
    if (normalizedBypassList.length > 0) {
      proxyConfig.rules.bypassList = normalizedBypassList;
    }

    await setProxySettingsValue(proxyConfig);

    console.log('[Proxy] Applied fixed proxy:', profile.name);
    return;
  }

  // If domain routing enabled, use PAC script
  const pacScript = generatePACScript(
    profiles,
    normalizedRoutes,
    activeProfile,
    config.globalWhitelist,
    normalizedBypassList
  );
  await setProxySettingsValue({
      mode: 'pac_script',
      pacScript: {
        data: pacScript,
        mandatory: true
      }
    });

  console.log('[Proxy] Applied PAC script with', routes.length, 'routes');
}

/**
 * Enable proxy with specified profile
 * @param {string} profileName - Profile name to activate
 * @returns {Promise<void>}
 */
async function enableProxy(profileName) {
  const config = await loadConfig();
  config.proxy.enabled = true;
  config.proxy.activeProfile = profileName;
  await saveConfig(config);
  await applyProxySettings();
}

/**
 * Disable proxy
 * @returns {Promise<void>}
 */
async function disableProxy() {
  const config = await loadConfig();
  config.proxy.enabled = false;
  config.proxy.activeProfile = null;
  await saveConfig(config);
  await applyProxySettings();
}

/**
 * Test proxy connection by temporarily configuring it and making a real request
 * @param {string} host - Proxy host
 * @param {number} port - Proxy port
 * @param {string} scheme - Proxy scheme (socks5, socks4, http, https)
 * @returns {Promise<boolean>} True if proxy is reachable and working
 */
async function testProxyConnection(host, port, scheme = 'socks5') {
  let originalSettings = null;

  try {
    // Store current proxy settings
    originalSettings = await new Promise((resolve) => {
      chrome.proxy.settings.get({}, (config) => resolve(config));
    });

    // Configure test proxy
    const normalizedProfile = normalizeProxyProfile({ host, port, scheme });
    if (!normalizedProfile) {
      return false;
    }

    await setProxySettingsValue({
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: normalizedProfile.scheme,
          host: normalizedProfile.host,
          port: normalizedProfile.port
        }
      }
    });

    // Wait for proxy to be applied
    await new Promise(resolve => setTimeout(resolve, 500));

    // Make test request to IP service with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch('https://api.ipify.org?format=json', {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error('Request failed with status ' + response.status);
    }

    const data = await response.json();
    const success = Boolean(data && data.ip && typeof data.ip === 'string');

    // Restore original settings
    if (originalSettings) {
      await setProxySettingsValue(originalSettings.value || { mode: 'system' });
    }

    return success;
  } catch (e) {
    console.error('[Proxy] Test failed:', e);

    // Attempt to restore original settings even on error
    try {
      if (originalSettings) {
        await setProxySettingsValue(originalSettings.value || { mode: 'system' });
      } else {
        await setSystemProxySettings();
      }
    } catch (restoreError) {
      console.error('[Proxy] Failed to restore settings:', restoreError);
    }

    return false;
  }
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fetchProxyLocation,
    createUnknownProxyLocation,
    generateProfileName,
    addProxyProfile,
    removeProxyProfile,
    getProxyProfiles,
    addDomainRoute,
    removeDomainRoute,
    getDomainRoutes,
    normalizeBypassList,
    normalizeProxyScheme,
    normalizeProxyPort,
    normalizeProxyHost,
    normalizeProxyPattern,
    normalizeProxyProfile,
    formatProxyServer,
    sanitizePacComment,
    setProxySettingsValue,
    setSystemProxySettings,
    generatePACScript,
    applyProxySettings,
    enableProxy,
    disableProxy,
    testProxyConnection
  };
}
