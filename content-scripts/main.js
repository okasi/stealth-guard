function installMainWorldProtections(
  initialConfig,
  bridge,
  createPatternTools,
  userAgentStrings,
) {
  "use strict";

  const config = initialConfig;
  const configUpdateEvent = bridge.configEvent;
  const configUpdateToken = bridge.configToken;
  const domainPatterns = createPatternTools();

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
      if (!prototype || typeof prototype[method] !== "function") {
        return false;
      }
      prototype[method] = new Proxy(prototype[method], { apply });
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
  const webglCanvases = new WeakSet();
  let webglNoiseSeed = 0;

  if (config.canvas) {
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;

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
        const snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const snapshotContext = snapshot.getContext("2d");
        snapshotContext.drawImage(canvas, 0, 0);
        imageData = getImageData.call(
          snapshotContext,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        addSeededWebGLNoise(imageData);
      } else {
        const context = canvas.getContext("2d");
        if (!context) return originalMethod.apply(canvas, args);
        imageData = getImageData.call(
          context,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        addCanvasNoise(imageData);
      }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
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
    protectMethod(
      CanvasRenderingContext2D.prototype,
      "getImageData",
      (target, self, args) => {
        const imageData = Reflect.apply(target, self, args);
        if (isFeatureActive("canvas")) {
          addCanvasNoise(imageData);
          sendFingerprintAlert("canvas");
        }
        return imageData;
      },
      "CanvasRenderingContext2D.getImageData",
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

    protectMethod(
      HTMLCanvasElement.prototype,
      "getContext",
      (target, self, args) => {
        const context = Reflect.apply(target, self, args);
        const type = typeof args[0] === "string" ? args[0].toLowerCase() : "";
        if (
          context &&
          (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
        ) {
          webglCanvases.add(self);
        }
        return context;
      },
      "HTMLCanvasElement.getContext",
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
        const parsedConfiguredOffset = Number(timezoneConfig.offset);
        return {
          fallbackOffset: Number.isFinite(parsedConfiguredOffset)
            ? -parsedConfiguredOffset
            : 300,
          name:
            synchronizedTimezone ||
            timezoneConfig.name ||
            "America/New_York",
        };
      };

      const getSpoofedTimezoneOffset = function (dateObj) {
        const options = getTimezoneOptions();
        if (!options.name) return options.fallbackOffset;
        const timeValue =
          dateObj && typeof dateObj.getTime === "function"
            ? dateObj.getTime()
            : Date.now();
        if (!Number.isFinite(timeValue)) return options.fallbackOffset;

        const cacheKey = `${options.name}:${Math.floor(timeValue / 3600000)}`;
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
            for (let index = 0; index < data.length; index += 100) {
              data[index] += Math.random() * 0.0000001;
            }
            notifyAudioAccess();
          }
          return data;
        },
        "AudioBuffer.getChannelData",
      );
    }

    if (typeof AnalyserNode !== "undefined") {
      protectMethod(
        AnalyserNode.prototype,
        "getFloatFrequencyData",
        (target, self, args) => {
          const result = Reflect.apply(target, self, args);
          if (isFeatureActive("audiocontext") && args[0]) {
            for (let index = 0; index < args[0].length; index += 100) {
              args[0][index] += Math.random() * 0.1;
            }
            notifyAudioAccess();
          }
          return result;
        },
        "AnalyserNode.getFloatFrequencyData",
      );
    }
  }

  const currentHostname = window.location.hostname;
  const isEmptyHostnameFrame = !currentHostname;

  if (config.useragent && !isEmptyHostnameFrame) {
    const metadataByPreset = {
      macos: {
        platform: "MacIntel",
        oscpu: "Intel Mac OS X 10.15.7",
        vendor: "Apple Computer, Inc.",
      },
      macos_chrome: {
        platform: "MacIntel",
        oscpu: "Intel Mac OS X 10.15.7",
        vendor: "Google Inc.",
      },
      windows: {
        platform: "Win32",
        oscpu: "Windows NT 10.0; Win64; x64",
        vendor: "Google Inc.",
      },
      iphone: {
        platform: "iPhone",
        oscpu: "iPhone OS 17.4.1",
        vendor: "Apple Computer, Inc.",
      },
      android: {
        platform: "Linux armv8l",
        oscpu: "Linux; Android 14",
        vendor: "Google Inc.",
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
      cachedPreset = preset;
      cachedProfile = {
        ...metadata,
        userAgent,
        appVersion: slash === -1 ? "5.0" : userAgent.slice(slash + 1),
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
          if (property === "userAgent") notifyUserAgentAccess();
          return getSpoofedValue(getUserAgentProfile());
        },
        `Navigator.${property}`,
      );
    };

    protectNavigatorValue("userAgent", (profile) => profile.userAgent);
    protectNavigatorValue("platform", (profile) => profile.platform);
    protectNavigatorValue("appVersion", (profile) => profile.appVersion);
    protectNavigatorValue("vendor", (profile) => profile.vendor);
    if (Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgentData")) {
      protectNavigatorValue("userAgentData", () => undefined);
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
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { installMainWorldProtections };
}
