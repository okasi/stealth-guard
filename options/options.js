let currentConfig = null;
let saveTimeout = null;
let lastSavedSnapshot = null;
let saveInFlightSnapshot = null;
let editingProxyProfileName = null;

const AUTO_SAVE_DELAY_MS = 1000;
const MAX_CONFIG_FILE_SIZE = 1024 * 1024;

document.addEventListener("DOMContentLoaded", initializeOptions);
document.addEventListener("visibilitychange", saveWhenHidden);

async function initializeOptions() {
  try {
    await loadOptionsConfig();
    setupEventListeners();
    if (window.location.hash) {
      setTimeout(() => scrollToSection(window.location.hash.slice(1)), 300);
    }
  } catch (error) {
    console.error("Failed to initialize options:", error);
    showToast(
      "Failed to load settings. Reload the extension and try again.",
      "error",
    );
  }
}

function serializeConfig(config) {
  try {
    return JSON.stringify(config);
  } catch (error) {
    return null;
  }
}

async function loadOptionsConfig() {
  currentConfig = await loadRuntimeConfig();
  lastSavedSnapshot = serializeConfig(currentConfig);
  saveInFlightSnapshot = null;
  populateForm();
}

function populateForm() {
  document.getElementById("global-whitelist").value =
    currentConfig.globalWhitelist;
  document.getElementById("notifications-enabled").checked =
    currentConfig.notifications.enabled;

  for (const featureName of PROTECTION_FEATURES) {
    document.getElementById(`${featureName}-enabled`).checked =
      currentConfig[featureName].enabled;
    document.getElementById(`${featureName}-whitelist`).value =
      currentConfig[featureName].whitelist;
  }

  document.getElementById("webgl-preset").value = currentConfig.webgl.preset;
  document.getElementById("timezone-select").value =
    `${currentConfig.timezone.name}|${currentConfig.timezone.offset}`;
  document.getElementById("useragent-preset").value =
    currentConfig.useragent.preset;
  document.getElementById("webrtc-policy").value = currentConfig.webrtc.policy;
  document.getElementById("proxy-enabled").checked =
    currentConfig.proxy.enabled;
  document.getElementById("proxy-bypass-list").value =
    currentConfig.proxy.bypassList.join(", ");

  updateUserAgentString();
  populateProxyProfiles();
}

function collectForm(options = {}) {
  const showErrors = options.showErrors !== false;
  if (!currentConfig) {
    return false;
  }

  currentConfig.globalWhitelist =
    document.getElementById("global-whitelist").value;
  currentConfig.notifications.enabled = document.getElementById(
    "notifications-enabled",
  ).checked;

  for (const featureName of PROTECTION_FEATURES) {
    currentConfig[featureName].enabled = document.getElementById(
      `${featureName}-enabled`,
    ).checked;
    currentConfig[featureName].whitelist = document.getElementById(
      `${featureName}-whitelist`,
    ).value;
  }

  currentConfig.webgl.preset = document.getElementById("webgl-preset").value;
  const [timezoneName, timezoneOffset] = document
    .getElementById("timezone-select")
    .value.split("|");
  currentConfig.timezone.name = timezoneName;
  currentConfig.timezone.offset = Number.parseInt(timezoneOffset, 10);
  currentConfig.useragent.preset =
    document.getElementById("useragent-preset").value;
  currentConfig.webrtc.policy = document.getElementById("webrtc-policy").value;

  currentConfig.proxy.enabled =
    document.getElementById("proxy-enabled").checked;
  currentConfig.proxy.activeProfile =
    document.getElementById("proxy-active-profile").value || null;
  currentConfig.proxy.bypassList = document
    .getElementById("proxy-bypass-list")
    .value.split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  if (
    currentConfig.proxy.enabled &&
    !currentConfig.proxy.activeProfile &&
    currentConfig.proxy.domainRoutes.length === 0
  ) {
    if (showErrors) {
      showToast(
        "Select an active proxy profile before enabling the proxy.",
        "error",
      );
    }
    return false;
  }

  return true;
}

function scheduleAutoSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (collectForm()) {
      await saveOptionsConfig();
    }
  }, AUTO_SAVE_DELAY_MS);
}

async function saveOptionsConfig(refreshTabs = false) {
  const snapshot = serializeConfig(currentConfig);
  if (!snapshot) {
    showToast("Failed to serialize settings.", "error");
    return false;
  }

  if (snapshot === lastSavedSnapshot || snapshot === saveInFlightSnapshot) {
    if (refreshTabs) {
      await refreshAllHttpTabs();
    }
    return true;
  }

  saveInFlightSnapshot = snapshot;
  try {
    const response = await sendRuntimeMessage({
      type: "update-config",
      config: currentConfig,
    });
    assertSuccessfulResponse(response, "Failed to save settings");
    lastSavedSnapshot = snapshot;
    if (refreshTabs) {
      await refreshAllHttpTabs();
    } else {
      showToast("Settings saved", "success");
    }
    return true;
  } catch (error) {
    console.error("Failed to save settings:", error);
    showToast(error.message, "error");
    await loadOptionsConfig();
    return false;
  } finally {
    if (saveInFlightSnapshot === snapshot) {
      saveInFlightSnapshot = null;
    }
  }
}

async function saveWhenHidden() {
  if (document.visibilityState !== "hidden" || !currentConfig) {
    return;
  }
  clearTimeout(saveTimeout);
  saveTimeout = null;
  if (collectForm({ showErrors: false })) {
    await saveOptionsConfig();
  }
}

function assertSuccessfulResponse(response, fallbackMessage) {
  if (!response || response.success === false) {
    throw new Error((response && response.error) || fallbackMessage);
  }
  return response;
}

function queryTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, {}, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

async function refreshAllHttpTabs() {
  try {
    const tabs = await queryTabs();
    const reloads = tabs
      .filter(
        (tab) => typeof tab.id === "number" && /^https?:/.test(tab.url || ""),
      )
      .map((tab) => reloadTab(tab.id));
    const results = await Promise.all(reloads);
    const reloadCount = results.filter(Boolean).length;
    showToast(
      reloadCount
        ? `Settings saved. ${reloadCount} tab(s) refreshed.`
        : "Settings saved.",
      "success",
    );
  } catch (error) {
    console.error("Failed to refresh tabs:", error);
    showToast("Settings saved. Reload open pages manually.", "success");
  }
}

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.classList.add("highlight");
  setTimeout(() => section.classList.remove("highlight"), 1000);
}

function updateUserAgentString() {
  const preset = document.getElementById("useragent-preset").value;
  document.getElementById("useragent-string").value =
    USER_AGENT_STRINGS[preset] || "";
}

function populateProxyProfiles() {
  const profiles = currentConfig.proxy.profiles;
  const activeSelect = document.getElementById("proxy-active-profile");
  activeSelect.replaceChildren(new Option("None (Direct)", ""));

  for (const profile of profiles) {
    const option = new Option(
      profile.name,
      profile.name,
      false,
      profile.name === currentConfig.proxy.activeProfile,
    );
    activeSelect.appendChild(option);
  }

  const list = document.getElementById("proxy-profiles-list");
  list.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No proxy profiles configured";
    list.appendChild(empty);
    return;
  }

  for (const profile of profiles) {
    const card = document.createElement("div");
    card.className = "proxy-profile-card";

    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const details = document.createElement("div");
    details.className = "proxy-profile-details";
    details.textContent = `${profile.scheme.toUpperCase()} ${profile.host}:${profile.port}`;
    if (profile.location) {
      const location = document.createElement("div");
      location.className = "proxy-profile-location";
      location.textContent = `${profile.location.city || "Unknown"}, ${profile.location.country || "Unknown"}`;
      details.appendChild(location);
    }
    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "proxy-profile-actions";
    actions.append(
      createProfileButton("Edit", "btn-secondary", () =>
        editProxyProfile(profile.name),
      ),
      createProfileButton("Remove", "btn-danger", () =>
        removeProxyProfile(profile.name),
      ),
    );
    card.append(info, actions);
    list.appendChild(card);
  }
}

function createProfileButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `${className} btn-compact`;
  button.addEventListener("click", handler);
  return button;
}

function editProxyProfile(profileName) {
  const profile = currentConfig.proxy.profiles.find(
    (entry) => entry.name === profileName,
  );
  if (!profile) {
    return;
  }

  editingProxyProfileName = profileName;
  document.getElementById("new-proxy-host").value = profile.host;
  document.getElementById("new-proxy-port").value = profile.port;
  document.getElementById("new-proxy-scheme").value = profile.scheme;
  document.getElementById("new-proxy-name").value = profile.name;
  document.getElementById("add-proxy-profile").textContent = "Save Profile";

  const editor = document.querySelector("#proxy-section details");
  editor.open = true;
  editor.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetProxyEditor() {
  editingProxyProfileName = null;
  document.getElementById("new-proxy-host").value = "";
  document.getElementById("new-proxy-port").value = "";
  document.getElementById("new-proxy-name").value = "";
  document.getElementById("add-proxy-profile").textContent = "Add Profile";
}

async function prepareProxyProfileFromForm() {
  const existing = currentConfig.proxy.profiles.find(
    (profile) => profile.name === editingProxyProfileName,
  );
  const response = await sendRuntimeMessage({
    type: "prepare-proxy-profile",
    profile: {
      host: document.getElementById("new-proxy-host").value,
      port: document.getElementById("new-proxy-port").value,
      scheme: document.getElementById("new-proxy-scheme").value,
      name: document.getElementById("new-proxy-name").value,
      location: existing && existing.location,
    },
  });
  return assertSuccessfulResponse(response, "Invalid proxy profile").profile;
}

async function saveProxyProfile() {
  const wasEditing = Boolean(editingProxyProfileName);
  try {
    showToast("Preparing proxy profile...", "success");
    const profile = await prepareProxyProfileFromForm();
    const otherProfiles = currentConfig.proxy.profiles.filter(
      (entry) => entry.name !== editingProxyProfileName,
    );

    const baseName = profile.name;
    let finalName = baseName;
    let suffix = 1;
    while (otherProfiles.some((entry) => entry.name === finalName)) {
      finalName = `${baseName} (${suffix++})`;
    }
    profile.name = finalName;

    const wasActive =
      currentConfig.proxy.activeProfile === editingProxyProfileName;
    currentConfig.proxy.profiles = [...otherProfiles, profile];
    if (editingProxyProfileName) {
      currentConfig.proxy.domainRoutes = currentConfig.proxy.domainRoutes.map(
        (route) =>
          route.profile === editingProxyProfileName
            ? { ...route, profile: finalName }
            : route,
      );
    }
    if (wasActive) {
      currentConfig.proxy.activeProfile = finalName;
    }

    resetProxyEditor();
    document.querySelector("#proxy-section details").open = false;
    populateProxyProfiles();
    scheduleAutoSave();
    showToast(
      `Profile "${finalName}" ${wasEditing ? "updated" : "added"}.`,
      "success",
    );
  } catch (error) {
    console.error("Failed to prepare proxy profile:", error);
    showToast(error.message, "error");
  }
}

function removeProxyProfile(profileName) {
  if (!confirm(`Remove proxy profile "${profileName}"?`)) {
    return;
  }

  currentConfig.proxy.profiles = currentConfig.proxy.profiles.filter(
    (profile) => profile.name !== profileName,
  );
  currentConfig.proxy.domainRoutes = currentConfig.proxy.domainRoutes.filter(
    (route) => route.profile !== profileName,
  );
  if (currentConfig.proxy.activeProfile === profileName) {
    currentConfig.proxy.activeProfile = null;
    currentConfig.proxy.enabled = false;
    document.getElementById("proxy-enabled").checked = false;
  }
  if (editingProxyProfileName === profileName) {
    resetProxyEditor();
  }

  populateProxyProfiles();
  scheduleAutoSave();
  showToast(`Profile "${profileName}" removed.`, "success");
}

function setupEventListeners() {
  for (const input of document.querySelectorAll("input, select, textarea")) {
    input.addEventListener("change", scheduleAutoSave);
    if (input.type === "text" || input.tagName === "TEXTAREA") {
      input.addEventListener("input", scheduleAutoSave);
    }
  }

  document
    .getElementById("save-settings")
    .addEventListener("click", async () => {
      clearTimeout(saveTimeout);
      saveTimeout = null;
      if (collectForm()) {
        await saveOptionsConfig(true);
      }
    });

  document
    .getElementById("reset-settings")
    .addEventListener("click", resetSettings);
  document
    .getElementById("useragent-preset")
    .addEventListener("change", updateUserAgentString);
  document
    .getElementById("add-proxy-profile")
    .addEventListener("click", saveProxyProfile);
  document
    .getElementById("export-config")
    .addEventListener("click", exportConfig);
  document.getElementById("import-config").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) {
      importConfig(file);
    }
  });
}

async function resetSettings() {
  if (!confirm("Reset all settings to defaults?")) {
    return;
  }

  try {
    const response = await sendRuntimeMessage({ type: "reset-config" });
    assertSuccessfulResponse(response, "Failed to reset settings");
    await loadOptionsConfig();
    showToast("Settings reset to defaults", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

function exportConfig() {
  if (!currentConfig || !collectForm()) {
    return;
  }

  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    config: currentConfig,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `stealth-guard-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Settings exported", "success");
}

function importConfig(file) {
  if (file.size > MAX_CONFIG_FILE_SIZE) {
    showToast("Config files must be smaller than 1 MB", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (
        !data.config ||
        typeof data.config !== "object" ||
        Array.isArray(data.config)
      ) {
        throw new Error("Invalid config file");
      }

      const response = await sendRuntimeMessage({
        type: "update-config",
        config: data.config,
      });
      assertSuccessfulResponse(response, "Failed to import settings");
      await loadOptionsConfig();
      showToast("Settings imported", "success");
    } catch (error) {
      console.error("Failed to import settings:", error);
      showToast(error.message, "error");
    }
  };
  reader.onerror = () => showToast("Failed to read file", "error");
  reader.readAsText(file);
}
