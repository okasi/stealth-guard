// Background Script - Orchestrates all protection features
// Libraries are loaded via manifest.json scripts array

// Global state
let currentConfig = null;
let currentDomainFilter = null;
let lastNotificationTime = {};
let configLoaded = false;
let initializationPromise = null;
let turnstileTimestamps = {}; // Track domains with Turnstile: { hostname: timestamp }
let proxyDisabledForWhitelist = false; // Track if proxy is temporarily disabled for whitelisted tab
let triggeredFeaturesPerTab = {}; // Track triggered features per tab: { tabId: { hostname: string, features: Set } }
let lastAppliedWebRTCPolicy = null;
let pendingWebRTCPolicy = null;

// Timing / behavior constants
const TURNSTILE_BYPASS_TTL_MS = 3 * 60 * 1000;
const TURNSTILE_RELOAD_DELAY_MS = 1000;
const ACTIVATION_RECHECK_DELAY_MS = 377;
const NOTIFICATION_THROTTLE_MS = 3770;
const TURNSTILE_SESSION_KEY = "__STEALTH_GUARD_TURNSTILE_TS__";

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

function pruneExpiredTurnstileEntries(now = Date.now()) {
  for (const domain in turnstileTimestamps) {
    if (now - turnstileTimestamps[domain] >= TURNSTILE_BYPASS_TTL_MS) {
      delete turnstileTimestamps[domain];
    }
  }
}

function getExactTurnstileBypass(hostname) {
  if (!hostname) {
    return { active: false, remainingMs: 0 };
  }

  const now = Date.now();
  const timestamp = turnstileTimestamps[hostname];
  if (!timestamp) {
    return { active: false, remainingMs: 0 };
  }

  const age = now - timestamp;
  if (age >= TURNSTILE_BYPASS_TTL_MS) {
    delete turnstileTimestamps[hostname];
    return { active: false, remainingMs: 0 };
  }

  return {
    active: true,
    remainingMs: TURNSTILE_BYPASS_TTL_MS - age
  };
}

function getTurnstileBypassIncludingParents(hostname) {
  if (!hostname) {
    return { active: false, matchedDomain: null, remainingMs: 0 };
  }

  pruneExpiredTurnstileEntries();

  const labels = hostname.split(".");
  for (let i = 0; i < labels.length; i++) {
    const domain = labels.slice(i).join(".");
    const bypass = getExactTurnstileBypass(domain);
    if (bypass.active) {
      return {
        active: true,
        matchedDomain: domain,
        remainingMs: bypass.remainingMs
      };
    }
  }

  return { active: false, matchedDomain: null, remainingMs: 0 };
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
  if (!tabId) {
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

function setTurnstileSessionFlagAndReload(tabId, timestamp) {
  if (typeof tabId !== "number") {
    return;
  }

  const code = `
    try {
      // Set Turnstile timestamp for injector to read synchronously
      sessionStorage.setItem('${TURNSTILE_SESSION_KEY}', '${timestamp}');
    } catch (e) {
      // Ignore errors
    }
  `;

  chrome.tabs.executeScript(tabId, {
    code: code,
    runAt: "document_start"
  }, () => {
    debugLog("[Background] SessionStorage flag set, scheduling reload in 1s for tab:", tabId);
    setTimeout(() => {
      debugLog("[Background] Reloading tab now:", tabId);
      chrome.tabs.reload(tabId, { bypassCache: true });
    }, TURNSTILE_RELOAD_DELAY_MS);
  });
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
// The injector currently reads from session/storage cache directly.
// "get-injection-config" is retained as a legacy compatibility endpoint.

// ========== USER-AGENT SPOOFING ==========
// HTTP User-Agent header modification using declarativeNetRequest API
// Inspired by UA Switcher Pro - this approach works reliably in all Chrome installs

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
    if (!config.useragent || !config.useragent.enabled) {
      debugLog("User-Agent spoofing disabled");
      return;
    }

    // Get the User-Agent string
    const preset = config.useragent.preset || "macos";
    const userAgent = USER_AGENT_PRESETS[preset];

    if (!userAgent) {
      debugWarn("Invalid User-Agent preset:", preset);
      return;
    }

    // Create the listener function
    uaListener = function(details) {
      // Check if this domain is in the Turnstile bypass list
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

      // Check Turnstile bypass window
      const bypassInfo = getTurnstileBypassIncludingParents(hostname);
      if (bypassInfo.active) {
        // Bypass active: Don't modify headers (send real UA)
        debugLog(
          "[UA Listener] BYPASS: Turnstile domain",
          bypassInfo.matchedDomain,
          "age:",
          Math.round((TURNSTILE_BYPASS_TTL_MS - bypassInfo.remainingMs) / 1000) + "s",
          "for URL:",
          details.url.substring(0, 100)
        );
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
  }
}

// ========== WEBRTC POLICY ==========

async function applyWebRTCPolicyValue(policy) {
  if (lastAppliedWebRTCPolicy === policy || pendingWebRTCPolicy === policy) {
    return;
  }

  pendingWebRTCPolicy = policy;
  try {
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: policy });
    lastAppliedWebRTCPolicy = policy;
  } finally {
    if (pendingWebRTCPolicy === policy) {
      pendingWebRTCPolicy = null;
    }
  }
}

async function applyWebRTCPolicy() {
  try {
    const config = await getConfig();

    const policy = config.webrtc.enabled ? config.webrtc.policy : "default";
    await applyWebRTCPolicyValue(policy);
    debugLog("[WebRTC] Base policy applied:", policy);
  } catch (e) {
    console.error("Failed to apply WebRTC policy:", e);
  }
}

// Simple WebRTC policy setter (similar to WebRTC Leak Killer)
function setWebRTCPolicy(url) {
  getConfig().then(config => {
    if (!config.webrtc.enabled) {
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

    // Check if URL is on whitelist/allowlist
    const hostname = getHostnameFromUrl(url);
    const isOnAllowlist = isHostnameOnFeatureAllowlist(hostname, config.webrtc.whitelist, config);

    // Set policy: allow if on allowlist, block otherwise
    const policy = isOnAllowlist ? "default" : config.webrtc.policy;
    applyWebRTCPolicyValue(policy)
      .then(() => {
        debugLog("[WebRTC] Policy set to:", policy, "for:", url);
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
    updateProxyForActiveTab(changeInfo.url);
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
      updateProxyForActiveTab(tab.url);

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

// ========== ACTIVE TAB PROXY BYPASS FOR WHITELISTED PAGES ==========

// Track pending proxy disable for re-navigation
let pendingProxyDisableTabId = null;

// Update proxy based on whether active tab is on a whitelisted domain
async function updateProxyForActiveTab(url) {
  if (!currentConfig || !currentConfig.proxy || !currentConfig.proxy.enabled) {
    return; // Proxy not enabled, nothing to do
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Check if this domain is on the global whitelist
    const isWhitelisted = isHostnameOnGlobalAllowlist(hostname, currentConfig);

    if (isWhitelisted && !proxyDisabledForWhitelist) {
      // Disable proxy completely for whitelisted tab
      debugLog("[Proxy] Active tab is whitelisted, disabling proxy for:", hostname);
      proxyDisabledForWhitelist = true;
      await chrome.proxy.settings.set({
        value: { mode: 'system' },
        scope: 'regular'
      });
    } else if (!isWhitelisted && proxyDisabledForWhitelist) {
      // Re-enable proxy for non-whitelisted tab
      debugLog("[Proxy] Active tab is not whitelisted, re-enabling proxy");
      proxyDisabledForWhitelist = false;
      await applyProxySettings();
    }
  } catch (e) {
    // Ignore invalid URLs (like chrome:// pages)
  }
}

// Intercept main frame requests to whitelisted domains
// This ensures proxy is disabled BEFORE any resources load
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only handle main frame requests
    if (details.type !== 'main_frame') {
      return {};
    }

    // Skip if this is a re-navigation after proxy disable
    if (pendingProxyDisableTabId === details.tabId) {
      pendingProxyDisableTabId = null;
      debugLog("[Proxy] Allowing re-navigation after proxy disable");
      return {};
    }

    // Skip non-http URLs
    if (!details.url.startsWith('http://') && !details.url.startsWith('https://')) {
      return {};
    }

    try {
      const url = new URL(details.url);
      const hostname = url.hostname;

      // Check if proxy is enabled and not already disabled for whitelist
      if (!currentConfig || !currentConfig.proxy || !currentConfig.proxy.enabled) {
        return {};
      }

      if (proxyDisabledForWhitelist) {
        return {};
      }

      // Check if this domain is whitelisted
      const isWhitelisted = isHostnameOnGlobalAllowlist(hostname, currentConfig);

      if (isWhitelisted) {
        // Cancel this request, disable proxy, then re-navigate
        debugLog("[Proxy] Intercepted whitelisted navigation, disabling proxy first:", hostname);
        proxyDisabledForWhitelist = true;
        pendingProxyDisableTabId = details.tabId;

        chrome.proxy.settings.set({
          value: { mode: 'system' },
          scope: 'regular'
        }, () => {
          // Re-navigate after proxy is disabled
          debugLog("[Proxy] Proxy disabled, re-navigating to:", details.url);
          chrome.tabs.update(details.tabId, { url: details.url });
        });

        // Cancel the original request
        return { cancel: true };
      }
    } catch (e) {
      debugError("[Proxy] Error in onBeforeRequest:", e);
    }

    return {};
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["blocking"]
);

// Re-enable proxy when navigating away from whitelisted page
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Only main frame

  // Only need to check for re-enabling proxy when navigating away
  if (proxyDisabledForWhitelist) {
    try {
      const url = new URL(details.url);
      const hostname = url.hostname;
      const isWhitelisted = isHostnameOnGlobalAllowlist(hostname, currentConfig);

      if (!isWhitelisted) {
        debugLog("[Proxy] Navigating away from whitelisted domain, re-enabling proxy");
        proxyDisabledForWhitelist = false;
        applyProxySettings();
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
});

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

  // User-Agent handling: disable all inline protections while exact-domain Turnstile bypass is active.
  const userAgentActive = filter.shouldActivateFeature(requestUrl, "useragent");
  const topHostname = resolveTabHostname(sender, getHostnameFromUrl(requestUrl));
  const exactBypass = getExactTurnstileBypass(topHostname);
  if (exactBypass.active) {
    debugLog("[Background] Turnstile active on top domain:", topHostname, "- disabling protections for frame:", requestUrl);
    return { enabled: false, globalWhitelist: config.globalWhitelist };
  }

  debugLog("[Background] User-Agent active:", userAgentActive);
  if (userAgentActive) {
    injectionConfig.useragent = config.useragent;
  }

  addFeatureIfActive(injectionConfig, filter, config, requestUrl, "webrtc", "WebRTC");

  debugLog("[Background] Sending injection config:", injectionConfig);
  return injectionConfig;
}

function handleTurnstileDetectedMessage(request, sender) {
  const requestedHostname = request.hostname;
  const hostname = resolveTabHostname(sender, requestedHostname);

  if (requestedHostname && hostname && requestedHostname !== hostname) {
    debugLog("[Background] Overriding request hostname", requestedHostname, "with tab hostname:", hostname);
  }

  if (!hostname) {
    debugWarn("[Background] turnstile-detected received without a valid hostname");
    return { success: false, error: "Missing hostname" };
  }

  const existingBypass = getExactTurnstileBypass(hostname);
  if (existingBypass.active) {
    debugLog("[Background] Turnstile bypass already active for", hostname, "- ignoring re-detection");
    return { success: true, ignored: true };
  }

  const now = Date.now();
  turnstileTimestamps[hostname] = now;
  pruneExpiredTurnstileEntries(now);

  debugLog("[Background] Turnstile detected for:", hostname, "- Added to bypass list");
  debugLog("[Background] Turnstile domains now tracked:", Object.keys(turnstileTimestamps));

  // Re-apply UA listener and trigger one reload so page scripts run with bypass flag.
  applyUserAgentSpoofing()
    .then(() => setTurnstileSessionFlagAndReload(sender && sender.tab ? sender.tab.id : undefined, now))
    .catch((error) => {
      debugError("[Background] Failed to apply Turnstile bypass:", error);
    });

  return { success: true };
}

function handleCheckTurnstileStatusMessage(request, sender) {
  // Use top tab hostname when available so all frames in a tab share bypass state.
  const hostname = resolveTabHostname(sender, request.hostname);
  const bypassInfo = getTurnstileBypassIncludingParents(hostname);

  if (bypassInfo.active) {
    const remainingSeconds = Math.ceil(bypassInfo.remainingMs / 1000);
    if (bypassInfo.matchedDomain === hostname) {
      debugLog("[Background] check-turnstile-status: BYPASS ACTIVE for", hostname, "remaining:", remainingSeconds + "s");
    } else {
      debugLog("[Background] check-turnstile-status: BYPASS ACTIVE for subdomain", hostname, "of", bypassInfo.matchedDomain);
    }
    return { skipUA: true, remainingSeconds };
  }

  debugLog("[Background] check-turnstile-status: No bypass for", hostname, "tracked:", Object.keys(turnstileTimestamps));
  return { skipUA: false };
}

function handleFingerprintDetectedMessage(request, sender) {
  debugLog("[Background] Fingerprint detected:", request.feature, "on", request.hostname);

  if (sender.tab && sender.tab.id) {
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

async function handleUpdateConfigMessage(request) {
  const previousConfig = await getConfig();
  const nextConfig = request.config;
  const configChanged = serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig);

  if (!configChanged) {
    return { success: true };
  }

  const globalEnabledChanged = didConfigSectionChange(previousConfig, nextConfig, "enabled");
  const globalWhitelistChanged = didConfigSectionChange(previousConfig, nextConfig, "globalWhitelist");
  const userAgentChanged = didConfigSectionChange(previousConfig, nextConfig, "useragent") || globalEnabledChanged;
  const webrtcChanged =
    didConfigSectionChange(previousConfig, nextConfig, "webrtc") ||
    globalWhitelistChanged ||
    globalEnabledChanged;
  const proxyChanged =
    didConfigSectionChange(previousConfig, nextConfig, "proxy") ||
    globalWhitelistChanged ||
    globalEnabledChanged;

  await saveConfig(nextConfig);
  setCurrentConfig(nextConfig);

  if (userAgentChanged) {
    await applyUserAgentSpoofing();
  }

  if (webrtcChanged) {
    await applyWebRTCPolicy();
  }

  if (proxyChanged) {
    await applyProxySettings();
  }

  await broadcastConfigUpdated(nextConfig);

  return { success: true };
}

async function updateGlobalWhitelist(request, mutator) {
  const config = await getConfig();
  const filter = new DomainFilter(config);
  config.globalWhitelist = mutator(filter, request.domain, config.globalWhitelist);
  await saveConfig(config);
  setCurrentConfig(config);
  await applyWebRTCPolicy();
  await applyProxySettings();
  await broadcastConfigUpdated(config);
  return { success: true, whitelist: config.globalWhitelist };
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
  await resetConfig();
  setCurrentConfig(await loadConfig());
  await applyUserAgentSpoofing();
  await applyWebRTCPolicy();
  await applyProxySettings();
  return { success: true };
}

function handleGetTriggeredFeaturesMessage(request) {
  const tabData = triggeredFeaturesPerTab[request.tabId];
  return { features: tabData && tabData.features ? Array.from(tabData.features) : [] };
}

const messageHandlers = {
  "turnstile-detected": handleTurnstileDetectedMessage,
  "check-turnstile-status": handleCheckTurnstileStatusMessage,
  "fingerprint-detected": handleFingerprintDetectedMessage,
  "get-injection-config": handleGetInjectionConfigMessage,
  "get-config": handleGetConfigMessage,
  "update-config": handleUpdateConfigMessage,
  "add-to-whitelist": handleAddToWhitelistMessage,
  "remove-from-whitelist": handleRemoveFromWhitelistMessage,
  "reset-config": handleResetConfigMessage,
  "get-triggered-features": handleGetTriggeredFeaturesMessage
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
    const config = await getConfig();
    const filter = new DomainFilter(config);

    if (info.menuItemId === "add-to-global-whitelist") {
      // Add to whitelist/allowlist
      config.globalWhitelist = filter.addDomainToWhitelist(hostname, config.globalWhitelist);
      await saveConfig(config);
      setCurrentConfig(config);

      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard",
        message: `Added *.${hostname} to allowlist`
      });

      // Reload tab to apply changes
      chrome.tabs.reload(tab.id);

    } else if (info.menuItemId === "remove-from-global-whitelist") {
      // Remove from whitelist/allowlist
      config.globalWhitelist = filter.removeDomainFromWhitelist(hostname, config.globalWhitelist);
      await saveConfig(config);
      setCurrentConfig(config);

      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard",
        message: `Removed *.${hostname} from allowlist`
      });

      // Reload tab to apply changes
      chrome.tabs.reload(tab.id);

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
