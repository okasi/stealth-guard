// Content Script Injector - Runs in ISOLATED world and injects MAIN world script
// This is necessary for Manifest V2 since it doesn't support world: "MAIN" directly

(function () {
  'use strict';

  const CONFIG_VERSION = "1.0.2";  // Increment this to force cache refresh
  const CONFIG_CACHE_KEY = "__STEALTH_GUARD_CONFIG_CACHE__";
  const CONFIG_CACHE_REFRESH_TS_KEY = "__STEALTH_GUARD_CONFIG_CACHE_REFRESH_TS__";
  const CONFIG_CACHE_REFRESH_TTL_MS = 3000;
  const TURNSTILE_SESSION_KEY = "__STEALTH_GUARD_TURNSTILE_TS__";
  const TURNSTILE_BYPASS_TTL_MS = 3 * 60 * 1000;
  const TURNSTILE_OBSERVER_TIMEOUT_MS = 12000;
  const TURNSTILE_TRIGGER_CHECK_EVENT = "stealth-guard-trigger-check";
  const FINGERPRINT_ALERT_MAP = {
    "stealth-guard-canvas-alert": "canvas",
    "stealth-guard-webgl-alert": "webgl",
    "stealth-guard-font-alert": "font",
    "stealth-guard-clientrects-alert": "clientrects",
    "stealth-guard-webgpu-alert": "webgpu",
    "stealth-guard-audiocontext-alert": "audiocontext",
    "stealth-guard-timezone-alert": "timezone",
    "stealth-guard-useragent-alert": "user-agent",
    "stealth-guard-webrtc-alert": "webrtc"
  };

  // Check if already injected
  if (window.__STEALTH_GUARD_INJECTED__) {
    return;
  }
  window.__STEALTH_GUARD_INJECTED__ = true;

  // Debug logging helpers (will be initialized after config loads)
  let debugEnabled = false;
  const debugLog = function(...args) {
    if (debugEnabled) {
      console.log(...args);
    }
  };
  const debugWarn = function(...args) {
    if (debugEnabled) {
      console.warn(...args);
    }
  };
  const debugError = function(...args) {
    // Always log errors
    console.error(...args);
  };

  // ========== HELPER: DOMAIN ALLOWLIST CHECKER ==========

  // ========== NO CSS BLOCKING ==========
  // We rely purely on JS interceptors to fake measurements
  // This prevents any visible flashing or font changes
  // Normal website fonts render correctly while fingerprinting tests get fake data

  // ========== IMMEDIATE INLINE INJECTION ==========

  // Try to read cached config from sessionStorage (synchronous!)
  let config;
  let configFromCache = false;

  try {
    const cached = sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      // Check if cache has version and globalWhitelist field (new in 1.0.1)
      if (parsedCache._version === CONFIG_VERSION && 'globalWhitelist' in parsedCache) {
        config = parsedCache;
        configFromCache = true;
      }
    }
  } catch (e) {
    // Ignore errors
  }

  // Fallback to defaults if no cache or outdated cache
  if (!config) {
    config = {
      _version: CONFIG_VERSION,
      enabled: true,
      globalWhitelist: "",
      canvas: { enabled: true, whitelist: "", noiseLevel: "medium" },
      webgl: { enabled: true, whitelist: "*.figma.com", preset: "auto" },
      font: { enabled: true, whitelist: "docs.google.com, figma.com" },
      clientrects: { enabled: true, whitelist: "" },
      webgpu: { enabled: true, whitelist: "" },
      audiocontext: { enabled: true, whitelist: "" },
      timezone: { enabled: true, whitelist: "app.slack.com, webmail.*", offset: 60, name: "Europe/Paris" },
      useragent: { enabled: true, whitelist: "", preset: "macos" },
      webrtc: { enabled: true, whitelist: "meet.google.com, zoom.us, teams.microsoft.com, discord.com, web.whatsapp.com, messenger.com, web.telegram.org, figma.com", policy: "disable_non_proxied_udp" },
      notifications: { enabled: false, showFingerprints: true }  // Default to debug OFF
    };
  }

  // Set debug logging state based on config
  // Only enable if explicitly set to true in config
  debugEnabled = !!(config.notifications && config.notifications.enabled);
  debugLog("[Stealth Guard] Using cached config from sessionStorage");
  debugLog("[Stealth Guard] Debug logging:", debugEnabled ? "enabled" : "disabled");

  // Migrate old config structure if needed
  // Add global enabled field if missing
  if (typeof config.enabled === 'undefined') {
    config.enabled = true;
    debugLog("[Stealth Guard] Added global enabled field to config");
  }
  // CRITICAL: Add globalWhitelist field if missing (migration for 1.0.1)
  if (typeof config.globalWhitelist === 'undefined' || config.globalWhitelist === null) {
    config.globalWhitelist = "";
    debugLog("[Stealth Guard] Added empty globalWhitelist field");
    // Force cache update
    try {
      config._version = CONFIG_VERSION;
      sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch (e) {}
  }
  // Migrate vendor/renderer -> preset
  if (config.webgl && !config.webgl.preset) {
    config.webgl.preset = "auto";
    debugLog("[Stealth Guard] Migrated WebGL config to preset structure");
  }
  // Migrate old Apple device presets to unified "apple" preset
  if (config.webgl && (config.webgl.preset === "m1_air" || config.webgl.preset === "intel_mbp" || config.webgl.preset === "iphone_x")) {
    config.webgl.preset = "apple";
    debugLog("[Stealth Guard] Migrated old Apple preset to unified 'apple' preset");
  }
  if (config.useragent && !config.useragent.preset) {
    config.useragent.preset = navigator.platform.includes("Mac") ? "macos" : "windows";
    debugLog("[Stealth Guard] Migrated User-Agent config to preset structure");
  }

  // Refresh cache in background (for next page load), throttled to avoid per-frame storage churn.
  let shouldRefreshCache = true;
  try {
    const lastRefreshTs = parseInt(sessionStorage.getItem(CONFIG_CACHE_REFRESH_TS_KEY) || "0", 10);
    shouldRefreshCache = Number.isNaN(lastRefreshTs) || (Date.now() - lastRefreshTs >= CONFIG_CACHE_REFRESH_TTL_MS);
  } catch (e) {
    shouldRefreshCache = true;
  }

  if (shouldRefreshCache) {
    try {
      sessionStorage.setItem(CONFIG_CACHE_REFRESH_TS_KEY, String(Date.now()));
    } catch (e) {
      // Ignore errors
    }

    chrome.storage.local.get("stealth-guard-config", (result) => {
      const storedConfig = result["stealth-guard-config"] || {};
      const freshConfig = {
        _version: CONFIG_VERSION,
        enabled: typeof storedConfig.enabled !== 'undefined' ? storedConfig.enabled : config.enabled,
        globalWhitelist: typeof storedConfig.globalWhitelist !== 'undefined' ? storedConfig.globalWhitelist : (config.globalWhitelist || ""),
        canvas: storedConfig.canvas || config.canvas,
        webgl: storedConfig.webgl || config.webgl,
        font: storedConfig.font || config.font,
        clientrects: storedConfig.clientrects || config.clientrects,
        webgpu: storedConfig.webgpu || config.webgpu,
        audiocontext: storedConfig.audiocontext || config.audiocontext,
        timezone: storedConfig.timezone || config.timezone,
        useragent: storedConfig.useragent || config.useragent,
        webrtc: storedConfig.webrtc || config.webrtc,
        notifications: storedConfig.notifications || config.notifications
      };

      // Migrate old structures
      // Add global enabled field if missing
      if (typeof freshConfig.enabled === 'undefined') {
        freshConfig.enabled = true;
      }
      // CRITICAL: Ensure globalWhitelist exists
      if (typeof freshConfig.globalWhitelist === 'undefined' || freshConfig.globalWhitelist === null) {
        freshConfig.globalWhitelist = "";
      }
      // Empty string "" is valid - means no domains are excluded
      if (freshConfig.webgl && !freshConfig.webgl.preset) {
        freshConfig.webgl.preset = "auto";
      }
      // Migrate old Apple device presets to unified "apple" preset
      if (freshConfig.webgl && (freshConfig.webgl.preset === "m1_air" || freshConfig.webgl.preset === "intel_mbp" || freshConfig.webgl.preset === "iphone_x")) {
        freshConfig.webgl.preset = "apple";
      }
      if (freshConfig.useragent && !freshConfig.useragent.preset) {
        freshConfig.useragent.preset = navigator.platform.includes("Mac") ? "macos" : "windows";
      }

      try {
        sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(freshConfig));
        debugLog("[Stealth Guard] Config cache updated for next page load");
      } catch (e) {
        // Ignore errors
      }
    });
  }

  // Skip injection entirely if global protection is disabled
  if (!config.enabled) {
    debugLog("[Stealth Guard] Global protection disabled, skipping inline injection");
    return;
  }

  // Skip injection if no features are enabled
  const hasEnabledFeatures = (
    (config.canvas && config.canvas.enabled) ||
    (config.webgl && config.webgl.enabled) ||
    (config.font && config.font.enabled) ||
    (config.clientrects && config.clientrects.enabled) ||
    (config.webgpu && config.webgpu.enabled) ||
    (config.audiocontext && config.audiocontext.enabled) ||
    (config.timezone && config.timezone.enabled) ||
    (config.useragent && config.useragent.enabled) ||
    (config.webrtc && config.webrtc.enabled)
  );

  if (!hasEnabledFeatures) {
    debugLog("[Stealth Guard] No features enabled, skipping inline injection");
    return;
  }

  // Check if current domain is on global whitelist
  debugLog("[Stealth Guard] Global whitelist check - globalWhitelist value:", config.globalWhitelist);

  // Hardcoded exclusions for known challenge domains (e.g. Cloudflare Turnstile iframes)
  // These frames need to be clean for challenges to pass
  const CHALLENGE_DOMAINS = [
    'challenges.cloudflare.com'
  ];
  const currentHostname = window.location.hostname;
  if (CHALLENGE_DOMAINS.some(d => currentHostname === d || currentHostname.endsWith('.' + d))) {
    debugLog("[Stealth Guard] Skipping protections for challenge domain:", currentHostname);
    return;
  }

  if (config.globalWhitelist && config.globalWhitelist.trim() !== "") {
    try {
      const filter = new DomainFilter(config);
      const currentUrl = window.location.href;
      const hostname = filter.extractHostname(currentUrl);
      debugLog("[Stealth Guard] Checking hostname:", hostname, "against whitelist:", config.globalWhitelist);

      if (hostname && filter.isWhitelisted(hostname, config.globalWhitelist)) {
        debugLog("[Stealth Guard] Domain is on global whitelist, skipping all protections:", hostname);
        return;
      } else {
        debugLog("[Stealth Guard] Domain NOT on whitelist, protections will activate");
      }
    } catch (e) {
      // If DomainFilter not available, continue with injection
      debugLog("[Stealth Guard] Could not check global whitelist:", e);
    }
  } else {
    debugLog("[Stealth Guard] No global whitelist configured, protections will activate");
  }

  // ========== CLOUDFLARE TURNSTILE DETECTION ==========
  // Simple, reliable detection with 3-minute persistence per domain
  // Moved to Content Script to ensure access to chrome.runtime
  function detectTurnstile() {
    try {
      // Check URL patterns (fastest, most reliable)
      if (window.location.href.includes('__cf_chl_rt_tk=') ||
          window.location.pathname.includes('cdn-cgi/challenge-platform')) {
        debugLog("[Stealth Guard] Turnstile detected: URL pattern");
        return true;
      }

      // Check page title (with three dots variation)
      const title = document.title;
      if (title && (title.includes('Just a moment') ||
                    title.includes('Attention Required') ||
                    title.includes('Checking your browser'))) {
        debugLog("[Stealth Guard] Turnstile detected: page title '" + title + "'");
        return true;
      }

      // REMOVED: Ray ID check caused false positives on normal sites (e.g. BrowserLeaks)
      // because many sites display the Ray ID in the footer.

      // Check DOM for Turnstile elements
      if (document.querySelector('input[name="cf-turnstile-response"]') ||
          document.querySelector('[id*="cf-chl-widget"]') ||
          document.querySelector('.cf-turnstile') ||
          document.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
          document.querySelector('[data-sitekey]')) {
        debugLog("[Stealth Guard] Turnstile detected: DOM element found");
        return true;
      }
    } catch (e) {
      // Ignore errors during detection
    }
    return false;
  }

  // Detect Turnstile and notify background script
  const hasTurnstile = detectTurnstile();

  // Helper to check bypass status
  const isBypassingTurnstile = () => {
    try {
      const ts = sessionStorage.getItem(TURNSTILE_SESSION_KEY);
      return ts && (Date.now() - parseInt(ts, 10) < TURNSTILE_BYPASS_TTL_MS);
    } catch(e) { return false; }
  };

  if (hasTurnstile) {
    if (isBypassingTurnstile()) {
      debugLog("[Stealth Guard] Turnstile detected but bypass mode active - skipping notification");
    } else {
      debugLog("[Stealth Guard] Cloudflare Turnstile detected - notifying background script");

      // Get the TOP-LEVEL hostname (not iframe hostname)
      let topHostname = window.location.hostname;
      try {
        if (window.top !== window.self) {
          // We're in an iframe, try to get parent hostname
          topHostname = window.top.location.hostname;
        }
      } catch (e) {
        // Cross-origin iframe, can't access - use document.referrer as fallback
        if (document.referrer) {
          try {
            const referrerUrl = new URL(document.referrer);
            topHostname = referrerUrl.hostname;
            debugLog("[Stealth Guard] Using referrer hostname:", topHostname);
          } catch (err) {
            // Fallback failed, use current hostname
          }
        }
      }

      debugLog("[Stealth Guard] Notifying for hostname:", topHostname);

      // Notify background script to temporarily disable UA spoofing for this domain
      try {
        chrome.runtime.sendMessage({
          type: "turnstile-detected",
          hostname: topHostname
        });
      } catch (e) {
        debugLog("[Stealth Guard] Failed to notify background about Turnstile:", e);
      }
    }
  } else {
    // If not detected immediately, set up observers for late detection
    if (document.readyState !== 'complete') {
      let observer = null;
      let observerTimeoutId = null;

      const disconnectTurnstileObserver = () => {
        if (observerTimeoutId) {
          clearTimeout(observerTimeoutId);
          observerTimeoutId = null;
        }
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      };

      observer = new MutationObserver(() => {
        if (detectTurnstile()) {
          disconnectTurnstileObserver();

          if (isBypassingTurnstile()) {
            debugLog("[Stealth Guard] Turnstile detected late but bypass mode active - skipping notification");
            return;
          }

          debugLog("[Stealth Guard] Cloudflare Turnstile detected late (MutationObserver)");

          let topHostname = window.location.hostname;
          try {
            if (window.top !== window.self) topHostname = window.top.location.hostname;
          } catch(e) {}

          try {
            chrome.runtime.sendMessage({
              type: "turnstile-detected",
              hostname: topHostname
            });
          } catch (e) {}
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      observerTimeoutId = setTimeout(() => {
        disconnectTurnstileObserver();
      }, TURNSTILE_OBSERVER_TIMEOUT_MS);

      // Also check on DOMContentLoaded
      window.addEventListener('DOMContentLoaded', () => {
        if (detectTurnstile()) {
          disconnectTurnstileObserver();

          if (isBypassingTurnstile()) {
            debugLog("[Stealth Guard] Turnstile detected (DOMContentLoaded) but bypass mode active - skipping notification");
            return;
          }

          debugLog("[Stealth Guard] Cloudflare Turnstile detected (DOMContentLoaded)");

          let topHostname = window.location.hostname;
          try {
            if (window.top !== window.self) topHostname = window.top.location.hostname;
          } catch(e) {}

          try {
            chrome.runtime.sendMessage({
              type: "turnstile-detected",
              hostname: topHostname
            });
          } catch (e) {}
        } else {
          disconnectTurnstileObserver();
        }
      }, { once: true });
    }
  }

  // Build inline protection code
  const inlineCode = `
    (function() {
      'use strict';

      const config = ` + JSON.stringify(config) + `;
      const hasTurnstile = ${hasTurnstile};

      // Helper function for debug logging
      const debugLog = function(...args) {
        if (config.notifications && config.notifications.enabled) {
          console.log(...args);
        }
      };

      const debugWarn = function(...args) {
        if (config.notifications && config.notifications.enabled) {
          console.warn(...args);
        }
      };

      const debugError = function(...args) {
        // Always log errors
        console.error(...args);
      };

      // Check for Turnstile bypass flag in sessionStorage
      let turnstileBypassActive = false;
      let turnstileBypassTimestamp = null;
      try {
        const turnstileTs = sessionStorage.getItem('${TURNSTILE_SESSION_KEY}');
        if (turnstileTs) {
          turnstileBypassTimestamp = turnstileTs;
          const ts = parseInt(turnstileTs, 10);
          const now = Date.now();
          const age = now - ts;
          if (age < ${TURNSTILE_BYPASS_TTL_MS}) {
            turnstileBypassActive = true;
            debugLog('[Stealth Guard] SessionStorage bypass flag found. Age:', Math.round(age/1000) + 's');
          } else {
            debugLog('[Stealth Guard] SessionStorage bypass flag EXPIRED. Age:', Math.round(age/1000) + 's');
            sessionStorage.removeItem('${TURNSTILE_SESSION_KEY}');
          }
        }
      } catch (e) {
        debugWarn('[Stealth Guard] Failed to read sessionStorage:', e);
      }

      // If Turnstile bypass is active, we used to disable ALL protections.
      // Now we only disable User-Agent spoofing (handled in specific feature check)
      // and rely on iframe exclusions to keep the challenge frame clean.
      // This allows Canvas/WebGL protections to remain active on the main page.
      if (turnstileBypassActive) {
        debugLog("[Stealth Guard] Turnstile bypass active - User-Agent spoofing will be disabled, but other protections remain active");
      } else if (hasTurnstile) {
         debugLog("[Stealth Guard] Turnstile detected on page load - proceeding with protections (will reload shortly if not bypassed)");
      }

      // Helper function to check per-feature whitelists (full canonical implementation)
      const isDomainWhitelisted = function(whitelist) {
        if (!whitelist || whitelist.trim() === "") return false;

        const hostname = window.location.hostname;
        if (!hostname) return false;

        const patterns = whitelist.split(",").map(s => s.trim()).filter(Boolean);

        return patterns.some(pattern => {
          const normalizedHostname = hostname.toLowerCase();
          const normalizedPattern = pattern.toLowerCase();
          const hasOnlyLeadingWildcard =
            normalizedPattern.startsWith("*") &&
            !normalizedPattern.startsWith("*.") &&
            normalizedPattern.indexOf("*", 1) === -1;

          // Exact match
          if (normalizedHostname === normalizedPattern) {
            return true;
          }

          // Prefix wildcard matching: webmail.*
          if (normalizedPattern.endsWith(".*")) {
            const prefix = normalizedPattern.slice(0, -2);  // Remove ".*"
            if (normalizedHostname.startsWith(prefix + ".")) {
              return true;
            }
          }

          // Suffix wildcard matching: *.example.com
          if (normalizedPattern.startsWith("*.")) {
            const domain = normalizedPattern.substring(2);  // Remove "*."
            if (normalizedHostname === domain) {
              return true;
            }
            if (normalizedHostname.endsWith("." + domain)) {
              return true;
            }
          } else if (hasOnlyLeadingWildcard) {
            // Handle *example.com format (no dot after asterisk)
            const domain = normalizedPattern.substring(1);  // Remove "*"
            if (normalizedHostname === domain) {
              return true;
            }
            if (normalizedHostname.endsWith("." + domain)) {
              return true;
            }
          }

          // Generic wildcard support for patterns like *localhost*
          if (
            normalizedPattern.includes("*") &&
            !normalizedPattern.endsWith(".*") &&
            !normalizedPattern.startsWith("*.") &&
            !hasOnlyLeadingWildcard
          ) {
            const escapedPattern = normalizedPattern
              .replace(/[.+?^{}$()|[\\]\\\\]/g, "\\\\$&")
              .replace(/\\*/g, ".*");
            const wildcardRegex = new RegExp("^" + escapedPattern + "$");
            if (wildcardRegex.test(normalizedHostname)) {
              return true;
            }
          }

          // Plain domain pattern (no wildcard): also match www. variant
          if (!normalizedPattern.includes("*")) {
            if (normalizedHostname === "www." + normalizedPattern) {
              return true;
            }
          }

          return false;
        });
      };

      // Helper to check if the caller is a known challenge script (Stack Trace Analysis)
      // This allows Cloudflare Turnstile to verify the browser (seeing clean data)
      // while other scripts on the page see noisy data (protection active).
      const shouldBypassForCaller = function(feature) {
        try {
          const err = new Error();
          if (!err.stack) return false;

          // Normalize stack trace to lowercase for case-insensitive matching
          const stack = err.stack.toLowerCase();

          // Check for Cloudflare/Turnstile keywords in the stack trace
          // STRICT MODE: Only trust scripts from the official Cloudflare challenge domain.
          // We exclude generic /cdn-cgi/ paths because they are used by sites for analytics/fingerprinting
          // and whitelisting them would break protection on many sites.
          const isChallenge = stack.includes('challenges.cloudflare.com');

          if (isChallenge) {
             debugLog(\`[Stealth Guard] Bypassing \${feature} for trusted caller in stack\`);
             return true;
          }
          return false;
        } catch(e) {
          return false;
        }
      };

      // Helper to make functions look native (toString stealth)
      const makeNative = (func, originalName) => {
        const nativeToString = function() {
          return \`function \${originalName}() { [native code] }\`;
        };
        // Mask the toString function itself to look native
        Object.defineProperty(nativeToString, 'toString', {
          value: function() { return "function toString() { [native code] }"; }
        });

        Object.defineProperty(func, 'name', { value: originalName });
        Object.defineProperty(func, 'toString', {
          value: nativeToString,
          configurable: true,
          writable: true
        });
        return func;
      };

      debugLog("[Stealth Guard] Inline protections activating...");

    // ========== CANVAS PROTECTION ==========
    if (config.enabled && config.canvas && config.canvas.enabled && !isDomainWhitelisted(config.canvas.whitelist)) {
      const getImageData = CanvasRenderingContext2D.prototype.getImageData;

      // Helper function to add noise efficiently
      const addCanvasNoise = function(imageData) {
        const shift = {
          'r': Math.floor(Math.random() * 10) - 5,
          'g': Math.floor(Math.random() * 10) - 5,
          'b': Math.floor(Math.random() * 10) - 5,
          'a': Math.floor(Math.random() * 10) - 5
        };

        const width = imageData.width;
        const height = imageData.height;
        const totalPixels = width * height;

        // Performance optimization: Skip very large canvases (unlikely to be fingerprinting)
        if (totalPixels > 1000000) { // >1000x1000
          debugLog('[Canvas] Skipping noise for large canvas:', width + 'x' + height);
          return imageData;
        }

        // For small canvases (<256x256): Process all pixels (actual fingerprinting canvases)
        // For medium canvases: Sample every 4th pixel for performance
        const step = totalPixels < 65536 ? 1 : 4; // 256x256 = 65536

        for (let i = 0; i < height; i += step) {
          for (let j = 0; j < width; j += step) {
            const n = ((i * (width * 4)) + (j * 4));
            imageData.data[n + 0] = imageData.data[n + 0] + shift.r;
            imageData.data[n + 1] = imageData.data[n + 1] + shift.g;
            imageData.data[n + 2] = imageData.data[n + 2] + shift.b;
            imageData.data[n + 3] = imageData.data[n + 3] + shift.a;
          }
        }

        return imageData;
      };

      // Direct function replacement (faster than Proxy)
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function() {
        const context = this.getContext("2d");
        if (context && this.width && this.height) {
          // Get a copy of the canvas data
          const imageData = getImageData.apply(context, [0, 0, this.width, this.height]);

          // Add noise efficiently
          addCanvasNoise(imageData);

          // Create a temporary canvas with the noised data
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = this.width;
          tempCanvas.height = this.height;
          const tempContext = tempCanvas.getContext('2d');
          tempContext.putImageData(imageData, 0, 0);

          window.top.postMessage("stealth-guard-canvas-alert", '*');

          // Call toBlob on the temp canvas instead
          return originalToBlob.apply(tempCanvas, arguments);
        }
        return originalToBlob.apply(this, arguments);
      };

      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        const context = this.getContext("2d");
        if (context && this.width && this.height) {
          // Get a copy of the canvas data
          const imageData = getImageData.apply(context, [0, 0, this.width, this.height]);

          // Add noise efficiently
          addCanvasNoise(imageData);

          // Create a temporary canvas with the noised data
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = this.width;
          tempCanvas.height = this.height;
          const tempContext = tempCanvas.getContext('2d');
          tempContext.putImageData(imageData, 0, 0);

          window.top.postMessage("stealth-guard-canvas-alert", '*');

          // Call toDataURL on the temp canvas instead
          return originalToDataURL.apply(tempCanvas, arguments);
        }
        return originalToDataURL.apply(this, arguments);
      };

      CanvasRenderingContext2D.prototype.getImageData = function() {
        const imageData = getImageData.apply(this, arguments);
        addCanvasNoise(imageData);
        window.top.postMessage("stealth-guard-canvas-alert", '*');
        return imageData;
      };

      debugLog("[Stealth Guard] Canvas protection activated");
    }


    // ========== WEBGL PROTECTION ==========
    // Inspired by WebGL Fingerprint Defender - comprehensive parameter spoofing
    if (config.enabled && config.webgl && config.webgl.enabled && !isDomainWhitelisted(config.webgl.whitelist)) {
      // Random helper functions (from WebGL Fingerprint Defender)
      const randomConfig = {
        random: {
          value: function() {
            return Math.random();
          },
          item: function(e) {
            let rand = e.length * randomConfig.random.value();
            return e[Math.floor(rand)];
          },
          number: function(power) {
            let tmp = [];
            for (let i = 0; i < power.length; i++) {
              tmp.push(Math.pow(2, power[i]));
            }
            return randomConfig.random.item(tmp);
          },
          int: function(power) {
            let tmp = [];
            for (let i = 0; i < power.length; i++) {
              let n = Math.pow(2, power[i]);
              tmp.push(new Int32Array([n, n]));
            }
            return randomConfig.random.item(tmp);
          },
          float: function(power) {
            let tmp = [];
            for (let i = 0; i < power.length; i++) {
              let n = Math.pow(2, power[i]);
              tmp.push(new Float32Array([1, n]));
            }
            return randomConfig.random.item(tmp);
          }
        }
      };

      // Define WebGL device presets with consistent device-specific info
      const WEBGL_PRESETS = {
        apple: {
          vendor: "Apple Inc.",
          unmaskedVendor: "Apple Inc.",
          renderer: ["Apple GPU", "Apple M1", "Apple M2"],
          contextName: "WebKit",
          version: "WebGL 1.0 (OpenGL ES 2.0 Metal)",
          shadingLanguageVersion: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Metal)",
          description: "Apple"
        },
        pixel_4: {
          vendor: "Google Inc. (Qualcomm)",
          unmaskedVendor: "Qualcomm",
          renderer: ["Adreno (TM) 640", "Adreno (TM) 640"],
          contextName: "WebKit WebGL",
          version: "WebGL 1.0 (OpenGL ES 3.0 Chromium)",
          shadingLanguageVersion: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 3.00)",
          description: "Pixel 4"
        },
        surface_pro_7: {
          vendor: "Google Inc. (Intel)",
          unmaskedVendor: "Intel Inc.",
          renderer: ["Intel(R) Iris(R) Plus Graphics", "Intel(R) Iris(R) Plus Graphics 640"],
          contextName: "WebKit WebGL",
          version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
          shadingLanguageVersion: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.00 Chromium)",
          description: "Surface Pro 7"
        }
      };

      // Determine which preset to use
      let preset = config.webgl.preset || "auto";
      if (preset === "auto") {
        // Auto-select based on user-agent
        const uaPreset = config.useragent?.preset || "macos";
        const presetMap = {
          macos: "apple",
          macos_chrome: "apple",
          windows: "surface_pro_7",
          iphone: "apple",
          android: "pixel_4"
        };
        preset = presetMap[uaPreset] || "apple";
      }

      const deviceInfo = WEBGL_PRESETS[preset] || WEBGL_PRESETS.apple;

      // Helper function to spoof WebGL parameters
      const spoofParameter = function(target) {
        let proto = target.prototype ? target.prototype : target.__proto__;

        proto.getParameter = new Proxy(proto.getParameter, {
          apply(target, self, args) {
            // Bypass for Turnstile/Cloudflare scripts
            if (shouldBypassForCaller('webgl')) {
              return Reflect.apply(target, self, args);
            }

            window.top.postMessage("stealth-guard-webgl-alert", '*');

            // Comprehensive parameter spoofing with consistent device-specific values
            if (args[0] === 3415) return 0;  // GL_ALPHA_BITS
            else if (args[0] === 3414) return 24;  // GL_DEPTH_BITS
            else if (args[0] === 36348) return 30;  // GL_MAX_VERTEX_UNIFORM_COMPONENTS
            else if (args[0] === 7936) return deviceInfo.vendor;  // GL_VENDOR
            else if (args[0] === 37445) return deviceInfo.unmaskedVendor;  // GL_UNMASKED_VENDOR_WEBGL
            else if (args[0] === 7937) return deviceInfo.contextName;  // GL_RENDERER
            else if (args[0] === 3379) return randomConfig.random.number([14, 15]);  // GL_MAX_TEXTURE_SIZE
            else if (args[0] === 36347) return randomConfig.random.number([12, 13]);  // GL_MAX_TEXTURE_IMAGE_UNITS
            else if (args[0] === 34076) return randomConfig.random.number([14, 15]);  // GL_MAX_RENDERBUFFER_SIZE
            else if (args[0] === 34024) return randomConfig.random.number([14, 15]);  // GL_MAX_CUBE_MAP_TEXTURE_SIZE
            else if (args[0] === 3386) return randomConfig.random.int([13, 14, 15]);  // GL_VIEWPORT_BITS
            else if (args[0] === 3413) return randomConfig.random.number([1, 2, 3, 4]);  // GL_RED_BITS
            else if (args[0] === 3412) return randomConfig.random.number([1, 2, 3, 4]);  // GL_BLUE_BITS
            else if (args[0] === 3411) return randomConfig.random.number([1, 2, 3, 4]);  // GL_GREEN_BITS
            else if (args[0] === 3410) return randomConfig.random.number([1, 2, 3, 4]);  // GL_ALPHA_BITS (again)
            else if (args[0] === 34047) return randomConfig.random.number([1, 2, 3, 4]);  // GL_STENCIL_BITS
            else if (args[0] === 34930) return randomConfig.random.number([1, 2, 3, 4]);  // GL_MAX_VARYING_VECTORS
            else if (args[0] === 34921) return randomConfig.random.number([1, 2, 3, 4]);  // GL_MAX_VERTEX_ATTRIBS
            else if (args[0] === 35660) return randomConfig.random.number([1, 2, 3, 4]);  // GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS
            else if (args[0] === 35661) return randomConfig.random.number([4, 5, 6, 7, 8]);  // GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT
            else if (args[0] === 36349) return randomConfig.random.number([10, 11, 12, 13]);  // GL_MAX_FRAGMENT_UNIFORM_VECTORS
            else if (args[0] === 33902) return randomConfig.random.float([0, 10, 11, 12, 13]);  // GL_ALIASED_LINE_WIDTH_RANGE
            else if (args[0] === 33901) return randomConfig.random.float([0, 10, 11, 12, 13]);  // GL_ALIASED_POINT_SIZE_RANGE
            else if (args[0] === 37446) return randomConfig.random.item(deviceInfo.renderer);  // GL_UNMASKED_RENDERER_WEBGL
            else if (args[0] === 7938) return deviceInfo.version;  // GL_VERSION
            else if (args[0] === 35724) return deviceInfo.shadingLanguageVersion;  // GL_SHADING_LANGUAGE_VERSION

            return Reflect.apply(target, self, args);
          }
        });
      };

      // Helper function to add noise to buffer data
      const spoofBuffer = function(target) {
        let proto = target.prototype ? target.prototype : target.__proto__;

        proto.bufferData = new Proxy(proto.bufferData, {
          apply(target, self, args) {
            // Bypass for Turnstile/Cloudflare scripts
            if (shouldBypassForCaller('webgl')) {
              return Reflect.apply(target, self, args);
            }

            let index = Math.floor(randomConfig.random.value() * args[1].length);
            let noise = args[1][index] !== undefined ? 0.1 * randomConfig.random.value() * args[1][index] : 0;
            args[1][index] = args[1][index] + noise;
            window.top.postMessage("stealth-guard-webgl-alert", '*');
            return Reflect.apply(target, self, args);
          }
        });
      };

      // Apply protection to both WebGL 1.0 and WebGL 2.0
      try {
        if (typeof WebGLRenderingContext !== 'undefined') {
          spoofParameter(WebGLRenderingContext);
          spoofBuffer(WebGLRenderingContext);
          debugLog("[Stealth Guard] WebGL 1.0 protection activated:", deviceInfo.description);
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect WebGLRenderingContext:", e);
      }

      try {
        if (typeof WebGL2RenderingContext !== 'undefined') {
          spoofParameter(WebGL2RenderingContext);
          spoofBuffer(WebGL2RenderingContext);
          debugLog("[Stealth Guard] WebGL 2.0 protection activated:", deviceInfo.description);
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect WebGL2RenderingContext:", e);
      }

      // Iframe sandboxing - sync protections to child frames
      const mkey = "stealth-guard-webgl-sandboxed-frame";
      document.documentElement.setAttribute(mkey, '');

      window.addEventListener("message", function(e) {
        if (e.data && e.data === mkey) {
          e.preventDefault();
          e.stopPropagation();

          try {
            if (e.source && e.source.WebGLRenderingContext) {
              e.source.WebGLRenderingContext.prototype.getParameter = WebGLRenderingContext.prototype.getParameter;
              e.source.WebGLRenderingContext.prototype.bufferData = WebGLRenderingContext.prototype.bufferData;
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.WebGL2RenderingContext) {
              e.source.WebGL2RenderingContext.prototype.getParameter = WebGL2RenderingContext.prototype.getParameter;
              e.source.WebGL2RenderingContext.prototype.bufferData = WebGL2RenderingContext.prototype.bufferData;
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }, false);
    }

    // ========== FONT PROTECTION ==========
    if (config.enabled && config.font && config.font.enabled && !isDomainWhitelisted(config.font.whitelist)) {
      // Random noise functions - from Font Fingerprint Defender
      const rand = {
        noise: function() {
          const SIGN = Math.random() < Math.random() ? -1 : 1;
          return Math.floor(Math.random() + SIGN * Math.random());
        },
        sign: function() {
          const tmp = [-1, -1, -1, -1, -1, -1, +1, -1, -1, -1];
          const index = Math.floor(Math.random() * tmp.length);
          return tmp[index];
        }
      };

      // Font protection: Inspired by Font Fingerprint Defender
      // Main fingerprinting vector is offsetWidth/offsetHeight, not canvas.measureText
      // Add subtle random noise to make font fingerprinting unreliable

      let fontAlertSent = false;

      // Intercept offsetWidth - the PRIMARY font fingerprinting API
      try {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
          "get": new Proxy(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth").get, {
            apply(target, self, args) {
              // Bypass for Turnstile/Cloudflare scripts
              if (shouldBypassForCaller('font')) {
                return Reflect.apply(target, self, args);
              }

              const width = Math.floor(self.getBoundingClientRect().width);
              const valid = width && rand.sign() === 1; // Only add noise 10% of the time
              const result = valid ? width + rand.noise() : width;

              // Send alert when noise is actually added
              if (valid && result !== width && !fontAlertSent) {
                window.top.postMessage("stealth-guard-font-alert", '*');
                fontAlertSent = true;
              }

              return result;
            }
          })
        });

        // Intercept offsetHeight - also used for font fingerprinting
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
          "get": new Proxy(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight").get, {
            apply(target, self, args) {
              // Bypass for Turnstile/Cloudflare scripts
              if (shouldBypassForCaller('font')) {
                return Reflect.apply(target, self, args);
              }

              try {
                const height = Math.floor(self.getBoundingClientRect().height);
                const valid = height && rand.sign() === 1; // Only add noise 10% of the time
                const result = valid ? height + rand.noise() : height;

                // Send alert when noise is actually added
                if (valid && result !== height && !fontAlertSent) {
                  window.top.postMessage("stealth-guard-font-alert", '*');
                  fontAlertSent = true;
                }

                return result;
              } catch (e) {
                // Fallback to original implementation
              }
            }
          })
        });

        debugLog('[Stealth Guard] Font protection: offsetWidth/offsetHeight intercepted with random noise');

      } catch (e) {
        debugWarn('[Font Debug] Failed to intercept offsetWidth/offsetHeight:', e);
      }

      // Also protect canvas.measureText (secondary vector)
      try {
        const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function() {
          // Bypass for Turnstile/Cloudflare scripts
          if (shouldBypassForCaller('font')) {
            return originalMeasureText.apply(this, arguments);
          }

          const result = originalMeasureText.apply(this, arguments);

          // Only add noise 10% of the time
          const valid = rand.sign() === 1;
          if (!valid) {
            return result;
          }

          // Send alert when noise is actually added
          if (!fontAlertSent) {
            window.top.postMessage("stealth-guard-font-alert", '*');
            fontAlertSent = true;
          }

          // Add random noise (+1 or -1 pixel)
          const noise = rand.noise();

          // Create new object with all TextMetrics properties
          return {
            width: result.width + noise,
            actualBoundingBoxLeft: result.actualBoundingBoxLeft || 0,
            actualBoundingBoxRight: result.actualBoundingBoxRight ? result.actualBoundingBoxRight + noise : result.width + noise,
            actualBoundingBoxAscent: result.actualBoundingBoxAscent || 0,
            actualBoundingBoxDescent: result.actualBoundingBoxDescent || 0,
            fontBoundingBoxAscent: result.fontBoundingBoxAscent || 0,
            fontBoundingBoxDescent: result.fontBoundingBoxDescent || 0,
            emHeightAscent: result.emHeightAscent || 0,
            emHeightDescent: result.emHeightDescent || 0,
            hangingBaseline: result.hangingBaseline || 0,
            alphabeticBaseline: result.alphabeticBaseline || 0,
            ideographicBaseline: result.ideographicBaseline || 0
          };
        };

        debugLog('[Stealth Guard] Font protection: canvas.measureText intercepted');

      } catch (e) {
        debugWarn('[Font Debug] Failed to intercept canvas.measureText:', e);
      }

      // Iframe sandboxing - sync protections to child frames (from Font Fingerprint Defender)
      const mkey = "stealth-guard-sandboxed-frame";
      document.documentElement.setAttribute(mkey, '');

      window.addEventListener("message", function(e) {
        if (e.data && e.data === mkey) {
          e.preventDefault();
          e.stopPropagation();

          if (e.source && e.source.HTMLElement) {
            // Sync offsetWidth/offsetHeight to iframe
            Object.defineProperty(e.source.HTMLElement.prototype, "offsetWidth", {
              "get": Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth").get
            });

            Object.defineProperty(e.source.HTMLElement.prototype, "offsetHeight", {
              "get": Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight").get
            });
          }
        }
      }, false);

      debugLog("[Stealth Guard] Font protection activated");
    }

    // ========== TIMEZONE PROTECTION ==========
    if (config.enabled && config.timezone && config.timezone.enabled) {
      // Check per-feature whitelist first
      if (isDomainWhitelisted(config.timezone.whitelist)) {
        debugLog("[Stealth Guard] Timezone protection bypassed - domain is whitelisted");
      } else {
        const options = {
          value: config.timezone.offset || -300,
          name: config.timezone.name || "America/New_York"
        };

        try {
          let timezoneAlertSent = false;
          const getTimezoneOffset = Date.prototype.getTimezoneOffset;

        const processedNames = [
          "_date", "_offset", "getTime", "setTime", "getTimezoneOffset",
          "toJSON", "valueOf", "constructor", "toString", "toGMTString", "toISOString",
          "getUTCDay", "getUTCDate", "getUTCMonth", "getUTCHours",
          "getUTCMinutes", "getUTCSeconds", "getUTCFullYear", "getUTCMilliseconds",
          "toTimeString", "toLocaleString", "toLocaleTimeString", "toLocaleDateString"
        ];

        const propertyNames = Object.getOwnPropertyNames(Date.prototype).filter(function (item) {
          return processedNames.indexOf(item) === -1;
        });

        const convertToGMT = function (n) {
          const format = function (v) {return (v < 10 ? '0' : '') + v};
          return (n <= 0 ? '+' : '-') + format(Math.abs(n) / 60 | 0) + format(Math.abs(n) % 60);
        };

        Object.defineProperty(Date.prototype, "_offset", {
          "configurable": true,
          get() {
            return getTimezoneOffset.call(this);
          }
        });

        Object.defineProperty(Date.prototype, "_date", {
          configurable: true,
          get() {
            return this._newdate !== undefined ? this._newdate : new Date(this.getTime() + (this._offset - options.value) * 60 * 1000);
          }
        });

        Date.prototype.getTimezoneOffset = new Proxy(Date.prototype.getTimezoneOffset, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return isNaN(self) ? Reflect.apply(target, self, args) : options.value;
          }
        });

        Date.prototype.toString = new Proxy(Date.prototype.toString, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return isNaN(self) ? Reflect.apply(target, self, args) : self.toDateString() + ' ' + self.toTimeString();
          }
        });

        Date.prototype.toLocaleString = new Proxy(Date.prototype.toLocaleString, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            args[1] = args[1] !== undefined ? args[1] : {};
            args[1].timeZone = options.name;
            return isNaN(self) ? Reflect.apply(target, self, args) : Reflect.apply(target, self, args);
          }
        });

        Date.prototype.toLocaleDateString = new Proxy(Date.prototype.toLocaleDateString, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            args[1] = args[1] !== undefined ? args[1] : {};
            args[1].timeZone = options.name;
            return isNaN(self) ? Reflect.apply(target, self, args) : Reflect.apply(target, self, args);
          }
        });

        Date.prototype.toLocaleTimeString = new Proxy(Date.prototype.toLocaleTimeString, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            args[1] = args[1] !== undefined ? args[1] : {};
            args[1].timeZone = options.name;
            return isNaN(self) ? Reflect.apply(target, self, args) : Reflect.apply(target, self, args);
          }
        });

        Date.prototype.toTimeString = new Proxy(Date.prototype.toTimeString, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            const result = Reflect.apply(target, self._date, args);
            const replace_1 = convertToGMT(self._offset);
            const replace_2 = convertToGMT(options.value);
            const replace_3 = "(" + options.name.replace(/\\//g, " ") + " Standard Time)";
            return isNaN(self) ? Reflect.apply(target, self, args) : result.replace(replace_1, replace_2).replace(/\\(.*\\)/, replace_3);
          }
        });

        propertyNames.forEach(function (name) {
          if (["setHours", "setMinutes", "setMonth", "setDate", "setYear", "setFullYear"].indexOf(name) !== -1) {
            Date.prototype[name] = new Proxy(Date.prototype[name], {
              apply(target, self, args) {
                if (isNaN(self)) {
                  return Reflect.apply(target, self, args);
                } else {
                  const adjusted = self._date.getTime();
                  const current = Reflect.apply(target, self._date, args);
                  const result = self.setTime(self.getTime() + current - adjusted);
                  return result;
                }
              }
            });
          } else if (["setUTCDate", "setUTCFullYear", "setUTCHours", "setUTCMinutes", "setUTCMonth", "setUTCSeconds", "setUTCMilliseconds"].indexOf(name) !== -1) {
            // Skip UTC setters - don't wrap them (Change Timezone skips these)
          } else {
            Date.prototype[name] = new Proxy(Date.prototype[name], {
              apply(target, self, args) {
                return isNaN(self) ? Reflect.apply(target, self, args) : Reflect.apply(target, self._date, args);
              }
            });
          }
        });

        Intl.DateTimeFormat.prototype.resolvedOptions = new Proxy(Intl.DateTimeFormat.prototype.resolvedOptions, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            const result = Reflect.apply(target, self, args);
            result.timeZone = options.name;
            return result;
          }
        });

        Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
          apply(target, self, args) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            args[1] = args[1] !== undefined ? args[1] : {};
            args[1].timeZone = options.name;
            return Reflect.apply(target, self, args);
          },
          construct(target, args, newTarget) {
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            args[1] = args[1] !== undefined ? args[1] : {};
            args[1].timeZone = options.name;
            return Reflect.construct(target, args, newTarget);
          }
        });

          debugLog("[Stealth Guard] Timezone protection activated:", options.name);
        } catch(e) {
          debugError("[Stealth Guard] Timezone protection failed:", e);
        }
      }
    }

    // ========== CLIENTRECTS FINGERPRINT PROTECTION ==========
    if (config.enabled && config.clientrects && config.clientrects.enabled && !isDomainWhitelisted(config.clientrects.whitelist)) {
      const noiseConfig = {
        "DOMRect": 0.00000001,
        "DOMRectReadOnly": 0.000001
      };

      const metrics = {
        "DOMRect": ['x', 'y', "width", "height"],
        "DOMRectReadOnly": ["top", "right", "bottom", "left"]
      };

      let clientrectsAlertSent = false;

      // Protect DOMRect properties
      const domRectMetric = metrics.DOMRect.sort(() => 0.5 - Math.random())[0];
      try {
        Object.defineProperty(DOMRect.prototype, domRectMetric, {
          "get": new Proxy(Object.getOwnPropertyDescriptor(DOMRect.prototype, domRectMetric).get, {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              const noise = result * (1 + (Math.random() < 0.5 ? -1 : +1) * noiseConfig.DOMRect);

              if (!clientrectsAlertSent) {
                window.top.postMessage("stealth-guard-clientrects-alert", '*');
                clientrectsAlertSent = true;
              }

              return noise;
            }
          })
        });
        debugLog("[Stealth Guard] ClientRects: DOMRect." + domRectMetric + " protected");
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect DOMRect." + domRectMetric + ":", e);
      }

      // Protect DOMRectReadOnly properties
      const domRectReadOnlyMetric = metrics.DOMRectReadOnly.sort(() => 0.5 - Math.random())[0];
      try {
        Object.defineProperty(DOMRectReadOnly.prototype, domRectReadOnlyMetric, {
          "get": new Proxy(Object.getOwnPropertyDescriptor(DOMRectReadOnly.prototype, domRectReadOnlyMetric).get, {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              const noise = result * (1 + (Math.random() < 0.5 ? -1 : +1) * noiseConfig.DOMRectReadOnly);

              if (!clientrectsAlertSent) {
                window.top.postMessage("stealth-guard-clientrects-alert", '*');
                clientrectsAlertSent = true;
              }

              return noise;
            }
          })
        });
        debugLog("[Stealth Guard] ClientRects: DOMRectReadOnly." + domRectReadOnlyMetric + " protected");
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect DOMRectReadOnly." + domRectReadOnlyMetric + ":", e);
      }

      // Iframe sandboxing - sync protections to child frames
      const mkey = "stealth-guard-clientrects-sandboxed-frame";
      document.documentElement.setAttribute(mkey, '');

      window.addEventListener("message", function(e) {
        if (e.data && e.data === mkey) {
          e.preventDefault();
          e.stopPropagation();

          try {
            if (e.source.DOMRect) {
              for (let i = 0; i < metrics.DOMRect.length; i++) {
                Object.defineProperty(e.source.DOMRect.prototype, metrics.DOMRect[i], {
                  "get": Object.getOwnPropertyDescriptor(DOMRect.prototype, metrics.DOMRect[i]).get
                });
              }
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source.DOMRectReadOnly) {
              for (let i = 0; i < metrics.DOMRectReadOnly.length; i++) {
                Object.defineProperty(e.source.DOMRectReadOnly.prototype, metrics.DOMRectReadOnly[i], {
                  "get": Object.getOwnPropertyDescriptor(DOMRectReadOnly.prototype, metrics.DOMRectReadOnly[i]).get
                });
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }, false);

      debugLog("[Stealth Guard] ClientRects protection activated");
    }

    // ========== WEBGPU FINGERPRINT PROTECTION ==========
    if (config.enabled && config.webgpu && config.webgpu.enabled && !isDomainWhitelisted(config.webgpu.whitelist)) {
      const noiseConfig = {
        color: 0.01,      // 1% noise on color values
        percent: 0.1,     // Modify 10% of buffer elements
        buffer: 0.0001    // 0.01% noise on buffer values
      };

      let webgpuAlertSent = false;

      // Protect GPUAdapter.prototype.limits
      try {
        if (typeof GPUAdapter !== 'undefined') {
          const _GPUAdapter = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, "limits").get;
          Object.defineProperty(GPUAdapter.prototype, "_limits", {
            "configurable": true,
            get() { return _GPUAdapter.call(this); }
          });

          Object.defineProperty(GPUAdapter.prototype, "limits", {
            "get": new Proxy(_GPUAdapter, {
              apply(target, self, args) {
                const result = Reflect.apply(target, self, args);

                const _maxBufferSize = self._limits.maxBufferSize;
                const _maxUniformBufferBindingSize = self._limits.maxUniformBufferBindingSize;
                const _maxStorageBufferBindingSize = self._limits.maxStorageBufferBindingSize;
                const _maxComputeWorkgroupStorageSize = self._limits.maxComputeWorkgroupStorageSize;

                Object.defineProperty(result.__proto__, "maxBufferSize", {
                  "configurable": true,
                  get() { return _maxBufferSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxUniformBufferBindingSize", {
                  "configurable": true,
                  get() { return _maxUniformBufferBindingSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxStorageBufferBindingSize", {
                  "configurable": true,
                  get() { return _maxStorageBufferBindingSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxComputeWorkgroupStorageSize", {
                  "configurable": true,
                  get() { return _maxComputeWorkgroupStorageSize + (Math.random() < 0.5 ? -1 : -2); }
                });

                if (!webgpuAlertSent) {
                  window.top.postMessage("stealth-guard-webgpu-alert", '*');
                  webgpuAlertSent = true;
                }

                return result;
              }
            })
          });
          debugLog("[Stealth Guard] WebGPU: GPUAdapter.limits protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect GPUAdapter.limits:", e);
      }

      // Protect GPUDevice.prototype.limits
      try {
        if (typeof GPUDevice !== 'undefined') {
          const _GPUDevice = Object.getOwnPropertyDescriptor(GPUDevice.prototype, "limits").get;
          Object.defineProperty(GPUDevice.prototype, "_limits", {
            "configurable": true,
            get() { return _GPUDevice.call(this); }
          });

          Object.defineProperty(GPUDevice.prototype, "limits", {
            "get": new Proxy(_GPUDevice, {
              apply(target, self, args) {
                const result = Reflect.apply(target, self, args);

                const _maxBufferSize = self._limits.maxBufferSize;
                const _maxUniformBufferBindingSize = self._limits.maxUniformBufferBindingSize;
                const _maxStorageBufferBindingSize = self._limits.maxStorageBufferBindingSize;
                const _maxComputeWorkgroupStorageSize = self._limits.maxComputeWorkgroupStorageSize;

                Object.defineProperty(result.__proto__, "maxBufferSize", {
                  "configurable": true,
                  get() { return _maxBufferSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxUniformBufferBindingSize", {
                  "configurable": true,
                  get() { return _maxUniformBufferBindingSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxStorageBufferBindingSize", {
                  "configurable": true,
                  get() { return _maxStorageBufferBindingSize + (Math.random() < 0.5 ? -1 : -2); }
                });
                Object.defineProperty(result.__proto__, "maxComputeWorkgroupStorageSize", {
                  "configurable": true,
                  get() { return _maxComputeWorkgroupStorageSize + (Math.random() < 0.5 ? -1 : -2); }
                });

                if (!webgpuAlertSent) {
                  window.top.postMessage("stealth-guard-webgpu-alert", '*');
                  webgpuAlertSent = true;
                }

                return result;
              }
            })
          });
          debugLog("[Stealth Guard] WebGPU: GPUDevice.limits protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect GPUDevice.limits:", e);
      }

      // Protect GPUCommandEncoder.prototype.beginRenderPass
      try {
        if (typeof GPUCommandEncoder !== 'undefined') {
          GPUCommandEncoder.prototype.beginRenderPass = new Proxy(GPUCommandEncoder.prototype.beginRenderPass, {
            apply(target, self, args) {
              if (args && args[0] && args[0].colorAttachments && args[0].colorAttachments[0]) {
                if (args[0].colorAttachments[0].clearValue) {
                  try {
                    const metrics = args[0].colorAttachments[0].clearValue;
                    for (let key in metrics) {
                      let value = metrics[key];
                      value = value + (Math.random() < 0.5 ? -1 : -2) * noiseConfig.color * value;
                      value = (value < 0 ? -1 : +1) * value;
                      metrics[key] = value;
                    }
                    args[0].colorAttachments[0].clearValue = metrics;

                    if (!webgpuAlertSent) {
                      window.top.postMessage("stealth-guard-webgpu-alert", '*');
                      webgpuAlertSent = true;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              return Reflect.apply(target, self, args);
            }
          });
          debugLog("[Stealth Guard] WebGPU: GPUCommandEncoder.beginRenderPass protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect GPUCommandEncoder.beginRenderPass:", e);
      }

      // Protect GPUQueue.prototype.writeBuffer
      try {
        if (typeof GPUQueue !== 'undefined') {
          GPUQueue.prototype.writeBuffer = new Proxy(GPUQueue.prototype.writeBuffer, {
            apply(target, self, args) {
              if (args && args[2]) {
                const flag = (args[2] instanceof ArrayBuffer) || (args[2] instanceof Float32Array);
                if (flag) {
                  try {
                    const metrics = args[2];
                    const array = Array(metrics.length).fill(0).map((n, i) => n + i);
                    const count = Math.ceil(metrics.length * noiseConfig.percent);
                    const shuffled = array.sort(() => 0.5 - Math.random());
                    const selected = [...shuffled.slice(0, count)];

                    for (let i = 0; i < selected.length; i++) {
                      const index = selected[i];
                      const value = metrics[index];
                      metrics[index] = value + (Math.random() < 0.5 ? -noiseConfig.buffer * value : +noiseConfig.buffer * value);
                    }

                    args[2] = metrics;

                    if (!webgpuAlertSent) {
                      window.top.postMessage("stealth-guard-webgpu-alert", '*');
                      webgpuAlertSent = true;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              return Reflect.apply(target, self, args);
            }
          });
          debugLog("[Stealth Guard] WebGPU: GPUQueue.writeBuffer protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect GPUQueue.writeBuffer:", e);
      }

      // Iframe sandboxing - sync protections to child frames
      const mkey = "stealth-guard-webgpu-sandboxed-frame";
      document.documentElement.setAttribute(mkey, '');

      window.addEventListener("message", function(e) {
        if (e.data && e.data === mkey) {
          e.preventDefault();
          e.stopPropagation();

          try {
            if (e.source && e.source.GPUQueue) {
              e.source.GPUQueue.prototype.writeBuffer = GPUQueue.prototype.writeBuffer;
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.GPUCommandEncoder) {
              e.source.GPUCommandEncoder.prototype.beginRenderPass = GPUCommandEncoder.prototype.beginRenderPass;
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.GPUAdapter) {
              Object.defineProperty(e.source.GPUAdapter.prototype, "limits", {
                "get": Object.getOwnPropertyDescriptor(GPUAdapter.prototype, "limits").get
              });
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.GPUDevice) {
              Object.defineProperty(e.source.GPUDevice.prototype, "limits", {
                "get": Object.getOwnPropertyDescriptor(GPUDevice.prototype, "limits").get
              });
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }, false);

      debugLog("[Stealth Guard] WebGPU protection activated");
    }

    // ========== AUDIOCONTEXT FINGERPRINT PROTECTION ==========
    if (config.enabled && config.audiocontext && config.audiocontext.enabled && !isDomainWhitelisted(config.audiocontext.whitelist)) {
      let audiocontextAlertSent = false;

      const audioContext = {
        BUFFER: null,
        getChannelData: function(AudioBufferPrototype) {
          AudioBufferPrototype.prototype.getChannelData = new Proxy(AudioBufferPrototype.prototype.getChannelData, {
            apply(target, self, args) {
              const results = Reflect.apply(target, self, args);

              if (audioContext.BUFFER !== results) {
                audioContext.BUFFER = results;

                if (!audiocontextAlertSent) {
                  window.top.postMessage("stealth-guard-audiocontext-alert", '*');
                  audiocontextAlertSent = true;
                }

                // Add minimal noise to every 100th sample
                for (let i = 0; i < results.length; i += 100) {
                  const index = Math.floor(Math.random() * i);
                  results[index] = results[index] + Math.random() * 0.0000001;
                }
              }

              return results;
            }
          });
        },
        createAnalyser: function(AudioContextPrototype) {
          AudioContextPrototype.prototype.__proto__.createAnalyser = new Proxy(
            AudioContextPrototype.prototype.__proto__.createAnalyser,
            {
              apply(target, self, args) {
                const results = Reflect.apply(target, self, args);

                results.__proto__.getFloatFrequencyData = new Proxy(
                  results.__proto__.getFloatFrequencyData,
                  {
                    apply(target, self, args) {
                      const results = Reflect.apply(target, self, args);

                      if (!audiocontextAlertSent) {
                        window.top.postMessage("stealth-guard-audiocontext-alert", '*');
                        audiocontextAlertSent = true;
                      }

                      // Add noise to frequency data
                      for (let i = 0; i < arguments[0].length; i += 100) {
                        const index = Math.floor(Math.random() * i);
                        arguments[0][index] = arguments[0][index] + Math.random() * 0.1;
                      }

                      return results;
                    }
                  }
                );

                return results;
              }
            }
          );
        }
      };

      try {
        if (typeof AudioBuffer !== 'undefined') {
          audioContext.getChannelData(AudioBuffer);
          debugLog("[Stealth Guard] AudioContext: AudioBuffer.getChannelData protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect AudioBuffer.getChannelData:", e);
      }

      try {
        if (typeof AudioContext !== 'undefined') {
          audioContext.createAnalyser(AudioContext);
          debugLog("[Stealth Guard] AudioContext: AudioContext.createAnalyser protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect AudioContext.createAnalyser:", e);
      }

      try {
        if (typeof OfflineAudioContext !== 'undefined') {
          audioContext.createAnalyser(OfflineAudioContext);
          debugLog("[Stealth Guard] AudioContext: OfflineAudioContext.createAnalyser protected");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect OfflineAudioContext.createAnalyser:", e);
      }

      // Iframe sandboxing - sync protections to child frames
      const mkey = "stealth-guard-audiocontext-sandboxed-frame";
      document.documentElement.setAttribute(mkey, '');

      window.addEventListener("message", function(e) {
        if (e.data && e.data === mkey) {
          e.preventDefault();
          e.stopPropagation();

          try {
            if (e.source && e.source.AudioBuffer && e.source.AudioBuffer.prototype) {
              if (e.source.AudioBuffer.prototype.getChannelData) {
                e.source.AudioBuffer.prototype.getChannelData = AudioBuffer.prototype.getChannelData;
              }
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.AudioContext && e.source.AudioContext.prototype) {
              if (e.source.AudioContext.prototype.__proto__ && e.source.AudioContext.prototype.__proto__.createAnalyser) {
                e.source.AudioContext.prototype.__proto__.createAnalyser = AudioContext.prototype.__proto__.createAnalyser;
              }
            }
          } catch (e) {
            // Ignore errors
          }

          try {
            if (e.source && e.source.OfflineAudioContext && e.source.OfflineAudioContext.prototype) {
              if (e.source.OfflineAudioContext.prototype.__proto__ && e.source.OfflineAudioContext.prototype.__proto__.createAnalyser) {
                e.source.OfflineAudioContext.prototype.__proto__.createAnalyser = OfflineAudioContext.prototype.__proto__.createAnalyser;
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }, false);

      debugLog("[Stealth Guard] AudioContext protection activated");
    }

    // ========== USER-AGENT PROTECTION ==========
    // Critical: Log the decision for debugging Turnstile bypass
    const uaEnabled = config.enabled && config.useragent && config.useragent.enabled;

    // CRITICAL FIX: Skip UA protection for frames with empty hostname
    // These are about:blank, blob:, data: URLs or sandboxed iframes
    // They cannot access sessionStorage and are often used by Cloudflare Turnstile
    // Spoofing UA in these frames breaks Turnstile verification
    const currentHostname = window.location.hostname;
    const isEmptyHostnameFrame = !currentHostname || currentHostname === '';

    const shouldActivateUA = uaEnabled && !hasTurnstile && !turnstileBypassActive && !isEmptyHostnameFrame;

    debugLog('[Stealth Guard] UA Protection Decision:', {
      uaEnabled: uaEnabled,
      hasTurnstile: hasTurnstile,
      turnstileBypassActive: turnstileBypassActive,
      isEmptyHostnameFrame: isEmptyHostnameFrame,
      willActivate: shouldActivateUA,
      hostname: currentHostname
    });

    if (shouldActivateUA) {
      // User-Agent presets (5 core presets)
      const USER_AGENT_PRESETS = {
        macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        macos_chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
        android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
      };

      // Determine which preset to use
      const preset = config.useragent.preset || "macos";
      const userAgent = USER_AGENT_PRESETS[preset] || USER_AGENT_PRESETS.macos;

      // Platform detection (inspired by UA Switcher Pro's createUAObject function)
      let platform = /Mac|iPod|iPhone|iPad/.test(userAgent) ? "MacIntel" : /Win/.test(userAgent) ? "Win32" : "Linux x86_64";
      let oscpu = "";
      let platformVersion = "";

      // Enhanced platform-specific detection
      if (/iPhone/.test(userAgent)) {
        platform = "iPhone";
        const match = userAgent.match(/CPU iPhone OS ([\\d_]+)/);
        oscpu = match ? "iPhone OS " + match[1].replace(/_/g, ".") : "iPhone OS 17.4.1";
        platformVersion = "17.0.0";
      } else if (/iPad/.test(userAgent)) {
        platform = "iPad";
        const match = userAgent.match(/CPU OS ([\\d_]+)/);
        oscpu = match ? "iPad OS " + match[1].replace(/_/g, ".") : "iPad OS 17.4.1";
        platformVersion = "17.0.0";
      } else if (/Android/.test(userAgent)) {
        platform = "Linux armv8l";
        const match = userAgent.match(/Android ([\\d.]+)/);
        oscpu = match ? "Linux; Android " + match[1] : "Linux; Android 14";
        platformVersion = "14.0.0";
      } else if (/Mac OS X/.test(userAgent)) {
        platform = "MacIntel";
        const match = userAgent.match(/Mac OS X (\\d+_\\d+_\\d+)/);
        oscpu = match ? "Intel Mac OS X " + match[1].replace(/_/g, ".") : "Intel Mac OS X 10.15.7";
        platformVersion = "15.0.0";
      } else if (/Linux/.test(userAgent) && !/Android/.test(userAgent)) {
        platform = "Linux x86_64";
        oscpu = "Linux x86_64";
        platformVersion = "";
      } else if (/Win/.test(userAgent)) {
        platform = "Win32";
        const match = userAgent.match(/Windows NT ([\\d.]+)/);
        oscpu = match ? "Windows NT " + match[1] + "; Win64; x64" : "Windows NT 10.0; Win64; x64";
        platformVersion = "10.0.0";
      }

      // Store original descriptors
      const originalUA = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent");
      const originalPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
      const originalAppVersion = Object.getOwnPropertyDescriptor(Navigator.prototype, "appVersion");
      const originalVendor = Object.getOwnPropertyDescriptor(Navigator.prototype, "vendor");

      // Dynamic spoofing control
      let shouldSpoof = true;

      // Override userAgent
      try {
        Object.defineProperty(Navigator.prototype, "userAgent", {
          get: function () {
            if (!shouldSpoof) return originalUA ? originalUA.get.call(this) : userAgent; // Fallback or original
            window.top.postMessage("stealth-guard-useragent-alert", '*');
            return userAgent;
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Could not override userAgent:", e);
      }

      // Override platform
      try {
        Object.defineProperty(Navigator.prototype, "platform", {
          get: function () {
            if (!shouldSpoof) return originalPlatform ? originalPlatform.get.call(this) : platform;
            return platform;
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Could not override platform:", e);
      }

      // Override appVersion
      try {
        Object.defineProperty(Navigator.prototype, "appVersion", {
          get: function () {
            if (!shouldSpoof) return originalAppVersion ? originalAppVersion.get.call(this) : "";
            const versionStart = userAgent.indexOf('/');
            return versionStart !== -1 ? userAgent.substring(versionStart + 1) : "5.0";
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Could not override appVersion:", e);
      }

      // Override vendor
      try {
        Object.defineProperty(Navigator.prototype, "vendor", {
          get: function () {
            if (!shouldSpoof) return originalVendor ? originalVendor.get.call(this) : "";
            if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
              return "Google Inc.";
            } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
              return "Apple Computer, Inc.";
            } else if (userAgent.includes("Firefox")) {
              return "";
            }
            return "";
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Could not override vendor:", e);
      }

      // Override userAgentData (for Chromium browsers)
      if (navigator.userAgentData) {
        try {
          Object.defineProperty(Navigator.prototype, "userAgentData", {
            get: function () {
              if (!shouldSpoof) return undefined; // Ideally restore original, but undefined is safer than spoofed for now
              return undefined;
            },
            configurable: true,
            enumerable: true
          });
        } catch (e) {
          debugWarn("[Stealth Guard] Could not override userAgentData:", e);
        }
      }

      // Override oscpu (Firefox)
      if ("oscpu" in Navigator.prototype) {
        try {
          Object.defineProperty(Navigator.prototype, "oscpu", {
            get: function () {
              return oscpu;
            },
            configurable: true,
            enumerable: true
          });
        } catch (e) {
          debugWarn("[Stealth Guard] Could not override oscpu:", e);
        }
      }

      // Async check to see if we should disable spoofing for Turnstile
      // This helps frames that didn't get the sessionStorage flag (cross-origin/sandboxed)
      try {
        // Use a unique event name to communicate with the content script (ISOLATED world)
        const checkEvent = "stealth-guard-check-turnstile-" + Math.random().toString(36).substring(7);
        window.addEventListener(checkEvent, (e) => {
          if (e.detail && e.detail.skipUA) {
            shouldSpoof = false;
            debugLog("[Stealth Guard] Disabling UA spoofing due to Turnstile signal from background");
          }
        }, { once: true });
        window.dispatchEvent(new CustomEvent("${TURNSTILE_TRIGGER_CHECK_EVENT}", { detail: { eventName: checkEvent } }));
      } catch(e) {}

      debugLog("[Stealth Guard] User-Agent protection activated:", userAgent);
    } else if (uaEnabled && isEmptyHostnameFrame) {
      // Don't log for every empty frame - too noisy
    } else if (uaEnabled && turnstileBypassActive) {
      debugLog("[Stealth Guard] User-Agent spoofing DISABLED - Turnstile bypass active, using real browser UA");
    } else if (uaEnabled && hasTurnstile) {
      debugLog("[Stealth Guard] User-Agent spoofing DISABLED - Turnstile detected, using real browser UA");
    }

    // ========== WEBRTC DETECTION ==========
    // Detect WebRTC fingerprinting attempts by intercepting RTCPeerConnection
    debugLog("[Stealth Guard] WebRTC config check:", {
      enabled: config.enabled,
      webrtc: config.webrtc,
      webrtcEnabled: config.webrtc ? config.webrtc.enabled : 'N/A'
    });

    if (config.enabled && config.webrtc && config.webrtc.enabled) {
      try {
        const OriginalRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

        debugLog("[Stealth Guard] Original RTCPeerConnection found:", !!OriginalRTCPeerConnection);

        if (OriginalRTCPeerConnection) {
          const ProxiedRTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
            construct(target, args) {
              // Send alert when RTCPeerConnection is created
              debugLog("[Stealth Guard] RTCPeerConnection created! Sending alert...");
              window.top.postMessage("stealth-guard-webrtc-alert", '*');
              return new target(...args);
            }
          });

          window.RTCPeerConnection = ProxiedRTCPeerConnection;
          if (window.webkitRTCPeerConnection) {
            window.webkitRTCPeerConnection = ProxiedRTCPeerConnection;
          }
          if (window.mozRTCPeerConnection) {
            window.mozRTCPeerConnection = ProxiedRTCPeerConnection;
          }

          debugLog("[Stealth Guard] WebRTC detection activated");
        } else {
          debugWarn("[Stealth Guard] No RTCPeerConnection found to intercept");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Could not setup WebRTC detection:", e);
      }
    } else {
      debugLog("[Stealth Guard] WebRTC detection skipped - protection disabled or not configured");
    }

    debugLog("[Stealth Guard] All inline protections activated");
  })();
  `;

  // Inject inline code SYNCHRONOUSLY
  const script = document.createElement('script');
  script.textContent = inlineCode;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  debugLog("[Stealth Guard] Protection injection complete");

  // ========== LISTEN FOR FINGERPRINT ALERTS ==========

  const mkey = "stealth-guard-sandboxed-frame";

  // Clean up temporary marker attributes so frameworks (e.g. Next.js)
  // don't see extension-only attributes during hydration.
  const transientSandboxMarkers = [
    "stealth-guard-webgl-sandboxed-frame",
    "stealth-guard-clientrects-sandboxed-frame",
    "stealth-guard-webgpu-sandboxed-frame",
    "stealth-guard-audiocontext-sandboxed-frame"
  ];
  for (let i = 0; i < transientSandboxMarkers.length; i++) {
    const marker = transientSandboxMarkers[i];
    if (document.documentElement.hasAttribute(marker)) {
      document.documentElement.removeAttribute(marker);
    }
  }

  // Notify parent frames about sandboxed context
  if (!document.documentElement.hasAttribute(mkey)) {
    try {
      parent.postMessage(mkey, "*");
      window.top.postMessage(mkey, "*");
    } catch (e) {
      // Ignore cross-origin errors
    }
  } else {
    document.documentElement.removeAttribute(mkey);
  }

  // Listen for config updates from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "config-updated") {
      // Update sessionStorage cache with new config
      try {
        // Add version to config before caching
        const configWithVersion = {
          ...request.config,
          _version: CONFIG_VERSION
        };
        sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(configWithVersion));
        debugEnabled = request.config.notifications && request.config.notifications.enabled;
        debugLog("[Stealth Guard] Config updated, debug logging now:", debugEnabled ? "enabled" : "disabled");
      } catch (e) {
        // Ignore errors
      }
    }
  });

  // Listen for fingerprint alerts from MAIN world
  window.addEventListener("message", function (e) {
    if (!e.data) return;

    // Check if this is a fingerprint alert
    const feature = FINGERPRINT_ALERT_MAP[e.data];
    if (feature) {
      debugLog("[Stealth Guard Injector] Received alert for feature:", feature, "on", window.location.hostname);
      // Forward to background script
      try {
        chrome.runtime.sendMessage({
          type: "fingerprint-detected",
          feature: feature,
          hostname: window.location.hostname,
          url: window.location.href,
          timestamp: Date.now()
        }, (response) => {
          // Ignore errors (extension may be reloading)
          if (chrome.runtime.lastError) {
            debugWarn("[Stealth Guard Injector] Error sending to background:", chrome.runtime.lastError.message);
          } else {
            debugLog("[Stealth Guard Injector] Alert forwarded to background successfully");
          }
        });
      } catch (e) {
        debugError("[Stealth Guard Injector] Exception sending to background:", e);
      }
    }
  }, false);

  // Listen for Turnstile check requests from MAIN world (for iframes without sessionStorage access)
  window.addEventListener(TURNSTILE_TRIGGER_CHECK_EVENT, function(e) {
    if (!e.detail || !e.detail.eventName) return;

    try {
      chrome.runtime.sendMessage({
        type: "check-turnstile-status",
        hostname: window.location.hostname
      }, (response) => {
        if (chrome.runtime.lastError) return;

        // Dispatch result back to MAIN world
        if (response) {
          const detail = { skipUA: response.skipUA };
          window.dispatchEvent(new CustomEvent(e.detail.eventName, { detail: detail }));
        }
      });
    } catch (err) {
      // Ignore errors
    }
  });

})();
