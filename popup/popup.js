// Popup Script - Handles UI interactions and config updates

let currentConfig = null;
let currentTab = null;
let currentSessionHostname = "";
let currentSessions = [];
let activeSessionId = null;
let pendingReloadTimeout = null;
let listenersInitialized = false;
const POPUP_RELOAD_DEBOUNCE_MS = 250;

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadCurrentTab();
});

// ========== LOAD CONFIG ==========

function loadConfig() {
  try {
    // Use callback-based API for MV2 compatibility
    chrome.runtime.sendMessage({ type: "get-config" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError);
        document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load settings. Please reload the extension.</div>';
        return;
      }

      if (!response || !response.config) {
        console.error("Invalid config response:", response);
        // Retry once
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "get-config" }, (retryResponse) => {
            if (chrome.runtime.lastError) {
              console.error("Retry message error:", chrome.runtime.lastError);
              document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load settings. Please reload the extension.</div>';
              return;
            }

            if (!retryResponse || !retryResponse.config) {
              console.error("Invalid config after retry:", retryResponse);
              document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load settings. Please reload the extension.</div>';
              return;
            }

            currentConfig = retryResponse.config;
            updateUI();
            if (!listenersInitialized) {
              setupEventListeners();
              listenersInitialized = true;
            }
          });
        }, 100);
      } else {
        currentConfig = response.config;
        updateUI();
        if (!listenersInitialized) {
          setupEventListeners();
          listenersInitialized = true;
        }
      }
    });
  } catch (e) {
    console.error("Failed to load config:", e);
    document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load settings. Please reload the extension.</div>';
  }
}

// ========== LOAD CURRENT TAB ==========

function loadCurrentTab() {
  try {
    // MV2 uses callback-based API
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to query tabs:", chrome.runtime.lastError);
        return;
      }
      if (tabs && tabs.length > 0) {
        currentTab = tabs[0];
        currentSessionHostname = getTabHostname(currentTab);
        updateCurrentSite();
        updateTriggeredFeatures();
        updateAllowlistHighlighting();
        refreshSessionList();
      }
    });
  } catch (e) {
    console.error("Failed to load current tab:", e);
  }
}

// ========== UPDATE TRIGGERED FEATURES HIGHLIGHTING ==========

function updateTriggeredFeatures() {
  if (!currentTab || !currentTab.id) return;

  chrome.runtime.sendMessage({
    type: "get-triggered-features",
    tabId: currentTab.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to get triggered features:", chrome.runtime.lastError);
      return;
    }

    if (!response || !response.features) return;

    const triggeredFeatures = response.features;
    const featureRows = document.querySelectorAll('.feature-row');

    // Clear all triggered classes first
    featureRows.forEach(row => row.classList.remove('triggered'));

    // Map feature names to row indices
    const featureToIndex = {
      'proxy': 0,
      'useragent': 1,
      'user-agent': 1,
      'timezone': 2,
      'webrtc': 3,
      'canvas': 4,
      'clientrects': 5,
      'font': 6,
      'audiocontext': 7,
      'webgl': 8,
      'webgpu': 9
    };

    triggeredFeatures.forEach(feature => {
      const index = featureToIndex[feature.toLowerCase()];
      if (index !== undefined && featureRows[index]) {
        featureRows[index].classList.add('triggered');
      }
    });
  });
}

// ========== UPDATE FEATURE ROWS STATE ==========

function updateFeatureRowsState(enabled) {
  const featureRows = document.querySelectorAll('.feature-row');
  featureRows.forEach(row => {
    if (enabled) {
      row.classList.remove('disabled');
    } else {
      row.classList.add('disabled');
    }
  });
}

// ========== UPDATE UI ==========

function updateUI() {
  if (!currentConfig) return;

  // Ensure enabled field exists (for old configs)
  if (typeof currentConfig.enabled === 'undefined') {
    currentConfig.enabled = true;
  }

  // Global toggle
  document.getElementById('global-enabled').checked = currentConfig.enabled;

  // Update feature rows disabled state
  updateFeatureRowsState(currentConfig.enabled);

  // Feature toggles
  document.getElementById('canvas-enabled').checked = currentConfig.canvas.enabled;
  document.getElementById('webgl-enabled').checked = currentConfig.webgl.enabled;
  document.getElementById('font-enabled').checked = currentConfig.font.enabled;
  document.getElementById('clientrects-enabled').checked = currentConfig.clientrects?.enabled ?? true;
  document.getElementById('webgpu-enabled').checked = currentConfig.webgpu?.enabled ?? true;
  document.getElementById('audiocontext-enabled').checked = currentConfig.audiocontext?.enabled ?? true;
  document.getElementById('timezone-enabled').checked = currentConfig.timezone.enabled;
  document.getElementById('useragent-enabled').checked = currentConfig.useragent.enabled;
  document.getElementById('webrtc-enabled').checked = currentConfig.webrtc.enabled;
  document.getElementById('notifications-enabled').checked = currentConfig.notifications.enabled;

  // Proxy toggle and info
  if (currentConfig.proxy) {
    document.getElementById('proxy-enabled').checked = currentConfig.proxy.enabled || false;
    updateProxyInfo();
  }

  // WebGL preset selector
  const webglPreset = currentConfig.webgl.preset || "auto";
  const webglSelect = document.getElementById('webgl-quick-select');
  if (webglSelect) {
    let found = false;
    for (let i = 0; i < webglSelect.options.length; i++) {
      if (webglSelect.options[i].value === webglPreset) {
        webglSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) {
      webglSelect.selectedIndex = 0;
    }
  }

  // Timezone selector
  const timezoneValue = `${currentConfig.timezone.name}|${currentConfig.timezone.offset}`;
  const timezoneSelect = document.getElementById('timezone-quick-select');
  if (timezoneSelect) {
    // Try to find exact match
    let found = false;
    for (let i = 0; i < timezoneSelect.options.length; i++) {
      if (timezoneSelect.options[i].value === timezoneValue) {
        timezoneSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    // If not found, default to first option
    if (!found) {
      timezoneSelect.selectedIndex = 0;
    }
  }

  // User-Agent selector
  const useragentPreset = currentConfig.useragent.preset || "macos";
  const useragentSelect = document.getElementById('useragent-quick-select');
  if (useragentSelect) {
    // Try to find exact match
    let found = false;
    for (let i = 0; i < useragentSelect.options.length; i++) {
      if (useragentSelect.options[i].value === useragentPreset) {
        useragentSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    // If not found, default to first option
    if (!found) {
      useragentSelect.selectedIndex = 0;
    }
  }

  // Update allowlist highlighting for current site
  updateAllowlistHighlighting();
}

function updateProxyInfo() {
  const proxyStatus = document.getElementById('proxy-status');
  if (!proxyStatus || !currentConfig || !currentConfig.proxy) return;

  const proxy = currentConfig.proxy;

  if (!proxy.enabled) {
    proxyStatus.textContent = 'No proxy';
    proxyStatus.style.color = '#666';
    return;
  }

  const profiles = proxy.profiles || [];
  const routes = proxy.domainRoutes || [];
  const activeProfile = proxy.activeProfile;

  if (routes.length > 0) {
    proxyStatus.textContent = `${routes.length} route(s)`;
    proxyStatus.style.color = '#667eea';
  } else if (activeProfile && profiles.find(p => p.name === activeProfile)) {
    const profile = profiles.find(p => p.name === activeProfile);
    proxyStatus.textContent = profile.name;
    proxyStatus.style.color = '#667eea';
  } else if (profiles.length > 0) {
    proxyStatus.textContent = `${profiles.length} profile(s)`;
    proxyStatus.style.color = '#999';
  } else {
    proxyStatus.textContent = 'Not configured';
    proxyStatus.style.color = '#f59e0b';
  }
}

function updateCurrentSite() {
  const urlElement = document.getElementById('current-url');
  const buttonElement = document.getElementById('toggle-current-site');

  if (!urlElement || !buttonElement) {
    // Current popup layout does not always include current-site controls.
    // Treat these controls as optional and skip this section when absent.
    return;
  }

  if (!currentTab || !currentTab.url) {
    urlElement.textContent = "N/A";
    buttonElement.disabled = true;
    return;
  }

  try {
    const url = new URL(currentTab.url);
    const hostname = url.hostname;

    urlElement.textContent = hostname;

    // Check if hostname is in whitelist/allowlist (only if config is loaded)
    if (currentConfig) {
      const isWhitelisted = isDomainInWhitelist(hostname, currentConfig.globalWhitelist);

      if (isWhitelisted) {
        buttonElement.textContent = "Remove from Allowlist";
        buttonElement.style.background = "#f44336";
      } else {
        buttonElement.textContent = "Add to Allowlist";
        buttonElement.style.background = "#667eea";
      }
      buttonElement.disabled = false;
    } else {
      buttonElement.disabled = true;
    }

    // Update allowlist highlighting for this hostname
    updateAllowlistHighlighting();

  } catch (e) {
    urlElement.textContent = "Invalid URL";
    buttonElement.disabled = true;
  }
}

function getTabHostname(tab) {
  if (!tab || !tab.url) {
    return "";
  }

  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSessionTime(timestamp) {
  if (!timestamp) {
    return "Never";
  }

  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return "Unknown";
  }
}

function setSessionStatus(message, type = "") {
  const statusElement = document.getElementById("session-status");
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message || "";
  statusElement.classList.remove("error", "success");

  if (type === "error" || type === "success") {
    statusElement.classList.add(type);
  }
}

function updateSessionDomainLabel() {
  const domainElement = document.getElementById("session-domain");
  if (!domainElement) {
    return;
  }

  domainElement.textContent = currentSessionHostname || "No active site";
}

function renderSessionList() {
  const listElement = document.getElementById("session-list");
  if (!listElement) {
    return;
  }

  if (!currentSessionHostname) {
    listElement.innerHTML = '<div class="session-list-empty">Open an HTTP(S) site to manage sessions.</div>';
    return;
  }

  if (!currentSessions || currentSessions.length === 0) {
    listElement.innerHTML = '<div class="session-list-empty">No saved sessions for this site.</div>';
    return;
  }

  listElement.innerHTML = currentSessions.map((session) => {
    const isActive = session.id === activeSessionId;
    const switchLabel = isActive ? "Re-Switch" : "Switch";
    return `
      <div class="session-entry ${isActive ? "active" : ""}">
        <div class="session-entry-header">
          <div class="session-entry-name">${escapeHtml(session.name || "Unnamed Session")}</div>
        </div>
        <div class="session-entry-meta">Last used: ${escapeHtml(formatSessionTime(session.lastUsed))}</div>
        <div class="session-entry-actions">
          <button class="session-action-btn switch" data-action="switch" data-session-id="${escapeHtml(session.id)}">
            <span class="btn-icon-inline" aria-hidden="true">🔄</span>
            <span>${switchLabel}</span>
          </button>
          <button class="session-action-btn" data-action="rename" data-session-id="${escapeHtml(session.id)}">
            <span class="btn-icon-inline" aria-hidden="true">✏️</span>
            <span>Rename</span>
          </button>
          <button class="session-action-btn" data-action="delete" data-session-id="${escapeHtml(session.id)}">
            <span class="btn-icon-inline" aria-hidden="true">🗑️</span>
            <span>Delete</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function refreshSessionList() {
  currentSessionHostname = getTabHostname(currentTab);
  updateSessionDomainLabel();

  if (!currentSessionHostname) {
    currentSessions = [];
    activeSessionId = null;
    renderSessionList();
    return;
  }

  chrome.runtime.sendMessage({
    type: "get-sessions",
    hostname: currentSessionHostname
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to load sessions:", chrome.runtime.lastError);
      setSessionStatus("Failed to load sessions.", "error");
      return;
    }

    if (!response || response.success === false) {
      const message = response && response.error ? response.error : "Failed to load sessions.";
      setSessionStatus(message, "error");
      return;
    }

    currentSessions = Array.isArray(response.sessions) ? response.sessions : [];
    activeSessionId = response.activeSessionId || null;
    renderSessionList();
  });
}

// ========== HELPER: CHECK IF DOMAIN IN WHITELIST/ALLOWLIST ==========

// Use DomainFilter from lib/domainFilter.js (loaded via script tag in popup.html)
function isDomainInWhitelist(domain, whitelistString) {
  if (!whitelistString || !domain) return false;
  const filter = new DomainFilter({});
  return filter.isWhitelisted(domain, whitelistString);
}

// ========== HELPER: UPDATE ALLOWLIST HIGHLIGHTING ==========

function updateAllowlistHighlighting() {
  // Clear all allowlist classes first
  const featureRows = document.querySelectorAll('.feature-row');
  featureRows.forEach(row => {
    row.classList.remove('allowlisted-feature', 'allowlisted-global');
  });

  // Check if we have current tab and config
  if (!currentTab || !currentTab.url || !currentConfig) {
    return;
  }

  try {
    const url = new URL(currentTab.url);
    const hostname = url.hostname;

    // Check global allowlist
    const isGloballyAllowlisted = isDomainInWhitelist(hostname, currentConfig.globalWhitelist);

    if (isGloballyAllowlisted) {
      // All feature rows get global allowlist styling (yellow with reduced opacity)
      featureRows.forEach(row => {
        row.classList.add('allowlisted-global');
      });
      return; // Global takes precedence, no need to check individual features
    }

    // Check each feature's allowlist
    const featureConfigs = [
      { index: 0, config: currentConfig.proxy },
      { index: 1, config: currentConfig.useragent },
      { index: 2, config: currentConfig.timezone },
      { index: 3, config: currentConfig.webrtc },
      { index: 4, config: currentConfig.canvas },
      { index: 5, config: currentConfig.clientrects },
      { index: 6, config: currentConfig.font },
      { index: 7, config: currentConfig.audiocontext },
      { index: 8, config: currentConfig.webgl },
      { index: 9, config: currentConfig.webgpu }
    ];

    featureConfigs.forEach(({ index, config }) => {
      if (!config) return;

      let isFeatureAllowlisted = false;

      // Proxy uses bypassList (array) instead of whitelist (string)
      if (index === 0 && config.bypassList !== undefined) {
        // Convert array to comma-separated string for bypassList
        const bypassListString = Array.isArray(config.bypassList)
          ? config.bypassList.join(", ")
          : config.bypassList;
        isFeatureAllowlisted = isDomainInWhitelist(hostname, bypassListString);
      } else if (config.whitelist) {
        isFeatureAllowlisted = isDomainInWhitelist(hostname, config.whitelist);
      }

      if (isFeatureAllowlisted) {
        featureRows[index].classList.add('allowlisted-feature');
      }
    });

  } catch (e) {
    console.error("Failed to update allowlist highlighting:", e);
  }
}

// ========== EVENT LISTENERS ==========

function setupEventListeners() {
  // Check if config is loaded
  if (!currentConfig) {
    console.error("Cannot setup event listeners: config not loaded");
    return;
  }

  // Helper to safely add event listener
  const addListener = (id, handler) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('change', handler);
    } else {
      console.error(`Element not found: ${id}`);
    }
  };

  // Global toggle
  addListener('global-enabled', (e) => {
    currentConfig.enabled = e.target.checked;
    updateFeatureRowsState(e.target.checked);
    saveConfig();
  });

  // Feature toggles
  addListener('canvas-enabled', (e) => {
    currentConfig.canvas.enabled = e.target.checked;
    saveConfig();
  });

  addListener('webgl-enabled', (e) => {
    currentConfig.webgl.enabled = e.target.checked;
    saveConfig();
  });

  // WebGL preset selector
  const webglSelect = document.getElementById('webgl-quick-select');
  if (webglSelect) {
    webglSelect.addEventListener('change', (e) => {
      currentConfig.webgl.preset = e.target.value;
      saveConfig();
    });
  }

  addListener('font-enabled', (e) => {
    currentConfig.font.enabled = e.target.checked;
    saveConfig();
  });

  addListener('clientrects-enabled', (e) => {
    if (!currentConfig.clientrects) {
      currentConfig.clientrects = { enabled: true, whitelist: "" };
    }
    currentConfig.clientrects.enabled = e.target.checked;
    saveConfig();
  });

  addListener('webgpu-enabled', (e) => {
    if (!currentConfig.webgpu) {
      currentConfig.webgpu = { enabled: true, whitelist: "" };
    }
    currentConfig.webgpu.enabled = e.target.checked;
    saveConfig();
  });

  addListener('audiocontext-enabled', (e) => {
    if (!currentConfig.audiocontext) {
      currentConfig.audiocontext = { enabled: true, whitelist: "" };
    }
    currentConfig.audiocontext.enabled = e.target.checked;
    saveConfig();
  });

  addListener('timezone-enabled', (e) => {
    currentConfig.timezone.enabled = e.target.checked;
    saveConfig();
  });

  addListener('useragent-enabled', (e) => {
    currentConfig.useragent.enabled = e.target.checked;
    saveConfig();
  });

  addListener('webrtc-enabled', (e) => {
    currentConfig.webrtc.enabled = e.target.checked;
    saveConfig();
  });

  addListener('proxy-enabled', (e) => {
    if (!currentConfig.proxy) {
      currentConfig.proxy = { enabled: false, activeProfile: null, profiles: [], domainRoutes: [], bypassList: [] };
    }
    currentConfig.proxy.enabled = e.target.checked;
    saveConfig();
    updateProxyInfo();
  });

  addListener('notifications-enabled', (e) => {
    currentConfig.notifications.enabled = e.target.checked;
    saveConfig();
  });

  // Timezone quick selector
  const timezoneSelect = document.getElementById('timezone-quick-select');
  if (timezoneSelect) {
    timezoneSelect.addEventListener('change', (e) => {
      // Parse timezone dropdown value (format: "timezone-name|offset")
      const timezoneValue = e.target.value;
      const [timezoneName, timezoneOffset] = timezoneValue.split('|');
      currentConfig.timezone.name = timezoneName;
      currentConfig.timezone.offset = parseInt(timezoneOffset);
      saveConfig();
    });
  }

  // User-Agent quick selector
  const useragentSelect = document.getElementById('useragent-quick-select');
  if (useragentSelect) {
    useragentSelect.addEventListener('change', (e) => {
      currentConfig.useragent.preset = e.target.value;
      saveConfig();
    });
  }

  // Toggle current site allowlist
  const toggleButton = document.getElementById('toggle-current-site');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      if (!currentTab || !currentTab.url) return;

      try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;

        const isWhitelisted = isDomainInWhitelist(hostname, currentConfig.globalWhitelist);

        if (isWhitelisted) {
          // Remove from whitelist/allowlist
          chrome.runtime.sendMessage({
            type: "remove-from-whitelist",
            domain: hostname
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Failed to remove from allowlist:", chrome.runtime.lastError);
              return;
            }
            // Reload config and update UI
            loadConfig();
            updateCurrentSite();
            // Reload the current tab to apply changes
            chrome.tabs.reload(currentTab.id);
          });
        } else {
          // Add to whitelist/allowlist
          chrome.runtime.sendMessage({
            type: "add-to-whitelist",
            domain: hostname
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Failed to add to allowlist:", chrome.runtime.lastError);
              return;
            }
            // Reload config and update UI
            loadConfig();
            updateCurrentSite();
            // Reload the current tab to apply changes
            chrome.tabs.reload(currentTab.id);
          });
        }

      } catch (e) {
        console.error("Failed to toggle allowlist:", e);
      }
    });
  }

  // Make feature rows clickable to open settings at section
  const featureRows = document.querySelectorAll('.feature-row');
  featureRows.forEach((row, index) => {
    row.addEventListener('click', (e) => {
      // Don't open settings if clicking on toggle or select
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
          e.target.classList.contains('slider') || e.target.classList.contains('switch')) {
        return;
      }

      // Map feature rows to section IDs (must match HTML order)
      const sectionIds = [
        'proxy-section',          // 0. Proxy
        'useragent-section',      // 1. User-Agent
        'timezone-section',       // 2. Timezone
        'webrtc-section',         // 3. WebRTC
        'canvas-section',         // 4. Canvas
        'clientrects-section',    // 5. ClientRects
        'font-section',           // 6. Font
        'audiocontext-section',   // 7. AudioContext
        'webgl-section',          // 8. WebGL
        'webgpu-section'          // 9. WebGPU
      ];

      const sectionId = sectionIds[index];
      if (sectionId) {
        // Open options page with hash to scroll to section
        chrome.tabs.create({
          url: chrome.runtime.getURL('options/options.html#' + sectionId)
        });
      }
    });
  });

  // Open options page
  const openOptionsButton = document.getElementById('open-options');
  if (openOptionsButton) {
    openOptionsButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }


  // Test WebRTC/DNS leak
  const testWebrtcButton = document.getElementById('test-webrtc');
  if (testWebrtcButton) {
    testWebrtcButton.addEventListener('click', () => {
      chrome.tabs.create({ url: "https://dnscheck.tools/" });
    });
  }

  const saveSessionButton = document.getElementById("save-session");
  if (saveSessionButton) {
    saveSessionButton.addEventListener("click", () => {
      if (!currentTab || typeof currentTab.id !== "number" || !currentSessionHostname) {
        setSessionStatus("Open an HTTP(S) tab first.", "error");
        return;
      }

      const nameInput = document.getElementById("session-name-input");
      const sessionName = nameInput ? nameInput.value : "";
      setSessionStatus("Saving session...");

      chrome.runtime.sendMessage({
        type: "save-session",
        hostname: currentSessionHostname,
        tabId: currentTab.id,
        name: sessionName
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Failed to save session:", chrome.runtime.lastError);
          setSessionStatus("Failed to save session.", "error");
          return;
        }

        if (!response || response.success === false) {
          setSessionStatus((response && response.error) || "Failed to save session.", "error");
          return;
        }

        if (nameInput) {
          nameInput.value = "";
        }

        setSessionStatus("Session saved.", "success");
        refreshSessionList();
      });
    });
  }

  const clearSessionButton = document.getElementById("clear-current-session");
  if (clearSessionButton) {
    clearSessionButton.addEventListener("click", () => {
      if (!currentTab || typeof currentTab.id !== "number" || !currentSessionHostname) {
        setSessionStatus("Open an HTTP(S) tab first.", "error");
        return;
      }

      if (!confirm("Clear cookies and storage for this site in the current tab?")) {
        return;
      }

      setSessionStatus("Clearing current session...");
      chrome.runtime.sendMessage({
        type: "clear-current-session",
        hostname: currentSessionHostname,
        tabId: currentTab.id
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Failed to clear current session:", chrome.runtime.lastError);
          setSessionStatus("Failed to clear current session.", "error");
          return;
        }

        if (!response || response.success === false) {
          setSessionStatus((response && response.error) || "Failed to clear current session.", "error");
          return;
        }

        setSessionStatus("Current session cleared.", "success");
        refreshSessionList();
      });
    });
  }

  const sessionListElement = document.getElementById("session-list");
  if (sessionListElement) {
    sessionListElement.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const action = button.getAttribute("data-action");
      const sessionId = button.getAttribute("data-session-id");
      if (!action || !sessionId) {
        return;
      }

      if (action === "switch") {
        if (!currentTab || typeof currentTab.id !== "number") {
          setSessionStatus("No active tab found.", "error");
          return;
        }

        setSessionStatus("Switching session...");
        chrome.runtime.sendMessage({
          type: "switch-session",
          sessionId,
          tabId: currentTab.id
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Failed to switch session:", chrome.runtime.lastError);
            setSessionStatus("Failed to switch session.", "error");
            return;
          }

          if (!response || response.success === false) {
            setSessionStatus((response && response.error) || "Failed to switch session.", "error");
            return;
          }

          setSessionStatus("Session switched.", "success");
          refreshSessionList();
        });
        return;
      }

      if (action === "delete") {
        if (!confirm("Delete this saved session?")) {
          return;
        }

        chrome.runtime.sendMessage({
          type: "delete-session",
          sessionId
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Failed to delete session:", chrome.runtime.lastError);
            setSessionStatus("Failed to delete session.", "error");
            return;
          }

          if (!response || response.success === false) {
            setSessionStatus((response && response.error) || "Failed to delete session.", "error");
            return;
          }

          setSessionStatus("Session deleted.", "success");
          refreshSessionList();
        });
        return;
      }

      if (action === "rename") {
        const targetSession = currentSessions.find((session) => session.id === sessionId);
        const renamed = prompt("Session name", targetSession && targetSession.name ? targetSession.name : "");
        if (renamed === null) {
          return;
        }

        chrome.runtime.sendMessage({
          type: "rename-session",
          sessionId,
          name: renamed
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Failed to rename session:", chrome.runtime.lastError);
            setSessionStatus("Failed to rename session.", "error");
            return;
          }

          if (!response || response.success === false) {
            setSessionStatus((response && response.error) || "Failed to rename session.", "error");
            return;
          }

          setSessionStatus("Session renamed.", "success");
          refreshSessionList();
        });
      }
    });
  }

}

// ========== SAVE CONFIG ==========

function scheduleCurrentTabReload() {
  if (!currentTab || !currentTab.id) {
    return;
  }

  if (pendingReloadTimeout) {
    clearTimeout(pendingReloadTimeout);
  }

  pendingReloadTimeout = setTimeout(() => {
    pendingReloadTimeout = null;
    chrome.tabs.reload(currentTab.id);
  }, POPUP_RELOAD_DEBOUNCE_MS);
}

function saveConfig() {
  try {
    chrome.runtime.sendMessage({
      type: "update-config",
      config: currentConfig
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save config:", chrome.runtime.lastError);
        return;
      }

      // Reload current tab to apply changes (debounced for rapid toggle bursts)
      scheduleCurrentTabReload();
    });

  } catch (e) {
    console.error("Failed to save config:", e);
  }
}
