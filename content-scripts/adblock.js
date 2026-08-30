(function initializeStealthGuardAdblock() {
  if (
    window.top !== window ||
    !/^https?:$/.test(location.protocol) ||
    isCloudflareChallengeHostname(location.hostname) ||
    isDataDomeChallengeHostname(location.hostname)
  ) {
    return;
  }

  const appliedSelectors = new Set();
  const observedTokens = new Set();
  let requestTimer = null;
  let youtubeEnhancements = false;
  let pickerCleanup = null;
  let observer = null;
  let runtimeMessageListener = null;
  let active = true;

  function deactivate() {
    if (!active) return;
    active = false;
    clearTimeout(requestTimer);
    requestTimer = null;
    if (observer) observer.disconnect();
    if (pickerCleanup) pickerCleanup();
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
      // The old content script cannot access the new extension context.
    }
  }

  function addClassToken(token) {
    if (
      observedTokens.size < 3000 &&
      typeof token === "string" &&
      /^[a-z0-9_-]{1,128}$/i.test(token)
    ) {
      observedTokens.add(token);
    }
  }

  function addElementTokens(element) {
    if (element.id && observedTokens.size < 3000) {
      observedTokens.add(element.id);
    }
    for (const className of element.classList || []) addClassToken(className);
  }

  function addTokensFromElement(element) {
    if (!(element instanceof Element)) return false;
    const sizeBefore = observedTokens.size;
    addElementTokens(element);
    if (observedTokens.size >= 3000) return observedTokens.size !== sizeBefore;
    for (const child of element.querySelectorAll("[id], [class]")) {
      if (observedTokens.size >= 3000) break;
      addElementTokens(child);
    }
    return observedTokens.size !== sizeBefore;
  }

  function isValidSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch (error) {
      return false;
    }
  }

  function applySelectors(selectors) {
    const fresh = (selectors || []).filter(
      (selector) =>
        typeof selector === "string" &&
        !appliedSelectors.has(selector) &&
        isValidSelector(selector),
    );
    if (!fresh.length) return;
    for (const selector of fresh) appliedSelectors.add(selector);
    for (let index = 0; index < fresh.length; index += 250) {
      const style = document.createElement("style");
      style.dataset.stealthGuardAdblock = "";
      style.textContent = `${fresh.slice(index, index + 250).join(",\n")}{display:none!important;}`;
      (document.documentElement || document).appendChild(style);
    }
  }

  function clearCosmeticStyles() {
    for (const style of document.querySelectorAll("style[data-stealth-guard-adblock]")) {
      style.remove();
    }
    appliedSelectors.clear();
  }

  function applyYouTubeEnhancements() {
    if (!youtubeEnhancements) return;
    applySelectors([
      "ytd-display-ad-renderer",
      "ytd-ad-slot-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "ytd-banner-promo-renderer",
      "#masthead-ad",
      ".ytp-ad-overlay-container",
      ".ytp-ad-player-overlay",
    ]);
    const skipButton = document.querySelector(
      ".ytp-ad-skip-button, .ytp-skip-ad-button, button.ytp-ad-skip-button-modern",
    );
    if (skipButton instanceof HTMLElement) skipButton.click();
  }

  async function requestCosmeticRules() {
    requestTimer = null;
    if (!active) return;
    try {
      const response = await sendRuntimeMessage({
        type: "get-cosmetic-rules",
        hostname: normalizeHostname(location.hostname),
        tokens: Array.from(observedTokens),
      });
      if (!response || response.success === false) return;
      if (!response.enabled) {
        youtubeEnhancements = false;
        clearCosmeticStyles();
        return;
      }
      youtubeEnhancements = Boolean(response.youtubeEnhancements);
      applySelectors(response.selectors);
      applyYouTubeEnhancements();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) deactivate();
      // Other failures are transient while the background is restarting.
    }
  }

  function scheduleRuleRequest() {
    if (!active) return;
    clearTimeout(requestTimer);
    requestTimer = setTimeout(requestCosmeticRules, 80);
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^a-z0-9_-]/gi, (character) =>
      `\\${character.codePointAt(0).toString(16)} `,
    );
  }

  function createElementSelector(element) {
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement && parts.length < 4) {
      let part = current.localName;
      const stableClasses = Array.from(current.classList || [])
        .filter((name) => /^[a-z][a-z0-9_-]{1,64}$/i.test(name))
        .slice(0, 2);
      if (stableClasses.length) {
        part += stableClasses.map((name) => `.${cssEscape(name)}`).join("");
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(
          (sibling) => sibling.localName === current.localName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (isValidSelector(selector) && document.querySelectorAll(selector).length === 1) {
        return selector;
      }
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function startElementPicker() {
    if (pickerCleanup) pickerCleanup();
    let selected = null;
    let selectedOutline = null;
    const banner = document.createElement("div");
    banner.textContent = "Stealth Guard: click an element to block it · Esc to cancel";
    Object.assign(banner.style, {
      all: "initial",
      position: "fixed",
      zIndex: "2147483647",
      inset: "12px auto auto 50%",
      transform: "translateX(-50%)",
      padding: "9px 14px",
      borderRadius: "7px",
      background: "#263238",
      color: "white",
      font: "600 13px sans-serif",
      boxShadow: "0 3px 18px rgba(0,0,0,.35)",
    });
    document.documentElement.appendChild(banner);

    const clearSelected = () => {
      if (selected && selectedOutline) {
        if (selectedOutline.value) {
          selected.style.setProperty(
            "outline",
            selectedOutline.value,
            selectedOutline.priority,
          );
        } else {
          selected.style.removeProperty("outline");
        }
      }
      selected = null;
      selectedOutline = null;
    };
    const onMove = (event) => {
      if (!(event.target instanceof HTMLElement) || event.target === banner) return;
      clearSelected();
      selected = event.target;
      selectedOutline = {
        value: selected.style.getPropertyValue("outline"),
        priority: selected.style.getPropertyPriority("outline"),
      };
      selected.style.setProperty("outline", "3px solid #ef4444", "important");
    };
    const cleanup = () => {
      clearSelected();
      banner.remove();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      pickerCleanup = null;
    };
    const onClick = async (event) => {
      if (!selected || event.target === banner) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = selected;
      const selector = createElementSelector(target);
      cleanup();
      try {
        const response = await sendRuntimeMessage({
          type: "add-cosmetic-rule",
          hostname: normalizeHostname(location.hostname),
          selector,
        });
        if (response && response.success !== false) applySelectors([selector]);
      } catch (error) {
        // The picker is best-effort; rules can always be added in settings.
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") cleanup();
    };
    pickerCleanup = cleanup;
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  runtimeMessageListener = (message, sender, sendResponse) => {
    if (!active) return;
    if (message && message.type === "start-element-picker") {
      startElementPicker();
      sendResponse({ success: true });
    } else if (message && message.type === "adblock-rules-updated") {
      clearCosmeticStyles();
      scheduleRuleRequest();
      sendResponse({ success: true });
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

  addTokensFromElement(document.documentElement);
  requestCosmeticRules();
  observer = new MutationObserver((mutations) => {
    let tokensChanged = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        tokensChanged = addTokensFromElement(node) || tokensChanged;
      }
    }
    if (tokensChanged) scheduleRuleRequest();
    applyYouTubeEnhancements();
  });
  if (active) observer.observe(document, { childList: true, subtree: true });
  window.addEventListener("pagehide", deactivate, { once: true });
})();
