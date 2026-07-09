// Background Script - Orchestrates all protection features
// Libraries are loaded via manifest.json scripts array

// Global state
let currentConfig = null;
let currentDomainFilter = null;
let lastNotificationTime = {};
let configLoaded = false;
let initializationPromise = null;
let triggeredFeaturesPerTab = {}; // Track triggered features per tab: { tabId: { hostname: string, features: Set } }
let lastAppliedWebRTCPolicy = null;
let webRTCPolicyQueue = Promise.resolve();
let configMutationQueue = Promise.resolve();

// Timing / behavior constants
const ACTIVATION_RECHECK_DELAY_MS = 377;
const NOTIFICATION_THROTTLE_MS = 3770;
const SESSION_STORAGE_KEY = "stealth-guard-sessions";
const ACTIVE_SESSIONS_STORAGE_KEY = "stealth-guard-active-sessions";
const MAX_SAVED_SESSIONS_PER_DOMAIN = 20;

// Debug logging helpers
const debugLog = function(...args) {
  if (currentConfig && currentConfig.notifications && currentConfig.notifications.enabled) {
    console.log(...args);
  }
};

const debugWarn = function(...args) {
  if (currentConfig && currentConfig.notifications && currentConfig.notifications.enabled) {
    console.warn(...args);
  }
};

const debugError = function(...args) {
  // Always log errors regardless of debug setting
  console.error(...args);
};

// Utility helpers
function getHostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

function resolveTabHostname(sender, fallbackHostname = null) {
  if (sender && sender.tab && sender.tab.url) {
    const tabHostname = getHostnameFromUrl(sender.tab.url);
    if (tabHostname) {
      return tabHostname;
    }
  }
  return fallbackHostname;
}

function setCurrentConfig(config) {
  currentConfig = config;
  currentDomainFilter = config ? new DomainFilter(config) : null;
}

function getDomainFilter(config = currentConfig) {
  if (!config) {
    return null;
  }

  if (!currentDomainFilter || currentDomainFilter.config !== config) {
    currentDomainFilter = new DomainFilter(config);
  }

  return currentDomainFilter;
}

function isHostnameOnGlobalAllowlist(hostname, config = currentConfig) {
  if (!hostname || !config) {
    return false;
  }

  const filter = getDomainFilter(config);
  return filter ? filter.isWhitelisted(hostname, config.globalWhitelist || "") : false;
}

function isHostnameOnFeatureAllowlist(hostname, whitelist, config = currentConfig) {
  if (!hostname || !whitelist || !config) {
    return false;
  }

  const filter = getDomainFilter(config);
  return filter ? filter.isWhitelisted(hostname, whitelist) : false;
}

function isCloudflareChallengeHostname(hostname) {
  return hostname === "challenges.cloudflare.com" || hostname.endsWith(".challenges.cloudflare.com");
}

async function ensureBackgroundInitialized() {
  if (!configLoaded) {
    debugLog("[Background] Config not loaded yet, waiting for initialization...");
    await initializationPromise;
    debugLog("[Background] Initialization complete");
  }
}

function markTriggeredFeatureForTab(tabId, hostname, feature) {
  if (typeof tabId !== "number") {
    return;
  }

  if (!triggeredFeaturesPerTab[tabId] || triggeredFeaturesPerTab[tabId].hostname !== hostname) {
    triggeredFeaturesPerTab[tabId] = { hostname: hostname, features: new Set() };
  }

  triggeredFeaturesPerTab[tabId].features.add(feature);
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        debugWarn("[Background] Failed to query tabs for broadcast:", chrome.runtime.lastError.message);
        resolve([]);
        return;
      }
      resolve(tabs || []);
    });
  });
}

function sendMessageToTabIgnoringErrors(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      // Read runtime.lastError to suppress "Unchecked runtime.lastError" noise.
      // These two failures are expected during tab broadcasts:
      // 1) Tab has no content script, 2) Receiver doesn't send a response.
      const error = chrome.runtime.lastError;
      if (error) {
        const msg = error.message || "";
        const expected =
          msg.includes("Could not establish connection. Receiving end does not exist.") ||
          msg.includes("The message port closed before a response was received.");
        if (!expected) {
          debugWarn("[Background] tabs.sendMessage warning for tab", tabId + ":", msg);
        }
      }
      resolve();
    });
  });
}

async function broadcastConfigUpdated(config) {
  const tabs = await queryTabs({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs
      .filter(tab => typeof tab.id === "number")
      .map(tab => sendMessageToTabIgnoringErrors(tab.id, { type: "config-updated", config }))
  );
}

function addFeatureIfActive(injectionConfig, filter, config, url, featureName, label) {
  const isActive = filter.shouldActivateFeature(url, featureName);
  debugLog(`[Background] ${label} active:`, isActive);
  if (isActive) {
    injectionConfig[featureName] = config[featureName];
  }
  return isActive;
}

// ========== SESSION SWITCHER ==========

function normalizeSessionHostname(hostname) {
  if (!hostname || typeof hostname !== "string") {
    return "";
  }

  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function resolveSessionHostname(request, sender) {
  const explicitHostname = normalizeSessionHostname(request && (request.hostname || request.domain));
  if (explicitHostname) {
    return explicitHostname;
  }

  return normalizeSessionHostname(resolveTabHostname(sender));
}

function sanitizeSessionName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed) {
    return trimmed.slice(0, 64);
  }

  const now = new Date();
  return "Session " + now.toLocaleString();
}

function createSessionId() {
  return "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

async function readSessionState() {
  const stored = await storage.read([SESSION_STORAGE_KEY, ACTIVE_SESSIONS_STORAGE_KEY]);
  const sessions = Array.isArray(stored[SESSION_STORAGE_KEY]) ? stored[SESSION_STORAGE_KEY] : [];
  const activeSessions = stored[ACTIVE_SESSIONS_STORAGE_KEY] && typeof stored[ACTIVE_SESSIONS_STORAGE_KEY] === "object"
    ? stored[ACTIVE_SESSIONS_STORAGE_KEY]
    : {};

  return { sessions, activeSessions };
}

async function writeSessionState(sessions, activeSessions) {
  await storage.write({
    [SESSION_STORAGE_KEY]: sessions,
    [ACTIVE_SESSIONS_STORAGE_KEY]: activeSessions
  });
}

function cookiesGetAllCookieStores() {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAllCookieStores((stores) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(stores || []);
    });
  });
}

function cookiesGetAll(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll(details, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookies || []);
    });
  });
}

function cookiesRemove(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.remove(details, (removed) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(removed);
    });
  });
}

function cookiesSet(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.set(details, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookie);
    });
  });
}

function buildCookieUrl(cookie, fallbackHostname) {
  const protocol = cookie.secure ? "https" : "http";
  let host = cookie.domain || fallbackHostname;

  if (typeof host !== "string") {
    throw new Error("Invalid cookie host");
  }

  host = host.replace(/^\./, "").trim();
  if (!host) {
    throw new Error("Invalid cookie host");
  }

  const path = cookie.path || "/";
  return protocol + "://" + host + path;
}

function maybeCopyCookiePartitionKey(targetDetails, cookie) {
  if (!cookie || !cookie.partitionKey) {
    return;
  }

  // Preserve partitioned cookie identity when the browser exposes it.
  // Without this, restored auth cookies may become non-partitioned and invalid.
  targetDetails.partitionKey = cookie.partitionKey;
}

function cookieMatchesHostname(cookie, hostname) {
  if (!cookie || !cookie.domain || !hostname) {
    return false;
  }

  const normalizedHostname = hostname.split(":")[0].toLowerCase();
  const cookieDomain = cookie.domain.replace(/^\./, "").toLowerCase();

  return (
    cookieDomain === normalizedHostname ||
    cookieDomain === "www." + normalizedHostname ||
    normalizedHostname.endsWith("." + cookieDomain) ||
    cookieDomain.endsWith("." + normalizedHostname)
  );
}

async function getCookiesForHostname(hostname) {
  if (!chrome.cookies || !chrome.cookies.getAllCookieStores) {
    return [];
  }

  const stores = await cookiesGetAllCookieStores();
  const allCookies = [];

  for (const store of stores) {
    const storeCookies = await cookiesGetAll({ storeId: store.id });
    const matchingCookies = storeCookies.filter((cookie) => cookieMatchesHostname(cookie, hostname));
    allCookies.push(...matchingCookies);
  }

  return allCookies;
}

async function clearCookiesForHostname(hostname) {
  const cookies = await getCookiesForHostname(hostname);
  const removeOperations = cookies.map(async (cookie) => {
    try {
      const removeDetails = {
        url: buildCookieUrl(cookie, hostname),
        name: cookie.name,
        storeId: cookie.storeId
      };

      maybeCopyCookiePartitionKey(removeDetails, cookie);
      await cookiesRemove(removeDetails);
    } catch (error) {
      debugWarn("[Session] Failed to remove cookie:", cookie.name, error);
    }
  });

  await Promise.all(removeOperations);
}

async function restoreCookies(cookies, fallbackHostname) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return;
  }

  const restoreOperations = cookies.map(async (cookie) => {
    try {
      const details = {
        url: buildCookieUrl(cookie, fallbackHostname),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        storeId: cookie.storeId
      };

      if (cookie.domain && cookie.domain.startsWith(".")) {
        details.domain = cookie.domain;
      }

      if (!cookie.session && typeof cookie.expirationDate === "number") {
        details.expirationDate = cookie.expirationDate;
      }

      if (cookie.sameSite && cookie.sameSite !== "unspecified") {
        details.sameSite = cookie.sameSite;
      }

      if (typeof cookie.sameParty === "boolean") {
        details.sameParty = cookie.sameParty;
      }

      maybeCopyCookiePartitionKey(details, cookie);

      await cookiesSet(details);
    } catch (error) {
      debugWarn("[Session] Failed to restore cookie:", cookie && cookie.name, error);
    }
  });

  await Promise.all(restoreOperations);
}

function executeScriptInTab(tabId, code, runAt = "document_idle") {
  return new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, { code, runAt }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results);
    });
  });
}

async function readTabStorageSnapshot(tabId) {
  const script = `
    (() => {
      const snapshot = { localStorage: {}, sessionStorage: {} };

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key !== null) {
            snapshot.localStorage[key] = localStorage.getItem(key);
          }
        }
      } catch (error) {}

      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key !== null) {
            snapshot.sessionStorage[key] = sessionStorage.getItem(key);
          }
        }
      } catch (error) {}

      return snapshot;
    })();
  `;

  try {
    const results = await executeScriptInTab(tabId, script);
    return (results && results[0]) || { localStorage: {}, sessionStorage: {} };
  } catch (error) {
    debugWarn("[Session] Failed to read storage snapshot:", error);
    return { localStorage: {}, sessionStorage: {} };
  }
}

async function clearTabStorage(tabId) {
  const script = `
    (() => {
      try { localStorage.clear(); } catch (error) {}
      try { sessionStorage.clear(); } catch (error) {}
      return true;
    })();
  `;

  await executeScriptInTab(tabId, script);
}

async function restoreTabStorage(tabId, storageSnapshot) {
  const payload = JSON.stringify({
    localStorage: storageSnapshot && storageSnapshot.localStorage ? storageSnapshot.localStorage : {},
    sessionStorage: storageSnapshot && storageSnapshot.sessionStorage ? storageSnapshot.sessionStorage : {}
  });

  const script = `
    ((snapshot) => {
      try {
        localStorage.clear();
        Object.keys(snapshot.localStorage || {}).forEach((key) => {
          const value = snapshot.localStorage[key];
          localStorage.setItem(key, value === null || value === undefined ? "" : String(value));
        });
      } catch (error) {}

      try {
        sessionStorage.clear();
        Object.keys(snapshot.sessionStorage || {}).forEach((key) => {
          const value = snapshot.sessionStorage[key];
          sessionStorage.setItem(key, value === null || value === undefined ? "" : String(value));
        });
      } catch (error) {}

      return true;
    })(${payload});
  `;

  await executeScriptInTab(tabId, script);
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, { bypassCache: true }, () => {
      if (chrome.runtime.lastError) {
        debugWarn("[Background] Failed to reload tab:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function sortSessionsForHostname(sessions, hostname) {
  return sessions
    .filter((session) => session.domain === hostname)
    .sort((a, b) => (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0));
}

function cleanupSessionLimits(sessions, activeSessions, hostname) {
  const domainSessions = sortSessionsForHostname(sessions, hostname);
  if (domainSessions.length <= MAX_SAVED_SESSIONS_PER_DOMAIN) {
    return sessions;
  }

  const keepIds = new Set(domainSessions.slice(0, MAX_SAVED_SESSIONS_PER_DOMAIN).map((session) => session.id));
  const nextSessions = sessions.filter((session) => session.domain !== hostname || keepIds.has(session.id));

  if (activeSessions[hostname] && !keepIds.has(activeSessions[hostname])) {
    delete activeSessions[hostname];
  }

  return nextSessions;
}

// ========== INITIALIZATION ==========

// Initialize config immediately when background script loads
initializationPromise = (async function initializeBackground() {
  try {
    // Initial logs before config is loaded - use console.log since debugLog isn't ready yet
    setCurrentConfig(await loadConfig());

    configLoaded = true;
    await applyUserAgentSpoofing();
    await applyWebRTCPolicy();
    await applyProxySettings();
    setupContextMenus();
    debugLog("Stealth Guard initialized successfully");
  } catch (e) {
    debugError("Failed to initialize:", e);
    debugError("Stack:", e.stack);
  }
})();

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  debugLog("Stealth Guard installed/updated");

  // Ensure config is loaded
  if (!configLoaded) {
    setCurrentConfig(await loadConfig());
    configLoaded = true;
  }

  // Apply User-Agent spoofing
  await applyUserAgentSpoofing();

  // Apply WebRTC policy
  await applyWebRTCPolicy();

  // Apply proxy settings
  await applyProxySettings();

  // Setup context menus
  setupContextMenus();

  // Open welcome page on first install
  if (details.reason === "install") {
    chrome.tabs.create({ url: "options/options.html" });
  }
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  debugLog("Stealth Guard starting");
  setCurrentConfig(await loadConfig());
  configLoaded = true;
  await applyUserAgentSpoofing();
  await applyWebRTCPolicy();
  await applyProxySettings();
});

// ========== DYNAMIC CONFIG INJECTION ==========
// Config injection is handled by injector.js content script.
// The injector installs document-start safe defaults synchronously, then receives
// runtime config updates through the isolated content-script message channel.
// "get-injection-config" is retained as a legacy compatibility endpoint.

// ========== USER-AGENT SPOOFING ==========
// HTTP User-Agent header modification using MV2 blocking webRequest.
// Inspired by UA Switcher Pro; MV3 needs a declarativeNetRequest-specific path.

const USER_AGENT_PRESETS = {
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  macos_chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
};

const UA_RULE_ID = 1; // Rule ID for User-Agent modification (Legacy DNR)

// Helper to remove legacy DNR rules
async function clearDNRRules() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: []
    });
  } catch (e) {}
}

// Global reference to the listener function so we can remove it
let uaListener = null;

// Apply User-Agent spoofing using webRequest (Synchronous & Reliable)
async function applyUserAgentSpoofing() {
  try {
    const config = await getConfig();

    // Always clear legacy DNR rules first
    await clearDNRRules();

    // Remove existing listener if any
    if (uaListener) {
      chrome.webRequest.onBeforeSendHeaders.removeListener(uaListener);
      uaListener = null;
    }

    // Check if User-Agent spoofing is enabled
    if (config.enabled === false || !config.useragent || !config.useragent.enabled) {
      debugLog("User-Agent spoofing disabled");
      return;
    }

    // Get the User-Agent string
    const preset = config.useragent.preset || "macos";
    const userAgent = USER_AGENT_PRESETS[preset];

    if (!userAgent) {
      throw new Error(`Invalid User-Agent preset: ${preset}`);
    }

    // Create the listener function
    uaListener = function(details) {
      let hostname = null;
      try {
        hostname = new URL(details.url).hostname;
      } catch (e) {
        return { requestHeaders: details.requestHeaders };
      }

      // Check specific Cloudflare challenge domain first
      if (isCloudflareChallengeHostname(hostname)) {
        debugLog("[UA Listener] BYPASS: Cloudflare challenge domain:", hostname);
        return { requestHeaders: details.requestHeaders };
      }

      if (
        isHostnameOnGlobalAllowlist(hostname, config) ||
        isHostnameOnFeatureAllowlist(hostname, config.useragent.whitelist || "", config)
      ) {
        debugLog("[UA Listener] BYPASS: allowlisted domain:", hostname);
        return { requestHeaders: details.requestHeaders };
      }

      // Modify the User-Agent header
      let uaHeaderFound = false;
      for (let i = 0; i < details.requestHeaders.length; ++i) {
        if (details.requestHeaders[i].name.toLowerCase() === 'user-agent') {
          details.requestHeaders[i].value = userAgent;
          uaHeaderFound = true;
          break;
        }
      }

      // If no User-Agent header found (rare), add it
      if (!uaHeaderFound) {
        details.requestHeaders.push({
          name: 'User-Agent',
          value: userAgent
        });
      }

      return { requestHeaders: details.requestHeaders };
    };

    // Register the listener
    chrome.webRequest.onBeforeSendHeaders.addListener(
      uaListener,
      { urls: ["<all_urls>"] },
      ["blocking", "requestHeaders", "extraHeaders"]
    );

    debugLog("User-Agent spoofing enabled (webRequest):", preset, "->", userAgent);

  } catch (e) {
    debugError("Failed to apply User-Agent spoofing:", e);
    throw e;
  }
}

// ========== WEBRTC POLICY ==========

async function applyWebRTCPolicyValue(policy) {
  const previousOperation = webRTCPolicyQueue.catch(() => {});
  const operation = previousOperation.then(async () => {
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: policy });
    let effectiveSetting = await getWebRTCPolicySetting();
    if (effectiveSetting.value !== policy) {
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: policy });
      effectiveSetting = await getWebRTCPolicySetting();
    }
    if (effectiveSetting.value !== policy) {
      throw new Error(`WebRTC policy not applied. Expected "${policy}", got "${effectiveSetting.value}"`);
    }
    if (effectiveSetting.levelOfControl === "not_controllable" || effectiveSetting.levelOfControl === "controlled_by_other_extensions") {
      throw new Error(`WebRTC policy is ${effectiveSetting.levelOfControl}`);
    }
    lastAppliedWebRTCPolicy = policy;
  });

  webRTCPolicyQueue = operation;
  return operation;
}

function getWebRTCPolicySetting() {
  return new Promise((resolve, reject) => {
    chrome.privacy.network.webRTCIPHandlingPolicy.get({}, (details) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || String(error)));
        return;
      }
      resolve(details || {});
    });
  });
}

async function applyWebRTCPolicy() {
  try {
    const config = await getConfig();

    const policy = config.enabled !== false && config.webrtc.enabled ? config.webrtc.policy : "default";
    await applyWebRTCPolicyValue(policy);
    debugLog("[WebRTC] Base policy applied:", policy);
  } catch (e) {
    console.error("Failed to apply WebRTC policy:", e);
    throw e;
  }
}

// chrome.privacy.network.webRTCIPHandlingPolicy is browser-global. Keep it at
// the configured protective value while WebRTC protection is enabled; per-site
// allowlists are handled only by the content-script API patch.
function setWebRTCPolicy(url) {
  getConfig().then(config => {
    if (config.enabled === false || !config.webrtc.enabled) {
      // Protection disabled - allow WebRTC everywhere
      applyWebRTCPolicyValue("default")
        .then(() => {
          debugLog("[WebRTC] Protection disabled, allowing WebRTC");
        })
        .catch((error) => {
          debugError("[WebRTC] Failed to set default policy:", error);
        });
      return;
    }

    const policy = config.webrtc.policy;
    applyWebRTCPolicyValue(policy)
      .then(() => {
        debugLog("[WebRTC] Global policy set to:", policy, "while visiting:", url);
      })
      .catch((error) => {
        debugError("[WebRTC] Failed to set policy:", error);
      });
  }).catch(e => {
    debugError("[WebRTC] Failed to set policy:", e);
  });
}

// Main listener: navigation events (like WebRTC Leak Killer)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Only main frame
  setWebRTCPolicy(details.url);
});

// Secondary listener: fires after navigation commits (more reliable timing)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // Only main frame
  setWebRTCPolicy(details.url);
});

// Tab update listener: catches URL changes and loading state changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Clear triggered features only when navigating to a different domain
  if (changeInfo.url) {
    try {
      const newHostname = new URL(changeInfo.url).hostname;
      const tabData = triggeredFeaturesPerTab[tabId];
      if (tabData && tabData.hostname !== newHostname) {
        delete triggeredFeaturesPerTab[tabId];
      }
    } catch (e) {
      // Invalid URL, clear the data
      delete triggeredFeaturesPerTab[tabId];
    }
  }

  if (changeInfo.url && tab.active) {
    setWebRTCPolicy(changeInfo.url);
  }
});

// Tab removed listener: clean up triggered features
chrome.tabs.onRemoved.addListener((tabId) => {
  delete triggeredFeaturesPerTab[tabId];
});

// Tab activation listener: for switching between existing tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) {
      // Tab might be closed or not accessible, ignore
      return;
    }

    if (tab && tab.url) {
      setWebRTCPolicy(tab.url);

      // Delayed check to ensure policy is applied after activation
      setTimeout(() => {
        chrome.tabs.get(activeInfo.tabId, (currentTab) => {
          if (chrome.runtime.lastError) {
            // Tab might be closed, ignore
            return;
          }

          if (currentTab && currentTab.active && currentTab.url) {
            setWebRTCPolicy(currentTab.url);
          }
        });
      }, ACTIVATION_RECHECK_DELAY_MS);
    }
  });
});

// Global proxy allowlist bypass is handled in lib/proxy.js by PAC rules that
// return DIRECT for allowlisted hosts. Do not toggle chrome.proxy.settings per
// active tab here; that setting is browser-global and can leak other tabs.

// ========== MESSAGE HANDLING ==========

async function buildInjectionConfigForRequest(request, sender) {
  await ensureBackgroundInitialized();

  const config = await getConfig();
  const requestUrl = request.url;
  debugLog("[Background] Building injection config for URL:", requestUrl);

  const filter = new DomainFilter(config);
  const injectionConfig = {};

  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "canvas", "Canvas");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "webgl", "WebGL");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "font", "Font");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "clientrects", "ClientRects");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "webgpu", "WebGPU");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "audiocontext", "AudioContext");
  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "timezone", "Timezone");

  const userAgentActive = filter.shouldActivateFeature(requestUrl, "useragent");
  debugLog("[Background] User-Agent active:", userAgentActive);
  if (userAgentActive) {
    injectionConfig.useragent = config.useragent;
  }

  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "webrtc", "WebRTC");

  debugLog("[Background] Sending injection config:", injectionConfig);
  return injectionConfig;
}

function handleFingerprintDetectedMessage(request, sender) {
  debugLog("[Background] Fingerprint detected:", request.feature, "on", request.hostname);

  if (sender.tab && typeof sender.tab.id === "number") {
    markTriggeredFeatureForTab(sender.tab.id, request.hostname, request.feature);
    debugLog("[Background] Tracked feature", request.feature, "for tab", sender.tab.id, "on", request.hostname);
  }

  handleFingerprintDetection(request.feature, request.hostname).catch((error) => {
    debugError("[Background] Failed to process fingerprint detection:", error);
  });

  return { success: true };
}

async function handleGetInjectionConfigMessage(request, sender) {
  try {
    const injectionConfig = await buildInjectionConfigForRequest(request, sender);
    return { config: injectionConfig };
  } catch (error) {
    debugError("Error getting injection config:", error);
    return { config: null, error: error.message };
  }
}

async function handleGetConfigMessage() {
  try {
    debugLog("Getting config, current:", currentConfig ? "loaded" : "not loaded");
    const config = await getConfig();
    debugLog("Sending config response:", config ? "success" : "null");
    return { config };
  } catch (error) {
    debugError("Error getting config:", error);
    return { config: null, error: error.message };
  }
}

function serializeConfigValue(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function didConfigSectionChange(previousConfig, nextConfig, key) {
  return serializeConfigValue(previousConfig ? previousConfig[key] : undefined) !==
    serializeConfigValue(nextConfig ? nextConfig[key] : undefined);
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function getConfigChangeFlags(previousConfig, nextConfig) {
  const globalEnabledChanged = didConfigSectionChange(previousConfig, nextConfig, "enabled");
  const globalWhitelistChanged = didConfigSectionChange(previousConfig, nextConfig, "globalWhitelist");

  return {
    userAgentChanged:
      didConfigSectionChange(previousConfig, nextConfig, "useragent") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
    webrtcChanged:
      didConfigSectionChange(previousConfig, nextConfig, "webrtc") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
    proxyChanged:
      didConfigSectionChange(previousConfig, nextConfig, "proxy") ||
      globalWhitelistChanged ||
      globalEnabledChanged
  };
}

async function applyConfigChanges(changeFlags) {
  if (changeFlags.userAgentChanged) {
    await applyUserAgentSpoofing();
  }

  if (changeFlags.webrtcChanged) {
    await applyWebRTCPolicy();
  }

  if (changeFlags.proxyChanged) {
    await applyProxySettings();
  }
}

async function saveConfigWithRollback(previousConfig, nextConfig) {
  const changeFlags = getConfigChangeFlags(previousConfig, nextConfig);

  await saveConfig(nextConfig);
  setCurrentConfig(nextConfig);

  try {
    await applyConfigChanges(changeFlags);
  } catch (error) {
    await saveConfig(previousConfig);
    setCurrentConfig(previousConfig);

    try {
      await applyConfigChanges(changeFlags);
      await broadcastConfigUpdated(previousConfig);
    } catch (rollbackError) {
      debugError("[Background] Failed to roll back config after apply failure:", rollbackError);
    }

    throw error;
  }

  await broadcastConfigUpdated(nextConfig);
}

function enqueueConfigMutation(operation) {
  const queuedOperation = configMutationQueue.then(operation, operation);
  configMutationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

async function handleUpdateConfigMessage(request) {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(request.config);
    const configChanged = serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig);

    if (!configChanged) {
      return { success: true };
    }

    await saveConfigWithRollback(previousConfig, nextConfig);

    return { success: true };
  });
}

async function updateGlobalWhitelist(request, mutator) {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(previousConfig);
    const filter = new DomainFilter(nextConfig);

    nextConfig.globalWhitelist = mutator(filter, request.domain, nextConfig.globalWhitelist);

    if (serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig)) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    return { success: true, whitelist: nextConfig.globalWhitelist };
  });
}

async function handleAddToWhitelistMessage(request) {
  return updateGlobalWhitelist(request, (filter, domain, whitelist) => {
    return filter.addDomainToWhitelist(domain, whitelist);
  });
}

async function handleRemoveFromWhitelistMessage(request) {
  return updateGlobalWhitelist(request, (filter, domain, whitelist) => {
    return filter.removeDomainFromWhitelist(domain, whitelist);
  });
}

async function handleResetConfigMessage() {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(DEFAULT_CONFIG);

    if (serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig)) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    return { success: true };
  });
}

function handleGetTriggeredFeaturesMessage(request) {
  const tabData = triggeredFeaturesPerTab[request.tabId];
  return { features: tabData && tabData.features ? Array.from(tabData.features) : [] };
}

function resolveSessionTabId(request, sender) {
  if (request && typeof request.tabId === "number") {
    return request.tabId;
  }

  if (sender && sender.tab && typeof sender.tab.id === "number") {
    return sender.tab.id;
  }

  return null;
}

async function handleGetSessionsMessage(request, sender) {
  const hostname = resolveSessionHostname(request, sender);
  if (!hostname) {
    return { success: false, error: "Missing hostname", sessions: [], activeSessionId: null };
  }

  const { sessions, activeSessions } = await readSessionState();
  return {
    success: true,
    sessions: sortSessionsForHostname(sessions, hostname),
    activeSessionId: activeSessions[hostname] || null
  };
}

async function handleSaveSessionMessage(request, sender) {
  const hostname = resolveSessionHostname(request, sender);
  const tabId = resolveSessionTabId(request, sender);

  if (!hostname) {
    return { success: false, error: "Missing hostname" };
  }

  if (typeof tabId !== "number") {
    return { success: false, error: "Missing tab id" };
  }

  const [cookies, storageSnapshot] = await Promise.all([
    getCookiesForHostname(hostname),
    readTabStorageSnapshot(tabId)
  ]);

  const { sessions, activeSessions } = await readSessionState();
  const now = Date.now();

  const session = {
    id: createSessionId(),
    name: sanitizeSessionName(request && request.name),
    domain: hostname,
    createdAt: now,
    lastUsed: now,
    cookies,
    localStorage: storageSnapshot.localStorage || {},
    sessionStorage: storageSnapshot.sessionStorage || {}
  };

  const nextSessions = cleanupSessionLimits([...sessions, session], activeSessions, hostname);
  activeSessions[hostname] = session.id;
  await writeSessionState(nextSessions, activeSessions);

  return { success: true, session };
}

async function handleSwitchSessionMessage(request, sender) {
  const tabId = resolveSessionTabId(request, sender);
  const sessionId = request && request.sessionId;

  if (typeof tabId !== "number") {
    return { success: false, error: "Missing tab id" };
  }

  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return { success: false, error: "Session not found" };
  }

  await Promise.all([
    clearCookiesForHostname(session.domain),
    clearTabStorage(tabId)
  ]);

  await Promise.all([
    restoreCookies(session.cookies, session.domain),
    restoreTabStorage(tabId, {
      localStorage: session.localStorage || {},
      sessionStorage: session.sessionStorage || {}
    })
  ]);

  session.lastUsed = Date.now();
  activeSessions[session.domain] = session.id;

  await writeSessionState(sessions, activeSessions);
  await reloadTab(tabId);

  return { success: true };
}

async function handleDeleteSessionMessage(request) {
  const sessionId = request && request.sessionId;
  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const targetSession = sessions.find((entry) => entry.id === sessionId);

  const nextSessions = sessions.filter((entry) => entry.id !== sessionId);
  if (targetSession && activeSessions[targetSession.domain] === sessionId) {
    delete activeSessions[targetSession.domain];
  }

  await writeSessionState(nextSessions, activeSessions);
  return { success: true };
}

async function handleRenameSessionMessage(request) {
  const sessionId = request && request.sessionId;
  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return { success: false, error: "Session not found" };
  }

  session.name = sanitizeSessionName(request && request.name);
  await writeSessionState(sessions, activeSessions);
  return { success: true, session };
}

async function handleClearCurrentSessionMessage(request, sender) {
  const hostname = resolveSessionHostname(request, sender);
  const tabId = resolveSessionTabId(request, sender);

  if (!hostname) {
    return { success: false, error: "Missing hostname" };
  }

  if (typeof tabId !== "number") {
    return { success: false, error: "Missing tab id" };
  }

  await Promise.all([
    clearCookiesForHostname(hostname),
    clearTabStorage(tabId)
  ]);

  const { sessions, activeSessions } = await readSessionState();
  delete activeSessions[hostname];
  await writeSessionState(sessions, activeSessions);
  await reloadTab(tabId);

  return { success: true };
}

const messageHandlers = {
  "fingerprint-detected": handleFingerprintDetectedMessage,
  "get-injection-config": handleGetInjectionConfigMessage,
  "get-config": handleGetConfigMessage,
  "update-config": handleUpdateConfigMessage,
  "add-to-whitelist": handleAddToWhitelistMessage,
  "remove-from-whitelist": handleRemoveFromWhitelistMessage,
  "reset-config": handleResetConfigMessage,
  "get-triggered-features": handleGetTriggeredFeaturesMessage,
  "get-sessions": handleGetSessionsMessage,
  "save-session": handleSaveSessionMessage,
  "switch-session": handleSwitchSessionMessage,
  "delete-session": handleDeleteSessionMessage,
  "rename-session": handleRenameSessionMessage,
  "clear-current-session": handleClearCurrentSessionMessage
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const messageType = request && request.type;
  debugLog("Received message:", messageType, "from:", sender.tab ? "tab" : "popup/options");

  const handler = messageHandlers[messageType];
  if (!handler) {
    return;
  }

  try {
    const result = handler(request, sender);
    if (result && typeof result.then === "function") {
      result
        .then((payload) => {
          sendResponse(payload === undefined ? { success: true } : payload);
        })
        .catch((error) => {
          debugError(`[Background] Handler failed for "${messageType}":`, error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    sendResponse(result === undefined ? { success: true } : result);
  } catch (error) {
    debugError(`[Background] Handler crashed for "${messageType}":`, error);
    sendResponse({ success: false, error: error.message });
  }
});

// ========== FINGERPRINT DETECTION HANDLING ==========

async function handleFingerprintDetection(feature, hostname) {
  debugLog("[Background] handleFingerprintDetection called for:", feature, hostname);
  const config = await getConfig();

  debugLog("[Background] Notifications enabled:", config.notifications.enabled);

  if (!config.notifications.enabled) {
    debugLog("[Background] Notifications disabled, skipping");
    return;
  }

  // Check if global protection is enabled
  if (!config.enabled) {
    debugLog("[Background] Global protection disabled, skipping notification");
    return;
  }

  // Check if the specific feature is enabled
  const featureConfig = config[feature === "user-agent" ? "useragent" : feature];
  if (!featureConfig || !featureConfig.enabled) {
    debugLog("[Background] Feature", feature, "is disabled, skipping notification");
    return;
  }

  // Check if domain is on the whitelist/allowlist for this feature
  const featureWhitelist = featureConfig.whitelist || "";
  if (isHostnameOnFeatureAllowlist(hostname, featureWhitelist, config)) {
    debugLog("[Background] Domain", hostname, "is on whitelist/allowlist for", feature, "- skipping notification");
    return;
  }

  // Throttle notifications (max 1 per throttle window per feature-hostname combo)
  const key = `${feature}-${hostname}`;
  const now = Date.now();
  const lastTime = lastNotificationTime[key] || 0;

  debugLog("[Background] Throttle check:", {
    key: key,
    timeSinceLastNotification: now - lastTime,
    throttleLimit: NOTIFICATION_THROTTLE_MS
  });

  if (now - lastTime < NOTIFICATION_THROTTLE_MS) {
    debugLog("[Background] Notification throttled (too soon)");
    return;  // Too soon
  }

  lastNotificationTime[key] = now;

  // Show notification
  debugLog("[Background] Creating notification for:", feature, "on", hostname);
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/64.png",
    title: "Stealth Guard - Fingerprint Blocked",
    message: `${feature.toUpperCase()} fingerprinting attempt blocked on ${hostname}`,
    priority: 1
  }, (notificationId) => {
    if (chrome.runtime.lastError) {
      debugError("[Background] Notification error:", chrome.runtime.lastError);
    } else {
      debugLog("[Background] Notification created with ID:", notificationId);
    }
  });
}
// ========== CONTEXT MENUS ==========

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      debugWarn("Error removing context menus:", chrome.runtime.lastError);
    }

    // Add to whitelist/allowlist menu
    chrome.contextMenus.create({
      id: "add-to-global-whitelist",
      title: "Stealth Guard: Add to Allowlist",
      contexts: ["page"]
    }, () => {
      if (chrome.runtime.lastError) {
        // Ignore duplicate ID errors
        debugWarn("Context menu create warning:", chrome.runtime.lastError.message);
      }
    });

    // Remove from whitelist/allowlist menu
    chrome.contextMenus.create({
      id: "remove-from-global-whitelist",
      title: "Stealth Guard: Remove from Allowlist",
      contexts: ["page"]
    }, () => {
      if (chrome.runtime.lastError) {
        debugWarn("Context menu create warning:", chrome.runtime.lastError.message);
      }
    });

    // Test protection menu
    chrome.contextMenus.create({
      id: "test-protection",
      title: "Stealth Guard: Test Protection",
      contexts: ["page"]
    }, () => {
      if (chrome.runtime.lastError) {
        debugWarn("Context menu create warning:", chrome.runtime.lastError.message);
      }
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.url) return;

  try {
    const url = new URL(tab.url);
    const hostname = url.hostname;

    if (info.menuItemId === "add-to-global-whitelist") {
      await updateGlobalWhitelist({ domain: hostname }, (filter, domain, whitelist) => {
        return filter.addDomainToWhitelist(domain, whitelist);
      });

      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard",
        message: `Added *.${hostname} to allowlist`
      });

      // Reload tab to apply changes
      chrome.tabs.reload(tab.id, () => {
        if (chrome.runtime.lastError) {
          debugWarn("Failed to reload tab after allowlist add:", chrome.runtime.lastError.message);
        }
      });

    } else if (info.menuItemId === "remove-from-global-whitelist") {
      await updateGlobalWhitelist({ domain: hostname }, (filter, domain, whitelist) => {
        return filter.removeDomainFromWhitelist(domain, whitelist);
      });

      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard",
        message: `Removed *.${hostname} from allowlist`
      });

      // Reload tab to apply changes
      chrome.tabs.reload(tab.id, () => {
        if (chrome.runtime.lastError) {
          debugWarn("Failed to reload tab after allowlist removal:", chrome.runtime.lastError.message);
        }
      });

    } else if (info.menuItemId === "test-protection") {
      // Open test page
      chrome.tabs.create({ url: "https://browserleaks.com/" });
    }

  } catch (e) {
    debugError("Context menu error:", e);
  }
});

// ========== PROXY ERROR HANDLING ==========

chrome.proxy.onProxyError.addListener((details) => {
  debugError("[Proxy] Error detected:", details.error);
  debugError("[Proxy] Error details:", details.details);

  // If we have a fatal proxy error, we could consider notifying the user
  if (details.fatal) {
    console.error("[Proxy] Fatal error, proxy settings may be invalid");

    // Optional: Notify user via notification
    if (currentConfig && currentConfig.notifications && currentConfig.notifications.enabled) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard - Proxy Error",
        message: "Proxy connection failed. Check your proxy settings.",
        priority: 2
      });
    }
  }
});

// ========== CONFIG HELPER ==========

async function getConfig() {
  if (currentConfig) {
    return currentConfig;
  }
  setCurrentConfig(await loadConfig());
  return currentConfig;
}

debugLog("Stealth Guard background script loaded");
