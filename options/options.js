// Options Page Script

let currentConfig = null;
let saveTimeout = null;
const DEBOUNCE_DELAY = 1000; // 1 second debounce

// ========== AUTO-SAVE ==========

function autoSave() {
  // Clear any pending save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  // Debounce the save
  saveTimeout = setTimeout(() => {
    collectValues();
    saveConfig(false); // Don't refresh tabs on auto-save
  }, DEBOUNCE_DELAY);
}

function saveConfig(refreshTabs = false) {
  try {
    chrome.runtime.sendMessage({
      type: "update-config",
      config: currentConfig
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save config:", chrome.runtime.lastError);
        showToast("Failed to save settings", "error");
        return;
      }

      if (refreshTabs) {
        // Reload all tabs to apply changes
        chrome.tabs.query({}, (tabs) => {
          if (chrome.runtime.lastError) {
            console.error("Failed to query tabs:", chrome.runtime.lastError);
            showToast("Settings saved! Please reload pages manually to apply changes.", "success");
            return;
          }

          let reloadCount = 0;
          for (const tab of tabs) {
            if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
              chrome.tabs.reload(tab.id, {}, () => {
                if (!chrome.runtime.lastError) {
                  reloadCount++;
                }
              });
            }
          }

          // Show toast with reload count after a brief delay
          setTimeout(() => {
            if (reloadCount > 0) {
              showToast(`Settings saved! ${reloadCount} tab(s) refreshed.`, "success");
            } else {
              showToast("Settings saved!", "success");
            }
          }, 500);
        });
      } else {
        showToast("Settings saved", "success");
      }
    });

  } catch (e) {
    console.error("Failed to save config:", e);
    showToast("Failed to save settings", "error");
  }
}

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupEventListeners();

  // Check if there's a hash in the URL to scroll to
  if (window.location.hash) {
    const sectionId = window.location.hash.substring(1); // Remove the '#'
    // Delay scroll slightly to ensure page is fully rendered
    setTimeout(() => {
      scrollToSection(sectionId);
    }, 300);
  }
});

// Save on tab visibility change (user switches away)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentConfig) {
    // Clear debounce and save immediately
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    collectValues();
    saveConfig(false);
  }
});

// Save before page unload
window.addEventListener('beforeunload', () => {
  if (currentConfig) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    collectValues();
    // Use sendMessage synchronously before unload
    chrome.runtime.sendMessage({
      type: "update-config",
      config: currentConfig
    });
  }
});

// ========== SCROLL TO SECTION ==========

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Flash the section to draw attention
    section.style.transition = 'background 0.5s';
    section.style.background = '#e6f0ff';
    setTimeout(() => {
      section.style.background = '';
    }, 1000);
  }
}

// ========== LOAD CONFIG ==========

function loadConfig() {
  try {
    chrome.runtime.sendMessage({ type: "get-config" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError);
        showToast("Failed to load settings. Please reload the extension.", "error");
        return;
      }

      if (!response || !response.config) {
        console.error("Invalid config response:", response);
        // Retry once
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "get-config" }, (retryResponse) => {
            if (chrome.runtime.lastError) {
              console.error("Retry message error:", chrome.runtime.lastError);
              showToast("Failed to load settings. Please reload the extension.", "error");
              return;
            }

            if (!retryResponse || !retryResponse.config) {
              console.error("Invalid config after retry:", retryResponse);
              showToast("Failed to load settings. Please reload the extension.", "error");
              return;
            }

            currentConfig = retryResponse.config;
            populateFields();
          });
        }, 100);
      } else {
        currentConfig = response.config;
        populateFields();
      }
    });
  } catch (e) {
    console.error("Failed to load config:", e);
    showToast("Failed to load settings. Please reload the extension.", "error");
  }
}

// ========== POPULATE FIELDS ==========

function populateFields() {
  if (!currentConfig) return;

  // Global settings
  document.getElementById('global-whitelist').value = currentConfig.globalWhitelist || "";
  document.getElementById('notifications-enabled').checked = currentConfig.notifications.enabled;

  // Canvas
  document.getElementById('canvas-enabled').checked = currentConfig.canvas.enabled;
  document.getElementById('canvas-whitelist').value = currentConfig.canvas.whitelist || "";

  // WebGL
  document.getElementById('webgl-enabled').checked = currentConfig.webgl.enabled;
  document.getElementById('webgl-whitelist').value = currentConfig.webgl.whitelist || "";
  document.getElementById('webgl-preset').value = currentConfig.webgl.preset || "auto";

  // Font
  document.getElementById('font-enabled').checked = currentConfig.font.enabled;
  document.getElementById('font-whitelist').value = currentConfig.font.whitelist || "";

  // ClientRects
  document.getElementById('clientrects-enabled').checked = currentConfig.clientrects?.enabled ?? true;
  document.getElementById('clientrects-whitelist').value = currentConfig.clientrects?.whitelist || "";

  // WebGPU
  document.getElementById('webgpu-enabled').checked = currentConfig.webgpu?.enabled ?? true;
  document.getElementById('webgpu-whitelist').value = currentConfig.webgpu?.whitelist || "";

  // AudioContext
  document.getElementById('audiocontext-enabled').checked = currentConfig.audiocontext?.enabled ?? true;
  document.getElementById('audiocontext-whitelist').value = currentConfig.audiocontext?.whitelist || "";

  // Timezone
  document.getElementById('timezone-enabled').checked = currentConfig.timezone.enabled;
  document.getElementById('timezone-whitelist').value = currentConfig.timezone.whitelist || "";

  // Set timezone dropdown based on stored name and offset
  const timezoneValue = `${currentConfig.timezone.name}|${currentConfig.timezone.offset}`;
  const timezoneSelect = document.getElementById('timezone-select');

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

  // User-Agent
  document.getElementById('useragent-enabled').checked = currentConfig.useragent.enabled;
  document.getElementById('useragent-whitelist').value = currentConfig.useragent.whitelist || "";
  document.getElementById('useragent-preset').value = currentConfig.useragent.preset || "macos";
  updateUserAgentString();

  // WebRTC
  document.getElementById('webrtc-enabled').checked = currentConfig.webrtc.enabled;
  document.getElementById('webrtc-whitelist').value = currentConfig.webrtc.whitelist || "";
  document.getElementById('webrtc-policy').value = currentConfig.webrtc.policy;

  // Proxy
  document.getElementById('proxy-enabled').checked = currentConfig.proxy?.enabled || false;
  document.getElementById('proxy-bypass-list').value = (currentConfig.proxy?.bypassList || []).join(', ');
  populateProxyProfiles();

}

// ========== USER-AGENT PRESETS ==========

const USER_AGENT_PRESETS = {
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  macos_chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
};

function updateUserAgentString() {
  const preset = document.getElementById('useragent-preset').value;
  const uaString = USER_AGENT_PRESETS[preset] || "";
  document.getElementById('useragent-string').value = uaString;
}

// ========== PROXY MANAGEMENT ==========

function populateProxyProfiles() {
  const profiles = currentConfig.proxy?.profiles || [];
  const activeProfile = currentConfig.proxy?.activeProfile || null;

  // Update active profile dropdown
  const activeSelect = document.getElementById('proxy-active-profile');
  activeSelect.innerHTML = '<option value="">None (Direct)</option>';
  profiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.name;
    option.textContent = profile.name;
    if (profile.name === activeProfile) {
      option.selected = true;
    }
    activeSelect.appendChild(option);
  });

  // Update profiles list
  const profilesList = document.getElementById('proxy-profiles-list');
  profilesList.innerHTML = '';

  if (profiles.length === 0) {
    profilesList.innerHTML = '<p style="color: #666; font-style: italic; margin: 10px 0;">No proxy profiles configured</p>';
    return;
  }

  profiles.forEach(profile => {
    const profileCard = document.createElement('div');
    profileCard.style.cssText = 'background: #f5f5f5; padding: 10px; margin-bottom: 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;';

    const profileInfo = document.createElement('div');
    profileInfo.innerHTML = `
      <strong>${profile.name}</strong>
      <div style="font-size: 0.9em; color: #666;">
        ${profile.scheme.toUpperCase()} ${profile.host}:${profile.port}
        ${profile.location ? `<br><span style="font-size: 0.85em;">📍 ${profile.location.city}, ${profile.location.country}</span>` : ''}
      </div>
    `;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = 'display: flex; gap: 6px;';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.className = 'btn-secondary';
    editBtn.style.cssText = 'padding: 5px 10px; font-size: 0.9em;';
    editBtn.onclick = () => editProxyProfile(profile.name);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'btn-danger';
    removeBtn.style.cssText = 'padding: 5px 10px; font-size: 0.9em;';
    removeBtn.onclick = () => removeProxyProfile(profile.name);

    buttonsDiv.appendChild(editBtn);
    buttonsDiv.appendChild(removeBtn);

    profileCard.appendChild(profileInfo);
    profileCard.appendChild(buttonsDiv);
    profilesList.appendChild(profileCard);
  });
}

function removeProxyProfile(profileName) {
  if (!confirm(`Remove proxy profile "${profileName}"?`)) {
    return;
  }

  currentConfig.proxy.profiles = currentConfig.proxy.profiles.filter(p => p.name !== profileName);

  // If active profile was removed, disable it
  if (currentConfig.proxy.activeProfile === profileName) {
    currentConfig.proxy.activeProfile = null;
  }

  populateProxyProfiles();
  autoSave();
  showToast(`Profile "${profileName}" removed`, 'success');
}

function editProxyProfile(profileName) {
  const profile = currentConfig.proxy.profiles.find(p => p.name === profileName);
  if (!profile) return;

  // Populate the form with existing values
  document.getElementById('new-proxy-host').value = profile.host;
  document.getElementById('new-proxy-port').value = profile.port;
  document.getElementById('new-proxy-scheme').value = profile.scheme;
  document.getElementById('new-proxy-name').value = profile.name;
  document.getElementById('new-proxy-remote-dns').checked = profile.remoteDNS || false;

  // Remove the old profile
  currentConfig.proxy.profiles = currentConfig.proxy.profiles.filter(p => p.name !== profileName);

  // If this was the active profile, clear it temporarily
  if (currentConfig.proxy.activeProfile === profileName) {
    currentConfig.proxy._editingActiveProfile = profileName;
    currentConfig.proxy.activeProfile = null;
  }

  populateProxyProfiles();
  showToast(`Editing "${profileName}" - modify and click "Add Profile" to save`, 'success');

  // Scroll to the add profile form
  const addSection = document.querySelector('#proxy-section details');
  if (addSection) {
    addSection.open = true;
    addSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function addProxyProfileHandler() {
  const host = document.getElementById('new-proxy-host').value.trim();
  const port = parseInt(document.getElementById('new-proxy-port').value);
  const scheme = document.getElementById('new-proxy-scheme').value;
  const name = document.getElementById('new-proxy-name').value.trim();
  const remoteDNS = document.getElementById('new-proxy-remote-dns').checked;

  if (!host || !port) {
    showToast('Host and port are required', 'error');
    return;
  }

  if (port < 1 || port > 65535) {
    showToast('Invalid port number', 'error');
    return;
  }

  showToast('Fetching location info...', 'success');

  // Fetch location info
  let location = null;
  let profileName = name;

  if (!profileName) {
    try {
      const token = 'd202c49ff9c4b6';
      const response = await fetch(`https://ipinfo.io/${host}?token=${token}`);

      if (response.ok) {
        const data = await response.json();
        // org format from ipinfo.io: "AS12345 Company Name"
        const orgName = data.org ? data.org.replace(/^AS\d+\s*/, '') : '';
        location = {
          city: data.city || 'Unknown',
          region: data.region || '',
          country: data.country || 'Unknown',
          loc: data.loc || '',
          org: orgName,
          timezone: data.timezone || '',
          source: 'ipinfo.io'
        };

        const countryCode = location.country.length > 2 ? location.country.substring(0, 2).toUpperCase() : location.country;
        const orgPart = orgName ? ` (${orgName})` : '';
        profileName = `${location.city}, ${countryCode}${orgPart}`;
      } else {
        // Fallback to ipapi.co
        const response2 = await fetch(`https://ipapi.co/${host}/json/`);
        if (response2.ok) {
          const data = await response2.json();
          const orgName = data.org || '';
          location = {
            city: data.city || 'Unknown',
            region: data.region || '',
            country: data.country_name || 'Unknown',
            loc: `${data.latitude},${data.longitude}`,
            org: orgName,
            timezone: data.timezone || '',
            source: 'ipapi.co'
          };

          const countryCode = location.country.length > 2 ? location.country.substring(0, 2).toUpperCase() : location.country;
          const orgPart = orgName ? ` (${orgName})` : '';
          profileName = `${location.city}, ${countryCode}${orgPart}`;
        } else {
          profileName = `Proxy ${host}`;
        }
      }
    } catch (e) {
      console.error('Failed to fetch location:', e);
      profileName = `Proxy ${host}`;
    }
  }

  // Check for duplicate names
  const profiles = currentConfig.proxy?.profiles || [];
  let finalName = profileName;
  let counter = 1;
  while (profiles.some(p => p.name === finalName)) {
    finalName = `${profileName} (${counter})`;
    counter++;
  }

  // Add profile
  const profile = {
    name: finalName,
    host,
    port,
    scheme,
    remoteDNS,
    location
  };

  if (!currentConfig.proxy) {
    currentConfig.proxy = { enabled: false, activeProfile: null, profiles: [], domainRoutes: [], bypassList: [] };
  }
  currentConfig.proxy.profiles.push(profile);

  // Clear form
  document.getElementById('new-proxy-host').value = '';
  document.getElementById('new-proxy-port').value = '';
  document.getElementById('new-proxy-name').value = '';

  // Collapse the accordion
  const addSection = document.querySelector('#proxy-section details');
  if (addSection) {
    addSection.open = false;
  }

  populateProxyProfiles();
  autoSave();
  showToast(`Profile "${finalName}" added`, 'success');
}

// ========== COLLECT VALUES ==========

function collectValues() {
  // Global settings
  currentConfig.globalWhitelist = document.getElementById('global-whitelist').value;
  currentConfig.notifications.enabled = document.getElementById('notifications-enabled').checked;

  // Canvas
  currentConfig.canvas.enabled = document.getElementById('canvas-enabled').checked;
  currentConfig.canvas.whitelist = document.getElementById('canvas-whitelist').value;

  // WebGL
  currentConfig.webgl.enabled = document.getElementById('webgl-enabled').checked;
  currentConfig.webgl.whitelist = document.getElementById('webgl-whitelist').value;
  currentConfig.webgl.preset = document.getElementById('webgl-preset').value;

  // Font
  currentConfig.font.enabled = document.getElementById('font-enabled').checked;
  currentConfig.font.whitelist = document.getElementById('font-whitelist').value;

  // ClientRects
  if (!currentConfig.clientrects) {
    currentConfig.clientrects = { enabled: true, whitelist: "" };
  }
  currentConfig.clientrects.enabled = document.getElementById('clientrects-enabled').checked;
  currentConfig.clientrects.whitelist = document.getElementById('clientrects-whitelist').value;

  // WebGPU
  if (!currentConfig.webgpu) {
    currentConfig.webgpu = { enabled: true, whitelist: "" };
  }
  currentConfig.webgpu.enabled = document.getElementById('webgpu-enabled').checked;
  currentConfig.webgpu.whitelist = document.getElementById('webgpu-whitelist').value;

  // AudioContext
  if (!currentConfig.audiocontext) {
    currentConfig.audiocontext = { enabled: true, whitelist: "" };
  }
  currentConfig.audiocontext.enabled = document.getElementById('audiocontext-enabled').checked;
  currentConfig.audiocontext.whitelist = document.getElementById('audiocontext-whitelist').value;

  // Timezone
  currentConfig.timezone.enabled = document.getElementById('timezone-enabled').checked;
  currentConfig.timezone.whitelist = document.getElementById('timezone-whitelist').value;

  // Parse timezone dropdown value (format: "timezone-name|offset")
  const timezoneValue = document.getElementById('timezone-select').value;
  const [timezoneName, timezoneOffset] = timezoneValue.split('|');
  currentConfig.timezone.name = timezoneName;
  currentConfig.timezone.offset = parseInt(timezoneOffset);

  // User-Agent
  currentConfig.useragent.enabled = document.getElementById('useragent-enabled').checked;
  currentConfig.useragent.whitelist = document.getElementById('useragent-whitelist').value;
  currentConfig.useragent.preset = document.getElementById('useragent-preset').value;

  // WebRTC
  currentConfig.webrtc.enabled = document.getElementById('webrtc-enabled').checked;
  currentConfig.webrtc.whitelist = document.getElementById('webrtc-whitelist').value;
  currentConfig.webrtc.policy = document.getElementById('webrtc-policy').value;

  // Proxy
  if (!currentConfig.proxy) {
    currentConfig.proxy = { enabled: false, activeProfile: null, profiles: [], domainRoutes: [], bypassList: [] };
  }
  currentConfig.proxy.enabled = document.getElementById('proxy-enabled').checked;
  currentConfig.proxy.activeProfile = document.getElementById('proxy-active-profile').value || null;

  // Parse bypass list
  const bypassListValue = document.getElementById('proxy-bypass-list').value;
  currentConfig.proxy.bypassList = bypassListValue
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// ========== EVENT LISTENERS ==========

function setupEventListeners() {
  // Auto-save on any input change
  const inputs = document.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    input.addEventListener('change', autoSave);
    if (input.type === 'text' || input.tagName === 'TEXTAREA') {
      input.addEventListener('input', autoSave);
    }
  });

  // Save & Refresh All Tabs button
  document.getElementById('save-settings').addEventListener('click', () => {
    // Clear any pending auto-save
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    collectValues();
    saveConfig(true); // Refresh all tabs
  });

  // Reset button
  document.getElementById('reset-settings').addEventListener('click', () => {
    if (!confirm("Are you sure you want to reset all settings to defaults?")) {
      return;
    }

    try {
      // Send reset command to background
      chrome.runtime.sendMessage({ type: "reset-config" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Failed to reset config:", chrome.runtime.lastError);
          showToast("Failed to reset settings", "error");
          return;
        }

        // Reload config
        loadConfig();

        showToast("Settings reset to defaults", "success");
      });

    } catch (e) {
      console.error("Failed to reset config:", e);
      showToast("Failed to reset settings", "error");
    }
  });

  // User-Agent preset change
  document.getElementById('useragent-preset').addEventListener('change', updateUserAgentString);

  // Proxy event listeners
  document.getElementById('add-proxy-profile').addEventListener('click', addProxyProfileHandler);

  // Export/Import event listeners
  document.getElementById('export-config').addEventListener('click', exportConfig);
  document.getElementById('import-config').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importConfig(e.target.files[0]);
      e.target.value = ''; // Reset for future imports
    }
  });
}

// ========== TOAST NOTIFICATION ==========

function showToast(message, type = "success") {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ========== EXPORT / IMPORT ==========

function exportConfig() {
  if (!currentConfig) {
    showToast('No configuration to export', 'error');
    return;
  }

  collectValues();

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    config: currentConfig
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `stealth-guard-config-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Settings exported successfully', 'success');
}

function importConfig(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.config) {
        showToast('Invalid config file: missing config data', 'error');
        return;
      }

      currentConfig = data.config;
      populateFields();
      saveConfig(false);
      showToast('Settings imported successfully', 'success');
    } catch (err) {
      console.error('Failed to parse config file:', err);
      showToast('Failed to parse config file', 'error');
    }
  };

  reader.onerror = () => {
    showToast('Failed to read file', 'error');
  };

  reader.readAsText(file);
}
