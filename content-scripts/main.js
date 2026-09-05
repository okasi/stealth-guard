function installMainWorldProtections(
  initialConfig,
  bridge,
  createPatternTools,
  createChallengeUrlMatcher,
) {
  "use strict";

  const config = initialConfig;
  const configUpdateEvent = bridge.configEvent;
  const configUpdateToken = bridge.configToken;
  const domainPatterns = createPatternTools();
  const isCloudflareChallengeUrl = createChallengeUrlMatcher();
  const nativeHasOwnProperty = Object.prototype.hasOwnProperty;
  let cloudflareChallengeDocument = false;

  const isCloudflareChallengeDocument = function () {
    if (
      cloudflareChallengeDocument ||
      isCloudflareChallengeUrl(window.location.href)
    ) {
      cloudflareChallengeDocument = true;
      return true;
    }
    if (
      !nativeHasOwnProperty.call(window, "_cf_chl_opt") ||
      !window._cf_chl_opt ||
      typeof window._cf_chl_opt !== "object"
    ) {
      return false;
    }
    const currentScript = document.currentScript;
    if (
      currentScript &&
      currentScript.src &&
      isCloudflareChallengeUrl(currentScript.src)
    ) {
      cloudflareChallengeDocument = true;
      return true;
    }
    cloudflareChallengeDocument = Array.from(document.scripts).some(
      (script) => script.src && isCloudflareChallengeUrl(script.src),
    );
    return cloudflareChallengeDocument;
  };

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

  let getCurrentUserAgentProfile = function () {
    return null;
  };
  let getCurrentLanguageIdentity = function () {
    return null;
  };
  let getCurrentTimezoneName = function () {
    return null;
  };
  let getCurrentWebGLIdentity = function () {
    return null;
  };

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

  const protectDescriptor = function (prototype, property, slot, apply, label) {
    try {
      if (!prototype) return false;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor || typeof descriptor[slot] !== "function") return false;
      Object.defineProperty(prototype, property, {
        ...descriptor,
        [slot]: new Proxy(descriptor[slot], { apply }),
      });
      return true;
    } catch (error) {
      debugWarn(`[Stealth Guard] Failed to protect ${label || property}:`, error);
      return false;
    }
  };
  const protectGetter = (prototype, property, apply, label) =>
    protectDescriptor(prototype, property, "get", apply, label);
  const protectMethod = (prototype, property, apply, label) =>
    protectDescriptor(prototype, property, "value", apply, label);

  const isDomainAllowlisted = function (allowlist) {
    return domainPatterns.isAllowlisted(window.location.hostname, allowlist);
  };

  const isFeatureActive = function (featureName) {
    if (isCloudflareChallengeDocument()) {
      return false;
    }
    const featureConfig = config[featureName];
    return Boolean(
      config.enabled &&
        featureConfig &&
        featureConfig.enabled &&
        !isDomainAllowlisted(config.globalWhitelist || "") &&
        !isDomainAllowlisted(featureConfig.whitelist || ""),
    );
  };

  const isWebGLStrict = function () {
    const webgl = config.webgl;
    const isCompatibilitySite =
      webgl &&
      domainPatterns.isAllowlisted(
        window.location.hostname,
        webgl.compatibilityWhitelist || "",
      );
    return Boolean(
      isFeatureActive("webgl") &&
        webgl &&
        !isCompatibilitySite &&
        (webgl.mode === "strict" ||
          domainPatterns.isAllowlisted(
            window.location.hostname,
            webgl.strictWhitelist || "",
          )),
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

  // Shared by the page and serialized Worker runtime.
  function createWebGLNoiseTools(getSeed, isStrict) {
    const advanceWebGLNoiseState = function (state) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };

    const seedWebGLNoiseState = function (...values) {
      let state = getSeed() || 1;
      for (const value of values) {
        state = advanceWebGLNoiseState((state ^ (Number(value) >>> 0)) >>> 0);
      }
      return state;
    };

    const addSeededWebGLNoise = function (imageData) {
      const totalPixels = imageData.width * imageData.height;
      if (!totalPixels || totalPixels > 1000000) return imageData;
      let state = seedWebGLNoiseState(imageData.width, imageData.height);
      const samples = Math.min(32, totalPixels);
      for (let sample = 0; sample < samples; sample++) {
        state = advanceWebGLNoiseState(state ^ sample);
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
    const getReadbackChannelCount = function (format) {
      if (format === 6407 || format === 36248) return 3;
      if (format === 33319 || format === 33320) return 2;
      if (format === 6408 || format === 36249) return 4;
      return 1;
    };

    const getIntegerArrayMaximum = function (output) {
      if (output instanceof Uint8Array || output instanceof Uint8ClampedArray) {
        return 255;
      }
      if (output instanceof Uint16Array) return 65535;
      if (output instanceof Uint32Array) return 4294967295;
      return null;
    };

    const addSeededWebGLReadbackNoise = function (
      context,
      nativeGetParameter,
      output,
      width,
      height,
      format,
      type,
      offset,
    ) {
      if (!isStrict() || !ArrayBuffer.isView(output) || !output.length ||
          !Number.isInteger(width) || !Number.isInteger(height) ||
          width <= 0 || height <= 0 || offset < 0 || type < 5120 || type > 5126) return;
      const channels = getReadbackChannelCount(format);
      const readParameter = (name) => Reflect.apply(nativeGetParameter, context, [name]);
      const alignment = readParameter(3333); // PACK_ALIGNMENT
      const webgl2 = "PACK_ROW_LENGTH" in context;
      const rowLength = webgl2 ? readParameter(3330) || width : width;
      const skipRows = webgl2 ? readParameter(3331) : 0;
      const skipPixels = webgl2 ? readParameter(3332) : 0;
      const rowBytes = rowLength * channels * output.BYTES_PER_ELEMENT;
      const stride = Math.ceil(rowBytes / alignment) * alignment / output.BYTES_PER_ELEMENT;
      const start = offset + skipRows * stride + skipPixels * channels;
      if (start + (height - 1) * stride + width * channels > output.length) return;
      const pixelCount = width * height;
      let state = seedWebGLNoiseState(width, height, format, type, offset);
      const samples = Math.min(8, pixelCount);
      const maximum = getIntegerArrayMaximum(output);
      const isFloat = output instanceof Float32Array || output instanceof Float64Array;
      for (let sample = 0; sample < samples; sample++) {
        state = advanceWebGLNoiseState(state ^ sample);
        const pixel = state % pixelCount;
        const channel = (state >>> 8) % Math.min(3, channels);
        const index = start + Math.floor(pixel / width) * stride + (pixel % width) * channels + channel;
        const value = output[index];
        if (typeof value !== "number") continue;
        if (isFloat) {
          const delta = value === 0 ? 1e-7 : Math.max(Math.abs(value), 1) * 1e-7;
          output[index] = value + (state & 1 ? delta : -delta);
          continue;
        }
        const direction = state & 1 ? 1 : -1;
        const nextValue = value + direction;
        output[index] =
          maximum === null
            ? nextValue
            : Math.max(0, Math.min(maximum, nextValue));
      }
    };

    return { advanceWebGLNoiseState, seedWebGLNoiseState,
      addSeededWebGLNoise, addSeededWebGLReadbackNoise };
  }
  const { advanceWebGLNoiseState, seedWebGLNoiseState,
    addSeededWebGLNoise, addSeededWebGLReadbackNoise } =
    createWebGLNoiseTools(() => webglNoiseSeed, isWebGLStrict);

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

    const exportNoisedCanvas = function (canvas, originalMethod, args) {
      const isWebGLCanvas = webglCanvases.has(canvas);
      // WebGL exports are rendering output, not a safe place to inject
      // fingerprint noise in compatibility mode. Editors and design tools
      // commonly use these exports for textures, thumbnails, and clipboard
      // data. Strict mode operates on a copy only.
      if (isWebGLCanvas) {
        if (!isFeatureActive("webgl") || !canvas.width || !canvas.height) {
          return originalMethod.apply(canvas, args);
        }
        if (!isWebGLStrict()) {
          sendFingerprintAlert("webgl");
          return originalMethod.apply(canvas, args);
        }
        const snapshot = createCanvasLike(canvas);
        const snapshotContext = snapshot.getContext("2d");
        if (!snapshotContext) return originalMethod.apply(canvas, args);
        snapshotContext.drawImage(canvas, 0, 0);
        const imageData = readCanvasImageData(
          snapshotContext,
          canvas.width,
          canvas.height,
        );
        addSeededWebGLNoise(imageData);
        const tempCanvas = createCanvasLike(canvas);
        const tempContext = tempCanvas.getContext("2d");
        if (!tempContext) return originalMethod.apply(canvas, args);
        tempContext.putImageData(imageData, 0, 0);
        sendFingerprintAlert("webgl");
        return originalMethod.apply(tempCanvas, args);
      }
      if (!isFeatureActive("canvas") || !canvas.width || !canvas.height) {
        return originalMethod.apply(canvas, args);
      }

      let imageData;
      const context = canvas.getContext("2d");
      if (!context) return originalMethod.apply(canvas, args);
      imageData = readCanvasImageData(context, canvas.width, canvas.height);
      addCanvasNoise(imageData);

      const tempCanvas = createCanvasLike(canvas);
      tempCanvas.getContext("2d").putImageData(imageData, 0, 0);
      sendFingerprintAlert("canvas");
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

  const getConfiguredGpuProfile = function () {
    return config.gpuProfile && typeof config.gpuProfile === "object"
      ? config.gpuProfile
      : null;
  };
  const getConfiguredWebGLSurfaceProfile = function (version) {
    const profile = getConfiguredGpuProfile();
    if (!profile || !profile.webgl) return null;
    return version === 2
      ? profile.webgl.webgl2 || profile.webgl.webgl1
      : profile.webgl.webgl1 || profile.webgl.webgl2;
  };
  const getConfiguredWebGPUProfile = function () {
    const profile = getConfiguredGpuProfile();
    return profile && profile.webgpu ? profile.webgpu : null;
  };
  const isWebGPUProfileActive = function () {
    return Boolean(
      getConfiguredWebGPUProfile() &&
        isFeatureActive("webgpu") &&
        (!config.webgl || isWebGLStrict()),
    );
  };

  if (config.webgl) {
    const webglProfiles = {
      apple: {
        maskedVendor: "WebKit",
        maskedRenderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Apple)",
        unmaskedRenderer:
          "ANGLE (Apple, ANGLE Metal Renderer: Apple GPU, Unspecified Version)",
      },
      safari_apple: {
        maskedVendor: "WebKit",
        maskedRenderer: "WebKit WebGL",
        unmaskedVendor: "Apple Inc. (WebKit)",
        unmaskedRenderer: "Apple GPU",
      },
      iphone: {
        maskedVendor: "WebKit",
        maskedRenderer: "WebKit WebGL",
        unmaskedVendor: "Apple Inc. (WebKit)",
        unmaskedRenderer: "Apple GPU",
      },
      pixel_4: {
        maskedVendor: "WebKit",
        maskedRenderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Qualcomm)",
        unmaskedRenderer:
          "ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)",
      },
      surface_pro_7: {
        maskedVendor: "WebKit",
        maskedRenderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Intel)",
        unmaskedRenderer:
          "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 640 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      },
    };
    const defaultProfileByUserAgent = {
      macos: "safari_apple",
      macos_chrome: "apple",
      windows: "surface_pro_7",
      iphone: "iphone",
      android: "pixel_4",
    };
    const compatibleProfilesByUserAgent = {
      macos: new Set(["auto", "apple"]),
      macos_chrome: new Set(["auto", "apple"]),
      windows: new Set(["auto", "surface_pro_7"]),
      iphone: new Set(["auto", "apple"]),
      android: new Set(["auto", "pixel_4"]),
    };
    const identityParameters = new Set([7936, 7937, 37445, 37446]);
    const shaderTypeNames = {
      35632: "FRAGMENT_SHADER",
      35633: "VERTEX_SHADER",
    };
    const shaderPrecisionNames = {
      36336: "LOW_FLOAT",
      36337: "MEDIUM_FLOAT",
      36338: "HIGH_FLOAT",
      36339: "LOW_INT",
      36340: "MEDIUM_INT",
      36341: "HIGH_INT",
    };
    const debugRendererInfoContexts = new WeakSet();
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      webglNoiseSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    } else {
      webglNoiseSeed = (Math.random() * 0xffffffff) >>> 0 || 1;
    }
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

    const getWebGLProfile = function (version = 1) {
      const importedSurface = getConfiguredWebGLSurfaceProfile(version);
      const importedDebug = importedSurface && importedSurface.debug;
      if (
        importedSurface &&
        importedDebug &&
        Object.keys(importedDebug).length > 0
      ) {
        return {
          maskedVendor: importedDebug.VENDOR || "WebKit",
          maskedRenderer: importedDebug.RENDERER || "WebKit WebGL",
          unmaskedVendor:
            importedDebug.UNMASKED_VENDOR_WEBGL || importedDebug.VENDOR || "",
          unmaskedRenderer:
            importedDebug.UNMASKED_RENDERER_WEBGL ||
            importedDebug.RENDERER ||
            "",
        };
      }
      const userAgentPreset =
        (config.useragent && config.useragent.preset) || "macos_chrome";
      const defaultProfile =
        defaultProfileByUserAgent[userAgentPreset] || "apple";
      const requestedProfile =
        config.webgl && typeof config.webgl.preset === "string"
          ? config.webgl.preset
          : "auto";
      const compatibleProfiles =
        compatibleProfilesByUserAgent[userAgentPreset];
      let profileName = requestedProfile;
      if (
        requestedProfile === "apple" &&
        (userAgentPreset === "macos" || userAgentPreset === "iphone")
      ) {
        profileName = defaultProfile;
      } else if (
        requestedProfile === "auto" ||
        !compatibleProfiles ||
        !compatibleProfiles.has(requestedProfile)
      ) {
        profileName = defaultProfile;
      }
      return webglProfiles[profileName] || webglProfiles.apple;
    };
    getCurrentWebGLIdentity = function () {
      const profile = getWebGLProfile(1);
      return {
        maskedVendor: profile.maskedVendor,
        maskedRenderer: profile.maskedRenderer,
        unmaskedVendor: profile.unmaskedVendor,
        unmaskedRenderer: profile.unmaskedRenderer,
      };
    };

    const cloneProfileWebGLValue = function (profileValue, nativeValue) {
      if (ArrayBuffer.isView(nativeValue) && Array.isArray(profileValue)) {
        try {
          return new nativeValue.constructor(profileValue);
        } catch (error) {
          return nativeValue;
        }
      }
      if (Array.isArray(nativeValue) && Array.isArray(profileValue)) {
        return profileValue.slice();
      }
      if (
        typeof nativeValue === "number" &&
        typeof profileValue === "number" &&
        Number.isFinite(profileValue)
      ) {
        return profileValue;
      }
      if (typeof nativeValue === typeof profileValue) return profileValue;
      return nativeValue;
    };

    const getProfileWebGLParameter = function (
      parameter,
      version,
      nativeValue,
    ) {
      if (!isWebGLStrict()) return undefined;
      const surface = getConfiguredWebGLSurfaceProfile(version);
      if (!surface || !surface.parameters) return undefined;
      const Constructor =
        version === 2
          ? typeof WebGL2RenderingContext !== "undefined"
            ? WebGL2RenderingContext
            : null
          : typeof WebGLRenderingContext !== "undefined"
            ? WebGLRenderingContext
            : null;
      const parameterName =
        Constructor
          ? Object.getOwnPropertyNames(Constructor).find(
              (name) =>
                Constructor[name] === parameter &&
                Object.prototype.hasOwnProperty.call(
                  surface.parameters,
                  name,
                ),
            )
          : undefined;
      if (!parameterName) return undefined;
      return cloneProfileWebGLValue(
        surface.parameters[parameterName],
        nativeValue,
      );
    };

    const getSpoofedParameter = function (parameter, version, nativeValue) {
      const profile = getWebGLProfile(version);
      const presetValues = {
        7936: profile.maskedVendor,
        37445: profile.unmaskedVendor,
        7937: profile.maskedRenderer,
        37446: profile.unmaskedRenderer,
      };
      if (Object.prototype.hasOwnProperty.call(presetValues, parameter)) {
        return presetValues[parameter];
      }
      if (parameter === 7938 || parameter === 35724) {
        const importedSurface = getConfiguredWebGLSurfaceProfile(version);
        const importedDebug = importedSurface && importedSurface.debug;
        const debugValue =
          importedDebug &&
          (parameter === 7938
            ? importedDebug.VERSION
            : importedDebug.SHADING_LANGUAGE_VERSION);
        if (typeof debugValue === "string" && debugValue) return debugValue;
      }
      return getProfileWebGLParameter(parameter, version, nativeValue);
    };

    const getProfileShaderPrecision = function (version, shader, precision) {
      if (!isWebGLStrict()) return null;
      const surface = getConfiguredWebGLSurfaceProfile(version);
      if (!surface) return null;
      const shaderName = shaderTypeNames[shader];
      const precisionName = shaderPrecisionNames[precision];
      if (!shaderName || !precisionName) return null;
      const key = `${shaderName}:${precisionName}`;
      const entry =
        (surface.shaderPrecision && surface.shaderPrecision[key]) ||
        (surface.parameters &&
          surface.parameters[`PRECISION_${shaderName}_${precisionName}`]);
      if (!entry || typeof entry !== "object") return null;
      const values = {
        rangeMin: Number(entry.rangeMin ?? entry.RANGE_MIN),
        rangeMax: Number(entry.rangeMax ?? entry.RANGE_MAX),
        precision: Number(entry.precision ?? entry.PRECISION),
      };
      return Object.values(values).every(Number.isFinite) ? values : null;
    };

    const protectWebGL = function (Constructor, version) {
      if (typeof Constructor === "undefined") return;
      const label = `WebGL${version === 2 ? "2" : ""}RenderingContext`;
      const nativeGetParameter = Constructor.prototype.getParameter;
      protectMethod(
        Constructor.prototype,
        "getParameter",
        (target, self, args) => {
          const nativeValue = Reflect.apply(target, self, args);
          const isDebugRendererParameter =
            (args[0] === 37445 || args[0] === 37446) &&
            debugRendererInfoContexts.has(self);
          if (
            !isFeatureActive("webgl") ||
            (args[0] >= 37445 && !isDebugRendererParameter)
          ) {
            return nativeValue;
          }
          const isProfileParameter =
            isWebGLStrict() &&
            getProfileWebGLParameter(args[0], version, nativeValue) !==
              undefined;
          const importedSurface = getConfiguredWebGLSurfaceProfile(version);
          const importedDebug = importedSurface && importedSurface.debug;
          const isProfileDebugParameter =
            isWebGLStrict() &&
            (args[0] === 7938 || args[0] === 35724) &&
            importedDebug &&
            typeof
              importedDebug[args[0] === 7938 ? "VERSION" : "SHADING_LANGUAGE_VERSION"] ===
              "string";
          if (
            !identityParameters.has(args[0]) &&
            !isProfileParameter &&
            !isProfileDebugParameter
          ) {
            return nativeValue;
          }
          notifyWebGLAccess();
          const spoofedValue = getSpoofedParameter(
            args[0],
            version,
            nativeValue,
          );
          return spoofedValue === undefined ? nativeValue : spoofedValue;
        },
        `${label}.getParameter`,
      );
      protectMethod(
        Constructor.prototype,
        "getShaderPrecisionFormat",
        (target, self, args) => {
          const format = Reflect.apply(target, self, args);
          const profilePrecision = getProfileShaderPrecision(
            version,
            args[0],
            args[1],
          );
          if (profilePrecision && format && isWebGLStrict()) {
            notifyWebGLAccess();
            return new Proxy(format, {
              get(targetFormat, property, receiver) {
                if (property in profilePrecision) {
                  return profilePrecision[property];
                }
                return Reflect.get(targetFormat, property, receiver);
              },
            });
          }
          if (isFeatureActive("webgl")) notifyWebGLAccess();
          return format;
        },
        `${label}.getShaderPrecisionFormat`,
      );
      protectMethod(
        Constructor.prototype,
        "getSupportedExtensions",
        (target, self, args) => {
          const extensions = Reflect.apply(target, self, args);
          if (isWebGLStrict() && Array.isArray(extensions)) {
            const importedSurface = getConfiguredWebGLSurfaceProfile(version);
            const importedExtensions =
              importedSurface && Array.isArray(importedSurface.extensions)
                ? importedSurface.extensions.filter((extension) =>
                    extensions.includes(extension),
                  )
                : [];
            const shuffled = (
              importedExtensions.length ? importedExtensions : extensions
            ).slice();
            let state = seedWebGLNoiseState(version, shuffled.length);
            for (let index = shuffled.length - 1; index > 0; index--) {
              state = advanceWebGLNoiseState(state ^ index);
              const swapIndex = state % (index + 1);
              [shuffled[index], shuffled[swapIndex]] = [
                shuffled[swapIndex],
                shuffled[index],
              ];
            }
            notifyWebGLAccess();
            return shuffled;
          }
          if (isFeatureActive("webgl")) notifyWebGLAccess();
          return extensions;
        },
        `${label}.getSupportedExtensions`,
      );
      protectMethod(
        Constructor.prototype,
        "getExtension",
        (target, self, args) => {
          const extension = Reflect.apply(target, self, args);
          if (
            typeof args[0] === "string" &&
            args[0].toLowerCase() === "webgl_debug_renderer_info" &&
            extension
          ) {
            debugRendererInfoContexts.add(self);
            if (isFeatureActive("webgl")) notifyWebGLAccess();
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
          if (isWebGLStrict()) {
            addSeededWebGLReadbackNoise(
              self, nativeGetParameter, args[6],
              args[2],
              args[3],
              args[4],
              args[5],
              Number.isInteger(args[7]) ? args[7] : 0,
            );
            notifyWebGLAccess();
          } else if (isFeatureActive("webgl")) {
            notifyWebGLAccess();
          }
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
    const pixelNoise = () => (Math.random() < 0.5 ? -1 : 1);
    let measurementNoise;

    const getMeasurementNoise = function () {
      if (measurementNoise === undefined) {
        measurementNoise =
          Math.floor(Math.random() * 10) === 6 ? pixelNoise() : 0;
      }
      return measurementNoise;
    };

    const normalizeFontFamily = function (value) {
      return String(value || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase();
    };

    const fontFamiliesByPlatform = {
      windows: new Set([
        "calibri",
        "cambria",
        "cambria math",
        "candara",
        "consolas",
        "constantia",
        "corbel",
        "ebrima",
        "gabriola",
        "leelawadee ui",
        "malgun gothic",
        "meiryo",
        "microsoft jhenghei",
        "microsoft sans serif",
        "microsoft yahei",
        "mingliu",
        "ms gothic",
        "ms pgothic",
        "ms reference sans serif",
        "ms serif",
        "ms ui gothic",
        "mv boli",
        "nirmala ui",
        "pmingliu",
        "segoe print",
        "segoe script",
        "segoe ui",
        "segoe ui symbol",
        "simsun",
        "tahoma",
        "wingdings",
        "wingdings 2",
        "wingdings 3",
      ]),
      macos: new Set([
        "american typewriter",
        "apple braille",
        "apple chancery",
        "apple sd gothic neo",
        "avenir",
        "avenir next",
        "baskerville",
        "copperplate",
        "didot",
        "futura",
        "gill sans",
        "helvetica neue",
        "menlo",
        "monaco",
        "optima",
        "san francisco",
      ]),
      linux: new Set(["dejavu sans", "freesans", "ubuntu"]),
      android: new Set(["android emoji", "droid sans", "droid serif", "roboto"]),
    };

    const getUserAgentPlatform = function () {
      if (!config.useragent || !config.useragent.enabled) return null;
      if (!isFeatureActive("useragent")) return null;
      switch (config.useragent.preset) {
        case "macos":
        case "macos_chrome":
          return "macos";
        case "windows":
          return "windows";
        case "iphone":
          return "macos";
        case "android":
          return "android";
        default:
          return null;
      }
    };

    const getMaskedFontFamily = function (element) {
      const inlineFamily =
        element && element.style && typeof element.style.fontFamily === "string"
          ? element.style.fontFamily
          : "";
      if (!inlineFamily) return null;

      const families = inlineFamily
        .split(",")
        .map(normalizeFontFamily)
        .filter(Boolean);
      const requestedFamily = families[0];
      const targetPlatform = getUserAgentPlatform();
      if (!requestedFamily || !targetPlatform) return null;

      const requestedPlatform = Object.keys(fontFamiliesByPlatform).find(
        (platform) => fontFamiliesByPlatform[platform].has(requestedFamily),
      );
      if (!requestedPlatform || requestedPlatform === targetPlatform) {
        return null;
      }

      return families.slice(1).join(", ") || "sans-serif";
    };

    const measureWithFontFallback = function (target, element, args, family) {
      if (!element || !element.style) {
        return Reflect.apply(target, element, args);
      }
      const originalFamily = element.style.fontFamily;
      const originalStyle =
        typeof element.getAttribute === "function"
          ? element.getAttribute("style")
          : null;
      try {
        element.style.fontFamily = family;
        return Reflect.apply(target, element, args);
      } finally {
        if (typeof element.setAttribute === "function") {
          if (originalStyle === null) {
            element.removeAttribute("style");
          } else {
            element.setAttribute("style", originalStyle);
          }
        } else {
          element.style.fontFamily = originalFamily;
        }
      }
    };

    for (const property of ["offsetWidth", "offsetHeight"]) {
      protectGetter(
        HTMLElement.prototype,
        property,
        (target, self, args) => {
          if (!isFeatureActive("font")) {
            return Reflect.apply(target, self, args);
          }
          const nativeValue = Reflect.apply(target, self, args);
          if (!nativeValue) {
            return nativeValue;
          }
          const maskedFamily = getMaskedFontFamily(self);
          const value = maskedFamily
            ? measureWithFontFallback(target, self, args, maskedFamily)
            : nativeValue;
          const noise = getMeasurementNoise();
          if (!maskedFamily && !noise) {
            return value;
          }
          notifyFontAccess();
          if (!noise) {
            return value;
          }
          return value + noise;
        },
        `HTMLElement.${property}`,
      );
    }

    protectMethod(
      CanvasRenderingContext2D.prototype,
      "measureText",
      (target, self, args) => {
        const metrics = Reflect.apply(target, self, args);
        if (!isFeatureActive("font")) {
          return metrics;
        }
        const noise = getMeasurementNoise();
        if (!noise) {
          return metrics;
        }
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
      getCurrentTimezoneName = function () {
        return getTimezoneOptions().name;
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
    const getProfiledLimit = function (property, nativeValue) {
      if (!isWebGPUProfileActive() || typeof nativeValue !== "number") {
        return undefined;
      }
      const profile = getConfiguredWebGPUProfile();
      const candidate = Number(profile && profile.limits[property]);
      if (!Number.isFinite(candidate) || candidate < 0) return undefined;
      if (String(property).startsWith("min")) {
        return Math.max(nativeValue, candidate);
      }
      return Math.min(nativeValue, candidate);
    };
    const createProfiledAdapterInfo = function (nativeInfo) {
      const profile = getConfiguredWebGPUProfile();
      const profileInfo = profile && profile.info;
      if (!profileInfo || !nativeInfo || typeof nativeInfo !== "object") {
        return nativeInfo;
      }
      return new Proxy(nativeInfo, {
        get(targetInfo, property, receiver) {
          if (
            ["vendor", "architecture", "device", "description"].includes(
              property,
            ) &&
            typeof profileInfo[property] === "string" &&
            profileInfo[property]
          ) {
            return profileInfo[property];
          }
          return Reflect.get(targetInfo, property, receiver);
        },
      });
    };

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
              const profiledValue = getProfiledLimit(property, value);
              if (profiledValue !== undefined) {
                notifyWebGpuAccess();
                return profiledValue;
              }
              if (
                protectedLimitNames.has(property) &&
                typeof value === "number"
              ) {
                notifyWebGpuAccess();
                return Math.max(1, value - (Math.random() < 0.5 ? 1 : 2));
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

    if (typeof GPUAdapter !== "undefined") {
      protectMethod(
        GPUAdapter.prototype,
        "requestAdapterInfo",
        (target, self, args) => {
          const result = Reflect.apply(target, self, args);
          if (!isWebGPUProfileActive()) return result;
          notifyWebGpuAccess();
          return Promise.resolve(result).then(createProfiledAdapterInfo);
        },
        "GPUAdapter.requestAdapterInfo",
      );
      protectGetter(
        GPUAdapter.prototype,
        "info",
        (target, self, args) => {
          const info = Reflect.apply(target, self, args);
          if (!isWebGPUProfileActive()) return info;
          notifyWebGpuAccess();
          return createProfiledAdapterInfo(info);
        },
        "GPUAdapter.info",
      );
      protectGetter(
        GPUAdapter.prototype,
        "isFallbackAdapter",
        (target, self, args) => {
          const value = Reflect.apply(target, self, args);
          const profile = getConfiguredWebGPUProfile();
          if (
            !isWebGPUProfileActive() ||
            !profile ||
            typeof profile.isFallbackAdapter !== "boolean"
          ) {
            return value;
          }
          notifyWebGpuAccess();
          return profile.isFallbackAdapter;
        },
        "GPUAdapter.isFallbackAdapter",
      );
    }

    const gpuConstructor =
      typeof GPU !== "undefined"
        ? GPU
        : typeof navigator !== "undefined" && navigator.gpu
          ? navigator.gpu.constructor
          : undefined;
    if (gpuConstructor) {
      protectMethod(
        gpuConstructor.prototype,
        "getPreferredCanvasFormat",
        (target, self, args) => {
          const format = Reflect.apply(target, self, args);
          const profile = getConfiguredWebGPUProfile();
          const preferred = profile && profile.preferredCanvasFormat;
          if (
            !isWebGPUProfileActive() ||
            !["bgra8unorm", "rgba8unorm"].includes(preferred)
          ) {
            return format;
          }
          notifyWebGpuAccess();
          return preferred;
        },
        "GPU.getPreferredCanvasFormat",
      );
    }

    // Keep command descriptors and upload buffers native. These methods are
    // part of the rendering path, so changing their values changes application
    // output or can make an otherwise valid WebGPU resource invalid. Adapter
    // identity and limits above are passive fingerprint surfaces; render
    // commands are not.
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
      getCurrentLanguageIdentity = getLanguageIdentity;

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
    let cachedProfileKey = null;
    let cachedProfile = null;
    const getUserAgentProfile = function () {
      const configuredProfile =
        config.useragent.profile &&
        typeof config.useragent.profile === "object"
          ? config.useragent.profile
          : null;
      if (!configuredProfile) return null;
      const profileKey = `${configuredProfile.target || ""}:${configuredProfile.version || ""}:${configuredProfile.updatedAt || ""}`;
      if (cachedProfileKey === profileKey) return cachedProfile;
      const userAgent = configuredProfile.userAgent;
      const metadata = configuredProfile.navigator || {};
      const clientHints = configuredProfile.clientHints || null;
      const slash = userAgent.indexOf("/");
      const versionPattern =
        clientHints && clientHints.brand === "Microsoft Edge"
          ? /Edg\/([\d.]+)/
          : /Chrome\/([\d.]+)/;
      const versionMatch = userAgent.match(versionPattern);
      const fullVersion = versionMatch ? versionMatch[1] : "0.0.0.0";
      cachedProfileKey = profileKey;
      cachedProfile = {
        ...metadata,
        clientHints,
        userAgent,
        appVersion: slash === -1 ? "5.0" : userAgent.slice(slash + 1),
        fullVersion,
        majorVersion: fullVersion.split(".")[0],
      };
      return cachedProfile;
    };
    getCurrentUserAgentProfile = getUserAgentProfile;

    const notifyUserAgentAccess = createOneTimeAlert("user-agent");
    const protectNavigatorValue = function (property, getSpoofedValue) {
      protectGetter(
        Navigator.prototype,
        property,
        (target, self, args) => {
          const profile = getUserAgentProfile();
          if (!isFeatureActive("useragent") || !profile) {
            return Reflect.apply(target, self, args);
          }
          notifyUserAgentAccess();
          return getSpoofedValue(profile, target, self, args);
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
        brands: freezeBrands(
          hints.brands || [
            { brand: "Not_A Brand", version: "99" },
            { brand: "Chromium", version: profile.majorVersion },
            { brand: hints.brand, version: profile.majorVersion },
          ],
        ),
        mobile: hints.mobile,
        platform: hints.platform,
        architecture: hints.architecture,
        bitness: hints.bitness,
        formFactors: Array.isArray(hints.formFactors)
          ? hints.formFactors.slice()
          : [],
        fullVersionList: freezeBrands(
          hints.fullVersionList || [
            { brand: "Not_A Brand", version: "99.0.0.0" },
            { brand: "Chromium", version: profile.fullVersion },
            { brand: hints.brand, version: profile.fullVersion },
          ],
        ),
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

  // This factory is serialized with the installer for nested Workers.
  function createWorkerBootstrapTools(installWorkerWorldProtections, createWebGLNoiseTools) {
    const getWorkerType = function (args) {
      const options = args && args[1];
      return options && typeof options === "object" && options.type === "module"
        ? "module"
        : "classic";
    };

    const wrappedWorkerUrls = new Map();
    const isInlineWorkerUrl = function (scriptUrl) {
      try {
        const protocol = new URL(scriptUrl).protocol;
        return protocol === "blob:" || protocol === "data:";
      } catch (error) {
        return false;
      }
    };
    const createWrappedWorkerUrl = function (scriptUrl, type, payload) {
      const serializedPayload = JSON.stringify({ ...payload, baseUrl: scriptUrl });
      const cacheKey = `${type}\n${scriptUrl}\n${serializedPayload}`;
      const cachedUrl = wrappedWorkerUrls.get(cacheKey);
      if (cachedUrl) return cachedUrl;
      const bootstrap = `(${installWorkerWorldProtections.toString()})(${serializedPayload}, ${createWorkerBootstrapTools.toString()}, ${createWebGLNoiseTools.toString()});`;
      const originalUrl = JSON.stringify(scriptUrl);
      const source =
        type === "module"
          ? `${bootstrap}\nimport(${originalUrl});`
          : `${bootstrap}
  const __sgOriginalWorkerUrl = ${originalUrl};
  const __sgNativeImportScripts = self.importScripts.bind(self);
  let __sgImportBase = __sgOriginalWorkerUrl;
  self.importScripts = function (...urls) {
    const previousBase = __sgImportBase;
    try {
      for (const url of urls) {
        const resolvedUrl = new URL(String(url), __sgImportBase).href;
        __sgImportBase = resolvedUrl;
        __sgNativeImportScripts(resolvedUrl);
      }
    } finally {
      __sgImportBase = previousBase;
    }
  };
  self.importScripts(__sgOriginalWorkerUrl);`;
      const wrappedUrl = URL.createObjectURL(
        new Blob([source], { type: "application/javascript" }),
      );
      wrappedWorkerUrls.set(cacheKey, wrappedUrl);
      return wrappedUrl;
    };
    return {
      getWorkerType,
      isInlineWorkerUrl,
      createWrappedWorkerUrl,
      dispose() {
        for (const url of wrappedWorkerUrls.values()) URL.revokeObjectURL(url);
        wrappedWorkerUrls.clear();
      },
    };
  }

  const installWorkerWorldProtections = function installWorkerWorldProtections(
    payload,
    createWorkerBootstrapTools,
    createWebGLNoiseTools,
  ) {
    "use strict";

    const scope = self;
    const features = payload && payload.features ? payload.features : {};
    const identity = payload && payload.identity ? payload.identity : {};
    const language = payload && payload.language ? payload.language : null;
    const timezone = payload && payload.timezone ? payload.timezone : null;
    const webgl = payload && payload.webgl ? payload.webgl : null;
    const webglSeed = Number(payload && payload.webglSeed) >>> 0 || 1;

    const isActive = function (feature) {
      return Boolean(features[feature]);
    };

    const defineNavigatorValue = function (property, value) {
      if (!scope.navigator) return;
      const prototype = Object.getPrototypeOf(scope.navigator);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor || typeof descriptor.get !== "function") return;
      try {
        Object.defineProperty(prototype, property, {
          ...descriptor,
          get() {
            return value;
          },
        });
      } catch (error) {}
    };

    if (isActive("useragent")) {
      for (const property of [
        "userAgent",
        "platform",
        "appVersion",
        "vendor",
        "hardwareConcurrency",
        "deviceMemory",
        "maxTouchPoints",
        "oscpu",
      ]) {
        if (Object.prototype.hasOwnProperty.call(identity, property)) {
          defineNavigatorValue(property, identity[property]);
        }
      }

      const clientHints = identity.clientHints;
      if (
        clientHints &&
        scope.navigator &&
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(scope.navigator),
          "userAgentData",
        )
      ) {
        const nativeUserAgentData = scope.navigator.userAgentData;
        const majorVersion = String(identity.majorVersion || "0");
        const fullVersion = String(identity.fullVersion || "0.0.0.0");
        const brands = Object.freeze(
          (
            clientHints.brands || [
              { brand: "Not_A Brand", version: "99" },
              { brand: "Chromium", version: majorVersion },
              { brand: clientHints.brand, version: majorVersion },
            ]
          ).map((entry) => Object.freeze({ ...entry })),
        );
        const fullVersionList = Object.freeze(
          (
            clientHints.fullVersionList || [
              { brand: "Not_A Brand", version: "99.0.0.0" },
              { brand: "Chromium", version: fullVersion },
              { brand: clientHints.brand, version: fullVersion },
            ]
          ).map((entry) => Object.freeze({ ...entry })),
        );
        const values = {
          brands,
          mobile: Boolean(clientHints.mobile),
          platform: clientHints.platform,
          architecture: clientHints.architecture,
          bitness: clientHints.bitness,
          formFactors: Object.freeze(
            Array.isArray(clientHints.formFactors)
              ? clientHints.formFactors.slice()
              : [],
          ),
          fullVersionList,
          model: clientHints.model,
          platformVersion: clientHints.platformVersion,
          uaFullVersion: fullVersion,
          wow64: Boolean(clientHints.wow64),
        };
        const source =
          nativeUserAgentData && typeof nativeUserAgentData === "object"
            ? nativeUserAgentData
            : {};
        const facade = new Proxy(source, {
          get(target, property, receiver) {
            if (property === "brands") return values.brands;
            if (property === "mobile") return values.mobile;
            if (property === "platform") return values.platform;
            if (property === "getHighEntropyValues") {
              return function () {
                return Promise.resolve({ ...values });
              };
            }
            if (property === "toJSON") {
              return function () {
                return {
                  brands: values.brands.map((entry) => ({ ...entry })),
                  mobile: values.mobile,
                  platform: values.platform,
                };
              };
            }
            return Reflect.get(target, property, receiver);
          },
        });
        defineNavigatorValue("userAgentData", facade);
      }
    }

    if (isActive("language") && language) {
      defineNavigatorValue("language", language.locale);
      defineNavigatorValue(
        "languages",
        Object.freeze(
          Array.isArray(language.languages)
            ? language.languages.slice()
            : [language.locale],
        ),
      );
    }

    const nativeIntlDateTimeFormat =
      typeof Intl !== "undefined" ? Intl.DateTimeFormat : null;

    if (isActive("language") || isActive("timezone")) {
      const locale = language && language.locale ? language.locale : null;
      const nativeConstructors = {
        Collator: Intl.Collator,
        DateTimeFormat: Intl.DateTimeFormat,
        DisplayNames: Intl.DisplayNames,
        ListFormat: Intl.ListFormat,
        NumberFormat: Intl.NumberFormat,
        PluralRules: Intl.PluralRules,
        RelativeTimeFormat: Intl.RelativeTimeFormat,
        Segmenter: Intl.Segmenter,
      };
      const prepareIntlArguments = function (name, args) {
        const nextArgs = Array.from(args || []);
        if (
          isActive("language") &&
          locale &&
          (nextArgs.length === 0 || nextArgs[0] === undefined)
        ) {
          nextArgs[0] = locale;
        }
        if (name === "DateTimeFormat" && isActive("timezone")) {
          nextArgs[1] = {
            ...(nextArgs[1] && typeof nextArgs[1] === "object"
              ? nextArgs[1]
              : {}),
            timeZone: timezone,
          };
        }
        return nextArgs;
      };
      for (const [name, nativeConstructor] of Object.entries(
        nativeConstructors,
      )) {
        if (typeof nativeConstructor !== "function") continue;
        const descriptor = Object.getOwnPropertyDescriptor(Intl, name);
        if (!descriptor) continue;
        const proxy = new Proxy(nativeConstructor, {
          apply(target, thisArg, args) {
            return Reflect.apply(
              target,
              thisArg,
              prepareIntlArguments(name, args),
            );
          },
          construct(target, args, newTarget) {
            return Reflect.construct(
              target,
              prepareIntlArguments(name, args),
              newTarget,
            );
          },
        });
        try {
          Object.defineProperty(Intl, name, { ...descriptor, value: proxy });
        } catch (error) {}
      }
    }

    if (isActive("timezone") && timezone && nativeIntlDateTimeFormat) {
      const nativeGetTimezoneOffset = Date.prototype.getTimezoneOffset;
      const parseOffset = function (value) {
        if (!value) return null;
        const normalized = String(value)
          .replace(/−/g, "-")
          .replace(/^UTC/, "GMT");
        if (normalized === "GMT") return 0;
        const match = normalized.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
        if (!match) return null;
        const sign = match[1] === "+" ? -1 : 1;
        return (
          sign *
          (parseInt(match[2], 10) * 60 + parseInt(match[3] || "0", 10))
        );
      };
      const getSpoofedOffset = function (date) {
        try {
          const parts = new nativeIntlDateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "longOffset",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).formatToParts(date);
          const zonePart = parts.find((part) => part.type === "timeZoneName");
          const offset = parseOffset(zonePart && zonePart.value);
          if (offset !== null) return offset;
        } catch (error) {}
        return Reflect.apply(nativeGetTimezoneOffset, date, []);
      };
      const offsetDescriptor = Object.getOwnPropertyDescriptor(
        Date.prototype,
        "getTimezoneOffset",
      );
      if (offsetDescriptor && typeof offsetDescriptor.value === "function") {
        try {
          Object.defineProperty(Date.prototype, "getTimezoneOffset", {
            ...offsetDescriptor,
            value: function () {
              return Number.isNaN(this.getTime())
                ? Reflect.apply(nativeGetTimezoneOffset, this, [])
                : getSpoofedOffset(this);
            },
          });
        } catch (error) {}
      }
    }

    const patchedWebGLPrototypes = new WeakSet();
    const debugRendererInfoContexts = new WeakSet();
    const { advanceWebGLNoiseState, seedWebGLNoiseState,
      addSeededWebGLNoise: addSeededWebGLCanvasNoise, addSeededWebGLReadbackNoise } =
      createWebGLNoiseTools(() => webglSeed, () => isActive("webglStrict"));
    const webglCanvases = new WeakSet();
    const patchWebGLContext = function (context) {
      if (!context || !webgl) return;
      const prototype = Object.getPrototypeOf(context);
      if (!prototype || patchedWebGLPrototypes.has(prototype)) return;
      const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "getParameter",
      );
      if (!descriptor || typeof descriptor.value !== "function") return;
      const nativeGetParameter = descriptor.value;
      try {
        Object.defineProperty(prototype, "getParameter", {
          ...descriptor,
          value: function (parameter) {
            const values = {
              7936: webgl.maskedVendor,
              7937: webgl.maskedRenderer,
              37445: webgl.unmaskedVendor,
              37446: webgl.unmaskedRenderer,
            };
            const debugParameter = parameter === 37445 || parameter === 37446;
            if (
              isActive("webgl") &&
              Object.prototype.hasOwnProperty.call(values, parameter) &&
              (!debugParameter || debugRendererInfoContexts.has(this))
            ) {
              return values[parameter];
            }
            return Reflect.apply(nativeGetParameter, this, [parameter]);
          },
        });

        const extensionDescriptor = Object.getOwnPropertyDescriptor(
          prototype,
          "getExtension",
        );
        if (
          extensionDescriptor &&
          typeof extensionDescriptor.value === "function"
        ) {
          const nativeGetExtension = extensionDescriptor.value;
          Object.defineProperty(prototype, "getExtension", {
            ...extensionDescriptor,
            value: function (name) {
              const extension = Reflect.apply(nativeGetExtension, this, [name]);
              if (
                typeof name === "string" &&
                name.toLowerCase() === "webgl_debug_renderer_info" &&
                extension
              ) {
                debugRendererInfoContexts.add(this);
              }
              return extension;
            },
          });
        }
        const extensionsDescriptor = Object.getOwnPropertyDescriptor(
          prototype,
          "getSupportedExtensions",
        );
        if (
          extensionsDescriptor &&
          typeof extensionsDescriptor.value === "function"
        ) {
          const nativeGetSupportedExtensions = extensionsDescriptor.value;
          Object.defineProperty(prototype, "getSupportedExtensions", {
            ...extensionsDescriptor,
            value: function (...args) {
              const extensions = Reflect.apply(
                nativeGetSupportedExtensions,
                this,
                args,
              );
              if (!isActive("webglStrict") || !Array.isArray(extensions)) {
                return extensions;
              }
              const shuffled = extensions.slice();
              let state = seedWebGLNoiseState(shuffled.length);
              for (let index = shuffled.length - 1; index > 0; index--) {
                state = advanceWebGLNoiseState(state ^ index);
                const swapIndex = state % (index + 1);
                [shuffled[index], shuffled[swapIndex]] = [
                  shuffled[swapIndex],
                  shuffled[index],
                ];
              }
              return shuffled;
            },
          });
        }
        const readPixelsDescriptor = Object.getOwnPropertyDescriptor(
          prototype,
          "readPixels",
        );
        if (
          readPixelsDescriptor &&
          typeof readPixelsDescriptor.value === "function"
        ) {
          const nativeReadPixels = readPixelsDescriptor.value;
          Object.defineProperty(prototype, "readPixels", {
            ...readPixelsDescriptor,
            value: function (...args) {
              const result = Reflect.apply(nativeReadPixels, this, args);
              addSeededWebGLReadbackNoise(
                this, nativeGetParameter, args[6],
                args[2],
                args[3],
                args[4],
                args[5],
                Number.isInteger(args[7]) ? args[7] : 0,
              );
              return result;
            },
          });
        }
        patchedWebGLPrototypes.add(prototype);
      } catch (error) {}
    };

    if (isActive("webgl") && typeof OffscreenCanvas !== "undefined") {
      const descriptor = Object.getOwnPropertyDescriptor(
        OffscreenCanvas.prototype,
        "getContext",
      );
      if (descriptor && typeof descriptor.value === "function") {
        const nativeGetContext = descriptor.value;
        try {
          Object.defineProperty(OffscreenCanvas.prototype, "getContext", {
            ...descriptor,
            value: function (type, ...args) {
              const context = Reflect.apply(nativeGetContext, this, [
                type,
                ...args,
              ]);
              const normalizedType =
                typeof type === "string" ? type.toLowerCase() : "";
              if (
                normalizedType === "webgl" ||
                normalizedType === "experimental-webgl"
              ) {
                if (context) webglCanvases.add(this);
                patchWebGLContext(context);
              } else if (normalizedType === "webgl2") {
                if (context) webglCanvases.add(this);
                patchWebGLContext(context);
              }
              return context;
            },
          });
        } catch (error) {}
      }

      const convertDescriptor = Object.getOwnPropertyDescriptor(
        OffscreenCanvas.prototype,
        "convertToBlob",
      );
      if (convertDescriptor && typeof convertDescriptor.value === "function") {
        const nativeConvertToBlob = convertDescriptor.value;
        try {
          Object.defineProperty(OffscreenCanvas.prototype, "convertToBlob", {
            ...convertDescriptor,
            value: function (...args) {
              if (
                !isActive("webglStrict") ||
                !webglCanvases.has(this) ||
                !this.width ||
                !this.height
              ) {
                return Reflect.apply(nativeConvertToBlob, this, args);
              }
              const snapshot = new OffscreenCanvas(this.width, this.height);
              const snapshotContext = snapshot.getContext("2d");
              if (!snapshotContext) {
                return Reflect.apply(nativeConvertToBlob, this, args);
              }
              snapshotContext.drawImage(this, 0, 0);
              const imageData = snapshotContext.getImageData(
                0,
                0,
                this.width,
                this.height,
              );
              addSeededWebGLCanvasNoise(imageData);
              const temp = new OffscreenCanvas(this.width, this.height);
              const tempContext = temp.getContext("2d");
              if (!tempContext) {
                return Reflect.apply(nativeConvertToBlob, this, args);
              }
              tempContext.putImageData(imageData, 0, 0);
              return Reflect.apply(nativeConvertToBlob, temp, args);
            },
          });
        } catch (error) {}
      }
    }

    if (!(
      isActive("useragent") ||
      isActive("language") ||
      isActive("timezone") ||
      isActive("webgl")
    )) {
      return;
    }

    const { getWorkerType, isInlineWorkerUrl, createWrappedWorkerUrl } =
      createWorkerBootstrapTools(installWorkerWorldProtections, createWebGLNoiseTools);

    const wrapWorkerConstructor = function (name) {
      const nativeConstructor = scope[name];
      if (typeof nativeConstructor !== "function") return;
      if (nativeConstructor.__stealthGuardWorkerWrapper) return;
      const wrapped = new Proxy(nativeConstructor, {
        construct(target, args, newTarget) {
          const originalArgs = Array.from(args || []);
          if (!originalArgs.length) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          let originalUrl;
          try {
            originalUrl = new URL(
              String(originalArgs[0]),
              payload.baseUrl || (scope.location && scope.location.href),
            ).href;
          } catch (error) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          if (!isInlineWorkerUrl(originalUrl)) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          const nextPayload = {
            ...payload,
            baseUrl: originalUrl,
          };
          try {
            const wrappedUrl = createWrappedWorkerUrl(
              originalUrl,
              getWorkerType(originalArgs),
              nextPayload,
            );
            originalArgs[0] = wrappedUrl;
            return Reflect.construct(target, originalArgs, newTarget);
          } catch (error) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
        },
      });
      try {
        Object.defineProperty(wrapped, "__stealthGuardWorkerWrapper", {
          value: true,
        });
        scope[name] = wrapped;
      } catch (error) {}
    };

    wrapWorkerConstructor("Worker");
    wrapWorkerConstructor("SharedWorker");
  };

  const createWorkerProtectionPayload = function () {
    const profile = getCurrentUserAgentProfile();
    const language = getCurrentLanguageIdentity();
    const timezone = getCurrentTimezoneName();
    const webgl = getCurrentWebGLIdentity();
    return {
      features: {
        useragent: isFeatureActive("useragent") && Boolean(profile),
        language: isFeatureActive("language") && Boolean(language),
        timezone: isFeatureActive("timezone") && Boolean(timezone),
        webgl: isFeatureActive("webgl") && Boolean(webgl),
        webglStrict: isWebGLStrict(),
      },
      identity: profile
        ? {
            userAgent: profile.userAgent,
            platform: profile.platform,
            appVersion: profile.appVersion,
            vendor: profile.vendor,
            oscpu: profile.oscpu,
            hardwareConcurrency: profile.hardwareConcurrency,
            deviceMemory: profile.deviceMemory,
            maxTouchPoints: profile.maxTouchPoints,
            majorVersion: profile.majorVersion,
            fullVersion: profile.fullVersion,
            clientHints: profile.clientHints,
          }
        : null,
      language: language
        ? { locale: language.locale, languages: language.languages }
        : null,
      timezone,
      webgl,
      webglSeed: webglNoiseSeed,
    };
  };

  const { getWorkerType, isInlineWorkerUrl, createWrappedWorkerUrl, dispose } =
    createWorkerBootstrapTools(installWorkerWorldProtections, createWebGLNoiseTools);
  window.addEventListener("pagehide", dispose, { once: true });

  const installWorkerConstructors = function () {
    if (typeof Worker === "undefined" && typeof SharedWorker === "undefined") {
      return;
    }
    const nativeWorker =
      typeof Worker === "undefined" ? null : Worker;
    const nativeSharedWorker =
      typeof SharedWorker === "undefined" ? null : SharedWorker;
    const wrapConstructor = function (name, nativeConstructor) {
      if (!nativeConstructor || nativeConstructor.__stealthGuardWorkerWrapper) {
        return;
      }
      const wrapped = new Proxy(nativeConstructor, {
        construct(target, args, newTarget) {
          const originalArgs = Array.from(args || []);
          if (!isFeatureActive("worker") || !originalArgs.length) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          const payload = createWorkerProtectionPayload();
          if (!Object.values(payload.features).some(Boolean)) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          let originalUrl;
          try {
            originalUrl = new URL(
              String(originalArgs[0]),
              document.baseURI,
            ).href;
          } catch (error) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          if (!isInlineWorkerUrl(originalUrl)) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
          try {
            const wrappedUrl = createWrappedWorkerUrl(
              originalUrl,
              getWorkerType(originalArgs),
              payload,
            );
            originalArgs[0] = wrappedUrl;
            return Reflect.construct(target, originalArgs, newTarget);
          } catch (error) {
            return Reflect.construct(target, originalArgs, newTarget);
          }
        },
      });
      try {
        Object.defineProperty(wrapped, "__stealthGuardWorkerWrapper", {
          value: true,
        });
        window[name] = wrapped;
      } catch (error) {}
    };
    wrapConstructor("Worker", nativeWorker);
    wrapConstructor("SharedWorker", nativeSharedWorker);
  };

  installWorkerConstructors();

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
