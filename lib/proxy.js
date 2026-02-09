// Proxy management for SOCKS5 proxy support with domain routing

/**
 * Fetch location information for a proxy IP address
 * @param {string} host - Proxy host IP or domain
 * @param {string} token - Optional ipinfo.io token (default: d202c49ff9c4b6)
 * @returns {Promise<Object>} Location info with city, country, etc.
 */
async function fetchProxyLocation(host, token = 'd202c49ff9c4b6') {
  try {
    // Try ipinfo.io first
    const ipinfoUrl = `https://ipinfo.io/${host}?token=${token}`;
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
    const ipapiUrl = `https://ipapi.co/${host}/json/`;
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
  return {
    city: 'Unknown',
    region: '',
    country: 'Unknown',
    loc: '',
    org: '',
    timezone: '',
    source: 'fallback'
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

/**
 * Expand bypass patterns so plain domains also include wildcard subdomains.
 * This keeps fixed_servers behavior aligned with PAC/domain matching.
 * @param {Array|string} bypassList - Raw bypass list from config
 * @returns {Array<string>} Normalized bypass list
 */
function normalizeBypassList(bypassList) {
  const raw = Array.isArray(bypassList)
    ? bypassList
    : typeof bypassList === 'string'
      ? bypassList.split(',')
      : [];

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
    const pattern = String(entry).trim();
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
      return value.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map(s => s.trim().toLowerCase())
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

    if (pattern.endsWith(".*")) {
      const prefix = pacEscape(pattern.slice(0, -2));
      return `shExpMatch(host, "${prefix}.*")`;
    }

    if (pattern.startsWith("*.")) {
      const domain = pacEscape(pattern.slice(2));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (pattern.startsWith("*") && !pattern.startsWith("*.")) {
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
    if (pattern.startsWith('*.')) {
      const domain = pacEscape(pattern.substring(2));
      return `(host === "${domain}" || shExpMatch(host, "*.${domain}"))`;
    }

    if (pattern.endsWith('.*')) {
      const prefix = pacEscape(pattern.slice(0, -2));
      return `shExpMatch(host, "${prefix}.*")`;
    }

    if (pattern.startsWith('*') && !pattern.startsWith('*.')) {
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
    profileMap[p.name] = p;
  });

  // Build PAC script
  let pac = `function FindProxyForURL(url, host) {
  // Stealth Guard - Auto-generated PAC script for domain-based proxy routing

  // Normalize host to lowercase
  host = host.toLowerCase();

${buildDirectConditions()}`;

  // Add routing rules
  routes.forEach(route => {
    const profile = profileMap[route.profile];
    if (!profile) return;

    const proxyString = `${profile.scheme.toUpperCase()} ${profile.host}:${profile.port}`;
    const pattern = route.pattern.toLowerCase();

    pac += `  // Route ${pattern} -> ${profile.name}\n`;
    pac += `  if (${buildRouteCheck(pattern)}) {\n`;
    pac += `    return "${proxyString}";\n`;
    pac += `  }\n\n`;
  });

  // Default fallback
  if (defaultProfile && profileMap[defaultProfile]) {
    const profile = profileMap[defaultProfile];
    const proxyString = `${profile.scheme.toUpperCase()} ${profile.host}:${profile.port}`;
    pac += `  // Default: Route all other traffic -> ${defaultProfile}\n`;
    pac += `  return "${proxyString}";\n`;
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
    await chrome.proxy.settings.set({
      value: { mode: 'system' },
      scope: 'regular'
    });
    console.log('[Proxy] Global disabled - using system settings');
    return;
  }

  if (!config.proxy || !config.proxy.enabled) {
    // Disable proxy - use system settings
    await chrome.proxy.settings.set({
      value: { mode: 'system' },
      scope: 'regular'
    });
    console.log('[Proxy] Disabled - using system settings');
    return;
  }

  const profiles = config.proxy.profiles || [];
  const routes = config.proxy.domainRoutes || [];
  const activeProfile = config.proxy.activeProfile;
  const normalizedBypassList = normalizeBypassList(config.proxy.bypassList || []);

  // If no routes and no active profile, disable proxy
  if (routes.length === 0 && !activeProfile) {
    await chrome.proxy.settings.set({
      value: { mode: 'system' },
      scope: 'regular'
    });
    console.log('[Proxy] No routes or active profile - using system settings');
    return;
  }

  const hasGlobalWhitelist = typeof config.globalWhitelist === 'string' && config.globalWhitelist.trim() !== "";

  // If only active profile (no domain routing), use fixed_servers mode unless allowlist needs PAC
  if (routes.length === 0 && activeProfile && !hasGlobalWhitelist) {
    const profile = profiles.find(p => p.name === activeProfile);
    if (!profile) {
      console.error('[Proxy] Active profile not found:', activeProfile);
      return;
    }

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

    await chrome.proxy.settings.set({
      value: proxyConfig,
      scope: 'regular'
    });

    console.log('[Proxy] Applied fixed proxy:', profile.name);
    return;
  }

  // If domain routing enabled, use PAC script
  const pacScript = generatePACScript(
    profiles,
    routes,
    activeProfile,
    config.globalWhitelist,
    normalizedBypassList
  );
  await chrome.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: {
        data: pacScript,
        mandatory: true
      }
    },
    scope: 'regular'
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
    await new Promise((resolve, reject) => {
      chrome.proxy.settings.set({
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: {
              scheme: scheme,
              host: host,
              port: parseInt(port)
            }
          }
        },
        scope: 'regular'
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    // Wait for proxy to be applied
    await new Promise(resolve => setTimeout(resolve, 500));

    // Make test request to IP service with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      cache: 'no-cache',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Request failed with status ' + response.status);
    }

    const data = await response.json();
    const success = data && data.ip && typeof data.ip === 'string';

    // Restore original settings
    if (originalSettings) {
      await new Promise((resolve) => {
        chrome.proxy.settings.set(originalSettings, resolve);
      });
    }

    return success;
  } catch (e) {
    console.error('[Proxy] Test failed:', e);

    // Attempt to restore original settings even on error
    try {
      if (originalSettings) {
        await new Promise((resolve) => {
          chrome.proxy.settings.set(originalSettings, resolve);
        });
      } else {
        await new Promise((resolve) => {
          chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' }, resolve);
        });
      }
    } catch (restoreError) {
      console.error('[Proxy] Failed to restore settings:', restoreError);
    }

    return false;
  }
}
