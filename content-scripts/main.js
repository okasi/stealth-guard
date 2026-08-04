function installMainWorldProtections(
  initialConfig,
  bridge,
  createPatternTools,
  userAgentStrings,
  userAgentClientHints,
) {
  "use strict";

  const config = initialConfig;
  const configUpdateEvent = bridge.configEvent;
  const configUpdateToken = bridge.configToken;
  const domainPatterns = createPatternTools();
  const clientHintProfiles = userAgentClientHints || {};

  const replaceConfig = function (nextConfig) {
    if (!nextConfig || typeof nextConfig !== "object") return;
    Object.keys(config).forEach(function (key) {
      delete config[key];
    });
    Object.assign(config, nextConfig);
  };

  const receiveConfigUpdate = function (event) {
    if (!event || !event.detail || event.detail.token !== configUpdateToken) {
      return;
    }
    replaceConfig(event.detail.config);
  };

  window.addEventListener(configUpdateEvent, receiveConfigUpdate, true);

  const debug = function (method, ...args) {
    if (config.notifications && config.notifications.enabled) {
      console[method](...args);
    }
  };
  const debugLog = (...args) => debug("log", ...args);
  const debugWarn = (...args) => debug("warn", ...args);
  const debugError = (...args) => console.error(...args);

  const sendFingerprintAlert = function (feature) {
    window.postMessage(
      {
        channel: bridge.alertChannel,
        token: bridge.alertToken,
        feature,
      },
      "*",
    );
  };

  const createOneTimeAlert = function (feature) {
    let sent = false;
    return function () {
      if (!sent) {
        sent = true;
        sendFingerprintAlert(feature);
      }
    };
  };

  const protectGetter = function (prototype, property, apply, label) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor || typeof descriptor.get !== "function") {
        return false;
      }
      Object.defineProperty(prototype, property, {
        ...descriptor,
        get: new Proxy(descriptor.get, { apply }),
      });
      return true;
    } catch (error) {
      debugWarn(`[Stealth Guard] Failed to protect ${label || property}:`, error);
      return false;
    }
  };

  const protectMethod = function (prototype, method, apply, label) {
    try {
      if (!prototype) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      if (!descriptor || typeof descriptor.value !== "function") {
        return false;
      }
      Object.defineProperty(prototype, method, {
        ...descriptor,
        value: new Proxy(descriptor.value, { apply }),
      });
      return true;
    } catch (error) {
      debugWarn(`[Stealth Guard] Failed to protect ${label || method}:`, error);
      return false;
    }
  };

  const isDomainAllowlisted = function (allowlist) {
    return domainPatterns.isAllowlisted(window.location.hostname, allowlist);
  };

  const isFeatureActive = function (featureName) {
    const featureConfig = config[featureName];
    return Boolean(
      config.enabled &&
        featureConfig &&
        featureConfig.enabled &&
        !isDomainAllowlisted(config.globalWhitelist || "") &&
        !isDomainAllowlisted(featureConfig.whitelist || ""),
    );
  };

  debugLog("[Stealth Guard] MAIN-world protections activating");

  const isYouTubeHostname = function () {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  };

  const isYouTubeAdBlockingActive = function () {
    return Boolean(
      isYouTubeHostname() &&
        config.adblock &&
        config.adblock.enabled &&
        config.adblock.youtubeEnhancements,
    );
  };

  if (isYouTubeHostname()) {
    const nativeJsonParse = JSON.parse;
    const nativeJsonStringify = JSON.stringify;
    const youtubeAdKeys = new Set([
      "adBreakHeartbeatParams",
      "adPlacements",
      "adSlots",
      "legacyImportant",
      "playerAds",
    ]);

    const isYouTubeAdEntry = function (value) {
      return Boolean(
        value &&
          typeof value === "object" &&
          (value.command?.reelWatchEndpoint?.adClientParams?.isAd === true ||
            value.adSlotRenderer ||
            value.displayAdRenderer ||
            value.inFeedAdLayoutRenderer),
      );
    };

    const sanitizeYouTubePayload = function (value, seen) {
      if (!value || typeof value !== "object") return value;
      const visited = seen || new WeakSet();
      if (visited.has(value)) return value;
      visited.add(value);
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (isYouTubeAdEntry(value[index])) {
            value.splice(index, 1);
          } else {
            sanitizeYouTubePayload(value[index], visited);
          }
        }
        return value;
      }
      for (const key of Object.keys(value)) {
        if (youtubeAdKeys.has(key)) {
          try {
            delete value[key];
          } catch (error) {}
        } else {
          sanitizeYouTubePayload(value[key], visited);
        }
      }
      return value;
    };

    const sanitizeYouTubeJsonText = function (text) {
      if (
        !isYouTubeAdBlockingActive() ||
        typeof text !== "string" ||
        !/(?:"adPlacements"|"adSlots"|"playerAds"|"isAd"\s*:\s*true)/.test(
          text,
        )
      ) {
        return text;
      }
      try {
        const parsed = Reflect.apply(nativeJsonParse, JSON, [text]);
        sanitizeYouTubePayload(parsed);
        return Reflect.apply(nativeJsonStringify, JSON, [parsed]);
      } catch (error) {
        return text;
      }
    };

    const getRequestUrl = function (input) {
      try {
        if (typeof input === "string") return input;
        if (typeof URL !== "undefined" && input instanceof URL) return input.href;
        if (input && typeof input.url === "string") return input.url;
      } catch (error) {}
      return "";
    };

    const isYouTubePlayerRequest = function (url) {
      if (typeof url !== "string" || !url) return false;
      try {
        const parsed = new URL(url, window.location.href);
        if (
          parsed.hostname !== "youtube.com" &&
          !parsed.hostname.endsWith(".youtube.com")
        ) {
          return false;
        }
        return /(?:\/youtubei\/v1\/(?:player|playlist|get_watch)|\/get_watch|\/watch)/.test(
          parsed.pathname,
        );
      } catch (error) {
        return false;
      }
    };

    const createSanitizedFetchResponse = async function (response) {
      if (
        !isYouTubeAdBlockingActive() ||
        !response ||
        typeof response.clone !== "function"
      ) {
        return response;
      }
      try {
        const text = await response.clone().text();
        const sanitized = sanitizeYouTubeJsonText(text);
        if (sanitized === text) return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        const replacement = new Response(sanitized, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
        for (const property of ["url", "redirected", "type"]) {
          try {
            Object.defineProperty(replacement, property, {
              configurable: true,
              value: response[property],
            });
          } catch (error) {}
        }
        return replacement;
      } catch (error) {
        return response;
      }
    };

    protectMethod(
      window,
      "fetch",
      function (target, self, args) {
        const responsePromise = Reflect.apply(target, self, args);
        if (
          !isYouTubeAdBlockingActive() ||
          !isYouTubePlayerRequest(getRequestUrl(args[0]))
        ) {
          return responsePromise;
        }
        return responsePromise.then(createSanitizedFetchResponse);
      },
      "YouTube fetch responses",
    );

    const youtubeXhrUrls = new WeakMap();
    const youtubeXhrTextCache = new WeakMap();
    const youtubeXhrObjectCache = new WeakMap();
    if (typeof XMLHttpRequest !== "undefined") {
      protectMethod(
        XMLHttpRequest.prototype,
        "open",
        function (target, self, args) {
          youtubeXhrUrls.set(self, getRequestUrl(args[1]));
          youtubeXhrTextCache.delete(self);
          youtubeXhrObjectCache.delete(self);
          return Reflect.apply(target, self, args);
        },
        "YouTube XMLHttpRequest.open",
      );

      protectGetter(
        XMLHttpRequest.prototype,
        "responseText",
        function (target, self, args) {
          const value = Reflect.apply(target, self, args);
          if (
            self.readyState !== 4 ||
            !isYouTubeAdBlockingActive() ||
            !isYouTubePlayerRequest(youtubeXhrUrls.get(self))
          ) {
            return value;
          }
          const cached = youtubeXhrTextCache.get(self);
          if (cached && cached.source === value) return cached.value;
          const sanitized = sanitizeYouTubeJsonText(value);
          youtubeXhrTextCache.set(self, { source: value, value: sanitized });
          return sanitized;
        },
        "YouTube XMLHttpRequest.responseText",
      );

      protectGetter(
        XMLHttpRequest.prototype,
        "response",
        function (target, self, args) {
          const value = Reflect.apply(target, self, args);
          if (
            self.readyState !== 4 ||
            !isYouTubeAdBlockingActive() ||
            !isYouTubePlayerRequest(youtubeXhrUrls.get(self))
          ) {
            return value;
          }
          if (typeof value === "string") return sanitizeYouTubeJsonText(value);
          if (!value || typeof value !== "object" || self.responseType !== "json") {
            return value;
          }
          const cached = youtubeXhrObjectCache.get(self);
          if (cached && cached.source === value) return cached.value;
          try {
            const clone = Reflect.apply(nativeJsonParse, JSON, [
              Reflect.apply(nativeJsonStringify, JSON, [value]),
            ]);
            sanitizeYouTubePayload(clone);
            youtubeXhrObjectCache.set(self, { source: value, value: clone });
            return clone;
          } catch (error) {
            return value;
          }
        },
        "YouTube XMLHttpRequest.response",
      );
    }

    protectMethod(
      JSON,
      "parse",
      function (target, self, args) {
        const value = Reflect.apply(target, self, args);
        return isYouTubeAdBlockingActive()
          ? sanitizeYouTubePayload(value)
          : value;
      },
      "YouTube JSON.parse",
    );

    try {
      const initialDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "ytInitialPlayerResponse",
      );
      if (!initialDescriptor || initialDescriptor.configurable) {
        let initialPlayerResponse = initialDescriptor?.value;
        if (isYouTubeAdBlockingActive()) {
          sanitizeYouTubePayload(initialPlayerResponse);
        }
        Object.defineProperty(window, "ytInitialPlayerResponse", {
          configurable: true,
          enumerable: initialDescriptor?.enumerable !== false,
          get() {
            return initialPlayerResponse;
          },
          set(value) {
            initialPlayerResponse = isYouTubeAdBlockingActive()
              ? sanitizeYouTubePayload(value)
              : value;
          },
        });
      }
    } catch (error) {
      debugWarn("[Adblock] Could not protect ytInitialPlayerResponse:", error);
    }

    const inspectYouTubePlayer = function () {
      if (!isYouTubeAdBlockingActive()) return;
      const player = document.getElementById("movie_player");
      if (!player) return;
      try {
        const stats = player.getStatsForNerds?.();
        const serverSideAd =
          typeof stats?.debug_info === "string" &&
          stats.debug_info.startsWith("SSAP, AD");
        const showingAd = player.classList.contains("ad-showing");
        if (!serverSideAd && !showingAd) return;
        const progress = player.getProgressState?.();
        const duration = Number(progress?.duration);
        if (Number.isFinite(duration) && duration > 0) {
          player.seekTo?.(duration, true);
        }
        const skip = document.querySelector(
          ".ytp-ad-skip-button, .ytp-skip-ad-button, button.ytp-ad-skip-button-modern",
        );
        skip?.click();
      } catch (error) {}
    };

    const startYouTubePlayerMonitor = function () {
      inspectYouTubePlayer();
      window.setInterval(inspectYouTubePlayer, 250);
    };
    if (document.documentElement) {
      startYouTubePlayerMonitor();
    } else {
      document.addEventListener("DOMContentLoaded", startYouTubePlayerMonitor, {
        once: true,
      });
    }
  }

  const webglCanvases = new WeakSet();
  let webglNoiseSeed = 0;

  if (config.canvas) {
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    const getOffscreenImageData =
      typeof OffscreenCanvasRenderingContext2D === "undefined"
        ? null
        : OffscreenCanvasRenderingContext2D.prototype.getImageData;

    const readCanvasImageData = function (context, width, height) {
      const reader =
        getOffscreenImageData &&
        typeof OffscreenCanvasRenderingContext2D !== "undefined" &&
        context instanceof OffscreenCanvasRenderingContext2D
          ? getOffscreenImageData
          : getImageData;
      return Reflect.apply(reader, context, [0, 0, width, height]);
    };

    const createCanvasLike = function (source) {
      if (
        typeof OffscreenCanvas !== "undefined" &&
        source instanceof OffscreenCanvas
      ) {
        return new OffscreenCanvas(source.width, source.height);
      }
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      return canvas;
    };

    const addCanvasNoise = function (imageData) {
      const spreadByLevel = { low: 3, medium: 10, high: 21 };
      const spread =
        spreadByLevel[config.canvas.noiseLevel] || spreadByLevel.medium;
      const midpoint = Math.floor(spread / 2);
      const createShift = () => Math.floor(Math.random() * spread) - midpoint;
      const shift = {
        r: createShift(),
        g: createShift(),
        b: createShift(),
        a: createShift(),
      };

      const width = imageData.width;
      const height = imageData.height;
      const totalPixels = width * height;

      if (totalPixels > 1000000) {
        debugLog(
          "[Canvas] Skipping noise for large canvas:",
          width + "x" + height,
        );
        return imageData;
      }

      const step = totalPixels < 65536 ? 1 : 4;

      for (let i = 0; i < height; i += step) {
        for (let j = 0; j < width; j += step) {
          const n = i * (width * 4) + j * 4;
          imageData.data[n + 0] = imageData.data[n + 0] + shift.r;
          imageData.data[n + 1] = imageData.data[n + 1] + shift.g;
          imageData.data[n + 2] = imageData.data[n + 2] + shift.b;
          imageData.data[n + 3] = imageData.data[n + 3] + shift.a;
        }
      }

      return imageData;
    };

    const addSeededWebGLNoise = function (imageData) {
      const totalPixels = imageData.width * imageData.height;
      if (!totalPixels) return imageData;
      let state = webglNoiseSeed || 1;
      const samples = Math.min(32, totalPixels);
      for (let sample = 0; sample < samples; sample++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        const pixel = state % totalPixels;
        const channel = (state >>> 8) % 3;
        const index = pixel * 4 + channel;
        const value = imageData.data[index];
        const direction = state & 1 ? 1 : -1;
        imageData.data[index] =
          (value === 0 && direction < 0) || (value === 255 && direction > 0)
            ? value - direction
            : value + direction;
      }
      return imageData;
    };

    const exportNoisedCanvas = function (canvas, originalMethod, args) {
      const isWebGLCanvas = webglCanvases.has(canvas);
      const feature = isWebGLCanvas ? "webgl" : "canvas";
      if (!isFeatureActive(feature) || !canvas.width || !canvas.height) {
        return originalMethod.apply(canvas, args);
      }

      let imageData;
      if (isWebGLCanvas) {
        const snapshot = createCanvasLike(canvas);
        const snapshotContext = snapshot.getContext("2d");
        snapshotContext.drawImage(canvas, 0, 0);
        imageData = readCanvasImageData(
          snapshotContext,
          canvas.width,
          canvas.height,
        );
        addSeededWebGLNoise(imageData);
      } else {
        const context = canvas.getContext("2d");
        if (!context) return originalMethod.apply(canvas, args);
        imageData = readCanvasImageData(
          context,
          canvas.width,
          canvas.height,
        );
        addCanvasNoise(imageData);
      }

      const tempCanvas = createCanvasLike(canvas);
      tempCanvas.getContext("2d").putImageData(imageData, 0, 0);
      sendFingerprintAlert(feature);
      return originalMethod.apply(tempCanvas, args);
    };

    for (const method of ["toBlob", "toDataURL"]) {
      protectMethod(
        HTMLCanvasElement.prototype,
        method,
        (target, self, args) => exportNoisedCanvas(self, target, args),
        `HTMLCanvasElement.${method}`,
      );
    }
    if (typeof OffscreenCanvas !== "undefined") {
      protectMethod(
        OffscreenCanvas.prototype,
        "convertToBlob",
        (target, self, args) => exportNoisedCanvas(self, target, args),
        "OffscreenCanvas.convertToBlob",
      );
    }
    const protectImageDataReader = function (Constructor, label) {
      if (typeof Constructor === "undefined") return;
      protectMethod(
        Constructor.prototype,
        "getImageData",
        (target, self, args) => {
          const imageData = Reflect.apply(target, self, args);
          if (isFeatureActive("canvas")) {
            addCanvasNoise(imageData);
            sendFingerprintAlert("canvas");
          }
          return imageData;
        },
        `${label}.getImageData`,
      );
    };
    protectImageDataReader(
      CanvasRenderingContext2D,
      "CanvasRenderingContext2D",
    );
    protectImageDataReader(
      typeof OffscreenCanvasRenderingContext2D === "undefined"
        ? undefined
        : OffscreenCanvasRenderingContext2D,
      "OffscreenCanvasRenderingContext2D",
    );

    debugLog("[Stealth Guard] Canvas protection activated");
  }

  if (config.webgl) {
    const webglPresets = {
      apple: {
        unmaskedVendor: "Google Inc. (Apple)",
        unmaskedRenderer:
          "ANGLE (Apple, ANGLE Metal Renderer: Apple GPU, Unspecified Version)",
      },
      safari_apple: {
        unmaskedVendor: "Apple Inc.",
        unmaskedRenderer: "Apple GPU",
      },
      iphone: {
        unmaskedVendor: "Apple Inc.",
        unmaskedRenderer: "Apple GPU",
      },
      pixel_4: {
        unmaskedVendor: "Google Inc. (Qualcomm)",
        unmaskedRenderer:
          "ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)",
      },
      surface_pro_7: {
        unmaskedVendor: "Google Inc. (Intel)",
        unmaskedRenderer:
          "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 640 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      },
    };
    const presetByUserAgent = {
      macos: "safari_apple",
      macos_chrome: "apple",
      windows: "surface_pro_7",
      iphone: "iphone",
      android: "pixel_4",
    };
    const parameterCaps = new Map([
      [3379, 16384],
      [34024, 16384],
      [34047, 16],
      [34076, 16384],
      [34930, 16],
      [34921, 16],
      [35660, 16],
      [35661, 32],
      [36347, 1024],
      [36348, 15],
      [36349, 1024],
    ]);
    const precisionValues = new Map([
      [36336, [15, 15, 10]],
      [36337, [15, 15, 10]],
      [36338, [127, 127, 23]],
      [36339, [15, 14, 0]],
      [36340, [15, 14, 0]],
      [36341, [31, 30, 0]],
    ]);
    const identityParameters = new Set([7936, 7937, 7938, 35724, 37445, 37446]);
    webglNoiseSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    const notifyWebGLAccess = createOneTimeAlert("webgl");

    const protectCanvasContext = function (Constructor, label) {
      if (typeof Constructor === "undefined") return;
      protectMethod(
        Constructor.prototype,
        "getContext",
        (target, self, args) => {
          const context = Reflect.apply(target, self, args);
          const type = typeof args[0] === "string" ? args[0].toLowerCase() : "";
          if (
            context &&
            (type === "webgl" ||
              type === "webgl2" ||
              type === "experimental-webgl")
          ) {
            webglCanvases.add(self);
          }
          return context;
        },
        `${label}.getContext`,
      );
    };

    protectCanvasContext(HTMLCanvasElement, "HTMLCanvasElement");
    protectCanvasContext(
      typeof OffscreenCanvas === "undefined" ? undefined : OffscreenCanvas,
      "OffscreenCanvas",
    );

    const getWebGLPreset = function () {
      let preset = config.webgl.preset;
      if (preset === "auto") {
        preset = presetByUserAgent[config.useragent.preset] || "apple";
      } else if (preset === "apple" && config.useragent.preset === "macos") {
        preset = "safari_apple";
      } else if (preset === "apple" && config.useragent.preset === "iphone") {
        preset = "iphone";
      }
      return webglPresets[preset] || webglPresets.apple;
    };

    const capArray = function (nativeValue, limits) {
      if (!ArrayBuffer.isView(nativeValue) || nativeValue.length !== limits.length) {
        return nativeValue;
      }
      return new nativeValue.constructor(
        limits.map((limit, index) => Math.min(nativeValue[index], limit)),
      );
    };

    const capRange = function (nativeValue, maximum) {
      if (!ArrayBuffer.isView(nativeValue) || nativeValue.length !== 2) {
        return nativeValue;
      }
      return new nativeValue.constructor([
        nativeValue[0],
        Math.min(nativeValue[1], maximum),
      ]);
    };

    const getSpoofedParameter = function (parameter, nativeValue, version) {
      const preset = getWebGLPreset();
      const safariProfile =
        config.useragent.preset === "macos" ||
        config.useragent.preset === "iphone";
      const versionValues = safariProfile
        ? {
            version: version === 2 ? "WebGL 2.0" : "WebGL 1.0",
            shadingLanguage:
              version === 2 ? "WebGL GLSL ES 3.00" : "WebGL GLSL ES 1.0",
          }
        : {
            version:
              version === 2
                ? "WebGL 2.0 (OpenGL ES 3.0 Chromium)"
                : "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
            shadingLanguage:
              version === 2
                ? "WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)"
                : "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
          };
      const presetValues = {
        7936: "WebKit",
        37445: preset.unmaskedVendor,
        7937: "WebKit WebGL",
        37446: preset.unmaskedRenderer,
        7938: versionValues.version,
        35724: versionValues.shadingLanguage,
      };
      if (Object.prototype.hasOwnProperty.call(presetValues, parameter)) {
        return presetValues[parameter];
      }
      if (parameter === 3386) return capArray(nativeValue, [16384, 16384]);
      if (parameter === 33901) return capRange(nativeValue, 1024);
      if (parameter === 33902) return capRange(nativeValue, 1);
      const cap = parameterCaps.get(parameter);
      if (cap !== undefined && typeof nativeValue === "number") {
        return Math.min(nativeValue, cap);
      }
      return nativeValue;
    };

    const protectWebGL = function (Constructor, version) {
      if (typeof Constructor === "undefined") return;
      const label = `WebGL${version === 2 ? "2" : ""}RenderingContext`;
      protectMethod(
        Constructor.prototype,
        "getParameter",
        (target, self, args) => {
          if (isFeatureActive("webgl") && identityParameters.has(args[0])) {
            notifyWebGLAccess();
            return getSpoofedParameter(args[0], undefined, version);
          }
          const nativeValue = Reflect.apply(target, self, args);
          if (!isFeatureActive("webgl")) {
            return nativeValue;
          }
          notifyWebGLAccess();
          return getSpoofedParameter(args[0], nativeValue, version);
        },
        `${label}.getParameter`,
      );
      protectMethod(
        Constructor.prototype,
        "getShaderPrecisionFormat",
        (target, self, args) => {
          const format = Reflect.apply(target, self, args);
          const values = precisionValues.get(args[1]);
          if (!isFeatureActive("webgl") || !format || !values) {
            return format;
          }
          notifyWebGLAccess();
          return new Proxy(format, {
            get(targetFormat, property) {
              if (isFeatureActive("webgl")) {
                if (property === "rangeMin") return values[0];
                if (property === "rangeMax") return values[1];
                if (property === "precision") return values[2];
              }
              return Reflect.get(targetFormat, property, targetFormat);
            },
          });
        },
        `${label}.getShaderPrecisionFormat`,
      );
      protectMethod(
        Constructor.prototype,
        "getSupportedExtensions",
        (target, self, args) => {
          const extensions = Reflect.apply(target, self, args);
          if (
            !isFeatureActive("webgl") ||
            !Array.isArray(extensions) ||
            extensions.length < 2
          ) {
            return extensions;
          }
          const shuffled = extensions.slice();
          let state = (webglNoiseSeed ^ version) >>> 0;
          for (let index = shuffled.length - 1; index > 0; index--) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            state >>>= 0;
            const swapIndex = state % (index + 1);
            [shuffled[index], shuffled[swapIndex]] = [
              shuffled[swapIndex],
              shuffled[index],
            ];
          }
          notifyWebGLAccess();
          return shuffled;
        },
        `${label}.getSupportedExtensions`,
      );
      protectMethod(
        Constructor.prototype,
        "getExtension",
        (target, self, args) => {
          const extension = Reflect.apply(target, self, args);
          if (
            isFeatureActive("webgl") &&
            typeof args[0] === "string" &&
            args[0].toLowerCase() === "webgl_debug_renderer_info"
          ) {
            notifyWebGLAccess();
          }
          return extension;
        },
        `${label}.getExtension`,
      );
      protectMethod(
        Constructor.prototype,
        "readPixels",
        (target, self, args) => {
          const result = Reflect.apply(target, self, args);
          const output = args[6];
          if (
            !isFeatureActive("webgl") ||
            !Number.isInteger(args[2]) ||
            args[2] <= 0 ||
            !Number.isInteger(args[3]) ||
            args[3] <= 0 ||
            !ArrayBuffer.isView(output) ||
            typeof output.length !== "number" ||
            !output.length
          ) {
            return result;
          }
          const offset = Number.isInteger(args[7]) ? args[7] : 0;
          const available = output.length - offset;
          if (available <= 0) return result;
          const pixelCount = Math.max(1, Math.floor(available / 4));
          const pixel = (webglNoiseSeed + args[2] + args[3]) % pixelCount;
          const index = offset + pixel * 4 + (webglNoiseSeed % Math.min(3, available));
          if (index < output.length && typeof output[index] === "number") {
            const value = output[index];
            const delta = output instanceof Float32Array ? 1e-7 : 1;
            output[index] = value > 0 ? value - delta : value + delta;
          }
          notifyWebGLAccess();
          return result;
        },
        `${label}.readPixels`,
      );
    };

    protectWebGL(
      typeof WebGLRenderingContext === "undefined"
        ? undefined
        : WebGLRenderingContext,
      1,
    );
    protectWebGL(
      typeof WebGL2RenderingContext === "undefined"
        ? undefined
        : WebGL2RenderingContext,
      2,
    );
  }

  if (config.font) {
    const notifyFontAccess = createOneTimeAlert("font");
    const shouldPerturb = () => Math.floor(Math.random() * 10) === 6;
    const pixelNoise = () => (Math.random() < 0.5 ? -1 : 1);

    for (const property of ["offsetWidth", "offsetHeight"]) {
      protectGetter(
        HTMLElement.prototype,
        property,
        (target, self, args) => {
          const value = Reflect.apply(target, self, args);
          if (!isFeatureActive("font") || !value || !shouldPerturb()) {
            return value;
          }
          notifyFontAccess();
          return value + pixelNoise();
        },
        `HTMLElement.${property}`,
      );
    }

    protectMethod(
      CanvasRenderingContext2D.prototype,
      "measureText",
      (target, self, args) => {
        const metrics = Reflect.apply(target, self, args);
        if (!isFeatureActive("font") || !shouldPerturb()) {
          return metrics;
        }
        const noise = pixelNoise();
        notifyFontAccess();
        return new Proxy(metrics, {
          get(targetMetrics, property) {
            const value = Reflect.get(targetMetrics, property, targetMetrics);
            return (property === "width" || property === "actualBoundingBoxRight") &&
              typeof value === "number"
              ? value + noise
              : value;
          },
        });
      },
      "CanvasRenderingContext2D.measureText",
    );
  }

  if (config.timezone) {
    try {
      const notifyTimezoneAccess = createOneTimeAlert("timezone");
      const getTimezoneOffset = Date.prototype.getTimezoneOffset;
      const setTime = Date.prototype.setTime;
      const NativeIntlDateTimeFormat = Intl.DateTimeFormat;
      const timezoneOffsetCache = new Map();

      const parseTimeZoneOffset = function (timeZoneName) {
        if (!timeZoneName) return null;
        const normalized = String(timeZoneName)
          .replace(/−/g, "-")
          .replace(/^UTC/, "GMT");
        if (normalized === "GMT") return 0;
        const match = normalized.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
        if (!match) return null;
        const sign = match[1] === "+" ? -1 : 1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || "0", 10);
        return sign * (hours * 60 + minutes);
      };

      const getTimezoneOptions = function () {
        const timezoneConfig = config.timezone || {};
        const vpnLocation = config.vpnLocation || {};
        const synchronizedTimezone =
          vpnLocation.syncTimezone && vpnLocation.timezone
            ? vpnLocation.timezone
            : null;
        return {
          name:
            synchronizedTimezone ||
            timezoneConfig.name ||
            new NativeIntlDateTimeFormat().resolvedOptions().timeZone,
        };
      };

      const getSpoofedTimezoneOffset = function (dateObj) {
        const options = getTimezoneOptions();
        const timeValue =
          dateObj && typeof dateObj.getTime === "function"
            ? dateObj.getTime()
            : Date.now();
        if (!Number.isFinite(timeValue)) return getTimezoneOffset.call(dateObj);

        const cacheKey = `${options.name}:${Math.floor(timeValue / 3600000)}`;
        if (timezoneOffsetCache.has(cacheKey)) {
          return timezoneOffsetCache.get(cacheKey);
        }

        let offset = getTimezoneOffset.call(dateObj);
        try {
          const formatter = new NativeIntlDateTimeFormat("en-US", {
            timeZone: options.name,
            timeZoneName: "longOffset",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          const parts = formatter.formatToParts(new Date(timeValue));
          const zonePart = parts.find((part) => part.type === "timeZoneName");
          const parsed = parseTimeZoneOffset(zonePart && zonePart.value);
          if (parsed !== null) {
            offset = parsed;
          }
        } catch (error) {}

        timezoneOffsetCache.set(cacheKey, offset);
        if (timezoneOffsetCache.size > 96) {
          const oldestKey = timezoneOffsetCache.keys().next().value;
          timezoneOffsetCache.delete(oldestKey);
        }
        return offset;
      };

      const withSpoofedTimezoneOptions = function (args) {
        const options = getTimezoneOptions();
        const nextArgs = Array.prototype.slice.call(args);
        const existingOptions = nextArgs[1];
        nextArgs[1] =
          existingOptions && typeof existingOptions === "object"
            ? Object.assign({}, existingOptions)
            : {};
        nextArgs[1].timeZone = options.name;
        return nextArgs;
      };

      const localDateReaders = [
        "getDate",
        "getDay",
        "getFullYear",
        "getHours",
        "getMilliseconds",
        "getMinutes",
        "getMonth",
        "getSeconds",
        "getYear",
        "toDateString",
      ];
      const localDateSetters = [
        "setHours",
        "setMinutes",
        "setSeconds",
        "setMilliseconds",
        "setMonth",
        "setDate",
        "setYear",
        "setFullYear",
      ];

      const convertToGMT = function (n) {
        const format = function (v) {
          return (v < 10 ? "0" : "") + v;
        };
        return (
          (n <= 0 ? "+" : "-") +
          format((Math.abs(n) / 60) | 0) +
          format(Math.abs(n) % 60)
        );
      };

      const createSpoofedDate = function (date) {
        const delta = getTimezoneOffset.call(date) - getSpoofedTimezoneOffset(date);
        return new Date(date.getTime() + delta * 60 * 1000);
      };

      protectMethod(
        Date.prototype,
        "getTimezoneOffset",
        (target, self, args) => {
          if (!isFeatureActive("timezone") || isNaN(self)) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          return getSpoofedTimezoneOffset(self);
        },
        "Date.getTimezoneOffset",
      );

      protectMethod(
        Date.prototype,
        "toString",
        (target, self, args) => {
          if (!isFeatureActive("timezone") || isNaN(self)) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          return self.toDateString() + " " + self.toTimeString();
        },
        "Date.toString",
      );

      for (const method of [
        "toLocaleString",
        "toLocaleDateString",
        "toLocaleTimeString",
      ]) {
        protectMethod(
          Date.prototype,
          method,
          (target, self, args) => {
            if (!isFeatureActive("timezone")) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
          },
          `Date.${method}`,
        );
      }

      protectMethod(
        Date.prototype,
        "toTimeString",
        (target, self, args) => {
          if (!isFeatureActive("timezone") || isNaN(self)) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          const native = Reflect.apply(target, createSpoofedDate(self), args);
          const nativeOffset = convertToGMT(getTimezoneOffset.call(self));
          const spoofedOffset = convertToGMT(getSpoofedTimezoneOffset(self));
          const zoneName = `(${getTimezoneOptions().name.replace(/\//g, " ")} Time)`;
          return native
            .replace(nativeOffset, spoofedOffset)
            .replace(/\(.*\)/, zoneName);
        },
        "Date.toTimeString",
      );

      for (const name of localDateReaders) {
        protectMethod(
          Date.prototype,
          name,
          (target, self, args) => {
            if (!isFeatureActive("timezone") || isNaN(self)) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            return Reflect.apply(target, createSpoofedDate(self), args);
          },
          `Date.${name}`,
        );
      }

      for (const name of localDateSetters) {
        protectMethod(
          Date.prototype,
          name,
          (target, self, args) => {
            if (!isFeatureActive("timezone") || isNaN(self)) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            const shifted = createSpoofedDate(self);
            const previousTime = shifted.getTime();
            const updatedTime = Reflect.apply(target, shifted, args);
            return Reflect.apply(setTime, self, [
              self.getTime() + updatedTime - previousTime,
            ]);
          },
          `Date.${name}`,
        );
      }

      protectMethod(
        Intl.DateTimeFormat.prototype,
        "resolvedOptions",
        (target, self, args) => {
          const result = Reflect.apply(target, self, args);
          if (isFeatureActive("timezone")) {
            notifyTimezoneAccess();
            result.timeZone = getTimezoneOptions().name;
          }
          return result;
        },
        "Intl.DateTimeFormat.resolvedOptions",
      );

      Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
        apply(target, self, args) {
          if (!isFeatureActive("timezone")) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
        },
        construct(target, args, newTarget) {
          if (!isFeatureActive("timezone")) {
            return Reflect.construct(target, args, newTarget);
          }
          notifyTimezoneAccess();
          return Reflect.construct(
            target,
            withSpoofedTimezoneOptions(args),
            newTarget,
          );
        },
      });

    } catch (error) {
      debugError("[Stealth Guard] Timezone protection failed:", error);
    }
  }

  if (config.geolocation && navigator.geolocation) {
    try {
      const notifyGeolocationAccess = createOneTimeAlert("geolocation");
      const geolocationPrototype = Object.getPrototypeOf(navigator.geolocation);

      const createSpoofedPosition = function (position) {
        const vpnLocation = config.vpnLocation || {};
        if (
          !vpnLocation.syncGeolocation ||
          !Number.isFinite(vpnLocation.latitude) ||
          !Number.isFinite(vpnLocation.longitude)
        ) {
          return position;
        }
        notifyGeolocationAccess();
        return Object.freeze({
          coords: Object.freeze({
            latitude: vpnLocation.latitude,
            longitude: vpnLocation.longitude,
            accuracy: Math.max(
              2500,
              Number(position && position.coords && position.coords.accuracy) ||
                0,
            ),
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          }),
          timestamp:
            Number(position && position.timestamp) || Date.now(),
        });
      };

      for (const method of ["getCurrentPosition", "watchPosition"]) {
        protectMethod(
          geolocationPrototype,
          method,
          (target, self, args) => {
            if (
              !isFeatureActive("geolocation") ||
              !config.vpnLocation ||
              !config.vpnLocation.syncGeolocation
            ) {
              return Reflect.apply(target, self, args);
            }
            const nextArgs = Array.prototype.slice.call(args);
            const success = nextArgs[0];
            if (typeof success === "function") {
              nextArgs[0] = function (position) {
                return Reflect.apply(success, this, [
                  createSpoofedPosition(position),
                ]);
              };
            }
            return Reflect.apply(target, self, nextArgs);
          },
          `Geolocation.${method}`,
        );
      }
    } catch (error) {
      debugError("[Stealth Guard] Geolocation protection failed:", error);
    }
  }

  if (config.clientrects) {
    const notifyClientRectsAccess = createOneTimeAlert("clientrects");
    const protectRect = function (Constructor, properties, ratio, label) {
      const property = properties[Math.floor(Math.random() * properties.length)];
      protectGetter(
        Constructor.prototype,
        property,
        (target, self, args) => {
          const value = Reflect.apply(target, self, args);
          if (!isFeatureActive("clientrects")) return value;
          notifyClientRectsAccess();
          const direction = Math.random() < 0.5 ? -1 : 1;
          return value * (1 + direction * ratio);
        },
        `${label}.${property}`,
      );
    };

    protectRect(DOMRect, ["x", "y", "width", "height"], 0.00000001, "DOMRect");
    protectRect(
      DOMRectReadOnly,
      ["top", "right", "bottom", "left"],
      0.000001,
      "DOMRectReadOnly",
    );
  }

  if (config.webgpu) {
    const notifyWebGpuAccess = createOneTimeAlert("webgpu");
    const protectedLimitNames = new Set([
      "maxBufferSize",
      "maxUniformBufferBindingSize",
      "maxStorageBufferBindingSize",
      "maxComputeWorkgroupStorageSize",
    ]);

    const protectGpuLimits = function (Constructor, label) {
      if (typeof Constructor === "undefined") return;
      protectGetter(
        Constructor.prototype,
        "limits",
        (target, self, args) => {
          const limits = Reflect.apply(target, self, args);
          if (!isFeatureActive("webgpu")) return limits;
          return new Proxy(limits, {
            get(targetLimits, property) {
              const value = Reflect.get(targetLimits, property, targetLimits);
              if (protectedLimitNames.has(property) && typeof value === "number") {
                notifyWebGpuAccess();
                return value - (Math.random() < 0.5 ? 1 : 2);
              }
              return value;
            },
          });
        },
        `${label}.limits`,
      );
    };

    protectGpuLimits(
      typeof GPUAdapter === "undefined" ? undefined : GPUAdapter,
      "GPUAdapter",
    );
    protectGpuLimits(
      typeof GPUDevice === "undefined" ? undefined : GPUDevice,
      "GPUDevice",
    );

    if (typeof GPUCommandEncoder !== "undefined") {
      protectMethod(
        GPUCommandEncoder.prototype,
        "beginRenderPass",
        (target, self, args) => {
          const descriptor = args[0];
          const attachment =
            descriptor && descriptor.colorAttachments && descriptor.colorAttachments[0];
          if (
            isFeatureActive("webgpu") &&
            attachment &&
            attachment.clearValue
          ) {
            const clearValue = Array.isArray(attachment.clearValue)
              ? [...attachment.clearValue]
              : { ...attachment.clearValue };
            for (const key of Object.keys(clearValue)) {
              if (typeof clearValue[key] === "number") {
                clearValue[key] *= Math.random() < 0.5 ? 0.99 : 1.01;
              }
            }
            args[0] = {
              ...descriptor,
              colorAttachments: [
                { ...attachment, clearValue },
                ...descriptor.colorAttachments.slice(1),
              ],
            };
            notifyWebGpuAccess();
          }
          return Reflect.apply(target, self, args);
        },
        "GPUCommandEncoder.beginRenderPass",
      );
    }

    const cloneBufferRange = function (source, offsetValue, sizeValue) {
      const offset = Number.isFinite(Number(offsetValue))
        ? Math.max(0, Math.floor(Number(offsetValue)))
        : 0;
      const size = Number.isFinite(Number(sizeValue))
        ? Math.max(0, Math.floor(Number(sizeValue)))
        : null;
      if (source instanceof ArrayBuffer) {
        const copy = source.slice(0);
        const start = Math.min(offset, copy.byteLength);
        const length = Math.min(size ?? copy.byteLength - start, copy.byteLength - start);
        return { copy, values: new Uint8Array(copy, start, length) };
      }
      if (!ArrayBuffer.isView(source)) return null;
      if (typeof source.subarray === "function") {
        const copy = new source.constructor(source);
        const start = Math.min(offset, copy.length);
        const end = Math.min(copy.length, start + (size ?? copy.length - start));
        return { copy, values: copy.subarray(start, end) };
      }
      const copiedBuffer = source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      );
      const copy = new DataView(copiedBuffer);
      const start = Math.min(offset, copy.byteLength);
      const length = Math.min(size ?? copy.byteLength - start, copy.byteLength - start);
      return { copy, values: new Uint8Array(copiedBuffer, start, length) };
    };

    if (typeof GPUQueue !== "undefined") {
      protectMethod(
        GPUQueue.prototype,
        "writeBuffer",
        (target, self, args) => {
          const range = isFeatureActive("webgpu")
            ? cloneBufferRange(args[2], args[3], args[4])
            : null;
          if (range && range.values.length) {
            const count = Math.ceil(range.values.length * 0.1);
            const step = Math.max(1, Math.floor(range.values.length / count));
            for (
              let index = 0, changed = 0;
              index < range.values.length && changed < count;
              index += step, changed++
            ) {
              const value = range.values[index];
              if (typeof value === "number") {
                const delta = Math.max(1, Math.abs(value) * 0.0001);
                range.values[index] = value + (Math.random() < 0.5 ? -delta : delta);
              }
            }
            args[2] = range.copy;
            notifyWebGpuAccess();
          }
          return Reflect.apply(target, self, args);
        },
        "GPUQueue.writeBuffer",
      );
    }
  }

  if (config.audiocontext) {
    const notifyAudioAccess = createOneTimeAlert("audiocontext");
    const protectedBuffers = new WeakSet();
    const addFloatNoise = function (values, scale) {
      if (!values || typeof values.length !== "number") return;
      for (let index = 0; index < values.length; index += 100) {
        values[index] += Math.random() * scale;
      }
    };

    const addByteNoise = function (values) {
      if (!values || typeof values.length !== "number") return;
      for (let index = 0; index < values.length; index += 100) {
        const value = values[index];
        values[index] = value >= 255 ? value - 1 : value + 1;
      }
    };

    if (typeof AudioBuffer !== "undefined") {
      protectMethod(
        AudioBuffer.prototype,
        "getChannelData",
        (target, self, args) => {
          const data = Reflect.apply(target, self, args);
          if (
            isFeatureActive("audiocontext") &&
            !protectedBuffers.has(data)
          ) {
            protectedBuffers.add(data);
            addFloatNoise(data, 0.0000001);
            notifyAudioAccess();
          }
          return data;
        },
        "AudioBuffer.getChannelData",
      );
      protectMethod(
        AudioBuffer.prototype,
        "copyFromChannel",
        (target, self, args) => {
          const result = Reflect.apply(target, self, args);
          if (isFeatureActive("audiocontext") && args[0]) {
            addFloatNoise(args[0], 0.0000001);
            notifyAudioAccess();
          }
          return result;
        },
        "AudioBuffer.copyFromChannel",
      );
    }

    if (typeof AnalyserNode !== "undefined") {
      const protectAnalyserReadout = function (method, addNoise) {
        protectMethod(
          AnalyserNode.prototype,
          method,
          (target, self, args) => {
            const result = Reflect.apply(target, self, args);
            if (isFeatureActive("audiocontext") && args[0]) {
              addNoise(args[0]);
              notifyAudioAccess();
            }
            return result;
          },
          `AnalyserNode.${method}`,
        );
      };
      protectAnalyserReadout("getFloatFrequencyData", (values) =>
        addFloatNoise(values, 0.1),
      );
      protectAnalyserReadout("getFloatTimeDomainData", (values) =>
        addFloatNoise(values, 0.0000001),
      );
      protectAnalyserReadout("getByteFrequencyData", addByteNoise);
      protectAnalyserReadout("getByteTimeDomainData", addByteNoise);
    }
  }

  const currentHostname = window.location.hostname;
  const isEmptyHostnameFrame = !currentHostname;

  if (config.language && !isEmptyHostnameFrame) {
    try {
      const notifyLanguageAccess = createOneTimeAlert("language");
      let cachedLanguageKey = null;
      let cachedLanguages = null;
      const getLanguageIdentity = function () {
        const identity = config.language.identity || {};
        const locale = identity.locale || config.language.preset || "en-US";
        const languages = Array.isArray(identity.languages)
          ? identity.languages
          : [locale, locale.split("-")[0]];
        const cacheKey = `${locale}:${languages.join(",")}`;
        if (cachedLanguageKey !== cacheKey) {
          cachedLanguageKey = cacheKey;
          cachedLanguages = Object.freeze(languages.slice());
        }
        return { locale, languages: cachedLanguages };
      };

      protectGetter(
        Navigator.prototype,
        "language",
        (target, self, args) => {
          if (!isFeatureActive("language")) {
            return Reflect.apply(target, self, args);
          }
          notifyLanguageAccess();
          return getLanguageIdentity().locale;
        },
        "Navigator.language",
      );
      protectGetter(
        Navigator.prototype,
        "languages",
        (target, self, args) => {
          if (!isFeatureActive("language")) {
            return Reflect.apply(target, self, args);
          }
          notifyLanguageAccess();
          return getLanguageIdentity().languages;
        },
        "Navigator.languages",
      );

      for (const constructorName of [
        "Collator",
        "DateTimeFormat",
        "DisplayNames",
        "ListFormat",
        "NumberFormat",
        "PluralRules",
        "RelativeTimeFormat",
        "Segmenter",
      ]) {
        const descriptor = Object.getOwnPropertyDescriptor(
          Intl,
          constructorName,
        );
        if (!descriptor || typeof descriptor.value !== "function") {
          continue;
        }
        const NativeIntlConstructor = descriptor.value;
        const withDefaultLanguage = function (args) {
          if (
            !isFeatureActive("language") ||
            (args.length > 0 && args[0] !== undefined)
          ) {
            return args;
          }
          notifyLanguageAccess();
          const nextArgs = Array.prototype.slice.call(args);
          nextArgs[0] = getLanguageIdentity().locale;
          return nextArgs;
        };
        Object.defineProperty(Intl, constructorName, {
          ...descriptor,
          value: new Proxy(NativeIntlConstructor, {
            apply(target, self, args) {
              return Reflect.apply(target, self, withDefaultLanguage(args));
            },
            construct(target, args, newTarget) {
              return Reflect.construct(
                target,
                withDefaultLanguage(args),
                newTarget,
              );
            },
          }),
        });
      }
    } catch (error) {
      debugWarn("[Stealth Guard] Language protection failed:", error);
    }
  }

  if (config.useragent && !isEmptyHostnameFrame) {
    const metadataByPreset = {
      macos: {
        platform: "MacIntel",
        oscpu: "Intel Mac OS X 10.15.7",
        vendor: "Apple Computer, Inc.",
        hardwareConcurrency: 8,
        deviceMemory: undefined,
        maxTouchPoints: 0,
        clientHints: null,
      },
      macos_chrome: {
        platform: "MacIntel",
        oscpu: "Intel Mac OS X 10.15.7",
        vendor: "Google Inc.",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        clientHints: clientHintProfiles.macos_chrome,
      },
      windows: {
        platform: "Win32",
        oscpu: "Windows NT 10.0; Win64; x64",
        vendor: "Google Inc.",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        clientHints: clientHintProfiles.windows,
      },
      iphone: {
        platform: "iPhone",
        oscpu: "iPhone OS 17.4.1",
        vendor: "Apple Computer, Inc.",
        hardwareConcurrency: 6,
        deviceMemory: undefined,
        maxTouchPoints: 5,
        clientHints: null,
      },
      android: {
        platform: "Linux armv8l",
        oscpu: "Linux; Android 13",
        vendor: "Google Inc.",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 5,
        clientHints: clientHintProfiles.android,
      },
    };
    let cachedPreset = null;
    let cachedProfile = null;
    const getUserAgentProfile = function () {
      const preset = config.useragent.preset || "macos";
      if (cachedPreset === preset) return cachedProfile;
      const userAgent = userAgentStrings[preset] || userAgentStrings.macos;
      const metadata = metadataByPreset[preset] || metadataByPreset.macos;
      const slash = userAgent.indexOf("/");
      const versionPattern =
        metadata.clientHints && metadata.clientHints.brand === "Microsoft Edge"
          ? /Edg\/([\d.]+)/
          : /Chrome\/([\d.]+)/;
      const versionMatch = userAgent.match(versionPattern);
      const fullVersion = versionMatch ? versionMatch[1] : "0.0.0.0";
      cachedPreset = preset;
      cachedProfile = {
        ...metadata,
        userAgent,
        appVersion: slash === -1 ? "5.0" : userAgent.slice(slash + 1),
        fullVersion,
        majorVersion: fullVersion.split(".")[0],
      };
      return cachedProfile;
    };

    const notifyUserAgentAccess = createOneTimeAlert("user-agent");
    const protectNavigatorValue = function (property, getSpoofedValue) {
      protectGetter(
        Navigator.prototype,
        property,
        (target, self, args) => {
          if (!isFeatureActive("useragent")) {
            return Reflect.apply(target, self, args);
          }
          notifyUserAgentAccess();
          return getSpoofedValue(getUserAgentProfile(), target, self, args);
        },
        `Navigator.${property}`,
      );
    };

    let cachedClientHintProfile = null;
    let cachedClientHintValues = null;
    const getClientHintValues = function (profile) {
      if (profile === cachedClientHintProfile) return cachedClientHintValues;
      const hints = profile.clientHints;
      if (!hints) return null;
      const freezeBrands = (brands) =>
        Object.freeze(brands.map((entry) => Object.freeze(entry)));
      cachedClientHintProfile = profile;
      cachedClientHintValues = {
        brands: freezeBrands([
          { brand: "Not_A Brand", version: "99" },
          { brand: "Chromium", version: profile.majorVersion },
          { brand: hints.brand, version: profile.majorVersion },
        ]),
        mobile: hints.mobile,
        platform: hints.platform,
        architecture: hints.architecture,
        bitness: hints.bitness,
        formFactors: hints.formFactors.slice(),
        fullVersionList: freezeBrands([
          { brand: "Not_A Brand", version: "99.0.0.0" },
          { brand: "Chromium", version: profile.fullVersion },
          { brand: hints.brand, version: profile.fullVersion },
        ]),
        model: hints.model,
        platformVersion: hints.platformVersion,
        uaFullVersion: profile.fullVersion,
        wow64: hints.wow64,
      };
      return cachedClientHintValues;
    };

    const cloneClientHintValue = function (value) {
      if (Array.isArray(value)) {
        return value.map((entry) =>
          entry && typeof entry === "object" ? { ...entry } : entry,
        );
      }
      return value;
    };

    const createClientHintResult = function (requested, profile) {
      const values = getClientHintValues(profile);
      const result = {};
      if (!values) return result;
      for (const name of ["brands", "mobile", "platform"]) {
        result[name] = cloneClientHintValue(values[name]);
      }
      for (const name of requested) {
        if (Object.prototype.hasOwnProperty.call(values, name)) {
          result[name] = cloneClientHintValue(values[name]);
        }
      }
      return result;
    };

    let cachedClientHintsSource = null;
    let cachedClientHintsFacade = null;
    const createClientHintsFacade = function (nativeValue) {
      const profile = getUserAgentProfile();
      if (!profile.clientHints) return undefined;
      if (cachedClientHintsSource === nativeValue && cachedClientHintsFacade) {
        return cachedClientHintsFacade;
      }

      const source =
        nativeValue && typeof nativeValue === "object"
          ? nativeValue
          : typeof NavigatorUAData !== "undefined"
            ? Object.create(NavigatorUAData.prototype)
            : {};
      const nativeHighEntropyMethod =
        nativeValue && typeof nativeValue.getHighEntropyValues === "function"
          ? nativeValue.getHighEntropyValues
          : null;
      const readHighEntropyValues = function (hints) {
        notifyUserAgentAccess();
        const requested = Array.from(hints || []);
        if (!nativeHighEntropyMethod) {
          return Promise.resolve(
            createClientHintResult(requested, getUserAgentProfile()),
          );
        }
        return Reflect.apply(nativeHighEntropyMethod, nativeValue, [
          hints,
        ]).then(() =>
          createClientHintResult(requested, getUserAgentProfile()),
        );
      };
      const highEntropyMethod = nativeHighEntropyMethod
        ? new Proxy(nativeHighEntropyMethod, {
            apply(targetMethod, self, args) {
              return readHighEntropyValues(args[0]);
            },
          })
        : readHighEntropyValues;
      const nativeToJSONMethod =
        nativeValue && typeof nativeValue.toJSON === "function"
          ? nativeValue.toJSON
          : function () {};
      const toJSONMethod = new Proxy(nativeToJSONMethod, {
        apply() {
          notifyUserAgentAccess();
          return createClientHintResult([], getUserAgentProfile());
        },
      });
      cachedClientHintsSource = nativeValue;
      cachedClientHintsFacade = new Proxy(source, {
        get(target, property, receiver) {
          const currentProfile = getUserAgentProfile();
          const values = getClientHintValues(currentProfile);
          if (!values) return undefined;
          if (
            property === "brands" ||
            property === "mobile" ||
            property === "platform"
          ) {
            notifyUserAgentAccess();
            return property === "brands"
              ? values.brands
              : values[property];
          }
          if (property === "getHighEntropyValues") {
            return highEntropyMethod;
          }
          if (property === "toJSON") {
            return toJSONMethod;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return cachedClientHintsFacade;
    };

    protectNavigatorValue("userAgent", (profile) => profile.userAgent);
    protectNavigatorValue("platform", (profile) => profile.platform);
    protectNavigatorValue("appVersion", (profile) => profile.appVersion);
    protectNavigatorValue("vendor", (profile) => profile.vendor);
    protectNavigatorValue(
      "hardwareConcurrency",
      (profile) => profile.hardwareConcurrency,
    );
    protectNavigatorValue("deviceMemory", (profile) => profile.deviceMemory);
    protectNavigatorValue(
      "maxTouchPoints",
      (profile) => profile.maxTouchPoints,
    );
    if (Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgentData")) {
      protectNavigatorValue(
        "userAgentData",
        (profile, target, self, args) =>
          createClientHintsFacade(Reflect.apply(target, self, args)),
      );
    }
    if (Object.getOwnPropertyDescriptor(Navigator.prototype, "oscpu")) {
      protectNavigatorValue("oscpu", (profile) => profile.oscpu);
    }
  }

  if (config.webrtc) {
    try {
      const NativeRTCPeerConnection =
        window.RTCPeerConnection ||
        window.webkitRTCPeerConnection ||
        window.mozRTCPeerConnection;

      if (NativeRTCPeerConnection) {
        const ProtectedRTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
          construct(target, args, newTarget) {
            if (isFeatureActive("webrtc")) {
              sendFingerprintAlert("webrtc");
            }
            return Reflect.construct(target, args, newTarget);
          },
        });

        window.RTCPeerConnection = ProtectedRTCPeerConnection;
        if (window.webkitRTCPeerConnection) {
          window.webkitRTCPeerConnection = ProtectedRTCPeerConnection;
        }
        if (window.mozRTCPeerConnection) {
          window.mozRTCPeerConnection = ProtectedRTCPeerConnection;
        }
      }
    } catch (error) {
      debugWarn("[Stealth Guard] Could not setup WebRTC detection:", error);
    }
  }

  if (
    bridge.diagnosticRequestEvent &&
    bridge.diagnosticResultEvent &&
    bridge.diagnosticToken
  ) {
    window.addEventListener(
      bridge.diagnosticRequestEvent,
      function (event) {
        if (!event || !event.detail || event.detail.token !== bridge.diagnosticToken) {
          return;
        }
        let timeZone = null;
        let intlLocale = null;
        try {
          const resolved = new Intl.DateTimeFormat().resolvedOptions();
          timeZone = resolved.timeZone || null;
          intlLocale = resolved.locale || null;
        } catch (error) {}
        window.dispatchEvent(
          new CustomEvent(bridge.diagnosticResultEvent, {
            detail: {
              token: bridge.diagnosticToken,
              snapshot: {
                hostname: window.location.hostname,
                userAgent: navigator.userAgent,
                language: navigator.language,
                languages: Array.from(navigator.languages || []),
                intlLocale,
                timeZone,
                timezoneOffset: new Date().getTimezoneOffset(),
              },
            },
          }),
        );
      },
      true,
    );
  }
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { installMainWorldProtections };
}
