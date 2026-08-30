(function () {
  "use strict";

  if (window.__STEALTH_GUARD_INJECTED__) {
    return;
  }
  window.__STEALTH_GUARD_INJECTED__ = true;

  if (
    isCloudflareChallengeHostname(window.location.hostname) ||
    isDataDomeChallengeHostname(window.location.hostname)
  ) {
    return;
  }

  let curlProfileCatalog = normalizeCurlProfileCatalog(null);
  let config = createContentConfig(
    DEFAULT_CONFIG,
    window.location.hostname,
    curlProfileCatalog,
  );
  let debugEnabled = config.notifications.enabled;
  const bridge = {
    configEvent: `stealth-guard-config-${createPrivateToken()}`,
    configToken: createPrivateToken(),
    alertChannel: `stealth-guard-alert-${createPrivateToken()}`,
    alertToken: createPrivateToken(),
    diagnosticRequestEvent: `stealth-guard-diagnostic-request-${createPrivateToken()}`,
    diagnosticResultEvent: `stealth-guard-diagnostic-result-${createPrivateToken()}`,
    diagnosticToken: createPrivateToken(),
  };
  const reportedFeatures = new Set();
  let active = true;
  let runtimeMessageListener = null;
  let alertMessageListener = null;

  function deactivate() {
    if (!active) return;
    active = false;
    if (alertMessageListener) {
      window.removeEventListener("message", alertMessageListener);
    }
    try {
      if (
        runtimeMessageListener &&
        chrome.runtime &&
        chrome.runtime.onMessage &&
        typeof chrome.runtime.onMessage.removeListener === "function"
      ) {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
      }
    } catch (error) {
      // A stale content script cannot access the replacement extension context.
    }
  }

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

  function requestNativeWindowGeometryRepair() {
    try {
      if (window !== window.top) return;

      const innerWidth = Number(window.innerWidth);
      const innerHeight = Number(window.innerHeight);
      const outerWidth = Number(window.outerWidth);
      const outerHeight = Number(window.outerHeight);
      const invalidWidth =
        !Number.isFinite(outerWidth) ||
        outerWidth <= 0 ||
        (Number.isFinite(innerWidth) && outerWidth < innerWidth);
      const invalidHeight =
        !Number.isFinite(outerHeight) ||
        outerHeight <= 0 ||
        (Number.isFinite(innerHeight) && outerHeight < innerHeight);
      if (!invalidWidth && !invalidHeight) return;

      const width = Math.max(
        1,
        Number.isFinite(innerWidth) ? innerWidth + 1 : 0,
        Number.isFinite(outerWidth) && outerWidth > 0 ? outerWidth : 0,
      );
      const height = Math.max(
        1,
        Number.isFinite(innerHeight) ? innerHeight + 1 : 0,
        Number.isFinite(outerHeight) && outerHeight > 0 ? outerHeight : 0,
      );
      chrome.runtime.sendMessage(
        { type: "repair-window-geometry", width, height },
        () => {
          getChromeError();
        },
      );
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) {
        debugWarn(
          "[Stealth Guard] Native window geometry repair failed:",
          error,
        );
      }
    }
  }

  requestNativeWindowGeometryRepair();
  window.addEventListener("load", requestNativeWindowGeometryRepair, {
    once: true,
    capture: true,
  });

  function loadStoredContentConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY, CURL_PROFILE_CACHE_KEY], (result) => {
          const error = getChromeError();
          if (error) {
            if (isExtensionContextInvalidated(error)) {
              deactivate();
            } else {
              debugWarn(
                "[Stealth Guard] Failed to load stored config:",
                error,
              );
            }
            resolve(config);
            return;
          }
          curlProfileCatalog = normalizeCurlProfileCatalog(
            result && result[CURL_PROFILE_CACHE_KEY],
          );
          resolve(
            createContentConfig(
              result && result[STORAGE_KEY],
              window.location.hostname,
              curlProfileCatalog,
            ),
          );
        });
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          deactivate();
        } else {
          debugWarn("[Stealth Guard] Failed to load stored config:", error);
        }
        resolve(config);
      }
    });
  }

  function applyTrustedContentConfig(nextConfig, nextProfileCatalog) {
    if (nextProfileCatalog) {
      curlProfileCatalog = normalizeCurlProfileCatalog(nextProfileCatalog);
    }
    config = createContentConfig(
      nextConfig,
      window.location.hostname,
      curlProfileCatalog,
    );
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

  function requestMainWorldDiagnostics() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (snapshot) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener(
          bridge.diagnosticResultEvent,
          receiveDiagnostics,
          true,
        );
        resolve(snapshot);
      };
      const receiveDiagnostics = (event) => {
        if (
          !event ||
          !event.detail ||
          event.detail.token !== bridge.diagnosticToken ||
          !event.detail.snapshot ||
          typeof event.detail.snapshot !== "object"
        ) {
          return;
        }
        finish(event.detail.snapshot);
      };
      const timeout = setTimeout(() => finish(null), 1000);
      window.addEventListener(
        bridge.diagnosticResultEvent,
        receiveDiagnostics,
        true,
      );
      window.dispatchEvent(
        new CustomEvent(bridge.diagnosticRequestEvent, {
          detail: { token: bridge.diagnosticToken },
        }),
      );
    });
  }

  runtimeMessageListener = (request, sender, sendResponse) => {
    if (!active) return;
    if (request && request.type === "config-updated") {
      applyTrustedContentConfig(request.config, request.profileCatalog);
    }
    if (request && request.type === "run-self-test") {
      requestMainWorldDiagnostics().then((snapshot) => {
        sendResponse(
          snapshot
            ? { success: true, snapshot }
            : { success: false, error: "MAIN-world diagnostics timed out" },
        );
      });
      return true;
    }
  };
  try {
    chrome.runtime.onMessage.addListener(runtimeMessageListener);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      deactivate();
    } else {
      throw error;
    }
  }

  alertMessageListener = (event) => {
    const alert = event.data;
    if (
      !active ||
      event.source !== window ||
      !alert ||
      alert.channel !== bridge.alertChannel ||
      alert.token !== bridge.alertToken ||
      typeof alert.feature !== "string"
    ) {
      return;
    }

    if (reportedFeatures.has(alert.feature)) return;
    reportedFeatures.add(alert.feature);
    try {
      chrome.runtime.sendMessage(
        {
          type: "fingerprint-detected",
          feature: alert.feature,
          hostname: window.location.hostname,
        },
        () => {
          const error = getChromeError();
          if (error) {
            if (isExtensionContextInvalidated(error)) {
              deactivate();
              return;
            }
            reportedFeatures.delete(alert.feature);
            debugWarn(
              "[Stealth Guard] Failed to report fingerprint access:",
              error.message || String(error),
            );
          } else {
            debugLog(
              "[Stealth Guard] Reported fingerprint access:",
              alert.feature,
            );
          }
        },
      );
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        deactivate();
      } else {
        reportedFeatures.delete(alert.feature);
        if (active) {
          debugWarn(
            "[Stealth Guard] Failed to report fingerprint access:",
            error.message || String(error),
          );
        }
      }
    }
  };
  window.addEventListener("message", alertMessageListener);
  window.addEventListener("pagehide", deactivate, { once: true });
})();
