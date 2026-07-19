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

  const debugLog = function (...args) {
    if (config.notifications && config.notifications.enabled) {
      console.log(...args);
    }
  };

  const debugWarn = function (...args) {
    if (config.notifications && config.notifications.enabled) {
      console.warn(...args);
    }
  };

  const debugError = function (...args) {
    console.error(...args);
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

  // ========== CANVAS PROTECTION ==========
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

    const exportNoisedCanvas = function (canvas, originalMethod, args) {
      if (!isFeatureActive("canvas")) {
        return originalMethod.apply(canvas, args);
      }

      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) {
        return originalMethod.apply(canvas, args);
      }

      const imageData = getImageData.apply(context, [
        0,
        0,
        canvas.width,
        canvas.height,
      ]);
      addCanvasNoise(imageData);

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      tempCanvas.getContext("2d").putImageData(imageData, 0, 0);
      sendFingerprintAlert("canvas");
      return originalMethod.apply(tempCanvas, args);
    };

    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function () {
      return exportNoisedCanvas(this, originalToBlob, arguments);
    };

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      return exportNoisedCanvas(this, originalToDataURL, arguments);
    };

    CanvasRenderingContext2D.prototype.getImageData = function () {
      const imageData = getImageData.apply(this, arguments);
      if (!isFeatureActive("canvas")) {
        return imageData;
      }
      addCanvasNoise(imageData);
      sendFingerprintAlert("canvas");
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
        value: function () {
          return Math.random();
        },
        item: function (e) {
          let rand = e.length * randomConfig.random.value();
          return e[Math.floor(rand)];
        },
        number: function (power) {
          let tmp = [];
          for (let i = 0; i < power.length; i++) {
            tmp.push(Math.pow(2, power[i]));
          }
          return randomConfig.random.item(tmp);
        },
        int: function (power) {
          let tmp = [];
          for (let i = 0; i < power.length; i++) {
            let n = Math.pow(2, power[i]);
            tmp.push(new Int32Array([n, n]));
          }
          return randomConfig.random.item(tmp);
        },
        float: function (power) {
          let tmp = [];
          for (let i = 0; i < power.length; i++) {
            let n = Math.pow(2, power[i]);
            tmp.push(new Float32Array([1, n]));
          }
          return randomConfig.random.item(tmp);
        },
      },
    };

    // Define WebGL device presets with consistent device-specific info
    const WEBGL_PRESETS = {
      apple: {
        vendor: "Apple Inc.",
        unmaskedVendor: "Apple Inc.",
        renderer: ["Apple GPU", "Apple M1", "Apple M2"],
        contextName: "WebKit",
        version: "WebGL 1.0 (OpenGL ES 2.0 Metal)",
        shadingLanguageVersion:
          "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Metal)",
        description: "Apple",
      },
      pixel_4: {
        vendor: "Google Inc. (Qualcomm)",
        unmaskedVendor: "Qualcomm",
        renderer: ["Adreno (TM) 640", "Adreno (TM) 640"],
        contextName: "WebKit WebGL",
        version: "WebGL 1.0 (OpenGL ES 3.0 Chromium)",
        shadingLanguageVersion: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 3.00)",
        description: "Pixel 4",
      },
      surface_pro_7: {
        vendor: "Google Inc. (Intel)",
        unmaskedVendor: "Intel Inc.",
        renderer: [
          "Intel(R) Iris(R) Plus Graphics",
          "Intel(R) Iris(R) Plus Graphics 640",
        ],
        contextName: "WebKit WebGL",
        version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
        shadingLanguageVersion:
          "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.00 Chromium)",
        description: "Surface Pro 7",
      },
    };

    const getWebGLDeviceInfo = function () {
      let preset =
        config.webgl && config.webgl.preset ? config.webgl.preset : "auto";
      if (preset === "auto") {
        const uaPreset =
          config.useragent && config.useragent.preset
            ? config.useragent.preset
            : "macos";
        const presetMap = {
          macos: "apple",
          macos_chrome: "apple",
          windows: "surface_pro_7",
          iphone: "apple",
          android: "pixel_4",
        };
        preset = presetMap[uaPreset] || "apple";
      }
      return WEBGL_PRESETS[preset] || WEBGL_PRESETS.apple;
    };

    // Helper function to spoof WebGL parameters
    const spoofParameter = function (target) {
      let proto = target.prototype ? target.prototype : target.__proto__;

      proto.getParameter = new Proxy(proto.getParameter, {
        apply(target, self, args) {
          if (!isFeatureActive("webgl")) {
            return Reflect.apply(target, self, args);
          }
          sendFingerprintAlert("webgl");
          const deviceInfo = getWebGLDeviceInfo();

          // Comprehensive parameter spoofing with consistent device-specific values
          if (args[0] === 3415)
            return 0; // GL_ALPHA_BITS
          else if (args[0] === 3414)
            return 24; // GL_DEPTH_BITS
          else if (args[0] === 36348)
            return 30; // GL_MAX_VERTEX_UNIFORM_COMPONENTS
          else if (args[0] === 7936)
            return deviceInfo.vendor; // GL_VENDOR
          else if (args[0] === 37445)
            return deviceInfo.unmaskedVendor; // GL_UNMASKED_VENDOR_WEBGL
          else if (args[0] === 7937)
            return deviceInfo.contextName; // GL_RENDERER
          else if (args[0] === 3379)
            return randomConfig.random.number([14, 15]); // GL_MAX_TEXTURE_SIZE
          else if (args[0] === 36347)
            return randomConfig.random.number([12, 13]); // GL_MAX_TEXTURE_IMAGE_UNITS
          else if (args[0] === 34076)
            return randomConfig.random.number([14, 15]); // GL_MAX_RENDERBUFFER_SIZE
          else if (args[0] === 34024)
            return randomConfig.random.number([14, 15]); // GL_MAX_CUBE_MAP_TEXTURE_SIZE
          else if (args[0] === 3386)
            return randomConfig.random.int([13, 14, 15]); // GL_VIEWPORT_BITS
          else if (args[0] === 3413)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_RED_BITS
          else if (args[0] === 3412)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_BLUE_BITS
          else if (args[0] === 3411)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_GREEN_BITS
          else if (args[0] === 3410)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_ALPHA_BITS (again)
          else if (args[0] === 34047)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_STENCIL_BITS
          else if (args[0] === 34930)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_MAX_VARYING_VECTORS
          else if (args[0] === 34921)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_MAX_VERTEX_ATTRIBS
          else if (args[0] === 35660)
            return randomConfig.random.number([1, 2, 3, 4]); // GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS
          else if (args[0] === 35661)
            return randomConfig.random.number([4, 5, 6, 7, 8]); // GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT
          else if (args[0] === 36349)
            return randomConfig.random.number([10, 11, 12, 13]); // GL_MAX_FRAGMENT_UNIFORM_VECTORS
          else if (args[0] === 33902)
            return randomConfig.random.float([0, 10, 11, 12, 13]); // GL_ALIASED_LINE_WIDTH_RANGE
          else if (args[0] === 33901)
            return randomConfig.random.float([0, 10, 11, 12, 13]); // GL_ALIASED_POINT_SIZE_RANGE
          else if (args[0] === 37446)
            return randomConfig.random.item(deviceInfo.renderer); // GL_UNMASKED_RENDERER_WEBGL
          else if (args[0] === 7938)
            return deviceInfo.version; // GL_VERSION
          else if (args[0] === 35724) return deviceInfo.shadingLanguageVersion; // GL_SHADING_LANGUAGE_VERSION

          return Reflect.apply(target, self, args);
        },
      });
    };

    // Helper function to add noise to buffer data
    const spoofBuffer = function (target) {
      let proto = target.prototype ? target.prototype : target.__proto__;

      proto.bufferData = new Proxy(proto.bufferData, {
        apply(target, self, args) {
          if (!isFeatureActive("webgl")) {
            return Reflect.apply(target, self, args);
          }
          const buffer = args[1];
          if (
            buffer &&
            typeof buffer.length === "number" &&
            buffer.length > 0
          ) {
            let index = Math.floor(randomConfig.random.value() * buffer.length);
            let noise =
              buffer[index] !== undefined
                ? 0.1 * randomConfig.random.value() * buffer[index]
                : 0;
            buffer[index] = buffer[index] + noise;
            sendFingerprintAlert("webgl");
          }
          return Reflect.apply(target, self, args);
        },
      });
    };

    // Apply protection to both WebGL 1.0 and WebGL 2.0
    try {
      if (typeof WebGLRenderingContext !== "undefined") {
        spoofParameter(WebGLRenderingContext);
        spoofBuffer(WebGLRenderingContext);
        debugLog("[Stealth Guard] WebGL 1.0 protection activated");
      }
    } catch (e) {
      debugWarn("[Stealth Guard] Failed to protect WebGLRenderingContext:", e);
    }

    try {
      if (typeof WebGL2RenderingContext !== "undefined") {
        spoofParameter(WebGL2RenderingContext);
        spoofBuffer(WebGL2RenderingContext);
        debugLog("[Stealth Guard] WebGL 2.0 protection activated");
      }
    } catch (e) {
      debugWarn("[Stealth Guard] Failed to protect WebGL2RenderingContext:", e);
    }
  }

  // ========== FONT PROTECTION ==========
  if (config.font) {
    // Random noise functions - from Font Fingerprint Defender
    const rand = {
      noise: function () {
        const SIGN = Math.random() < Math.random() ? -1 : 1;
        return Math.floor(Math.random() + SIGN * Math.random());
      },
      sign: function () {
        const tmp = [-1, -1, -1, -1, -1, -1, +1, -1, -1, -1];
        const index = Math.floor(Math.random() * tmp.length);
        return tmp[index];
      },
    };

    // Font protection: Inspired by Font Fingerprint Defender
    // Main fingerprinting vector is offsetWidth/offsetHeight, not canvas.measureText
    // Add subtle random noise to make font fingerprinting unreliable

    let fontAlertSent = false;

    // Intercept offsetWidth - the PRIMARY font fingerprinting API
    try {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        get: new Proxy(
          Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            "offsetWidth",
          ).get,
          {
            apply(target, self, args) {
              if (!isFeatureActive("font")) {
                return Reflect.apply(target, self, args);
              }
              const width = Math.floor(self.getBoundingClientRect().width);
              const valid = width && rand.sign() === 1; // Only add noise 10% of the time
              const result = valid ? width + rand.noise() : width;

              // Send alert when noise is actually added
              if (valid && result !== width && !fontAlertSent) {
                sendFingerprintAlert("font");
                fontAlertSent = true;
              }

              return result;
            },
          },
        ),
      });

      // Intercept offsetHeight - also used for font fingerprinting
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        get: new Proxy(
          Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            "offsetHeight",
          ).get,
          {
            apply(target, self, args) {
              if (!isFeatureActive("font")) {
                return Reflect.apply(target, self, args);
              }
              try {
                const height = Math.floor(self.getBoundingClientRect().height);
                const valid = height && rand.sign() === 1; // Only add noise 10% of the time
                const result = valid ? height + rand.noise() : height;

                // Send alert when noise is actually added
                if (valid && result !== height && !fontAlertSent) {
                  sendFingerprintAlert("font");
                  fontAlertSent = true;
                }

                return result;
              } catch (e) {
                // Fallback to original implementation
                return Reflect.apply(target, self, args);
              }
            },
          },
        ),
      });

      debugLog(
        "[Stealth Guard] Font protection: offsetWidth/offsetHeight intercepted with random noise",
      );
    } catch (e) {
      debugWarn(
        "[Font Debug] Failed to intercept offsetWidth/offsetHeight:",
        e,
      );
    }

    // Also protect canvas.measureText (secondary vector)
    try {
      const originalMeasureText =
        CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function () {
        if (!isFeatureActive("font")) {
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
          sendFingerprintAlert("font");
          fontAlertSent = true;
        }

        // Add random noise (+1 or -1 pixel)
        const noise = rand.noise();

        // Create new object with all TextMetrics properties
        return {
          width: result.width + noise,
          actualBoundingBoxLeft: result.actualBoundingBoxLeft || 0,
          actualBoundingBoxRight: result.actualBoundingBoxRight
            ? result.actualBoundingBoxRight + noise
            : result.width + noise,
          actualBoundingBoxAscent: result.actualBoundingBoxAscent || 0,
          actualBoundingBoxDescent: result.actualBoundingBoxDescent || 0,
          fontBoundingBoxAscent: result.fontBoundingBoxAscent || 0,
          fontBoundingBoxDescent: result.fontBoundingBoxDescent || 0,
          emHeightAscent: result.emHeightAscent || 0,
          emHeightDescent: result.emHeightDescent || 0,
          hangingBaseline: result.hangingBaseline || 0,
          alphabeticBaseline: result.alphabeticBaseline || 0,
          ideographicBaseline: result.ideographicBaseline || 0,
        };
      };

      debugLog(
        "[Stealth Guard] Font protection: canvas.measureText intercepted",
      );
    } catch (e) {
      debugWarn("[Font Debug] Failed to intercept canvas.measureText:", e);
    }

    debugLog("[Stealth Guard] Font protection activated");
  }

  // ========== TIMEZONE PROTECTION ==========
  if (config.timezone) {
    try {
      let timezoneAlertSent = false;
      const notifyTimezoneAccess = function () {
        if (!timezoneAlertSent) {
          sendFingerprintAlert("timezone");
          timezoneAlertSent = true;
        }
      };
      const getTimezoneOffset = Date.prototype.getTimezoneOffset;
      const NativeIntlDateTimeFormat = Intl.DateTimeFormat;
      const timezoneOffsetCache = new Map();

      const parseTimeZoneOffset = function (timeZoneName) {
        if (!timeZoneName) return null;
        const normalized = String(timeZoneName)
          .replace(/−/g, "-")
          .replace(/^UTC/, "GMT");
        if (normalized === "GMT") return 0;
        const match = normalized.match(/GMT([+-])(d{1,2})(?::?(d{2}))?/);
        if (!match) return null;
        const sign = match[1] === "+" ? -1 : 1; // JS offset uses inverted sign
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || "0", 10);
        return sign * (hours * 60 + minutes);
      };

      const getTimezoneOptions = function () {
        const timezoneConfig = config.timezone || {};
        const parsedConfiguredOffset = Number(timezoneConfig.offset);
        // Stored config offset is UTC-relative minutes (UTC+1 => 60).
        // Date#getTimezoneOffset uses inverse sign (UTC+1 => -60).
        return {
          fallbackOffset: Number.isFinite(parsedConfiguredOffset)
            ? -parsedConfiguredOffset
            : 300,
          name: timezoneConfig.name || "America/New_York",
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
            second: "2-digit",
          });
          const parts = formatter.formatToParts(new Date(timeValue));
          const zonePart = parts.find((part) => part.type === "timeZoneName");
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

      const processedNames = [
        "_date",
        "_offset",
        "getTime",
        "setTime",
        "getTimezoneOffset",
        "toJSON",
        "valueOf",
        "constructor",
        "toString",
        "toGMTString",
        "toISOString",
        "getUTCDay",
        "getUTCDate",
        "getUTCMonth",
        "getUTCHours",
        "getUTCMinutes",
        "getUTCSeconds",
        "getUTCFullYear",
        "getUTCMilliseconds",
        "toTimeString",
        "toLocaleString",
        "toLocaleTimeString",
        "toLocaleDateString",
      ];

      const propertyNames = Object.getOwnPropertyNames(Date.prototype).filter(
        function (item) {
          return processedNames.indexOf(item) === -1;
        },
      );

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

      Object.defineProperty(Date.prototype, "_offset", {
        configurable: true,
        get() {
          return getTimezoneOffset.call(this);
        },
      });

      Object.defineProperty(Date.prototype, "_date", {
        configurable: true,
        get() {
          const spoofedOffset = getSpoofedTimezoneOffset(this);
          return this._newdate !== undefined
            ? this._newdate
            : new Date(
                this.getTime() + (this._offset - spoofedOffset) * 60 * 1000,
              );
        },
      });

      Date.prototype.getTimezoneOffset = new Proxy(
        Date.prototype.getTimezoneOffset,
        {
          apply(target, self, args) {
            if (!isFeatureActive("timezone")) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            return isNaN(self)
              ? Reflect.apply(target, self, args)
              : getSpoofedTimezoneOffset(self);
          },
        },
      );

      Date.prototype.toString = new Proxy(Date.prototype.toString, {
        apply(target, self, args) {
          if (!isFeatureActive("timezone")) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          return isNaN(self)
            ? Reflect.apply(target, self, args)
            : self.toDateString() + " " + self.toTimeString();
        },
      });

      Date.prototype.toLocaleString = new Proxy(Date.prototype.toLocaleString, {
        apply(target, self, args) {
          if (!isFeatureActive("timezone")) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          return Reflect.apply(target, self, withSpoofedTimezoneOptions(args));
        },
      });

      Date.prototype.toLocaleDateString = new Proxy(
        Date.prototype.toLocaleDateString,
        {
          apply(target, self, args) {
            if (!isFeatureActive("timezone")) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            return Reflect.apply(
              target,
              self,
              withSpoofedTimezoneOptions(args),
            );
          },
        },
      );

      Date.prototype.toLocaleTimeString = new Proxy(
        Date.prototype.toLocaleTimeString,
        {
          apply(target, self, args) {
            if (!isFeatureActive("timezone")) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            return Reflect.apply(
              target,
              self,
              withSpoofedTimezoneOptions(args),
            );
          },
        },
      );

      Date.prototype.toTimeString = new Proxy(Date.prototype.toTimeString, {
        apply(target, self, args) {
          if (!isFeatureActive("timezone")) {
            return Reflect.apply(target, self, args);
          }
          notifyTimezoneAccess();
          const result = Reflect.apply(target, self._date, args);
          const replace_1 = convertToGMT(self._offset);
          const replace_2 = convertToGMT(getSpoofedTimezoneOffset(self));
          const options = getTimezoneOptions();
          const replace_3 =
            "(" + options.name.replace(/\//g, " ") + " Standard Time)";
          return isNaN(self)
            ? Reflect.apply(target, self, args)
            : result.replace(replace_1, replace_2).replace(/\(.*\)/, replace_3);
        },
      });

      propertyNames.forEach(function (name) {
        if (
          [
            "setHours",
            "setMinutes",
            "setMonth",
            "setDate",
            "setYear",
            "setFullYear",
          ].indexOf(name) !== -1
        ) {
          Date.prototype[name] = new Proxy(Date.prototype[name], {
            apply(target, self, args) {
              if (!isFeatureActive("timezone")) {
                return Reflect.apply(target, self, args);
              }
              if (isNaN(self)) {
                return Reflect.apply(target, self, args);
              } else {
                const adjusted = self._date.getTime();
                const current = Reflect.apply(target, self._date, args);
                const result = self.setTime(
                  self.getTime() + current - adjusted,
                );
                return result;
              }
            },
          });
        } else if (
          [
            "setUTCDate",
            "setUTCFullYear",
            "setUTCHours",
            "setUTCMinutes",
            "setUTCMonth",
            "setUTCSeconds",
            "setUTCMilliseconds",
          ].indexOf(name) !== -1
        ) {
          // Skip UTC setters - don't wrap them (Change Timezone skips these)
        } else {
          Date.prototype[name] = new Proxy(Date.prototype[name], {
            apply(target, self, args) {
              if (!isFeatureActive("timezone")) {
                return Reflect.apply(target, self, args);
              }
              return isNaN(self)
                ? Reflect.apply(target, self, args)
                : Reflect.apply(target, self._date, args);
            },
          });
        }
      });

      Intl.DateTimeFormat.prototype.resolvedOptions = new Proxy(
        Intl.DateTimeFormat.prototype.resolvedOptions,
        {
          apply(target, self, args) {
            if (!isFeatureActive("timezone")) {
              return Reflect.apply(target, self, args);
            }
            notifyTimezoneAccess();
            const result = Reflect.apply(target, self, args);
            const options = getTimezoneOptions();
            result.timeZone = options.name;
            return result;
          },
        },
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

      debugLog("[Stealth Guard] Timezone protection activated");
    } catch (e) {
      debugError("[Stealth Guard] Timezone protection failed:", e);
    }
  }

  // ========== CLIENTRECTS FINGERPRINT PROTECTION ==========
  if (config.clientrects) {
    const noiseConfig = {
      DOMRect: 0.00000001,
      DOMRectReadOnly: 0.000001,
    };

    const metrics = {
      DOMRect: ["x", "y", "width", "height"],
      DOMRectReadOnly: ["top", "right", "bottom", "left"],
    };

    let clientrectsAlertSent = false;

    // Protect DOMRect properties
    const domRectMetric = metrics.DOMRect.sort(() => 0.5 - Math.random())[0];
    try {
      Object.defineProperty(DOMRect.prototype, domRectMetric, {
        get: new Proxy(
          Object.getOwnPropertyDescriptor(DOMRect.prototype, domRectMetric).get,
          {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              if (!isFeatureActive("clientrects")) {
                return result;
              }
              const noise =
                result *
                (1 + (Math.random() < 0.5 ? -1 : +1) * noiseConfig.DOMRect);

              if (!clientrectsAlertSent) {
                sendFingerprintAlert("clientrects");
                clientrectsAlertSent = true;
              }

              return noise;
            },
          },
        ),
      });
      debugLog(
        "[Stealth Guard] ClientRects: DOMRect." + domRectMetric + " protected",
      );
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect DOMRect." + domRectMetric + ":",
        e,
      );
    }

    // Protect DOMRectReadOnly properties
    const domRectReadOnlyMetric = metrics.DOMRectReadOnly.sort(
      () => 0.5 - Math.random(),
    )[0];
    try {
      Object.defineProperty(DOMRectReadOnly.prototype, domRectReadOnlyMetric, {
        get: new Proxy(
          Object.getOwnPropertyDescriptor(
            DOMRectReadOnly.prototype,
            domRectReadOnlyMetric,
          ).get,
          {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              if (!isFeatureActive("clientrects")) {
                return result;
              }
              const noise =
                result *
                (1 +
                  (Math.random() < 0.5 ? -1 : +1) *
                    noiseConfig.DOMRectReadOnly);

              if (!clientrectsAlertSent) {
                sendFingerprintAlert("clientrects");
                clientrectsAlertSent = true;
              }

              return noise;
            },
          },
        ),
      });
      debugLog(
        "[Stealth Guard] ClientRects: DOMRectReadOnly." +
          domRectReadOnlyMetric +
          " protected",
      );
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect DOMRectReadOnly." +
          domRectReadOnlyMetric +
          ":",
        e,
      );
    }

    debugLog("[Stealth Guard] ClientRects protection activated");
  }

  // ========== WEBGPU FINGERPRINT PROTECTION ==========
  if (config.webgpu) {
    const noiseConfig = {
      color: 0.01, // 1% noise on color values
      percent: 0.1, // Modify 10% of buffer elements
      buffer: 0.0001, // 0.01% noise on buffer values
    };

    let webgpuAlertSent = false;
    const protectedLimitNames = [
      "maxBufferSize",
      "maxUniformBufferBindingSize",
      "maxStorageBufferBindingSize",
      "maxComputeWorkgroupStorageSize",
    ];

    const protectGpuLimits = function (Constructor, label) {
      if (typeof Constructor === "undefined") {
        return;
      }

      try {
        const originalGetter = Object.getOwnPropertyDescriptor(
          Constructor.prototype,
          "limits",
        ).get;
        Object.defineProperty(Constructor.prototype, "limits", {
          get: new Proxy(originalGetter, {
            apply(target, self, args) {
              const result = Reflect.apply(target, self, args);
              if (!isFeatureActive("webgpu")) {
                return result;
              }

              const prototype = Object.getPrototypeOf(result);
              for (const name of protectedLimitNames) {
                const originalValue = result[name];
                Object.defineProperty(prototype, name, {
                  configurable: true,
                  get() {
                    return originalValue + (Math.random() < 0.5 ? -1 : -2);
                  },
                });
              }

              if (!webgpuAlertSent) {
                sendFingerprintAlert("webgpu");
                webgpuAlertSent = true;
              }
              return result;
            },
          }),
        });
        debugLog(`[Stealth Guard] WebGPU: ${label}.limits protected`);
      } catch (error) {
        debugWarn(`[Stealth Guard] Failed to protect ${label}.limits:`, error);
      }
    };

    protectGpuLimits(
      typeof GPUAdapter === "undefined" ? undefined : GPUAdapter,
      "GPUAdapter",
    );
    protectGpuLimits(
      typeof GPUDevice === "undefined" ? undefined : GPUDevice,
      "GPUDevice",
    );

    // Protect GPUCommandEncoder.prototype.beginRenderPass
    try {
      if (typeof GPUCommandEncoder !== "undefined") {
        GPUCommandEncoder.prototype.beginRenderPass = new Proxy(
          GPUCommandEncoder.prototype.beginRenderPass,
          {
            apply(target, self, args) {
              if (!isFeatureActive("webgpu")) {
                return Reflect.apply(target, self, args);
              }
              if (
                args &&
                args[0] &&
                args[0].colorAttachments &&
                args[0].colorAttachments[0]
              ) {
                if (args[0].colorAttachments[0].clearValue) {
                  try {
                    const metrics = args[0].colorAttachments[0].clearValue;
                    for (let key in metrics) {
                      let value = metrics[key];
                      value =
                        value +
                        (Math.random() < 0.5 ? -1 : -2) *
                          noiseConfig.color *
                          value;
                      value = (value < 0 ? -1 : +1) * value;
                      metrics[key] = value;
                    }
                    args[0].colorAttachments[0].clearValue = metrics;

                    if (!webgpuAlertSent) {
                      sendFingerprintAlert("webgpu");
                      webgpuAlertSent = true;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              return Reflect.apply(target, self, args);
            },
          },
        );
        debugLog(
          "[Stealth Guard] WebGPU: GPUCommandEncoder.beginRenderPass protected",
        );
      }
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect GPUCommandEncoder.beginRenderPass:",
        e,
      );
    }

    // Protect GPUQueue.prototype.writeBuffer
    try {
      if (typeof GPUQueue !== "undefined") {
        GPUQueue.prototype.writeBuffer = new Proxy(
          GPUQueue.prototype.writeBuffer,
          {
            apply(target, self, args) {
              if (!isFeatureActive("webgpu")) {
                return Reflect.apply(target, self, args);
              }
              if (args && args[2]) {
                const rawBuffer = args[2];
                const dataOffset = Number.isFinite(Number(args[3]))
                  ? Math.max(0, Math.floor(Number(args[3])))
                  : 0;
                const explicitSize = Number.isFinite(Number(args[4]))
                  ? Math.max(0, Math.floor(Number(args[4])))
                  : null;
                let metrics = null;

                if (rawBuffer instanceof ArrayBuffer) {
                  const start = Math.min(dataOffset, rawBuffer.byteLength);
                  const byteLength =
                    explicitSize === null
                      ? Math.max(0, rawBuffer.byteLength - start)
                      : Math.min(
                          explicitSize,
                          Math.max(0, rawBuffer.byteLength - start),
                        );
                  metrics = new Uint8Array(rawBuffer, start, byteLength);
                } else if (ArrayBuffer.isView(rawBuffer)) {
                  if (typeof rawBuffer.subarray === "function") {
                    const start = Math.min(dataOffset, rawBuffer.length);
                    const end =
                      explicitSize === null
                        ? rawBuffer.length
                        : Math.min(rawBuffer.length, start + explicitSize);
                    metrics = rawBuffer.subarray(start, end);
                  } else {
                    const start = Math.min(dataOffset, rawBuffer.byteLength);
                    const byteLength =
                      explicitSize === null
                        ? Math.max(0, rawBuffer.byteLength - start)
                        : Math.min(
                            explicitSize,
                            Math.max(0, rawBuffer.byteLength - start),
                          );
                    metrics = new Uint8Array(
                      rawBuffer.buffer,
                      rawBuffer.byteOffset + start,
                      byteLength,
                    );
                  }
                }

                if (
                  metrics &&
                  typeof metrics.length === "number" &&
                  metrics.length > 0
                ) {
                  try {
                    const array = Array(metrics.length)
                      .fill(0)
                      .map((n, i) => n + i);
                    const count = Math.ceil(
                      metrics.length * noiseConfig.percent,
                    );
                    const shuffled = array.sort(() => 0.5 - Math.random());
                    const selected = [...shuffled.slice(0, count)];

                    for (let i = 0; i < selected.length; i++) {
                      const index = selected[i];
                      const value = metrics[index];
                      metrics[index] =
                        value +
                        (Math.random() < 0.5
                          ? -noiseConfig.buffer * value
                          : +noiseConfig.buffer * value);
                    }

                    if (!webgpuAlertSent) {
                      sendFingerprintAlert("webgpu");
                      webgpuAlertSent = true;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              return Reflect.apply(target, self, args);
            },
          },
        );
        debugLog("[Stealth Guard] WebGPU: GPUQueue.writeBuffer protected");
      }
    } catch (e) {
      debugWarn("[Stealth Guard] Failed to protect GPUQueue.writeBuffer:", e);
    }

    debugLog("[Stealth Guard] WebGPU protection activated");
  }

  // ========== AUDIOCONTEXT FINGERPRINT PROTECTION ==========
  if (config.audiocontext) {
    let audiocontextAlertSent = false;

    const audioContext = {
      BUFFER: null,
      getChannelData: function (AudioBufferPrototype) {
        AudioBufferPrototype.prototype.getChannelData = new Proxy(
          AudioBufferPrototype.prototype.getChannelData,
          {
            apply(target, self, args) {
              const results = Reflect.apply(target, self, args);
              if (!isFeatureActive("audiocontext")) {
                return results;
              }

              if (audioContext.BUFFER !== results) {
                audioContext.BUFFER = results;

                if (!audiocontextAlertSent) {
                  sendFingerprintAlert("audiocontext");
                  audiocontextAlertSent = true;
                }

                // Add minimal noise to every 100th sample
                for (let i = 0; i < results.length; i += 100) {
                  const index = Math.floor(Math.random() * i);
                  results[index] = results[index] + Math.random() * 0.0000001;
                }
              }

              return results;
            },
          },
        );
      },
      createAnalyser: function (AudioContextPrototype) {
        AudioContextPrototype.prototype.__proto__.createAnalyser = new Proxy(
          AudioContextPrototype.prototype.__proto__.createAnalyser,
          {
            apply(target, self, args) {
              const results = Reflect.apply(target, self, args);
              if (!isFeatureActive("audiocontext")) {
                return results;
              }

              results.__proto__.getFloatFrequencyData = new Proxy(
                results.__proto__.getFloatFrequencyData,
                {
                  apply(target, self, args) {
                    const results = Reflect.apply(target, self, args);
                    if (!isFeatureActive("audiocontext")) {
                      return results;
                    }

                    if (!audiocontextAlertSent) {
                      sendFingerprintAlert("audiocontext");
                      audiocontextAlertSent = true;
                    }

                    // Add noise to frequency data
                    const frequencyData = args[0];
                    for (
                      let i = 0;
                      frequencyData && i < frequencyData.length;
                      i += 100
                    ) {
                      const index = Math.floor(Math.random() * i);
                      frequencyData[index] =
                        frequencyData[index] + Math.random() * 0.1;
                    }

                    return results;
                  },
                },
              );

              return results;
            },
          },
        );
      },
    };

    try {
      if (typeof AudioBuffer !== "undefined") {
        audioContext.getChannelData(AudioBuffer);
        debugLog(
          "[Stealth Guard] AudioContext: AudioBuffer.getChannelData protected",
        );
      }
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect AudioBuffer.getChannelData:",
        e,
      );
    }

    try {
      if (typeof AudioContext !== "undefined") {
        audioContext.createAnalyser(AudioContext);
        debugLog(
          "[Stealth Guard] AudioContext: AudioContext.createAnalyser protected",
        );
      }
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect AudioContext.createAnalyser:",
        e,
      );
    }

    try {
      if (typeof OfflineAudioContext !== "undefined") {
        audioContext.createAnalyser(OfflineAudioContext);
        debugLog(
          "[Stealth Guard] AudioContext: OfflineAudioContext.createAnalyser protected",
        );
      }
    } catch (e) {
      debugWarn(
        "[Stealth Guard] Failed to protect OfflineAudioContext.createAnalyser:",
        e,
      );
    }

    debugLog("[Stealth Guard] AudioContext protection activated");
  }

  // ========== USER-AGENT PROTECTION ==========
  const currentHostname = window.location.hostname;
  const isEmptyHostnameFrame = !currentHostname;

  if (config.useragent && !isEmptyHostnameFrame) {
    const getUserAgentProfile = function () {
      const preset =
        config.useragent && config.useragent.preset
          ? config.useragent.preset
          : "macos";
      const userAgent = userAgentStrings[preset] || userAgentStrings.macos;
      let platform = /Mac|iPod|iPhone|iPad/.test(userAgent)
        ? "MacIntel"
        : /Win/.test(userAgent)
          ? "Win32"
          : "Linux x86_64";
      let oscpu = "";

      if (/iPhone/.test(userAgent)) {
        platform = "iPhone";
        const match = userAgent.match(/CPU iPhone OS ([\d_]+)/);
        oscpu = match
          ? "iPhone OS " + match[1].replace(/_/g, ".")
          : "iPhone OS 17.4.1";
      } else if (/iPad/.test(userAgent)) {
        platform = "iPad";
        const match = userAgent.match(/CPU OS ([\d_]+)/);
        oscpu = match
          ? "iPad OS " + match[1].replace(/_/g, ".")
          : "iPad OS 17.4.1";
      } else if (/Android/.test(userAgent)) {
        platform = "Linux armv8l";
        const match = userAgent.match(/Android ([\d.]+)/);
        oscpu = match ? "Linux; Android " + match[1] : "Linux; Android 14";
      } else if (/Mac OS X/.test(userAgent)) {
        platform = "MacIntel";
        const match = userAgent.match(/Mac OS X (\d+_\d+_\d+)/);
        oscpu = match
          ? "Intel Mac OS X " + match[1].replace(/_/g, ".")
          : "Intel Mac OS X 10.15.7";
      } else if (/Linux/.test(userAgent) && !/Android/.test(userAgent)) {
        platform = "Linux x86_64";
        oscpu = "Linux x86_64";
      } else if (/Win/.test(userAgent)) {
        platform = "Win32";
        const match = userAgent.match(/Windows NT ([\d.]+)/);
        oscpu = match
          ? "Windows NT " + match[1] + "; Win64; x64"
          : "Windows NT 10.0; Win64; x64";
      }

      return { userAgent, platform, oscpu };
    };

    const shouldSpoofUserAgent = function () {
      return isFeatureActive("useragent") && !isEmptyHostnameFrame;
    };

    // Store original descriptors
    const originalUA = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "userAgent",
    );
    const originalPlatform = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "platform",
    );
    const originalAppVersion = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "appVersion",
    );
    const originalVendor = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "vendor",
    );
    const originalOscpu = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "oscpu",
    );
    const originalUserAgentData = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "userAgentData",
    );

    // Override userAgent
    try {
      Object.defineProperty(Navigator.prototype, "userAgent", {
        get: function () {
          const profile = getUserAgentProfile();
          if (!shouldSpoofUserAgent())
            return originalUA ? originalUA.get.call(this) : profile.userAgent;
          sendFingerprintAlert("user-agent");
          return profile.userAgent;
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      debugWarn("[Stealth Guard] Could not override userAgent:", e);
    }

    // Override platform
    try {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: function () {
          const profile = getUserAgentProfile();
          if (!shouldSpoofUserAgent())
            return originalPlatform
              ? originalPlatform.get.call(this)
              : profile.platform;
          return profile.platform;
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      debugWarn("[Stealth Guard] Could not override platform:", e);
    }

    // Override appVersion
    try {
      Object.defineProperty(Navigator.prototype, "appVersion", {
        get: function () {
          const profile = getUserAgentProfile();
          if (!shouldSpoofUserAgent())
            return originalAppVersion ? originalAppVersion.get.call(this) : "";
          const versionStart = profile.userAgent.indexOf("/");
          return versionStart !== -1
            ? profile.userAgent.substring(versionStart + 1)
            : "5.0";
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      debugWarn("[Stealth Guard] Could not override appVersion:", e);
    }

    // Override vendor
    try {
      Object.defineProperty(Navigator.prototype, "vendor", {
        get: function () {
          const profile = getUserAgentProfile();
          if (!shouldSpoofUserAgent())
            return originalVendor ? originalVendor.get.call(this) : "";
          if (
            profile.userAgent.includes("Chrome") &&
            !profile.userAgent.includes("Edg")
          ) {
            return "Google Inc.";
          } else if (
            profile.userAgent.includes("Safari") &&
            !profile.userAgent.includes("Chrome")
          ) {
            return "Apple Computer, Inc.";
          } else if (profile.userAgent.includes("Firefox")) {
            return "";
          }
          return "";
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      debugWarn("[Stealth Guard] Could not override vendor:", e);
    }

    // Override userAgentData (for Chromium browsers)
    if (navigator.userAgentData) {
      try {
        Object.defineProperty(Navigator.prototype, "userAgentData", {
          get: function () {
            if (!shouldSpoofUserAgent()) {
              return originalUserAgentData && originalUserAgentData.get
                ? originalUserAgentData.get.call(this)
                : undefined;
            }
            return undefined;
          },
          configurable: true,
          enumerable: true,
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
            if (!shouldSpoofUserAgent())
              return originalOscpu && originalOscpu.get
                ? originalOscpu.get.call(this)
                : "";
            return profile.oscpu;
          },
          configurable: true,
          enumerable: true,
        });
      } catch (e) {
        debugWarn("[Stealth Guard] Could not override oscpu:", e);
      }
    }

    debugLog("[Stealth Guard] User-Agent protection activated");
  }

  // ========== WEBRTC DETECTION ==========
  // Detect WebRTC fingerprinting attempts by intercepting RTCPeerConnection
  debugLog("[Stealth Guard] WebRTC config check:", {
    enabled: config.enabled,
    webrtc: config.webrtc,
    webrtcEnabled: config.webrtc ? config.webrtc.enabled : "N/A",
  });

  if (config.webrtc) {
    try {
      const OriginalRTCPeerConnection =
        window.RTCPeerConnection ||
        window.webkitRTCPeerConnection ||
        window.mozRTCPeerConnection;

      debugLog(
        "[Stealth Guard] Original RTCPeerConnection found:",
        !!OriginalRTCPeerConnection,
      );

      if (OriginalRTCPeerConnection) {
        const ProxiedRTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
          construct(target, args) {
            if (!isFeatureActive("webrtc")) {
              return new target(...args);
            }
            // Send alert when RTCPeerConnection is created
            debugLog(
              "[Stealth Guard] RTCPeerConnection created! Sending alert...",
            );
            sendFingerprintAlert("webrtc");
            return new target(...args);
          },
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
    debugLog(
      "[Stealth Guard] WebRTC detection skipped - protection disabled or not configured",
    );
  }

  debugLog("[Stealth Guard] All inline protections activated");
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { installMainWorldProtections };
}
