let currentConfig = null;
let currentTab = null;
let currentSessionHostname = "";
let currentSessions = [];
let activeSessionId = null;
let pendingReloadTimeout = null;

const POPUP_RELOAD_DEBOUNCE_MS = 250;

document.addEventListener("DOMContentLoaded", initializePopup);

async function initializePopup() {
  try {
    [currentConfig, currentTab] = await Promise.all([
      loadRuntimeConfig(),
      queryCurrentTab(),
    ]);
    currentSessionHostname = getTabHostname(currentTab);
    renderPopup();
    setupEventListeners();
    await Promise.all([updateTriggeredFeatures(), refreshSessionList()]);
  } catch (error) {
    console.error("Failed to initialize popup:", error);
    document.body.textContent =
      "Failed to load settings. Reload the extension and try again.";
  }
}

function queryCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function getTabHostname(tab) {
  if (!tab || !tab.url) {
    return "";
  }

  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:"
      ? normalizeHostname(url.hostname).replace(/^www\./, "")
      : "";
  } catch (error) {
    return "";
  }
}

function setSelectValue(select, value) {
  select.value = value;
  if (select.selectedIndex < 0) {
    select.selectedIndex = 0;
  }
}

function renderPopup() {
  document.getElementById("global-enabled").checked = currentConfig.enabled;
  document.getElementById("notifications-enabled").checked =
    currentConfig.notifications.enabled;

  for (const row of document.querySelectorAll(".feature-row")) {
    const featureName = row.dataset.feature;
    const featureConfig = currentConfig[featureName];
    const toggle = row.querySelector("[data-feature-toggle]");
    if (toggle && featureConfig) {
      toggle.checked = featureConfig.enabled;
    }
    row.classList.toggle("disabled", !currentConfig.enabled);
  }

  setSelectValue(
    document.getElementById("webgl-quick-select"),
    currentConfig.webgl.preset,
  );
  setSelectValue(
    document.getElementById("timezone-quick-select"),
    `${currentConfig.timezone.name}|${currentConfig.timezone.offset}`,
  );
  setSelectValue(
    document.getElementById("useragent-quick-select"),
    currentConfig.useragent.preset,
  );

  renderProxyStatus();
  renderCurrentSite();
  renderAllowlistHighlighting();
  renderSessionDomain();
  renderSessionList();
}

function renderProxyStatus() {
  const proxy = currentConfig.proxy;
  const status = document.getElementById("proxy-status");
  const activeProfile = proxy.profiles.find(
    (profile) => profile.name === proxy.activeProfile,
  );

  if (!proxy.enabled) {
    status.textContent = "No proxy";
    status.dataset.state = "disabled";
  } else if (proxy.domainRoutes.length > 0) {
    status.textContent = `${proxy.domainRoutes.length} route(s)`;
    status.dataset.state = "active";
  } else if (activeProfile) {
    status.textContent = activeProfile.name;
    status.dataset.state = "active";
  } else if (proxy.profiles.length > 0) {
    status.textContent = `${proxy.profiles.length} profile(s)`;
    status.dataset.state = "configured";
  } else {
    status.textContent = "Not configured";
    status.dataset.state = "warning";
  }
}

function renderCurrentSite() {
  const hostname = getTabHostname(currentTab);
  const urlElement = document.getElementById("current-url");
  const button = document.getElementById("toggle-current-site");

  urlElement.textContent = hostname || "No HTTP(S) site";
  button.disabled = !hostname;
  if (!hostname) {
    button.textContent = "Add to Allowlist";
    button.classList.remove("danger");
    return;
  }

  const allowlisted = new DomainFilter(currentConfig).isAllowlisted(
    hostname,
    currentConfig.globalWhitelist,
  );
  button.textContent = allowlisted
    ? "Remove from Allowlist"
    : "Add to Allowlist";
  button.classList.toggle("danger", allowlisted);
}

function renderAllowlistHighlighting() {
  const hostname = getTabHostname(currentTab);
  const rows = document.querySelectorAll(".feature-row");
  for (const row of rows) {
    row.classList.remove("allowlisted-feature", "allowlisted-global");
  }
  if (!hostname) {
    return;
  }

  const filter = new DomainFilter(currentConfig);
  if (filter.isAllowlisted(hostname, currentConfig.globalWhitelist)) {
    for (const row of rows) {
      row.classList.add("allowlisted-global");
    }
    return;
  }

  for (const row of rows) {
    const featureName = row.dataset.feature;
    const featureConfig = currentConfig[featureName];
    const allowlist =
      featureName === "proxy"
        ? featureConfig.bypassList.join(",")
        : featureConfig.whitelist;
    row.classList.toggle(
      "allowlisted-feature",
      filter.isAllowlisted(hostname, allowlist || ""),
    );
  }
}

async function updateTriggeredFeatures() {
  if (!currentTab || typeof currentTab.id !== "number") {
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "get-triggered-features",
      tabId: currentTab.id,
    });
    const triggered = new Set(
      ((response && response.features) || []).map((feature) =>
        feature === "user-agent" ? "useragent" : feature,
      ),
    );

    for (const row of document.querySelectorAll(".feature-row")) {
      row.classList.toggle("triggered", triggered.has(row.dataset.feature));
    }
  } catch (error) {
    console.error("Failed to load triggered features:", error);
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
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function setSessionStatus(message, type = "") {
  const status = document.getElementById("session-status");
  status.textContent = message || "";
  status.className = `session-status${type ? ` ${type}` : ""}`;
}

function renderSessionDomain() {
  document.getElementById("session-domain").textContent =
    currentSessionHostname || "No active site";
}

function renderSessionList() {
  const list = document.getElementById("session-list");
  if (!currentSessionHostname) {
    list.innerHTML =
      '<div class="session-list-empty">Open an HTTP(S) site to manage sessions.</div>';
    return;
  }
  if (currentSessions.length === 0) {
    list.innerHTML =
      '<div class="session-list-empty">No saved sessions for this site.</div>';
    return;
  }

  list.innerHTML = currentSessions
    .map((session) => {
      const isActive = session.id === activeSessionId;
      return `
      <div class="session-entry ${isActive ? "active" : ""}">
        <div class="session-entry-name">${escapeHtml(session.name || "Unnamed Session")}</div>
        <div class="session-entry-meta">Last used: ${escapeHtml(formatSessionTime(session.lastUsed))}</div>
        <div class="session-entry-actions">
          <button class="session-action-btn switch" data-action="switch" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">🔄</span><span>${isActive ? "Re-Switch" : "Switch"}</span>
          </button>
          <button class="session-action-btn" data-action="rename" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">✏️</span><span>Rename</span>
          </button>
          <button class="session-action-btn" data-action="delete" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">🗑️</span><span>Delete</span>
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

async function refreshSessionList() {
  currentSessionHostname = getTabHostname(currentTab);
  renderSessionDomain();
  if (!currentSessionHostname) {
    currentSessions = [];
    activeSessionId = null;
    renderSessionList();
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "get-sessions",
      hostname: currentSessionHostname,
    });
    assertSuccessfulResponse(response, "Failed to load sessions");
    currentSessions = Array.isArray(response.sessions) ? response.sessions : [];
    activeSessionId = response.activeSessionId || null;
    renderSessionList();
  } catch (error) {
    console.error("Failed to load sessions:", error);
    setSessionStatus(error.message, "error");
  }
}

function assertSuccessfulResponse(response, fallbackMessage) {
  if (!response || response.success === false) {
    throw new Error((response && response.error) || fallbackMessage);
  }
  return response;
}

async function saveCurrentConfig() {
  try {
    const response = await sendRuntimeMessage({
      type: "update-config",
      config: currentConfig,
    });
    assertSuccessfulResponse(response, "Failed to save settings");
    scheduleCurrentTabReload();
  } catch (error) {
    console.error("Failed to save settings:", error);
    currentConfig = await loadRuntimeConfig();
    renderPopup();
  }
}

function scheduleCurrentTabReload() {
  if (!currentTab || typeof currentTab.id !== "number") {
    return;
  }
  clearTimeout(pendingReloadTimeout);
  pendingReloadTimeout = setTimeout(() => {
    pendingReloadTimeout = null;
    chrome.tabs.reload(currentTab.id, () => {
      if (chrome.runtime.lastError) {
        console.error(
          "Failed to reload current tab:",
          chrome.runtime.lastError,
        );
      }
    });
  }, POPUP_RELOAD_DEBOUNCE_MS);
}

function setupEventListeners() {
  document
    .getElementById("global-enabled")
    .addEventListener("change", async (event) => {
      currentConfig.enabled = event.target.checked;
      renderPopup();
      await saveCurrentConfig();
    });

  document
    .getElementById("notifications-enabled")
    .addEventListener("change", async (event) => {
      currentConfig.notifications.enabled = event.target.checked;
      await saveCurrentConfig();
    });

  for (const toggle of document.querySelectorAll("[data-feature-toggle]")) {
    toggle.addEventListener("change", async (event) => {
      currentConfig[toggle.dataset.featureToggle].enabled =
        event.target.checked;
      renderProxyStatus();
      await saveCurrentConfig();
    });
  }

  document
    .getElementById("webgl-quick-select")
    .addEventListener("change", async (event) => {
      currentConfig.webgl.preset = event.target.value;
      await saveCurrentConfig();
    });

  document
    .getElementById("useragent-quick-select")
    .addEventListener("change", async (event) => {
      currentConfig.useragent.preset = event.target.value;
      await saveCurrentConfig();
    });

  document
    .getElementById("timezone-quick-select")
    .addEventListener("change", async (event) => {
      const [name, offset] = event.target.value.split("|");
      currentConfig.timezone.name = name;
      currentConfig.timezone.offset = Number.parseInt(offset, 10);
      await saveCurrentConfig();
    });

  document
    .getElementById("toggle-current-site")
    .addEventListener("click", toggleCurrentSiteAllowlist);

  for (const row of document.querySelectorAll(".feature-row")) {
    row.addEventListener("click", (event) => {
      if (event.target.closest("input, select, .switch")) {
        return;
      }
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `options/options.html#${row.dataset.section}`,
        ),
      });
    });
  }

  document.getElementById("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("test-webrtc").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://dnscheck.tools/" });
  });
  document
    .getElementById("save-session")
    .addEventListener("click", saveSession);
  document
    .getElementById("clear-current-session")
    .addEventListener("click", clearCurrentSession);
  document
    .getElementById("session-list")
    .addEventListener("click", handleSessionAction);
}

async function toggleCurrentSiteAllowlist() {
  if (!currentSessionHostname) {
    return;
  }

  const filter = new DomainFilter(currentConfig);
  const allowlisted = filter.isAllowlisted(
    currentSessionHostname,
    currentConfig.globalWhitelist,
  );

  try {
    const response = await sendRuntimeMessage({
      type: allowlisted ? "remove-from-whitelist" : "add-to-whitelist",
      domain: currentSessionHostname,
    });
    assertSuccessfulResponse(response, "Failed to update allowlist");
    currentConfig.globalWhitelist = response.whitelist;
    renderPopup();
    scheduleCurrentTabReload();
  } catch (error) {
    console.error("Failed to update allowlist:", error);
  }
}

async function saveSession() {
  if (
    !currentTab ||
    typeof currentTab.id !== "number" ||
    !currentSessionHostname
  ) {
    setSessionStatus("Open an HTTP(S) tab first.", "error");
    return;
  }

  const input = document.getElementById("session-name-input");
  setSessionStatus("Saving session...");
  try {
    const response = await sendRuntimeMessage({
      type: "save-session",
      hostname: currentSessionHostname,
      tabId: currentTab.id,
      name: input.value,
    });
    assertSuccessfulResponse(response, "Failed to save session");
    input.value = "";
    setSessionStatus("Session saved.", "success");
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}

async function clearCurrentSession() {
  if (
    !currentTab ||
    typeof currentTab.id !== "number" ||
    !currentSessionHostname
  ) {
    setSessionStatus("Open an HTTP(S) tab first.", "error");
    return;
  }
  if (!confirm("Clear cookies and storage for this site in the current tab?")) {
    return;
  }

  setSessionStatus("Clearing current session...");
  try {
    const response = await sendRuntimeMessage({
      type: "clear-current-session",
      hostname: currentSessionHostname,
      tabId: currentTab.id,
    });
    assertSuccessfulResponse(response, "Failed to clear current session");
    setSessionStatus("Current session cleared.", "success");
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}

async function handleSessionAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const sessionId = button.dataset.sessionId;
  if (action === "delete" && !confirm("Delete this saved session?")) {
    return;
  }

  let request = { type: `${action}-session`, sessionId };
  if (action === "switch") {
    if (!currentTab || typeof currentTab.id !== "number") {
      setSessionStatus("No active tab found.", "error");
      return;
    }
    request.tabId = currentTab.id;
    setSessionStatus("Switching session...");
  } else if (action === "rename") {
    const session = currentSessions.find((entry) => entry.id === sessionId);
    const name = prompt("Session name", (session && session.name) || "");
    if (name === null) {
      return;
    }
    request.name = name;
  }

  try {
    const response = await sendRuntimeMessage(request);
    assertSuccessfulResponse(response, `Failed to ${action} session`);
    setSessionStatus(
      `Session ${action === "switch" ? "switched" : `${action}d`}.`,
      "success",
    );
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}
