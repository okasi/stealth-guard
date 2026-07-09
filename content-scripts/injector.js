// Content Script Injector - Runs in ISOLATED world and injects MAIN world script
// This is necessary for Manifest V2 since it doesn't support world: "MAIN" directly

(async function () {
  'use strict';

  const CONFIG_VERSION = "1.0.4";  // Increment this when document-start defaults change
  const CONFIG_STORAGE_KEY = "stealth-guard-config";
  const CONFIG_UPDATE_EVENT = "stealth-guard-config-update-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const CONFIG_UPDATE_TOKEN = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const DEFAULT_CANVAS_WHITELIST = "*.notion.so, *.lovable.dev";
  const DEFAULT_CLIENTRECTS_WHITELIST = "*.figma.com, *.miro.com, *.canva.com";
  const DEFAULT_WEBGL_WHITELIST = "*.figma.com, *.miro.com, *.adguard-mail.com";
  const DEFAULT_FONT_WHITELIST = "docs.google.com, *.figma.com, *.discord.com, *.notion.so";
  const DEFAULT_TIMEZONE_WHITELIST = "app.slack.com, webmail.*";
  const DEFAULT_WEBRTC_WHITELIST = "meet.google.com, zoom.us, teams.microsoft.com, discord.com, web.whatsapp.com, messenger.com, web.telegram.org, figma.com";
  const DEFAULT_WEBGPU_WHITELIST = "*.lovable.dev";
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

  function normalizeClientRectsConfig(clientRectsConfig) {
    const normalized = (clientRectsConfig && typeof clientRectsConfig === "object")
      ? { ...clientRectsConfig }
      : {};
    if (typeof normalized.enabled === "undefined") {
      normalized.enabled = true;
    }
    if (typeof normalized.whitelist === "undefined" || normalized.whitelist === null) {
      normalized.whitelist = DEFAULT_CLIENTRECTS_WHITELIST;
    }
    return normalized;
  }

  function normalizeFeatureWhitelistConfig(featureConfig, defaultWhitelist) {
    const normalized = (featureConfig && typeof featureConfig === "object")
      ? { ...featureConfig }
      : {};
    if (typeof normalized.enabled === "undefined") {
      normalized.enabled = true;
    }
    if (typeof normalized.whitelist === "undefined" || normalized.whitelist === null) {
      normalized.whitelist = defaultWhitelist;
    }
    return normalized;
  }

  // ========== HELPER: DOMAIN ALLOWLIST CHECKER ==========

  // ========== NO CSS BLOCKING ==========
  // We rely purely on JS interceptors to fake measurements
  // This prevents any visible flashing or font changes
  // Normal website fonts render correctly while fingerprinting tests get fake data

  // ========== IMMEDIATE INLINE INJECTION ==========

  const defaultContentConfig = {
    _version: CONFIG_VERSION,
    enabled: true,
    globalWhitelist: "",
    canvas: { enabled: true, whitelist: DEFAULT_CANVAS_WHITELIST, noiseLevel: "medium" },
    webgl: { enabled: true, whitelist: DEFAULT_WEBGL_WHITELIST, preset: "auto" },
    font: { enabled: true, whitelist: DEFAULT_FONT_WHITELIST },
    clientrects: { enabled: true, whitelist: DEFAULT_CLIENTRECTS_WHITELIST },
    webgpu: { enabled: true, whitelist: DEFAULT_WEBGPU_WHITELIST },
    audiocontext: { enabled: true, whitelist: "" },
    timezone: { enabled: true, whitelist: DEFAULT_TIMEZONE_WHITELIST, offset: 60, name: "Europe/Paris" },
    useragent: { enabled: true, whitelist: "", preset: navigator.platform.includes("Mac") ? "macos" : "windows" },
    webrtc: { enabled: true, whitelist: DEFAULT_WEBRTC_WHITELIST, policy: "disable_non_proxied_udp" },
    notifications: { enabled: false, showFingerprints: true }
  };

  function buildContentConfig(sourceConfig) {
    const source = sourceConfig && typeof sourceConfig === "object" ? sourceConfig : {};
    const nextConfig = {
      ...defaultContentConfig,
      ...source,
      canvas: normalizeFeatureWhitelistConfig(source.canvas, DEFAULT_CANVAS_WHITELIST),
      webgl: normalizeFeatureWhitelistConfig(source.webgl, DEFAULT_WEBGL_WHITELIST),
      font: normalizeFeatureWhitelistConfig(source.font, DEFAULT_FONT_WHITELIST),
      clientrects: normalizeClientRectsConfig(source.clientrects),
      webgpu: normalizeFeatureWhitelistConfig(source.webgpu, DEFAULT_WEBGPU_WHITELIST),
      audiocontext: normalizeFeatureWhitelistConfig(source.audiocontext, ""),
      timezone: normalizeFeatureWhitelistConfig(source.timezone, DEFAULT_TIMEZONE_WHITELIST),
      useragent: normalizeFeatureWhitelistConfig(source.useragent, ""),
      webrtc: normalizeFeatureWhitelistConfig(source.webrtc, DEFAULT_WEBRTC_WHITELIST),
      notifications: {
        ...defaultContentConfig.notifications,
        ...(source.notifications && typeof source.notifications === "object" ? source.notifications : {})
      },
      _version: CONFIG_VERSION
    };

    if (!nextConfig.canvas.noiseLevel) {
      nextConfig.canvas.noiseLevel = "medium";
    }
    if (!nextConfig.webgl.preset) {
      nextConfig.webgl.preset = "auto";
    }
    if (!nextConfig.timezone.offset && nextConfig.timezone.offset !== 0) {
      nextConfig.timezone.offset = 60;
    }
    if (!nextConfig.timezone.name) {
      nextConfig.timezone.name = "Europe/Paris";
    }
    if (!nextConfig.useragent.preset) {
      nextConfig.useragent.preset = navigator.platform.includes("Mac") ? "macos" : "windows";
    }
    if (!nextConfig.webrtc.policy) {
      nextConfig.webrtc.policy = "disable_non_proxied_udp";
    }
    return nextConfig;
  }

  function loadStoredContentConfig() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(buildContentConfig(defaultContentConfig));
          return;
        }

        chrome.storage.local.get(CONFIG_STORAGE_KEY, (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            debugWarn("[Stealth Guard] Failed to load stored config:", chrome.runtime.lastError);
            resolve(buildContentConfig(defaultContentConfig));
            return;
          }

          resolve(buildContentConfig(result && result[CONFIG_STORAGE_KEY]));
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to read stored config:", e);
        resolve(buildContentConfig(defaultContentConfig));
      }
    });
  }

  // MV2 cannot synchronously read chrome.storage.local at document_start.
  // Inject immediately with non-forgeable safe defaults, then deliver trusted
  // extension storage through an authenticated MAIN-world update channel.
  let config = buildContentConfig(defaultContentConfig);

  // Set debug logging state based on config
  // Only enable if explicitly set to true in config
  debugEnabled = !!(config.notifications && config.notifications.enabled);
  debugLog("[Stealth Guard] Using document-start content config");
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
  config.canvas = normalizeFeatureWhitelistConfig(config.canvas, DEFAULT_CANVAS_WHITELIST);
  config.webgl = normalizeFeatureWhitelistConfig(config.webgl, DEFAULT_WEBGL_WHITELIST);
  config.font = normalizeFeatureWhitelistConfig(config.font, DEFAULT_FONT_WHITELIST);
  config.clientrects = normalizeClientRectsConfig(config.clientrects);
  config.webgpu = normalizeFeatureWhitelistConfig(config.webgpu, DEFAULT_WEBGPU_WHITELIST);
  config.audiocontext = normalizeFeatureWhitelistConfig(config.audiocontext, "");
  config.timezone = normalizeFeatureWhitelistConfig(config.timezone, DEFAULT_TIMEZONE_WHITELIST);
  config.useragent = normalizeFeatureWhitelistConfig(config.useragent, "");
  config.webrtc = normalizeFeatureWhitelistConfig(config.webrtc, DEFAULT_WEBRTC_WHITELIST);
  if (!config.webgl.preset) {
    config.webgl.preset = "auto";
  }
  if (!config.useragent.preset) {
    config.useragent.preset = navigator.platform.includes("Mac") ? "macos" : "windows";
  }
  if (!config.webrtc.policy) {
    config.webrtc.policy = "disable_non_proxied_udp";
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
  const isChallengeDomain = CHALLENGE_DOMAINS.some(d => currentHostname === d || currentHostname.endsWith('.' + d));

  if (isChallengeDomain) {
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

  // Top-level pages do not trigger Turnstile UA bypass from page-controlled
  // URL/title/DOM signals. Cloudflare-owned challenge frames are left clean
  // without granting the embedding site a real-UA bypass.
  const hasTurnstile = false;

  // Build inline protection code
  const inlineCode = `
    (function() {
      'use strict';

      const config = ` + JSON.stringify(config) + `;
      const configUpdateEvent = ` + JSON.stringify(CONFIG_UPDATE_EVENT) + `;
      const configUpdateToken = ` + JSON.stringify(CONFIG_UPDATE_TOKEN) + `;
      const hasTurnstile = ${hasTurnstile};

      const replaceConfig = function(nextConfig) {
        if (!nextConfig || typeof nextConfig !== "object") return;
        Object.keys(config).forEach(function(key) {
          delete config[key];
        });
        Object.assign(config, nextConfig);
      };

      const receiveConfigUpdate = function(event) {
        if (!event || !event.detail || event.detail.token !== configUpdateToken) {
          return;
        }
        replaceConfig(event.detail.config);
      };

      window.addEventListener(configUpdateEvent, receiveConfigUpdate, true);

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

      if (hasTurnstile) {
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

      const shouldBypassForCaller = function(feature) {
        return false;
      };

      const isFeatureActive = function(featureName) {
        const featureConfig = config[featureName];
        return !!(
          config.enabled &&
          featureConfig &&
          featureConfig.enabled &&
          !isDomainWhitelisted(config.globalWhitelist || "") &&
          !isDomainWhitelisted(featureConfig.whitelist || "")
        );
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
    if (config.canvas) {
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
        if (!isFeatureActive('canvas')) {
          return originalToBlob.apply(this, arguments);
        }
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
        if (!isFeatureActive('canvas')) {
          return originalToDataURL.apply(this, arguments);
        }
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
        if (!isFeatureActive('canvas')) {
          return imageData;
        }
        addCanvasNoise(imageData);
        window.top.postMessage("stealth-guard-canvas-alert", '*');
        return imageData;
      };

      debugLog("[Stealth Guard] Canvas protection activated");
    }


    // ========== WEBGL PROTECTION ==========
    // Inspired by WebGL Fingerprint Defender - comprehensive parameter spoofing
    if (config.webgl) {
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

      const getWebGLDeviceInfo = function() {
        let preset = config.webgl && config.webgl.preset ? config.webgl.preset : "auto";
        if (preset === "auto") {
          const uaPreset = config.useragent && config.useragent.preset ? config.useragent.preset : "macos";
          const presetMap = {
            macos: "apple",
            macos_chrome: "apple",
            windows: "surface_pro_7",
            iphone: "apple",
            android: "pixel_4"
          };
          preset = presetMap[uaPreset] || "apple";
        }
        return WEBGL_PRESETS[preset] || WEBGL_PRESETS.apple;
      };

      // Helper function to spoof WebGL parameters
      const spoofParameter = function(target) {
        let proto = target.prototype ? target.prototype : target.__proto__;

        proto.getParameter = new Proxy(proto.getParameter, {
          apply(target, self, args) {
            if (!isFeatureActive('webgl')) {
              return Reflect.apply(target, self, args);
            }
            // Reserved caller bypass hook; currently disabled.
            if (shouldBypassForCaller('webgl')) {
              return Reflect.apply(target, self, args);
            }

            window.top.postMessage("stealth-guard-webgl-alert", '*');
            const deviceInfo = getWebGLDeviceInfo();

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
            if (!isFeatureActive('webgl')) {
              return Reflect.apply(target, self, args);
            }
            // Reserved caller bypass hook; currently disabled.
            if (shouldBypassForCaller('webgl')) {
              return Reflect.apply(target, self, args);
            }

            const buffer = args[1];
            if (buffer && typeof buffer.length === 'number' && buffer.length > 0) {
              let index = Math.floor(randomConfig.random.value() * buffer.length);
              let noise = buffer[index] !== undefined ? 0.1 * randomConfig.random.value() * buffer[index] : 0;
              buffer[index] = buffer[index] + noise;
              window.top.postMessage("stealth-guard-webgl-alert", '*');
            }
            return Reflect.apply(target, self, args);
          }
        });
      };

      // Apply protection to both WebGL 1.0 and WebGL 2.0
      try {
        if (typeof WebGLRenderingContext !== 'undefined') {
          spoofParameter(WebGLRenderingContext);
          spoofBuffer(WebGLRenderingContext);
          debugLog("[Stealth Guard] WebGL 1.0 protection activated");
        }
      } catch (e) {
        debugWarn("[Stealth Guard] Failed to protect WebGLRenderingContext:", e);
      }

      try {
        if (typeof WebGL2RenderingContext !== 'undefined') {
          spoofParameter(WebGL2RenderingContext);
          spoofBuffer(WebGL2RenderingContext);
          debugLog("[Stealth Guard] WebGL 2.0 protection activated");
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
    if (config.font) {
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
              if (!isFeatureActive('font')) {
                return Reflect.apply(target, self, args);
              }
              // Reserved caller bypass hook; currently disabled.
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
              if (!isFeatureActive('font')) {
                return Reflect.apply(target, self, args);
              }
              // Reserved caller bypass hook; currently disabled.
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
                return Reflect.apply(target, self, args);
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
          if (!isFeatureActive('font')) {
            return originalMeasureText.apply(this, arguments);
          }
          // Reserved caller bypass hook; currently disabled.
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
    if (config.timezone) {
        try {
          let timezoneAlertSent = false;
          const getTimezoneOffset = Date.prototype.getTimezoneOffset;
          const NativeIntlDateTimeFormat = Intl.DateTimeFormat;
          const timezoneOffsetCache = new Map();

          const parseTimeZoneOffset = function(timeZoneName) {
            if (!timeZoneName) return null;
            const normalized = String(timeZoneName).replace(/\u2212/g, "-").replace(/^UTC/, "GMT");
            if (normalized === "GMT") return 0;
            const match = normalized.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
            if (!match) return null;
            const sign = match[1] === "+" ? -1 : 1; // JS offset uses inverted sign
            const hours = parseInt(match[2], 10);
            const minutes = parseInt(match[3] || "0", 10);
            return sign * (hours * 60 + minutes);
          };

          const getTimezoneOptions = function() {
            const timezoneConfig = config.timezone || {};
            const parsedConfiguredOffset = Number(timezoneConfig.offset);
            // Stored config offset is UTC-relative minutes (UTC+1 => 60).
            // Date#getTimezoneOffset uses inverse sign (UTC+1 => -60).
            return {
              fallbackOffset: Number.isFinite(parsedConfiguredOffset) ? -parsedConfiguredOffset : 300,
              name: timezoneConfig.name || "America/New_York"
            };
          };

          const getSpoofedTimezoneOffset = function(dateObj) {
            const options = getTimezoneOptions();
            if (!options.name) return options.fallbackOffset;
            const timeValue = dateObj && typeof dateObj.getTime === "function" ? dateObj.getTime() : Date.now();
            if (!Number.isFinite(timeValue)) return options.fallbackOffset;

            // Cache by hour boundary; timezone offsets only change at coarse boundaries.
            const cacheKey = String(Math.floor(timeValue / 3600000));
            if (timezoneOffsetCache.has(cacheKey)) {
              return timezoneOffsetCache.get(cacheKey);
            }

            let offset = options.fallbackOffset;
            try {
              const formatter = new NativeIntlDateTimeFormat("en-US", {
                timeZone: options.name,
                timeZoneName: "longOffset",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
              });
              const parts = formatter.formatToParts(new Date(timeValue));
              const zonePart = parts.find(part => part.type === "timeZoneName");
              const parsed = parseTimeZoneOffset(zonePart && zonePart.value);
              if (parsed !== null) {
                offset = parsed;
              }
            } catch (e) {
              // Fall back to configured numeric offset if formatter isn't available
            }

            timezoneOffsetCache.set(cacheKey, offset);
            if (timezoneOffsetCache.size > 96) {
              const oldestKey = timezoneOffsetCache.keys().next().value;
              timezoneOffsetCache.delete(oldestKey);
            }
            return offset;
          };

          const withSpoofedTimezoneOptions = function(args) {
            const options = getTimezoneOptions();
            const nextArgs = Array.prototype.slice.call(args);
            const existingOptions = nextArgs[1];
            nextArgs[1] = existingOptions && typeof existingOptions === "object"
              ? Object.assign({}, existingOptions)
              : {};
            nextArgs[1].timeZone = options.name;
            return nextArgs;
          };

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
            const spoofedOffset = getSpoofedTimezoneOffset(this);
            return this._newdate !== undefined ? this._newdate : new Date(this.getTime() + (this._offset - spoofedOffset) * 60 * 1000);
          }
        });

        Date.prototype.getTimezoneOffset = new Proxy(Date.prototype.getTimezoneOffset, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return isNaN(self) ? Reflect.apply(target, self, args) : getSpoofedTimezoneOffset(self);
          }
        });

        Date.prototype.toString = new Proxy(Date.prototype.toString, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return isNaN(self) ? Reflect.apply(target, self, args) : self.toDateString() + ' ' + self.toTimeString();
          }
        });

        Date.prototype.toLocaleString = new Proxy(Date.prototype.toLocaleString, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
          }
        });

        Date.prototype.toLocaleDateString = new Proxy(Date.prototype.toLocaleDateString, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
          }
        });

        Date.prototype.toLocaleTimeString = new Proxy(Date.prototype.toLocaleTimeString, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
          }
        });

        Date.prototype.toTimeString = new Proxy(Date.prototype.toTimeString, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            const result = Reflect.apply(target, self._date, args);
            const replace_1 = convertToGMT(self._offset);
            const replace_2 = convertToGMT(getSpoofedTimezoneOffset(self));
            const options = getTimezoneOptions();
            const replace_3 = "(" + options.name.replace(/\\//g, " ") + " Standard Time)";
            return isNaN(self) ? Reflect.apply(target, self, args) : result.replace(replace_1, replace_2).replace(/\\(.*\\)/, replace_3);
          }
        });

        propertyNames.forEach(function (name) {
          if (["setHours", "setMinutes", "setMonth", "setDate", "setYear", "setFullYear"].indexOf(name) !== -1) {
            Date.prototype[name] = new Proxy(Date.prototype[name], {
              apply(target, self, args) {
                if (!isFeatureActive('timezone')) {
                  return Reflect.apply(target, self, args);
                }
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
                if (!isFeatureActive('timezone')) {
                  return Reflect.apply(target, self, args);
                }
                return isNaN(self) ? Reflect.apply(target, self, args) : Reflect.apply(target, self._date, args);
              }
            });
          }
        });

        Intl.DateTimeFormat.prototype.resolvedOptions = new Proxy(Intl.DateTimeFormat.prototype.resolvedOptions, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            const result = Reflect.apply(target, self, args);
            const options = getTimezoneOptions();
            result.timeZone = options.name;
            return result;
          }
        });

        Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
          apply(target, self, args) {
            if (!isFeatureActive('timezone')) {
              return Reflect.apply(target, self, args);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
          },
          construct(target, args, newTarget) {
            if (!isFeatureActive('timezone')) {
              return Reflect.construct(target, args, newTarget);
            }
            if (!timezoneAlertSent) {
              try { window.top.postMessage("stealth-guard-timezone-alert", '*'); } catch(e) {}
              timezoneAlertSent = true;
            }
            return Reflect.construct(target, withSpoofedTimezoneOptions(args), newTarget);
          }
        });

          debugLog("[Stealth Guard] Timezone protection activated");
        } catch(e) {
          debugError("[Stealth Guard] Timezone protection failed:", e);
        }
    }

    // ========== CLIENTRECTS FINGERPRINT PROTECTION ==========
    if (config.clientrects) {
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
              if (!isFeatureActive('clientrects')) {
                return result;
              }
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
              if (!isFeatureActive('clientrects')) {
                return result;
              }
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
    if (config.webgpu) {
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
                if (!isFeatureActive('webgpu')) {
                  return result;
                }

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
                if (!isFeatureActive('webgpu')) {
                  return result;
                }

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
              if (!isFeatureActive('webgpu')) {
                return Reflect.apply(target, self, args);
              }
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
              if (!isFeatureActive('webgpu')) {
                return Reflect.apply(target, self, args);
              }
              if (args && args[2]) {
                const rawBuffer = args[2];
                const dataOffset = Number.isFinite(Number(args[3])) ? Math.max(0, Math.floor(Number(args[3]))) : 0;
                const explicitSize = Number.isFinite(Number(args[4])) ? Math.max(0, Math.floor(Number(args[4]))) : null;
                let metrics = null;

                if (rawBuffer instanceof ArrayBuffer) {
                  const start = Math.min(dataOffset, rawBuffer.byteLength);
                  const byteLength = explicitSize === null
                    ? Math.max(0, rawBuffer.byteLength - start)
                    : Math.min(explicitSize, Math.max(0, rawBuffer.byteLength - start));
                  metrics = new Uint8Array(rawBuffer, start, byteLength);
                } else if (ArrayBuffer.isView(rawBuffer)) {
                  if (typeof rawBuffer.subarray === 'function') {
                    const start = Math.min(dataOffset, rawBuffer.length);
                    const end = explicitSize === null ? rawBuffer.length : Math.min(rawBuffer.length, start + explicitSize);
                    metrics = rawBuffer.subarray(start, end);
                  } else {
                    const start = Math.min(dataOffset, rawBuffer.byteLength);
                    const byteLength = explicitSize === null
                      ? Math.max(0, rawBuffer.byteLength - start)
                      : Math.min(explicitSize, Math.max(0, rawBuffer.byteLength - start));
                    metrics = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset + start, byteLength);
                  }
                }

                if (metrics && typeof metrics.length === 'number' && metrics.length > 0) {
                  try {
                    const array = Array(metrics.length).fill(0).map((n, i) => n + i);
                    const count = Math.ceil(metrics.length * noiseConfig.percent);
                    const shuffled = array.sort(() => 0.5 - Math.random());
                    const selected = [...shuffled.slice(0, count)];

                    for (let i = 0; i < selected.length; i++) {
                      const index = selected[i];
                      const value = metrics[index];
                      metrics[index] = value + (Math.random() < 0.5 ? -noiseConfig.buffer * value : +noiseConfig.buffer * value);
                    }

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
    if (config.audiocontext) {
      let audiocontextAlertSent = false;

      const audioContext = {
        BUFFER: null,
        getChannelData: function(AudioBufferPrototype) {
          AudioBufferPrototype.prototype.getChannelData = new Proxy(AudioBufferPrototype.prototype.getChannelData, {
            apply(target, self, args) {
              const results = Reflect.apply(target, self, args);
              if (!isFeatureActive('audiocontext')) {
                return results;
              }

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
                if (!isFeatureActive('audiocontext')) {
                  return results;
                }

                results.__proto__.getFloatFrequencyData = new Proxy(
                  results.__proto__.getFloatFrequencyData,
                  {
                    apply(target, self, args) {
                      const results = Reflect.apply(target, self, args);
                      if (!isFeatureActive('audiocontext')) {
                        return results;
                      }

                      if (!audiocontextAlertSent) {
                        window.top.postMessage("stealth-guard-audiocontext-alert", '*');
                        audiocontextAlertSent = true;
                      }

                      // Add noise to frequency data
                      const frequencyData = args[0];
                      for (let i = 0; frequencyData && i < frequencyData.length; i += 100) {
                        const index = Math.floor(Math.random() * i);
                        frequencyData[index] = frequencyData[index] + Math.random() * 0.1;
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
    // Critical: Log the decision for debugging challenge-frame compatibility
    const uaEnabled = !!config.useragent;

    // CRITICAL FIX: Skip UA protection for frames with empty hostname
    // These are about:blank, blob:, data: URLs or sandboxed iframes
    // They are often used by Cloudflare Turnstile
    // Spoofing UA in these frames breaks Turnstile verification
    const currentHostname = window.location.hostname;
    const isEmptyHostnameFrame = !currentHostname || currentHostname === '';

    const userAgentAllowlisted = isDomainWhitelisted(config.useragent && config.useragent.whitelist);
    const shouldActivateUA = uaEnabled && !hasTurnstile && !isEmptyHostnameFrame && !userAgentAllowlisted;

    debugLog('[Stealth Guard] UA Protection Decision:', {
      uaEnabled: uaEnabled,
      hasTurnstile: hasTurnstile,
      isEmptyHostnameFrame: isEmptyHostnameFrame,
      userAgentAllowlisted: userAgentAllowlisted,
      willActivate: shouldActivateUA,
      hostname: currentHostname
    });

    if (uaEnabled && !hasTurnstile && !isEmptyHostnameFrame) {
      // User-Agent presets (5 core presets)
      const USER_AGENT_PRESETS = {
        macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        macos_chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
        android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
      };

      const getUserAgentProfile = function() {
        const preset = config.useragent && config.useragent.preset ? config.useragent.preset : "macos";
        const userAgent = USER_AGENT_PRESETS[preset] || USER_AGENT_PRESETS.macos;
        let platform = /Mac|iPod|iPhone|iPad/.test(userAgent) ? "MacIntel" : /Win/.test(userAgent) ? "Win32" : "Linux x86_64";
        let oscpu = "";

        if (/iPhone/.test(userAgent)) {
          platform = "iPhone";
          const match = userAgent.match(/CPU iPhone OS ([\\d_]+)/);
          oscpu = match ? "iPhone OS " + match[1].replace(/_/g, ".") : "iPhone OS 17.4.1";
        } else if (/iPad/.test(userAgent)) {
          platform = "iPad";
          const match = userAgent.match(/CPU OS ([\\d_]+)/);
          oscpu = match ? "iPad OS " + match[1].replace(/_/g, ".") : "iPad OS 17.4.1";
        } else if (/Android/.test(userAgent)) {
          platform = "Linux armv8l";
          const match = userAgent.match(/Android ([\\d.]+)/);
          oscpu = match ? "Linux; Android " + match[1] : "Linux; Android 14";
        } else if (/Mac OS X/.test(userAgent)) {
          platform = "MacIntel";
          const match = userAgent.match(/Mac OS X (\\d+_\\d+_\\d+)/);
          oscpu = match ? "Intel Mac OS X " + match[1].replace(/_/g, ".") : "Intel Mac OS X 10.15.7";
        } else if (/Linux/.test(userAgent) && !/Android/.test(userAgent)) {
          platform = "Linux x86_64";
          oscpu = "Linux x86_64";
        } else if (/Win/.test(userAgent)) {
          platform = "Win32";
          const match = userAgent.match(/Windows NT ([\\d.]+)/);
          oscpu = match ? "Windows NT " + match[1] + "; Win64; x64" : "Windows NT 10.0; Win64; x64";
        }

        return { userAgent, platform, oscpu };
      };

      const shouldSpoofUserAgent = function() {
        return isFeatureActive('useragent') && !hasTurnstile && !isEmptyHostnameFrame;
      };

      // Store original descriptors
      const originalUA = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent");
      const originalPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
      const originalAppVersion = Object.getOwnPropertyDescriptor(Navigator.prototype, "appVersion");
      const originalVendor = Object.getOwnPropertyDescriptor(Navigator.prototype, "vendor");
      const originalOscpu = Object.getOwnPropertyDescriptor(Navigator.prototype, "oscpu");

      // Override userAgent
      try {
        Object.defineProperty(Navigator.prototype, "userAgent", {
          get: function () {
            const profile = getUserAgentProfile();
            if (!shouldSpoofUserAgent()) return originalUA ? originalUA.get.call(this) : profile.userAgent;
            window.top.postMessage("stealth-guard-useragent-alert", '*');
            return profile.userAgent;
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
            const profile = getUserAgentProfile();
            if (!shouldSpoofUserAgent()) return originalPlatform ? originalPlatform.get.call(this) : profile.platform;
            return profile.platform;
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
            const profile = getUserAgentProfile();
            if (!shouldSpoofUserAgent()) return originalAppVersion ? originalAppVersion.get.call(this) : "";
            const versionStart = profile.userAgent.indexOf('/');
            return versionStart !== -1 ? profile.userAgent.substring(versionStart + 1) : "5.0";
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
            const profile = getUserAgentProfile();
            if (!shouldSpoofUserAgent()) return originalVendor ? originalVendor.get.call(this) : "";
            if (profile.userAgent.includes("Chrome") && !profile.userAgent.includes("Edg")) {
              return "Google Inc.";
            } else if (profile.userAgent.includes("Safari") && !profile.userAgent.includes("Chrome")) {
              return "Apple Computer, Inc.";
            } else if (profile.userAgent.includes("Firefox")) {
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
              if (!shouldSpoofUserAgent()) return undefined; // Ideally restore original, but undefined is safer than spoofed for now
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
              const profile = getUserAgentProfile();
              if (!shouldSpoofUserAgent()) return originalOscpu && originalOscpu.get ? originalOscpu.get.call(this) : "";
              return profile.oscpu;
            },
            configurable: true,
            enumerable: true
          });
        } catch (e) {
          debugWarn("[Stealth Guard] Could not override oscpu:", e);
        }
      }

      debugLog("[Stealth Guard] User-Agent protection activated");
    } else if (uaEnabled && isEmptyHostnameFrame) {
      // Don't log for every empty frame - too noisy
    } else if (uaEnabled && hasTurnstile) {
      debugLog("[Stealth Guard] User-Agent spoofing DISABLED - Turnstile detected, using real browser UA");
    } else if (uaEnabled && userAgentAllowlisted) {
      debugLog("[Stealth Guard] User-Agent spoofing DISABLED - domain is allowlisted");
    }

    // ========== WEBRTC DETECTION ==========
    // Detect WebRTC fingerprinting attempts by intercepting RTCPeerConnection
    debugLog("[Stealth Guard] WebRTC config check:", {
      enabled: config.enabled,
      webrtc: config.webrtc,
      webrtcEnabled: config.webrtc ? config.webrtc.enabled : 'N/A'
    });

    if (config.webrtc) {
      try {
        const OriginalRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

        debugLog("[Stealth Guard] Original RTCPeerConnection found:", !!OriginalRTCPeerConnection);

        if (OriginalRTCPeerConnection) {
          const ProxiedRTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
            construct(target, args) {
              if (!isFeatureActive('webrtc')) {
                return new target(...args);
              }
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

  function applyTrustedContentConfig(nextConfig) {
    config = buildContentConfig(nextConfig);
    debugEnabled = !!(config.notifications && config.notifications.enabled);
    window.dispatchEvent(new CustomEvent(CONFIG_UPDATE_EVENT, {
      detail: {
        token: CONFIG_UPDATE_TOKEN,
        config
      }
    }));
  }

  loadStoredContentConfig().then((storedConfig) => {
    applyTrustedContentConfig(storedConfig);
  });

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

  // Listen for config updates from background. Keep the full config private to
  // the isolated content-script world; do not write it to page-origin storage.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "config-updated") {
      try {
        applyTrustedContentConfig(request.config);
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

})();
