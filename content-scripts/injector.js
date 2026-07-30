(function () {
  "use strict";

  if (window.__STEALTH_GUARD_INJECTED__) {
    return;
  }
  window.__STEALTH_GUARD_INJECTED__ = true;

  if (isCloudflareChallengeHostname(window.location.hostname)) {
    return;
  }

  let config = createContentConfig(DEFAULT_CONFIG, window.location.hostname);
  let debugEnabled = config.notifications.enabled;
  const bridge = {
    configEvent: `stealth-guard-config-${createPrivateToken()}`,
    configToken: createPrivateToken(),
    alertChannel: `stealth-guard-alert-${createPrivateToken()}`,
    alertToken: createPrivateToken(),
  };

  function createPrivateToken() {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const values = new Uint32Array(4);
      crypto.getRandomValues(values);
      return Array.from(values, (value) => value.toString(36)).join("");
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function debug(method, ...args) {
    if (debugEnabled) {
      console[method](...args);
    }
  }

  const debugLog = (...args) => debug("log", ...args);
  const debugWarn = (...args) => debug("warn", ...args);

  function loadStoredContentConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          debugWarn(
            "[Stealth Guard] Failed to load stored config:",
            chrome.runtime.lastError,
          );
          resolve(config);
          return;
        }
        resolve(
          createContentConfig(
            result && result[STORAGE_KEY],
            window.location.hostname,
          ),
        );
      });
    });
  }

  function applyTrustedContentConfig(nextConfig) {
    config = createContentConfig(nextConfig, window.location.hostname);
    debugEnabled = config.notifications.enabled;
    window.dispatchEvent(
      new CustomEvent(bridge.configEvent, {
        detail: {
          token: bridge.configToken,
          config,
        },
      }),
    );
  }

  const script = document.createElement("script");
  const serializedArguments = [
    JSON.stringify(config),
    JSON.stringify(bridge),
    createDomainPatternTools.toString(),
    JSON.stringify(USER_AGENT_STRINGS),
    JSON.stringify(USER_AGENT_CLIENT_HINTS),
  ].join(", ");
  script.textContent =
    `(${installMainWorldProtections.toString()})(${serializedArguments});`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  loadStoredContentConfig().then(applyTrustedContentConfig);

  chrome.runtime.onMessage.addListener((request) => {
    if (request && request.type === "config-updated") {
      applyTrustedContentConfig(request.config);
    }
  });

  window.addEventListener("message", (event) => {
    const alert = event.data;
    if (
      event.source !== window ||
      !alert ||
      alert.channel !== bridge.alertChannel ||
      alert.token !== bridge.alertToken ||
      typeof alert.feature !== "string"
    ) {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "fingerprint-detected",
        feature: alert.feature,
        hostname: window.location.hostname,
      },
      () => {
        if (chrome.runtime.lastError) {
          debugWarn(
            "[Stealth Guard] Failed to report fingerprint access:",
            chrome.runtime.lastError.message,
          );
        } else {
          debugLog(
            "[Stealth Guard] Reported fingerprint access:",
            alert.feature,
          );
        }
      },
    );
  });
})();
