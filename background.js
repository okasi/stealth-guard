// Background Script - Orchestrates all protection features
// Libraries are loaded via manifest.json scripts array

// Global state
let currentConfig = null;
let lastNotificationTime = {};
let configLoaded = false;
let initializationPromise = null;
let turnstileTimestamps = {}; // Track domains with Turnstile: { hostname: timestamp }
let proxyDisabledForWhitelist = false; // Track if proxy is temporarily disabled for whitelisted tab
let triggeredFeaturesPerTab = {}; // Track triggered features per tab: { tabId: { hostname: string, features: Set } }

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

// ========== INITIALIZATION ==========

// Initialize config immediately when background script loads
initializationPromise = (async function initializeBackground() {
  try {
    // Initial logs before config is loaded - use console.log since debugLog isn't ready yet
    currentConfig = await loadConfig();

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
    currentConfig = await loadConfig();
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
  currentConfig = await loadConfig();
  configLoaded = true;
  await applyUserAgentSpoofing();
  await applyWebRTCPolicy();
  await applyProxySettings();
});

// ========== DYNAMIC CONFIG INJECTION ==========
// Config injection is now handled by injector.js content script
// which requests the config via "get-injection-config" message

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
      if (hostname === 'challenges.cloudflare.com' || hostname.endsWith('.challenges.cloudflare.com')) {
         debugLog("[UA Listener] BYPASS: Cloudflare challenge domain:", hostname);
         return { requestHeaders: details.requestHeaders };
      }

      // Check Turnstile timestamp validity
      // Check exact match or if the tracked domain is a suffix (e.g. tracked "example.com" matches "www.example.com")
      const trackedDomains = Object.keys(turnstileTimestamps);
      for (const domain of trackedDomains) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          const age = Date.now() - turnstileTimestamps[domain];
          if (age < 3 * 60 * 1000) {
            // Bypass active: Don't modify headers (send real UA)
            debugLog("[UA Listener] BYPASS: Turnstile domain", domain, "age:", Math.round(age/1000) + "s", "for URL:", details.url.substring(0, 100));
            return { requestHeaders: details.requestHeaders };
          } else {
            delete turnstileTimestamps[domain];
          }
        }
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

async function applyWebRTCPolicy() {
  try {
    const config = await getConfig();

    if (config.webrtc.enabled) {
      // Apply WebRTC leak protection
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: config.webrtc.policy
      });
      debugLog("WebRTC policy applied:", config.webrtc.policy);
    } else {
      // Restore default
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "default"
      });
      debugLog("WebRTC policy restored to default");
    }
  } catch (e) {
    console.error("Failed to apply WebRTC policy:", e);
  }
}

// Simple WebRTC policy setter (similar to WebRTC Leak Killer)
function setWebRTCPolicy(url) {
  getConfig().then(config => {
    if (!config.webrtc.enabled) {
      // Protection disabled - allow WebRTC everywhere
      chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "default"
      });
      debugLog("[WebRTC] Protection disabled, allowing WebRTC");
      return;
    }

    // Check if URL is on whitelist/allowlist
    const filter = new DomainFilter(config);
    const hostname = filter.extractHostname(url);
    const isOnAllowlist = hostname && filter.isWhitelisted(hostname, config.webrtc.whitelist);

    // Set policy: allow if on allowlist, block otherwise
    const policy = isOnAllowlist ? "default" : config.webrtc.policy;
    chrome.privacy.network.webRTCIPHandlingPolicy.set({
      value: policy
    });

    debugLog("[WebRTC] Policy set to:", policy, "for:", url);
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

      // Delayed check after 377ms to ensure policy is applied
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
        // 377ms: Fibonacci number, Doherty threshold for perceived responsiveness
      }, 377);
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
    const filter = new DomainFilter(currentConfig);
    const isWhitelisted = filter.isWhitelisted(hostname, currentConfig.globalWhitelist || "");

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
      const filter = new DomainFilter(currentConfig);
      const isWhitelisted = filter.isWhitelisted(hostname, currentConfig.globalWhitelist || "");

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
      const filter = new DomainFilter(currentConfig);
      const isWhitelisted = filter.isWhitelisted(hostname, currentConfig.globalWhitelist || "");

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog("Received message:", request.type, "from:", sender.tab ? "tab" : "popup/options");

  // Turnstile detected - add to temporary whitelist
  if (request.type === "turnstile-detected") {
    let hostname = request.hostname;

    // CRITICAL FIX: Use the tab's top-level hostname if available
    // The content script might be in an iframe and unable to see the top URL
    // We want to whitelist the SITE the user is visiting, not just the iframe
    if (sender.tab && sender.tab.url) {
      try {
        const tabHostname = new URL(sender.tab.url).hostname;
        debugLog("[Background] Overriding request hostname", hostname, "with tab hostname:", tabHostname);
        hostname = tabHostname;
      } catch (e) {
        // Fallback to request.hostname
      }
    }

    const now = Date.now();

    // Check if we recently handled this domain (prevent infinite reload loop)
    if (turnstileTimestamps[hostname]) {
      const threeMinutes = 3 * 60 * 1000;
      const timeSinceLastDetection = now - turnstileTimestamps[hostname];

      // If a bypass is already active (detected < 3 mins ago), ignore new detections
      // This prevents infinite reloads when frames without sessionStorage access (re)detect Turnstile
      if (timeSinceLastDetection < threeMinutes) {
        debugLog("[Background] Turnstile bypass already active for", hostname, "- ignoring re-detection");
        sendResponse({ success: true, ignored: true });
        return;
      }
    }

    debugLog("[Background] Turnstile detected for:", hostname, "- Adding to bypass list");

    // Store timestamp for 3 minutes
    turnstileTimestamps[hostname] = now;

    // Clean up old entries
    const threeMinutes = 3 * 60 * 1000;
    for (const domain in turnstileTimestamps) {
      if (now - turnstileTimestamps[domain] > threeMinutes) {
        delete turnstileTimestamps[domain];
        debugLog("[Background] Cleared expired Turnstile entry for:", domain);
      }
    }

    debugLog("[Background] Turnstile domains now tracked:", Object.keys(turnstileTimestamps));

    // Update UA rules to exclude this domain
    applyUserAgentSpoofing().then(() => {
      // Tell content script to set timestamp flag (without clearing tracking cookies/storage)
      if (sender.tab && sender.tab.id) {
        const code = `
          try {
            // Set Turnstile timestamp for injector to read synchronously
            sessionStorage.setItem('__STEALTH_GUARD_TURNSTILE_TS__', '${now}');
          } catch(e) {
            // Ignore errors
          }
        `;

        chrome.tabs.executeScript(sender.tab.id, {
          code: code,
          runAt: 'document_start'
        }, () => {
          debugLog("[Background] SessionStorage flag set, scheduling reload in 1s for tab:", sender.tab.id);
          setTimeout(() => {
            debugLog("[Background] Reloading tab now:", sender.tab.id);
            chrome.tabs.reload(sender.tab.id, { bypassCache: true });
          }, 1000);
        });
      }
    });

    sendResponse({ success: true });
    return;
  }

  // Check if UA should be disabled for this domain (synchronous check)
  if (request.type === "check-turnstile-status") {
    // CRITICAL: Use the TAB's hostname, not the frame's hostname
    // This ensures we match against the same hostname stored in turnstileTimestamps
    let hostname = request.hostname;
    if (sender.tab && sender.tab.url) {
      try {
        hostname = new URL(sender.tab.url).hostname;
      } catch (e) {}
    }

    const threeMinutes = 3 * 60 * 1000;

    // Check exact match first
    if (turnstileTimestamps[hostname]) {
      const age = Date.now() - turnstileTimestamps[hostname];
      if (age < threeMinutes) {
        const remainingSeconds = Math.ceil((threeMinutes - age) / 1000);
        debugLog("[Background] check-turnstile-status: BYPASS ACTIVE for", hostname, "remaining:", remainingSeconds + "s");
        sendResponse({
          skipUA: true,
          remainingSeconds: remainingSeconds
        });
        return;
      } else {
        delete turnstileTimestamps[hostname];
      }
    }

    // Also check if hostname is a subdomain of a tracked domain (like uaListener does)
    const trackedDomains = Object.keys(turnstileTimestamps);
    for (const domain of trackedDomains) {
      if (hostname.endsWith('.' + domain)) {
        const age = Date.now() - turnstileTimestamps[domain];
        if (age < threeMinutes) {
          const remainingSeconds = Math.ceil((threeMinutes - age) / 1000);
          debugLog("[Background] check-turnstile-status: BYPASS ACTIVE for subdomain", hostname, "of", domain);
          sendResponse({
            skipUA: true,
            remainingSeconds: remainingSeconds
          });
          return;
        }
      }
    }

    debugLog("[Background] check-turnstile-status: No bypass for", hostname, "tracked:", trackedDomains);
    sendResponse({ skipUA: false });
    return;
  }

  // Fingerprint detected
  if (request.type === "fingerprint-detected") {
    debugLog("[Background] Fingerprint detected:", request.feature, "on", request.hostname);

    // Track per tab and hostname
    if (sender.tab && sender.tab.id) {
      const tabId = sender.tab.id;
      const hostname = request.hostname;

      if (!triggeredFeaturesPerTab[tabId]) {
        triggeredFeaturesPerTab[tabId] = { hostname: hostname, features: new Set() };
      }

      // If hostname changed, reset the features
      if (triggeredFeaturesPerTab[tabId].hostname !== hostname) {
        triggeredFeaturesPerTab[tabId] = { hostname: hostname, features: new Set() };
      }

      triggeredFeaturesPerTab[tabId].features.add(request.feature);
      debugLog("[Background] Tracked feature", request.feature, "for tab", tabId, "on", hostname);
    }

    handleFingerprintDetection(request.feature, request.hostname);
    sendResponse({ success: true });
    return;
  }

  // Get injection config (for content script)
  if (request.type === "get-injection-config") {
    // Wait for initialization to complete if needed
    const handleRequest = async () => {
      if (!configLoaded) {
        debugLog("[Background] Config not loaded yet, waiting for initialization...");
        await initializationPromise;
        debugLog("[Background] Initialization complete, proceeding with request");
      }

      const config = await getConfig();
      debugLog("[Background] Building injection config for URL:", request.url);
      debugLog("[Background] Full config:", config);

      const filter = new DomainFilter(config);
      const injectionConfig = {};

      // Check each feature
      const canvasActive = filter.shouldActivateFeature(request.url, "canvas");
      debugLog("[Background] Canvas active:", canvasActive);
      if (canvasActive) {
        injectionConfig.canvas = config.canvas;
      }

      const webglActive = filter.shouldActivateFeature(request.url, "webgl");
      debugLog("[Background] WebGL active:", webglActive);
      if (webglActive) {
        injectionConfig.webgl = config.webgl;
      }

      const fontActive = filter.shouldActivateFeature(request.url, "font");
      debugLog("[Background] Font active:", fontActive);
      if (fontActive) {
        injectionConfig.font = config.font;
      }

      const clientrectsActive = filter.shouldActivateFeature(request.url, "clientrects");
      debugLog("[Background] ClientRects active:", clientrectsActive);
      if (clientrectsActive) {
        injectionConfig.clientrects = config.clientrects;
      }

      const webgpuActive = filter.shouldActivateFeature(request.url, "webgpu");
      debugLog("[Background] WebGPU active:", webgpuActive);
      if (webgpuActive) {
        injectionConfig.webgpu = config.webgpu;
      }

      const audiocontextActive = filter.shouldActivateFeature(request.url, "audiocontext");
      debugLog("[Background] AudioContext active:", audiocontextActive);
      if (audiocontextActive) {
        injectionConfig.audiocontext = config.audiocontext;
      }

      const timezoneActive = filter.shouldActivateFeature(request.url, "timezone");
      debugLog("[Background] Timezone active:", timezoneActive);
      if (timezoneActive) {
        injectionConfig.timezone = config.timezone;
      }

      // Check User-Agent - but disable if Turnstile recently detected
      const useragentActive = filter.shouldActivateFeature(request.url, "useragent");
      let turnstileBypassActive = false;

      // Extract hostname from TAB URL (to cover all frames in the tab)
      try {
        let topHostname = null;
        if (sender && sender.tab && sender.tab.url) {
          topHostname = new URL(sender.tab.url).hostname;
        } else {
          // Fallback to request url if tab info missing
          topHostname = new URL(request.url).hostname;
        }

        // Check if this domain has recent Turnstile detection
        if (topHostname && turnstileTimestamps[topHostname]) {
          const threeMinutes = 3 * 60 * 1000;
          const age = Date.now() - turnstileTimestamps[topHostname];

          if (age < threeMinutes) {
            turnstileBypassActive = true;
            debugLog("[Background] Turnstile active on top domain:", topHostname, "- disabling protections for frame:", request.url);
          } else {
            // Expired, clean up
            delete turnstileTimestamps[topHostname];
          }
        }
      } catch (e) {
        debugLog("[Background] Error checking Turnstile status:", e);
      }

      // If Turnstile bypass is active, return disabled config
      if (turnstileBypassActive) {
        return { enabled: false, globalWhitelist: config.globalWhitelist };
      }

      debugLog("[Background] User-Agent active:", useragentActive);
      if (useragentActive) {
        injectionConfig.useragent = config.useragent;
      }

      const webrtcActive = filter.shouldActivateFeature(request.url, "webrtc");
      debugLog("[Background] WebRTC active:", webrtcActive);
      if (webrtcActive) {
        injectionConfig.webrtc = config.webrtc;
      }

      debugLog("[Background] Sending injection config:", injectionConfig);
      return injectionConfig;
    };

    // Execute async handler
    handleRequest()
      .then(injectionConfig => {
        sendResponse({ config: injectionConfig });
      })
      .catch(error => {
        console.error("Error getting injection config:", error);
        sendResponse({ config: null, error: error.message });
      });

    return true;  // Async response
  }

  // Get config
  if (request.type === "get-config") {
    debugLog("Getting config, current:", currentConfig ? "loaded" : "not loaded");
    getConfig().then(config => {
      debugLog("Sending config response:", config ? "success" : "null");
      sendResponse({ config: config });
    }).catch(error => {
      console.error("Error getting config:", error);
      sendResponse({ config: null, error: error.message });
    });
    return true;  // Async response
  }

  // Update config
  if (request.type === "update-config") {
    saveConfig(request.config).then(async () => {
      currentConfig = request.config;
      await applyUserAgentSpoofing();
      await applyWebRTCPolicy();
      await applyProxySettings();

      // Broadcast config update to all tabs and wait for completion
      return new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          let remaining = tabs.length;
          if (remaining === 0) {
            resolve();
            return;
          }

          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: "config-updated",
              config: request.config
            }, () => {
              // Ignore errors (tab might not have content script)
              if (chrome.runtime.lastError) {
                // Silent
              }
              remaining--;
              if (remaining === 0) {
                resolve();
              }
            });
          });
        });
      });
    }).then(() => {
      sendResponse({ success: true });
    });
    return true;  // Async response
  }

  // Add domain to whitelist/allowlist
  if (request.type === "add-to-whitelist") {
    getConfig().then(async config => {
      const filter = new DomainFilter(config);
      config.globalWhitelist = filter.addDomainToWhitelist(request.domain, config.globalWhitelist);
      await saveConfig(config);
      currentConfig = config;
      await applyProxySettings(); // Re-apply proxy settings to update PAC script
      sendResponse({ success: true, whitelist: config.globalWhitelist });
    });
    return true;
  }

  // Remove domain from whitelist/allowlist
  if (request.type === "remove-from-whitelist") {
    getConfig().then(async config => {
      const filter = new DomainFilter(config);
      config.globalWhitelist = filter.removeDomainFromWhitelist(request.domain, config.globalWhitelist);
      await saveConfig(config);
      currentConfig = config;
      await applyProxySettings(); // Re-apply proxy settings to update PAC script
      sendResponse({ success: true, whitelist: config.globalWhitelist });
    });
    return true;
  }

  // Reset config to defaults
  if (request.type === "reset-config") {
    resetConfig().then(async () => {
      currentConfig = await loadConfig();
      await applyWebRTCPolicy();
      await applyProxySettings();
      sendResponse({ success: true });
    });
    return true;
  }

  // Get triggered features for a specific tab (for popup highlighting)
  if (request.type === "get-triggered-features") {
    const tabId = request.tabId;
    const tabData = triggeredFeaturesPerTab[tabId];
    if (tabData && tabData.features) {
      sendResponse({ features: Array.from(tabData.features) });
    } else {
      sendResponse({ features: [] });
    }
    return;
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
  const filter = new DomainFilter(config);
  const featureWhitelist = featureConfig.whitelist || "";
  if (hostname && filter.isWhitelisted(hostname, featureWhitelist)) {
    debugLog("[Background] Domain", hostname, "is on whitelist/allowlist for", feature, "- skipping notification");
    return;
  }

  // Throttle notifications (max 1 per 3770ms per feature-hostname combo)
  const key = `${feature}-${hostname}`;
  const now = Date.now();
  const lastTime = lastNotificationTime[key] || 0;

  debugLog("[Background] Throttle check:", {
    key: key,
    timeSinceLastNotification: now - lastTime,
    throttleLimit: 3770
  });

  if (now - lastTime < 3770) {
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
      currentConfig = config;

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
      currentConfig = config;

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
  currentConfig = await loadConfig();
  return currentConfig;
}

debugLog("Stealth Guard background script loaded");
