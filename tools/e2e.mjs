import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { DEFAULT_CONFIG } = require("../lib/config.js");
const root = resolve(import.meta.dirname, "..");
const TEST_COMPATIBILITY_CONFIG = structuredClone(DEFAULT_CONFIG);
TEST_COMPATIBILITY_CONFIG.webgl.mode = "compatibility";
TEST_COMPATIBILITY_CONFIG.webgl.strictWhitelist = "";
const chromeCandidates = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  const executablePath = chromeCandidates.find(existsSync);
  if (!executablePath) {
    throw new Error(
      "Chrome or Chromium was not found. Install Playwright Chromium or set CHROME_PATH.",
    );
  }
  return executablePath;
}

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

function setChecked(page, selector, checked) {
  return page.$eval(
    selector,
    (input, nextValue) => {
      input.checked = nextValue;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    checked,
  );
}

const protectionSources = [
  "lib/filterLists.js",
  "lib/domainFilter.js",
  "lib/gpuProfiles.js",
  "lib/config.js",
  "lib/curlProfiles.js",
  "content-scripts/main.js",
  "content-scripts/injector.js",
]
  .map(readSource)
  .join("\n");

const adblockContentSources = [
  "lib/runtime.js",
  "lib/domainFilter.js",
  "content-scripts/adblock.js",
]
  .map(readSource)
  .join("\n");

function protectionInitScript(config) {
  return `
    (() => {
      const storedConfig = ${JSON.stringify(config)};
      const nativeUserAgentGetter = Object.getOwnPropertyDescriptor(
        Navigator.prototype,
        "userAgent",
      ).get;
      window.__sgNativeUserAgent = nativeUserAgentGetter.call(navigator);
      const nativeLanguageDescriptor = Object.getOwnPropertyDescriptor(
        Navigator.prototype,
        "language",
      );
      const nativeLanguagesDescriptor = Object.getOwnPropertyDescriptor(
        Navigator.prototype,
        "languages",
      );
      window.__sgNativeLanguage = nativeLanguageDescriptor.get.call(navigator);
      window.__sgNativeLanguages = Array.from(
        nativeLanguagesDescriptor.get.call(navigator),
      );
      window.__sgNativeCanvasToBlob = HTMLCanvasElement.prototype.toBlob;
      window.__sgNativeCanvasToDataURL = HTMLCanvasElement.prototype.toDataURL;
      window.__sgNativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      window.__sgNativeMeasureText = CanvasRenderingContext2D.prototype.measureText;
      window.__sgNativeOffscreen =
        typeof OffscreenCanvas === "undefined"
          ? null
          : {
              convertToBlob: OffscreenCanvas.prototype.convertToBlob,
              getImageData:
                OffscreenCanvasRenderingContext2D.prototype.getImageData,
            };
      window.__sgNativeWebGL = {
        getExtension: WebGLRenderingContext.prototype.getExtension,
        getParameter: WebGLRenderingContext.prototype.getParameter,
        getSupportedExtensions:
          WebGLRenderingContext.prototype.getSupportedExtensions,
        getShaderPrecisionFormat:
          WebGLRenderingContext.prototype.getShaderPrecisionFormat,
        readPixels: WebGLRenderingContext.prototype.readPixels,
      };
      window.__sgNativeWebGL2 = {
        getParameter: WebGL2RenderingContext.prototype.getParameter,
        readPixels: WebGL2RenderingContext.prototype.readPixels,
      };
      window.__sgNativeOffsetWidth = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "offsetWidth",
      ).get;
      window.__sgNativeAudio = {
        copyFromChannel: AudioBuffer.prototype.copyFromChannel,
        getByteTimeDomainData: AnalyserNode.prototype.getByteTimeDomainData,
      };
      window.__sgNativeDescriptors = {
        userAgent: Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent"),
        language: nativeLanguageDescriptor,
        languages: nativeLanguagesDescriptor,
        hardwareConcurrency: Object.getOwnPropertyDescriptor(
          Navigator.prototype,
          "hardwareConcurrency",
        ),
        offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
        webglGetParameter: Object.getOwnPropertyDescriptor(
          WebGLRenderingContext.prototype,
          "getParameter",
        ),
        webglGetExtension: Object.getOwnPropertyDescriptor(
          WebGLRenderingContext.prototype,
          "getExtension",
        ),
        webglReadPixels: Object.getOwnPropertyDescriptor(
          WebGLRenderingContext.prototype,
          "readPixels",
        ),
      };
      const geolocationPrototype = Object.getPrototypeOf(navigator.geolocation);
      window.__sgNativeGeolocation = {
        getCurrentPosition: geolocationPrototype.getCurrentPosition,
        watchPosition: geolocationPrototype.watchPosition,
      };
      geolocationPrototype.getCurrentPosition = function (success) {
        success({
          coords: {
            latitude: 59.33,
            longitude: 18.07,
            accuracy: 25,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
      };
      geolocationPrototype.watchPosition = function (success) {
        this.getCurrentPosition(success);
        return 1;
      };
      window.__sgReports = [];
      window.__sgRuntimeListeners = [];

      class FakeGPULimits {}
      for (const [name, value] of Object.entries({
        maxBufferSize: 1024,
        maxUniformBufferBindingSize: 512,
        maxStorageBufferBindingSize: 256,
        maxComputeWorkgroupStorageSize: 128
      })) {
        Object.defineProperty(FakeGPULimits.prototype, name, {
          configurable: true,
          get() { return value; }
        });
      }
      class FakeGPUAdapter {
        get limits() { return new FakeGPULimits(); }
      }
      class FakeGPUDevice {
        get limits() { return new FakeGPULimits(); }
      }
      class FakeGPUCommandEncoder {
        beginRenderPass(descriptor) {
          window.__sgRenderPassDescriptor = descriptor;
          return descriptor;
        }
      }
      class FakeGPUQueue {
        writeBuffer(...args) {
          window.__sgWriteBufferArgs = args;
          return true;
        }
      }
      Object.assign(window, {
        GPUAdapter: window.GPUAdapter || FakeGPUAdapter,
        GPUDevice: window.GPUDevice || FakeGPUDevice,
        GPUCommandEncoder: window.GPUCommandEncoder || FakeGPUCommandEncoder,
        GPUQueue: window.GPUQueue || FakeGPUQueue
      });

      const fakeChrome = {
        runtime: {
          lastError: null,
          onMessage: {
            addListener(listener) {
              window.__sgRuntimeListeners.push(listener);
            }
          },
          sendMessage(message, callback) {
            window.__sgReports.push(structuredClone(message));
            if (callback) callback({ success: true });
          }
        },
        storage: {
          local: {
            get(key, callback) {
              callback({ "stealth-guard-config": structuredClone(storedConfig) });
            }
          }
        }
      };
      Object.assign(window.chrome, fakeChrome);
      window.__sgUpdateConfig = (nextConfig) => {
        for (const listener of window.__sgRuntimeListeners) {
          listener({ type: "config-updated", config: structuredClone(nextConfig) }, {}, () => {});
        }
      };
    })();
  `;
}

function uiMockInitScript(config, options = {}) {
  return `
    (${function installUiMock(initialConfig, mockOptions) {
      const state = (window.__chromeState = {
        config: structuredClone(initialConfig),
        sessions: [],
        activeSessionId: null,
        reloads: 0,
        createdTabs: [],
        openedOptions: 0,
        failMessages: { ...(mockOptions.failMessages || {}) },
        failReload: false,
        failTabQuery: false,
        proxyCredentials: {},
        proxyHistory: [],
        proxyStatus: {
          state: "idle",
          profile: null,
          verifiedAt: null,
          exitIp: null,
          error: null,
          controlLevel: "controlled_by_this_extension",
        },
      });

      function proxyEndpoint(profile) {
        return profile
          ? String(profile.host).toLowerCase() + ":" + Number(profile.port)
          : null;
      }

      function responseFor(message) {
        if (state.failMessages[message.type]) {
          return { success: false, error: state.failMessages[message.type] };
        }
        if (message.type === "get-config") {
          return { config: structuredClone(state.config) };
        }
        if (message.type === "update-config") {
          state.config = structuredClone(message.config);
          state.proxyStatus = state.config.proxy.enabled
            ? {
                state: "connected",
                profile: state.config.proxy.activeProfile,
                verifiedAt: Date.now(),
                exitIp: "203.0.113.7",
                error: null,
                controlLevel: "controlled_by_this_extension",
              }
            : {
                state: "idle",
                profile: null,
                verifiedAt: null,
                exitIp: null,
                error: null,
                controlLevel: "controlled_by_this_extension",
              };
          state.proxyHistory.unshift({
            timestamp: Date.now(),
            state: state.proxyStatus.state,
            profile: state.proxyStatus.profile,
            exitIp: state.proxyStatus.exitIp,
            error: null,
            controlLevel: state.proxyStatus.controlLevel,
          });
          return { success: true };
        }
        if (message.type === "reset-config") {
          state.config = structuredClone(initialConfig);
          state.proxyCredentials = {};
          state.proxyStatus.state = "idle";
          return { success: true };
        }
        if (message.type === "get-proxy-runtime-status") {
          return { success: true, status: structuredClone(state.proxyStatus) };
        }
        if (message.type === "verify-proxy-connection") {
          return { success: true, status: structuredClone(state.proxyStatus) };
        }
        if (message.type === "get-proxy-diagnostics") {
          return {
            success: true,
            diagnostics: {
              generatedAt: Date.now(),
              status: structuredClone(state.proxyStatus),
              effectiveSettings: {
                mode: state.config.proxy.enabled ? "pac_script" : "system",
                controlLevel: "controlled_by_this_extension",
              },
              configuration: {
                enabled: state.config.proxy.enabled,
                routingMode: state.config.proxy.routingMode,
                activeProfile: state.config.proxy.activeProfile,
                profileCount: state.config.proxy.profiles.length,
                fallbackCount: state.config.proxy.fallbackProfiles.length,
                routeCount: state.config.proxy.domainRoutes.length,
                bypassCount: state.config.proxy.bypassList.length,
                syncTimezone: state.config.proxy.syncTimezone,
                syncGeolocation: state.config.proxy.syncGeolocation,
                credentialProfileCount: Object.keys(state.proxyCredentials).length,
                location: null,
              },
              history: structuredClone(state.proxyHistory),
            },
          };
        }
        if (message.type === "clear-proxy-history") {
          state.proxyHistory = [];
          return { success: true };
        }
        if (message.type === "get-proxy-credential-status") {
          return {
            success: true,
            credentials: (message.profiles || [message.profile])
              .filter(Boolean)
              .map((profile) => {
                const endpoint = proxyEndpoint(profile);
                const credential = state.proxyCredentials[endpoint];
                return {
                  endpoint,
                  configured: Boolean(credential),
                  username: credential ? credential.username : "",
                  persisted: credential ? credential.persisted : false,
                };
              }),
          };
        }
        if (message.type === "set-proxy-credentials") {
          const endpoint = proxyEndpoint(message.profile);
          state.proxyCredentials[endpoint] = {
            username: message.credentials.username,
            persisted: message.credentials.persist !== false,
          };
          return { success: true };
        }
        if (message.type === "clear-proxy-credentials") {
          delete state.proxyCredentials[proxyEndpoint(message.profile)];
          return { success: true };
        }
        if (message.type === "get-triggered-features") {
          return {
            features: ["canvas", "user-agent", "tracker"],
            tracker: {
              count: 4,
              domains: ["ads.example", "analytics.example"],
              entries: [
                { domain: "ads.example", count: 3 },
                { domain: "analytics.example", count: 1 },
              ],
            },
          };
        }
        if (message.type === "get-adblock-status") {
          return {
            success: true,
            status: {
              updating: false,
              lastUpdate: Date.now(),
              nextUpdate: Date.now() + 86400000,
              networkRules: 100,
              cosmeticRules: 50,
              error: null,
              lists: [],
            },
          };
        }
        if (message.type === "update-adblock-filters") {
          return {
            success: true,
            updated: 3,
            status: {
              updating: false,
              lastUpdate: Date.now(),
              nextUpdate: Date.now() + 86400000,
              networkRules: 110,
              cosmeticRules: 55,
              error: null,
              lists: [],
            },
          };
        }
        if (message.type === "get-identity-diagnostics") {
          return {
            success: true,
            diagnostics: {
              protectionEnabled: state.config.enabled,
              globallyAllowlisted: false,
              userAgent: {
                enabled: state.config.useragent.enabled,
                preset: state.config.useragent.preset,
                value: "Protected test agent",
              },
              language: {
                enabled: state.config.language.enabled,
                preset: state.config.language.preset,
                locale: state.config.language.preset,
                languages: [state.config.language.preset, "en"],
                acceptLanguage: state.config.language.preset + ",en;q=0.8",
                source: "preset",
              },
              timezone: {
                enabled: state.config.timezone.enabled,
                name: state.config.timezone.name,
                source: "preset",
              },
              geolocation: {
                enabled: state.config.geolocation.enabled,
                synchronized: false,
                coordinates: null,
              },
              webrtc: {
                enabled: state.config.webrtc.enabled,
                requestedPolicy: state.config.webrtc.policy,
                effectivePolicy: state.config.webrtc.policy,
                controlLevel: "controlled_by_this_extension",
              },
              proxy: {
                enabled: state.config.proxy.enabled,
                state: state.proxyStatus.state,
                profile: state.proxyStatus.profile,
                exitIp: state.proxyStatus.exitIp,
                location: null,
              },
              tracker: {
                enabled: state.config.tracker.enabled,
                builtInRules: state.config.tracker.useBuiltIn ? 15 : 0,
                customRules: state.config.tracker.customDomains ? 1 : 0,
                blockedCount: 0,
                blockedDomains: [],
              },
              triggeredFeatures: ["canvas", "user-agent"],
            },
          };
        }
        if (message.type === "add-to-whitelist") {
          state.config.globalWhitelist = "*." + message.domain;
          return {
            success: true,
            changed: true,
            whitelist: state.config.globalWhitelist,
          };
        }
        if (message.type === "remove-from-whitelist") {
          state.config.globalWhitelist = "";
          return { success: true, changed: true, whitelist: "" };
        }
        if (message.type === "prepare-proxy-profile") {
          const profile = message.profile;
          const host = String(profile.host || "").trim();
          const port = Number.parseInt(profile.port, 10);
          if (
            !host ||
            /\\s/.test(host) ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
          ) {
            return { success: false, error: "Invalid proxy profile" };
          }
          return {
            success: true,
            profile: {
              name: String(profile.name || "").trim() || "Proxy " + host,
              host,
              port,
              scheme: profile.scheme,
              ...(profile.location ? { location: profile.location } : {}),
            },
          };
        }
        if (message.type === "get-sessions") {
          return {
            success: true,
            sessions: structuredClone(state.sessions),
            activeSessionId: state.activeSessionId,
          };
        }
        if (message.type === "save-session") {
          const session = {
            id: "session-" + (state.sessions.length + 1),
            name: message.name || "Saved Session",
            domain: message.hostname,
            createdAt: Date.now(),
            lastUsed: Date.now(),
          };
          state.sessions.push(session);
          state.activeSessionId = session.id;
          return { success: true, session: structuredClone(session) };
        }
        if (message.type === "rename-session") {
          const session = state.sessions.find(
            (entry) => entry.id === message.sessionId,
          );
          session.name = message.name;
          return { success: true, session: structuredClone(session) };
        }
        if (message.type === "delete-session") {
          state.sessions = state.sessions.filter(
            (entry) => entry.id !== message.sessionId,
          );
          if (state.activeSessionId === message.sessionId)
            state.activeSessionId = null;
          return { success: true };
        }
        if (message.type === "switch-session") {
          state.activeSessionId = message.sessionId;
          return { success: true };
        }
        if (message.type === "clear-current-session") {
          state.activeSessionId = null;
          return { success: true };
        }
        return {
          success: false,
          error: "Unsupported test message: " + message.type,
        };
      }

      const fakeChrome = {
        runtime: {
          lastError: null,
          sendMessage(message, callback) {
            queueMicrotask(() => callback(responseFor(message)));
          },
          getURL(path) {
            return path;
          },
          openOptionsPage() {
            state.openedOptions++;
          },
        },
        tabs: {
          query(details, callback) {
            if (state.failTabQuery) {
              fakeChrome.runtime.lastError = { message: "Tab query failed" };
              callback([]);
              fakeChrome.runtime.lastError = null;
              return;
            }
            callback(
              mockOptions.tabUrl
                ? [{ id: 1, url: mockOptions.tabUrl, active: true }]
                : [],
            );
          },
          get(tabId, callback) {
            callback(
              mockOptions.tabUrl
                ? { id: tabId, url: mockOptions.tabUrl, active: true }
                : null,
            );
          },
          reload(tabId, options, callback) {
            if (typeof options === "function") callback = options;
            state.reloads++;
            if (state.failReload) {
              fakeChrome.runtime.lastError = { message: "Tab reload failed" };
            }
            if (callback) callback();
            fakeChrome.runtime.lastError = null;
          },
          create(details) {
            state.createdTabs.push(details);
          },
          sendMessage(tabId, message, options, callback) {
            if (typeof options === "function") callback = options;
            callback(
              message.type === "run-self-test"
                ? {
                    success: true,
                    snapshot: {
                      hostname: "www.example.com",
                      userAgent: "Protected test agent",
                      language: state.config.language.preset,
                      languages: [state.config.language.preset, "en"],
                      intlLocale: state.config.language.preset,
                      timeZone: state.config.timezone.name,
                    },
                  }
                : { success: false, error: "Unsupported tab message" },
            );
          },
        },
      };
      Object.assign(window.chrome, fakeChrome);
      window.confirm = () => true;
      window.prompt = (message, value) => value || "Renamed Session";
    }.toString()})(${JSON.stringify(config)}, ${JSON.stringify({
      tabUrl: "https://www.example.com/account",
      ...options,
    })});
  `;
}

async function startServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const isChild = request.url === "/child";
    response.end(`<!doctype html>
      <html>
        <head>
          <script>${protectionSources}
            window.__sgHarnessReady = true;
          </script>
        </head>
        <body>
          ${
            isChild
              ? '<canvas id="child-canvas" width="2" height="2"></canvas>'
              : '<iframe id="child" src="/child"></iframe>'
          }
        </body>
      </html>`);
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  return {
    port: server.address().port,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

async function exerciseProtections(page) {
  return page.evaluate(async () => {
    const originalRandom = Math.random;
    Math.random = () => 0.65;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      context.fillStyle = "rgb(10, 20, 30)";
      context.fillRect(0, 0, 2, 2);
      const nativeCanvasData = Array.from(
        window.__sgNativeGetImageData.call(
          context,
          0,
          0,
          1,
          1,
        ).data,
      );
      const canvasData = Array.from(context.getImageData(0, 0, 1, 1).data);
      const nativeDataUrl = window.__sgNativeCanvasToDataURL.call(canvas);
      const protectedDataUrl = canvas.toDataURL();
      const readBlob = (method) =>
        new Promise((resolvePromise) =>
          method.call(canvas, async (blob) =>
            resolvePromise(Array.from(new Uint8Array(await blob.arrayBuffer()))),
          ),
        );
      const nativeBlob = await readBlob(window.__sgNativeCanvasToBlob);
      const protectedBlob = await readBlob(canvas.toBlob);

      let offscreenResult = null;
      if (window.__sgNativeOffscreen) {
        const offscreen = new OffscreenCanvas(2, 2);
        const offscreenContext = offscreen.getContext("2d");
        offscreenContext.fillStyle = "rgb(10, 20, 30)";
        offscreenContext.fillRect(0, 0, 2, 2);
        const nativeOffscreenData = Array.from(
          window.__sgNativeOffscreen.getImageData.call(
            offscreenContext,
            0,
            0,
            1,
            1,
          ).data,
        );
        const offscreenData = Array.from(
          offscreenContext.getImageData(0, 0, 1, 1).data,
        );
        const nativeOffscreenBlob = Array.from(
          new Uint8Array(
            await (
              await window.__sgNativeOffscreen.convertToBlob.call(offscreen)
            ).arrayBuffer(),
          ),
        );
        const protectedOffscreenBlob = Array.from(
          new Uint8Array(await (await offscreen.convertToBlob()).arrayBuffer()),
        );
        offscreenResult = {
          nativeData: nativeOffscreenData,
          protectedData: offscreenData,
          nativeBlob: nativeOffscreenBlob,
          protectedBlob: protectedOffscreenBlob,
        };
      }

      const webglCanvas = document.createElement("canvas");
      webglCanvas.width = 16;
      webglCanvas.height = 16;
      const gl = webglCanvas.getContext("webgl");
      if (!gl) throw new Error("WebGL context unavailable");
      const webglVendor = gl.getParameter(7936);
      const repeatedWebglVendor = gl.getParameter(7936);
      const webglRenderer = gl.getParameter(7937);
      const webglVersion = gl.getParameter(7938);
      const webglShadingLanguage = gl.getParameter(35724);
      const nativeWebglVersion = window.__sgNativeWebGL.getParameter.call(
        gl,
        7938,
      );
      const nativeWebglShadingLanguage =
        window.__sgNativeWebGL.getParameter.call(gl, 35724);
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const nativeDebugInfo = window.__sgNativeWebGL.getExtension.call(
        gl,
        "WEBGL_debug_renderer_info",
      );
      const nativeWebglExtensions =
        window.__sgNativeWebGL.getSupportedExtensions.call(gl);
      const webglExtensions = gl.getSupportedExtensions();
      const repeatedWebglExtensions = gl.getSupportedExtensions();
      const unmaskedVendor = gl.getParameter(
        debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : 37445,
      );
      const unmaskedRenderer = gl.getParameter(
        debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : 37446,
      );
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const repeatedMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const nativeMaxTextureSize = window.__sgNativeWebGL.getParameter.call(
        gl,
        gl.MAX_TEXTURE_SIZE,
      );
      const precision = gl.getShaderPrecisionFormat(
        gl.FRAGMENT_SHADER,
        gl.HIGH_FLOAT,
      );
      const nativePrecision =
        window.__sgNativeWebGL.getShaderPrecisionFormat.call(
          gl,
          gl.FRAGMENT_SHADER,
          gl.HIGH_FLOAT,
        );
      const precisionValues = [
        precision.rangeMin,
        precision.rangeMax,
        precision.precision,
      ];
      const nativePrecisionValues = [
        nativePrecision.rangeMin,
        nativePrecision.rangeMax,
        nativePrecision.precision,
      ];
      gl.clearColor(0.2, 0.4, 0.6, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const nativeWebglDataUrl = window.__sgNativeCanvasToDataURL.call(webglCanvas);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const protectedWebglDataUrl = webglCanvas.toDataURL();
      gl.clear(gl.COLOR_BUFFER_BIT);
      const repeatedWebglDataUrl = webglCanvas.toDataURL();
      const nativeWebglPixels = new Uint8Array(4);
      window.__sgNativeWebGL.readPixels.call(
        gl,
        0,
        0,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        nativeWebglPixels,
      );
      const webglPixels = new Uint8Array(4);
      const repeatedWebglPixels = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, webglPixels);
      gl.readPixels(
        0,
        0,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        repeatedWebglPixels,
      );
      const webglError = gl.getError();

      const webgl2Canvas = document.createElement("canvas");
      webgl2Canvas.width = 1;
      webgl2Canvas.height = 1;
      const gl2 = webgl2Canvas.getContext("webgl2");
      if (!gl2) throw new Error("WebGL 2 context unavailable");
      const webgl2Vendor = gl2.getParameter(7936);
      const webgl2Version = gl2.getParameter(7938);
      const webgl2ShadingLanguage = gl2.getParameter(35724);
      const nativeWebgl2Version = window.__sgNativeWebGL2.getParameter.call(
        gl2,
        7938,
      );
      const nativeWebgl2ShadingLanguage =
        window.__sgNativeWebGL2.getParameter.call(gl2, 35724);
      gl2.clearColor(0.2, 0.4, 0.6, 1);
      gl2.clear(gl2.COLOR_BUFFER_BIT);
      const nativeWebgl2Pixels = new Uint8Array(4);
      window.__sgNativeWebGL2.readPixels.call(
        gl2,
        0,
        0,
        1,
        1,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        nativeWebgl2Pixels,
      );
      const webgl2Pixels = new Uint8Array(4);
      const repeatedWebgl2Pixels = new Uint8Array(4);
      gl2.readPixels(0, 0, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, webgl2Pixels);
      gl2.readPixels(
        0,
        0,
        1,
        1,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        repeatedWebgl2Pixels,
      );

      const span = document.createElement("span");
      span.style.cssText = "display:inline-block;width:123px;font:16px Arial";
      span.textContent = "fingerprint";
      document.body.appendChild(span);
      const nativeFontWidth = window.__sgNativeOffsetWidth.call(span);
      const fontWidth = span.offsetWidth;
      const nativeMeasuredWidth = window.__sgNativeMeasureText.call(
        context,
        "fingerprint",
      ).width;
      const metrics = context.measureText("fingerprint");
      const measuredWidth = metrics.width;

      const stableFontProbe = document.createElement("span");
      stableFontProbe.style.cssText = "display:inline-block;font:16px Arial";
      stableFontProbe.textContent = "fingerprint";
      document.body.appendChild(stableFontProbe);
      const savedFontRandom = Math.random;
      const fontRandomSequence = [0.65, 0.65, 0.1];
      let fontRandomIndex = 0;
      Math.random = () =>
        fontRandomSequence[fontRandomIndex++] ?? fontRandomSequence.at(-1);
      const stableFontReads = [
        stableFontProbe.offsetWidth,
        stableFontProbe.offsetWidth,
      ];
      Math.random = savedFontRandom;

      const mismatchedFont = /Mac|iPhone/.test(navigator.platform)
        ? "Segoe UI"
        : "Avenir";
      const mismatchedFontProbe = document.createElement("span");
      mismatchedFontProbe.style.cssText =
        `display:inline-block;font:16px "${mismatchedFont}",sans-serif`;
      mismatchedFontProbe.textContent = "fingerprint";
      document.body.appendChild(mismatchedFontProbe);
      const fallbackFontProbe = document.createElement("span");
      fallbackFontProbe.style.cssText =
        "display:inline-block;font:16px sans-serif";
      fallbackFontProbe.textContent = "fingerprint";
      document.body.appendChild(fallbackFontProbe);
      const mismatchedFontWidth = mismatchedFontProbe.offsetWidth;
      const fallbackFontWidth = fallbackFontProbe.offsetWidth;

      const winterDate = new Date("2026-01-15T12:00:00Z");
      const summerDate = new Date("2026-07-15T12:00:00Z");
      const winterTimezoneOffset = winterDate.getTimezoneOffset();
      const summerTimezoneOffset = summerDate.getTimezoneOffset();
      const winterHour = winterDate.getHours();
      const summerHour = summerDate.getHours();
      const setterDate = new Date("2026-01-15T12:00:00Z");
      setterDate.setHours(15);
      setterDate.setSeconds(30);
      setterDate.setMilliseconds(250);
      const resolvedTimezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      const rect = new DOMRect(1, 2, 3, 4);
      const rectValues = [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.top,
        rect.right,
        rect.bottom,
        rect.left,
      ];

      const gpuLimit = new GPUAdapter().limits.maxBufferSize;
      const encoder = new GPUCommandEncoder();
      const renderPassDescriptor = {
        colorAttachments: [{ clearValue: { r: 1, g: 1, b: 1, a: 1 } }],
      };
      encoder.beginRenderPass(renderPassDescriptor);
      const queue = new GPUQueue();
      const gpuInput = new Uint8Array([10, 20, 30, 40]);
      queue.writeBuffer({}, 0, gpuInput);

      const offline = new OfflineAudioContext(1, 128, 44100);
      const audioBuffer = offline.createBuffer(1, 128, 44100);
      const audioData = audioBuffer.getChannelData(0);
      const audioSample = audioData[0];
      const repeatedAudioSample = audioBuffer.getChannelData(0)[0];
      const copyBuffer = offline.createBuffer(1, 128, 44100);
      copyBuffer.copyToChannel(new Float32Array(128).fill(0.25), 0);
      const nativeCopiedAudio = new Float32Array(128);
      const copiedAudio = new Float32Array(128);
      window.__sgNativeAudio.copyFromChannel.call(
        copyBuffer,
        nativeCopiedAudio,
        0,
      );
      copyBuffer.copyFromChannel(copiedAudio, 0);
      const analyser = offline.createAnalyser();
      const nativeByteTimeDomain = new Uint8Array(analyser.frequencyBinCount);
      const byteTimeDomain = new Uint8Array(analyser.frequencyBinCount);
      window.__sgNativeAudio.getByteTimeDomainData.call(
        analyser,
        nativeByteTimeDomain,
      );
      analyser.getByteTimeDomainData(byteTimeDomain);

      const userAgent = navigator.userAgent;
      const language = navigator.language;
      const languages = Array.from(navigator.languages);
      const intlLocale = new Intl.NumberFormat().resolvedOptions().locale;
      const explicitIntlLocale = new Intl.NumberFormat("de-DE")
        .resolvedOptions()
        .locale;
      const navigatorValues = {
        platform: navigator.platform,
        appVersion: navigator.appVersion,
        vendor: navigator.vendor,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        maxTouchPoints: navigator.maxTouchPoints,
      };
      const peer = new RTCPeerConnection();
      peer.close();
      class DerivedPeerConnection extends RTCPeerConnection {}
      const derivedPeer = new DerivedPeerConnection();
      const derivedPeerWorks =
        derivedPeer instanceof DerivedPeerConnection &&
        derivedPeer instanceof RTCPeerConnection;
      derivedPeer.close();

      const workerSnapshot = `
        function snapshot() {
          const values = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            appVersion: navigator.appVersion,
            vendor: navigator.vendor,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            maxTouchPoints: navigator.maxTouchPoints,
            language: navigator.language,
            languages: Array.from(navigator.languages || []),
            timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date("2026-01-15T12:00:00Z").getTimezoneOffset(),
            webgl: null,
          };
          try {
            const canvas = new OffscreenCanvas(1, 1);
            const gl = canvas.getContext("webgl");
            if (gl) {
              const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
              values.webgl = {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                unmaskedVendor: gl.getParameter(
                  debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : 37445,
                ),
                unmaskedRenderer: gl.getParameter(
                  debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : 37446,
                ),
              };
            }
          } catch (error) {}
          return values;
        }
        self.onmessage = () => self.postMessage(snapshot());
      `;
      const readDedicatedWorker = () =>
        new Promise((resolvePromise, rejectPromise) => {
          const url = URL.createObjectURL(
            new Blob([workerSnapshot], { type: "application/javascript" }),
          );
          const worker = new Worker(url);
          const timeout = setTimeout(() => {
            worker.terminate();
            URL.revokeObjectURL(url);
            rejectPromise(new Error("Dedicated worker test timed out"));
          }, 2000);
          worker.onmessage = (event) => {
            clearTimeout(timeout);
            worker.terminate();
            URL.revokeObjectURL(url);
            resolvePromise(event.data);
          };
          worker.onerror = (event) => {
            clearTimeout(timeout);
            worker.terminate();
            URL.revokeObjectURL(url);
            rejectPromise(new Error(event.message || "Dedicated worker failed"));
          };
          worker.postMessage("snapshot");
        });
      const readSharedWorker = () =>
        typeof SharedWorker === "undefined"
          ? null
          : new Promise((resolvePromise, rejectPromise) => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    workerSnapshot.replace(
                      "self.onmessage = () => self.postMessage(snapshot());",
                      "self.onconnect = (event) => {\n  const port = event.ports[0];\n  port.onmessage = () => port.postMessage(snapshot());\n  port.start();\n};",
                    ),
                  ],
                  { type: "application/javascript" },
                ),
              );
              const worker = new SharedWorker(url, {
                name: "stealth-guard-worker-test",
              });
              const timeout = setTimeout(() => {
                URL.revokeObjectURL(url);
                rejectPromise(new Error("Shared worker test timed out"));
              }, 2000);
              worker.port.onmessage = (event) => {
                clearTimeout(timeout);
                worker.port.close();
                URL.revokeObjectURL(url);
                resolvePromise(event.data);
              };
              worker.port.onmessageerror = () => {
                clearTimeout(timeout);
                worker.port.close();
                URL.revokeObjectURL(url);
                rejectPromise(new Error("Shared worker failed"));
              };
              worker.port.start();
              worker.port.postMessage("snapshot");
            });
      const workerValues = {
        dedicated: await readDedicatedWorker(),
        shared: await readSharedWorker(),
      };

      window.postMessage(
        { channel: "guessed", token: "guessed", feature: "forged" },
        "*",
      );

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      return {
        nativeCanvasData,
        canvasData,
        nativeDataUrl,
        protectedDataUrl,
        nativeBlob,
        protectedBlob,
        offscreenResult,
        webglVendor,
        repeatedWebglVendor,
        webglRenderer,
        webglVersion,
        webglShadingLanguage,
        nativeWebglVersion,
        nativeWebglShadingLanguage,
        unmaskedVendor,
        unmaskedRenderer,
        debugExtensionPreserved: Boolean(debugInfo) === Boolean(nativeDebugInfo),
        nativeWebglExtensions,
        webglExtensions,
        repeatedWebglExtensions,
        maxTextureSize,
        repeatedMaxTextureSize,
        nativeMaxTextureSize,
        precisionValues,
        nativePrecisionValues,
        precisionIsNative: precision instanceof WebGLShaderPrecisionFormat,
        nativeWebglDataUrl,
        protectedWebglDataUrl,
        repeatedWebglDataUrl,
        nativeWebglPixels: Array.from(nativeWebglPixels),
        webglPixels: Array.from(webglPixels),
        repeatedWebglPixels: Array.from(repeatedWebglPixels),
        webglError,
        webgl2Vendor,
        webgl2Version,
        webgl2ShadingLanguage,
        nativeWebgl2Version,
        nativeWebgl2ShadingLanguage,
        nativeWebgl2Pixels: Array.from(nativeWebgl2Pixels),
        webgl2Pixels: Array.from(webgl2Pixels),
        repeatedWebgl2Pixels: Array.from(repeatedWebgl2Pixels),
        nativeFontWidth,
        fontWidth,
        nativeMeasuredWidth,
        measuredWidth,
        stableFontReads,
        mismatchedFontWidth,
        fallbackFontWidth,
        metricsAreNative: metrics instanceof TextMetrics,
        winterTimezoneOffset,
        summerTimezoneOffset,
        winterHour,
        summerHour,
        setterIso: setterDate.toISOString(),
        resolvedTimezone,
        datePrototypeClean:
          !("_date" in Date.prototype) && !("_offset" in Date.prototype),
        rectValues,
        gpuLimit,
        originalClearValue: renderPassDescriptor.colorAttachments[0].clearValue.r,
        receivedClearValue:
          window.__sgRenderPassDescriptor.colorAttachments[0].clearValue.r,
        gpuInput: Array.from(gpuInput),
        receivedGpuInput: Array.from(window.__sgWriteBufferArgs[2]),
        audioSample,
        repeatedAudioSample,
        nativeCopiedAudio: Array.from(nativeCopiedAudio.slice(0, 2)),
        copiedAudio: Array.from(copiedAudio.slice(0, 2)),
        nativeByteTimeDomain: Array.from(nativeByteTimeDomain.slice(0, 2)),
        byteTimeDomain: Array.from(byteTimeDomain.slice(0, 2)),
        userAgent,
        language,
        languages,
        intlLocale,
        explicitIntlLocale,
        navigatorValues,
        workerValues,
        nativeUserAgent: window.__sgNativeUserAgent,
        derivedPeerWorks,
        descriptorsPreserved: [
          ["userAgent", Navigator.prototype, "userAgent"],
          ["language", Navigator.prototype, "language"],
          ["languages", Navigator.prototype, "languages"],
          [
            "hardwareConcurrency",
            Navigator.prototype,
            "hardwareConcurrency",
          ],
          ["offsetWidth", HTMLElement.prototype, "offsetWidth"],
          ["webglGetParameter", WebGLRenderingContext.prototype, "getParameter"],
          ["webglGetExtension", WebGLRenderingContext.prototype, "getExtension"],
          ["webglReadPixels", WebGLRenderingContext.prototype, "readPixels"],
        ].every(([name, owner, property]) => {
          const before = window.__sgNativeDescriptors[name];
          const after = Object.getOwnPropertyDescriptor(owner, property);
          return (
            before.configurable === after.configurable &&
            before.writable === after.writable &&
            before.enumerable === after.enumerable
          );
        }),
        reports: window.__sgReports
          .filter((message) => message.type === "fingerprint-detected")
          .map((message) => message.feature),
      };
    } finally {
      Math.random = originalRandom;
    }
  });
}

async function testProtectionRuntime(browser, port) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: protectionInitScript(TEST_COMPATIBILITY_CONFIG),
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error("Protection page error:", error),
  );
  await page.goto(`http://site.test:${port}/`);
  await page.waitForFunction(() => window.__sgHarnessReady === true);
  await page.waitForTimeout(25);

  const windowGeometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
  }));
  assert(windowGeometry.outerWidth > 0);
  assert(windowGeometry.outerHeight > 0);
  assert(windowGeometry.outerWidth >= windowGeometry.innerWidth);
  assert(windowGeometry.outerHeight >= windowGeometry.innerHeight);

  const result = await exerciseProtections(page);
  const features = new Set(result.reports);
  for (const feature of [
    "canvas",
    "webgl",
    "font",
    "timezone",
    "language",
    "clientrects",
    "webgpu",
    "audiocontext",
    "user-agent",
    "webrtc",
  ]) {
    assert(
      features.has(feature),
      `Missing browser-level ${feature} alert; received: ${[...features].join(", ")}`,
    );
  }
  assert.notEqual(result.userAgent, result.nativeUserAgent);
  assert.equal(result.language, DEFAULT_CONFIG.language.preset);
  assert.deepEqual(result.languages, [DEFAULT_CONFIG.language.preset, "en"]);
  assert.equal(result.intlLocale, DEFAULT_CONFIG.language.preset);
  assert.equal(result.explicitIntlLocale, "de-DE");
  for (const worker of [
    result.workerValues.dedicated,
    result.workerValues.shared,
  ].filter(Boolean)) {
    assert.equal(worker.userAgent, result.userAgent);
    assert.equal(worker.platform, result.navigatorValues.platform);
    if (worker.appVersion !== undefined) {
      assert.equal(worker.appVersion, result.navigatorValues.appVersion);
    }
    if (worker.vendor !== undefined) {
      assert.equal(worker.vendor, result.navigatorValues.vendor);
    }
    assert.equal(
      worker.hardwareConcurrency,
      result.navigatorValues.hardwareConcurrency,
    );
    assert.equal(worker.deviceMemory, result.navigatorValues.deviceMemory);
    if (worker.maxTouchPoints !== undefined) {
      assert.equal(worker.maxTouchPoints, result.navigatorValues.maxTouchPoints);
    }
    assert.equal(worker.language, result.language);
    assert.deepEqual(worker.languages, result.languages);
    assert.equal(worker.timezone, result.resolvedTimezone);
    assert.equal(worker.timezoneOffset, result.winterTimezoneOffset);
    if (worker.webgl) {
      assert.equal(worker.webgl.vendor, result.webglVendor);
      assert.equal(worker.webgl.renderer, result.webglRenderer);
      assert.equal(worker.webgl.unmaskedVendor, result.unmaskedVendor);
      assert.equal(worker.webgl.unmaskedRenderer, result.unmaskedRenderer);
    }
  }
  assert.deepEqual(result.nativeCanvasData, [10, 20, 30, 255]);
  assert.deepEqual(result.canvasData, [11, 21, 31, 255]);
  assert.notEqual(result.protectedDataUrl, result.nativeDataUrl);
  assert.notDeepEqual(result.protectedBlob, result.nativeBlob);
  if (result.offscreenResult) {
    assert.deepEqual(result.offscreenResult.nativeData, [10, 20, 30, 255]);
    assert.notDeepEqual(
      result.offscreenResult.protectedData,
      result.offscreenResult.nativeData,
    );
    assert.notDeepEqual(
      result.offscreenResult.protectedBlob,
      result.offscreenResult.nativeBlob,
    );
  }
  assert.equal(result.webglVendor, "WebKit");
  assert.equal(result.webglVendor, result.repeatedWebglVendor);
  assert.equal(
    result.webglRenderer,
    "WebKit WebGL",
  );
  assert.equal(result.webglVersion, result.nativeWebglVersion);
  assert.equal(
    result.webglShadingLanguage,
    result.nativeWebglShadingLanguage,
  );
  assert.equal(typeof result.unmaskedVendor, "string");
  assert.equal(typeof result.unmaskedRenderer, "string");
  assert(result.unmaskedVendor.length > 0);
  assert(result.unmaskedRenderer.length > 0);
  assert(!result.unmaskedRenderer.includes("Apple M2"));
  assert(result.debugExtensionPreserved);
  assert.deepEqual(result.webglExtensions, result.repeatedWebglExtensions);
  assert.deepEqual(
    result.webglExtensions.slice().sort(),
    result.nativeWebglExtensions.slice().sort(),
  );
  assert.deepEqual(result.webglExtensions, result.nativeWebglExtensions);
  assert.equal(result.maxTextureSize, result.repeatedMaxTextureSize);
  assert.equal(result.maxTextureSize, result.nativeMaxTextureSize);
  assert.deepEqual(result.precisionValues, result.nativePrecisionValues);
  assert(result.precisionIsNative);
  assert.equal(result.protectedWebglDataUrl, result.nativeWebglDataUrl);
  assert.equal(result.protectedWebglDataUrl, result.repeatedWebglDataUrl);
  assert.deepEqual(result.webglPixels, result.nativeWebglPixels);
  assert.deepEqual(result.webglPixels, result.repeatedWebglPixels);
  assert.equal(result.webglError, 0);
  assert.equal(result.webgl2Vendor, result.webglVendor);
  assert.equal(result.webgl2Version, result.nativeWebgl2Version);
  assert.equal(
    result.webgl2ShadingLanguage,
    result.nativeWebgl2ShadingLanguage,
  );
  assert.deepEqual(result.webgl2Pixels, result.nativeWebgl2Pixels);
  assert.deepEqual(result.webgl2Pixels, result.repeatedWebgl2Pixels);
  assert.equal(result.fontWidth, result.nativeFontWidth + 1);
  assert.equal(result.measuredWidth, result.nativeMeasuredWidth + 1);
  assert.equal(result.stableFontReads[0], result.stableFontReads[1]);
  assert.equal(result.mismatchedFontWidth, result.fallbackFontWidth);
  assert(result.metricsAreNative);
  assert.equal(result.winterTimezoneOffset, -60);
  assert.equal(result.summerTimezoneOffset, -120);
  assert.equal(result.winterHour, 13);
  assert.equal(result.summerHour, 14);
  assert.equal(result.setterIso, "2026-01-15T14:00:30.250Z");
  assert.equal(result.resolvedTimezone, "Europe/Paris");
  assert(result.datePrototypeClean);
  assert.notDeepEqual(result.rectValues, [1, 2, 3, 4, 2, 4, 6, 1]);
  assert.equal(result.gpuLimit, 1022);
  assert.equal(result.originalClearValue, 1);
  assert.equal(result.receivedClearValue, 1);
  assert.deepEqual(result.gpuInput, [10, 20, 30, 40]);
  assert.deepEqual(result.receivedGpuInput, [10, 20, 30, 40]);
  assert(result.audioSample > 0);
  assert.equal(result.repeatedAudioSample, result.audioSample);
  assert.equal(result.nativeCopiedAudio[0], 0.25);
  assert(result.copiedAudio[0] > result.nativeCopiedAudio[0]);
  assert.equal(result.copiedAudio[1], result.nativeCopiedAudio[1]);
  assert.notEqual(result.byteTimeDomain[0], result.nativeByteTimeDomain[0]);
  assert.equal(result.byteTimeDomain[1], result.nativeByteTimeDomain[1]);
  const expectedNavigator = {
    macos: ["MacIntel", "Apple Computer, Inc.", 8, 0],
    macos_chrome: ["MacIntel", "Google Inc.", 8, 0],
    windows: ["Win32", "Google Inc.", 8, 0],
    iphone: ["iPhone", "Apple Computer, Inc.", 6, 5],
    android: ["Linux armv8l", "Google Inc.", 8, 5],
  }[DEFAULT_CONFIG.useragent.preset];
  assert.deepEqual(
    [
      result.navigatorValues.platform,
      result.navigatorValues.vendor,
      result.navigatorValues.hardwareConcurrency,
      result.navigatorValues.maxTouchPoints,
    ],
    expectedNavigator,
  );
  const expectedDeviceMemory = ["macos_chrome", "windows", "android"].includes(
    DEFAULT_CONFIG.useragent.preset,
  )
    ? 8
    : undefined;
  if (result.navigatorValues.deviceMemory !== undefined) {
    assert.equal(result.navigatorValues.deviceMemory, expectedDeviceMemory);
  }
  assert(result.navigatorValues.appVersion.length > 10);
  assert(result.derivedPeerWorks);
  assert(result.descriptorsPreserved);
  assert(!features.has("forged"));

  const selfTest = await page.evaluate(
    () =>
      new Promise((resolvePromise, rejectPromise) => {
        const listener = window.__sgRuntimeListeners.at(-1);
        const timeout = setTimeout(
          () => rejectPromise(new Error("Self-test response timed out")),
          1500,
        );
        const keepOpen = listener(
          { type: "run-self-test" },
          {},
          (response) => {
            clearTimeout(timeout);
            resolvePromise(response);
          },
        );
        if (keepOpen !== true) {
          clearTimeout(timeout);
          rejectPromise(new Error("Self-test message channel closed"));
        }
      }),
  );
  assert.equal(selfTest.success, true);
  assert.equal(selfTest.snapshot.hostname, "site.test");
  assert.equal(selfTest.snapshot.language, DEFAULT_CONFIG.language.preset);
  assert.equal(selfTest.snapshot.intlLocale, DEFAULT_CONFIG.language.preset);
  assert.equal(selfTest.snapshot.timeZone, "Europe/Paris");

  const secondPage = await context.newPage();
  await secondPage.goto(`http://site.test:${port}/`);
  await secondPage.waitForFunction(() => window.__sgHarnessReady === true);
  const rotatedWebgl = await secondPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext("webgl");
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      dataUrl: canvas.toDataURL(),
      extensions: gl.getSupportedExtensions(),
    };
  });
  assert.equal(rotatedWebgl.dataUrl, result.protectedWebglDataUrl);
  assert.deepEqual(rotatedWebgl.extensions, result.webglExtensions);
  await secondPage.close();

  const strictConfig = structuredClone(DEFAULT_CONFIG);
  strictConfig.webgl.compatibilityWhitelist = "";
  strictConfig.gpuProfile = {
    meta: { id: "e2e-combined-gpu", gpu_vendor: "Intel", gpu_family: "Iris" },
    webgl: {
      webgl1: {
        parameters: { MAX_TEXTURE_SIZE: 4096 },
        debug: {
          VENDOR: "Profile WebGL",
          RENDERER: "Profile Renderer",
          VERSION: "Profile WebGL 1.0",
          SHADING_LANGUAGE_VERSION: "Profile GLSL",
          UNMASKED_VENDOR_WEBGL: "Profile Vendor",
          UNMASKED_RENDERER_WEBGL: "Profile Renderer",
        },
      },
    },
    webgpu: {
      available: true,
      info: { vendor: "intel", architecture: "gen-12lp" },
      limits: { maxBufferSize: 512 },
      features: ["texture-compression-bc"],
      preferred_canvas_format: "bgra8unorm",
    },
  };
  const strictWebgl = await page.evaluate(async (strictConfig) => {
    window.__sgUpdateConfig(strictConfig);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const gl = canvas.getContext("webgl");
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const nativeDataUrl = window.__sgNativeCanvasToDataURL.call(canvas);
    const nativeExtensions = window.__sgNativeWebGL.getSupportedExtensions.call(
      gl,
    );
    const nativePixels = new Uint8Array(4);
    window.__sgNativeWebGL.readPixels.call(
      gl,
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      nativePixels,
    );
    const protectedDataUrl = canvas.toDataURL();
    const protectedExtensions = gl.getSupportedExtensions();
    const repeatedProtectedExtensions = gl.getSupportedExtensions();
    const profiledMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const profiledVersion = gl.getParameter(gl.VERSION);
    const profiledGpuLimit = new GPUAdapter().limits.maxBufferSize;
    const protectedPixels = new Uint8Array(4);
    const repeatedProtectedPixels = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, protectedPixels);
    gl.readPixels(
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      repeatedProtectedPixels,
    );
    const worker = await new Promise((resolvePromise, rejectPromise) => {
      const source = `
        self.onmessage = () => {
          const canvas = new OffscreenCanvas(1, 1);
          const gl = canvas.getContext("webgl");
          gl.clearColor(0.2, 0.4, 0.6, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const first = new Uint8Array(4);
          const second = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, first);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, second);
          self.postMessage({
            pixels: Array.from(first),
            repeatedPixels: Array.from(second),
            extensions: gl.getSupportedExtensions(),
            repeatedExtensions: gl.getSupportedExtensions(),
          });
        };
      `;
      const url = URL.createObjectURL(
        new Blob([source], { type: "application/javascript" }),
      );
      const workerHandle = new Worker(url);
      const timeout = setTimeout(() => {
        workerHandle.terminate();
        URL.revokeObjectURL(url);
        rejectPromise(new Error("Strict WebGL worker test timed out"));
      }, 2000);
      workerHandle.onmessage = (event) => {
        clearTimeout(timeout);
        workerHandle.terminate();
        URL.revokeObjectURL(url);
        resolvePromise(event.data);
      };
      workerHandle.onerror = () => {
        clearTimeout(timeout);
        workerHandle.terminate();
        URL.revokeObjectURL(url);
        rejectPromise(new Error("Strict WebGL worker test failed"));
      };
      workerHandle.postMessage("snapshot");
    });
    return {
      nativeDataUrl,
      protectedDataUrl,
      nativeExtensions,
      protectedExtensions,
      repeatedProtectedExtensions,
      profiledMaxTextureSize,
      profiledVersion,
      profiledGpuLimit,
      nativePixels: Array.from(nativePixels),
      protectedPixels: Array.from(protectedPixels),
      repeatedProtectedPixels: Array.from(repeatedProtectedPixels),
      worker,
    };
  }, strictConfig);
  assert.notEqual(strictWebgl.protectedDataUrl, strictWebgl.nativeDataUrl);
  assert.deepEqual(
    strictWebgl.protectedExtensions,
    strictWebgl.repeatedProtectedExtensions,
  );
  assert.equal(strictWebgl.profiledMaxTextureSize, 4096);
  assert.equal(strictWebgl.profiledVersion, "Profile WebGL 1.0");
  assert.equal(strictWebgl.profiledGpuLimit, 512);
  assert.notDeepEqual(
    strictWebgl.protectedPixels,
    strictWebgl.nativePixels,
  );
  assert.deepEqual(
    strictWebgl.protectedPixels,
    strictWebgl.repeatedProtectedPixels,
  );
  assert.notDeepEqual(strictWebgl.worker.pixels, [51, 102, 153, 255]);
  assert.deepEqual(strictWebgl.worker.pixels, strictWebgl.worker.repeatedPixels);
  assert.deepEqual(
    strictWebgl.worker.extensions,
    strictWebgl.worker.repeatedExtensions,
  );
  await page.evaluate((nextConfig) => {
    window.__sgUpdateConfig(nextConfig);
  }, DEFAULT_CONFIG);

  const updatedRuntime = await page.evaluate(async (nextConfig) => {
    window.__sgUpdateConfig(nextConfig);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const gl = document.createElement("canvas").getContext("webgl");
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const userAgentData = navigator.userAgentData;
    const highEntropyValues = userAgentData
      ? await userAgentData.getHighEntropyValues([
          "architecture",
          "bitness",
          "formFactors",
          "fullVersionList",
          "model",
          "platformVersion",
          "uaFullVersion",
          "wow64",
        ])
      : null;
    return {
      userAgent: navigator.userAgent,
      oscpu: navigator.oscpu,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgentData: userAgentData
        ? {
            lowEntropyValues: userAgentData.toJSON(),
            highEntropyValues,
            brandsAreStable: userAgentData.brands === userAgentData.brands,
            brandsAreFrozen: Object.isFrozen(userAgentData.brands),
            highEntropyMethodIsStable:
              userAgentData.getHighEntropyValues ===
              userAgentData.getHighEntropyValues,
            toJSONMethodIsStable: userAgentData.toJSON === userAgentData.toJSON,
          }
        : null,
      offset: new Date("2026-01-15T12:00:00Z").getTimezoneOffset(),
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      languages: Array.from(navigator.languages),
      intlLocale: new Intl.NumberFormat().resolvedOptions().locale,
      webglRenderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
      webglVersion: gl.getParameter(gl.VERSION),
    };
  }, {
    ...DEFAULT_CONFIG,
    useragent: { ...DEFAULT_CONFIG.useragent, preset: "android" },
    language: { ...DEFAULT_CONFIG.language, preset: "ja-JP" },
    timezone: {
      ...DEFAULT_CONFIG.timezone,
      name: "Asia/Tokyo",
    },
  });
  assert(updatedRuntime.userAgent.includes("Android 10; K"));
  if (updatedRuntime.oscpu !== undefined) {
    assert(updatedRuntime.oscpu.includes("Android 10"));
  }
  assert.equal(updatedRuntime.hardwareConcurrency, 8);
  if (updatedRuntime.deviceMemory !== undefined) {
    assert.equal(updatedRuntime.deviceMemory, 8);
  }
  assert.equal(updatedRuntime.maxTouchPoints, 5);
  const updatedWorker = await page.evaluate(
    () =>
      new Promise((resolvePromise, rejectPromise) => {
        const source = `
          self.onmessage = () => {
            const canvas = new OffscreenCanvas(1, 1);
            const gl = canvas.getContext("webgl");
            const debugInfo = gl && gl.getExtension("WEBGL_debug_renderer_info");
            self.postMessage({
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              hardwareConcurrency: navigator.hardwareConcurrency,
              deviceMemory: navigator.deviceMemory,
              maxTouchPoints: navigator.maxTouchPoints,
              language: navigator.language,
              languages: Array.from(navigator.languages || []),
              timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
              timezoneOffset: new Date("2026-01-15T12:00:00Z").getTimezoneOffset(),
              webglRenderer: gl && debugInfo
                ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                : null,
            });
          };
        `;
        const url = URL.createObjectURL(
          new Blob([source], { type: "application/javascript" }),
        );
        const worker = new Worker(url);
        const timeout = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(url);
          rejectPromise(new Error("Updated worker test timed out"));
        }, 2000);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(url);
          resolvePromise(event.data);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(url);
          rejectPromise(new Error("Updated worker test failed"));
        };
        worker.postMessage("snapshot");
      }),
  );
  assert(updatedWorker.userAgent.includes("Android 10; K"));
  assert.equal(updatedWorker.platform, "Linux armv8l");
  assert.equal(updatedWorker.hardwareConcurrency, 8);
  if (updatedWorker.deviceMemory !== undefined) {
    assert.equal(updatedWorker.deviceMemory, 8);
  }
  if (updatedWorker.maxTouchPoints !== undefined) {
    assert.equal(updatedWorker.maxTouchPoints, 5);
  }
  assert.equal(updatedWorker.language, "ja-JP");
  assert.deepEqual(updatedWorker.languages, ["ja-JP", "ja", "en"]);
  assert.equal(updatedWorker.timezone, "Asia/Tokyo");
  assert.equal(updatedWorker.timezoneOffset, -540);
  assert(updatedWorker.webglRenderer.includes("Adreno (TM) 640"));
  if (updatedRuntime.userAgentData) {
    const {
      brandsAreFrozen,
      brandsAreStable,
      highEntropyMethodIsStable,
      highEntropyValues,
      lowEntropyValues,
      toJSONMethodIsStable,
    } = updatedRuntime.userAgentData;
    assert(brandsAreFrozen);
    assert(brandsAreStable);
    assert(highEntropyMethodIsStable);
    assert(toJSONMethodIsStable);
    assert.equal(lowEntropyValues.mobile, true);
    assert.equal(lowEntropyValues.platform, "Android");
    assert(
      lowEntropyValues.brands.some(
        (entry) => entry.brand === "Google Chrome" && entry.version === "131",
      ),
    );
    assert.equal(highEntropyValues.architecture, "arm");
    assert.equal(highEntropyValues.bitness, "64");
    assert.deepEqual(highEntropyValues.formFactors, ["Mobile"]);
    assert.equal(highEntropyValues.model, "K");
    assert.equal(highEntropyValues.platformVersion, "10.0.0");
    assert.equal(highEntropyValues.uaFullVersion, "131.0.0.0");
    assert.equal(highEntropyValues.wow64, false);
    assert(
      highEntropyValues.fullVersionList.some(
        (entry) =>
          entry.brand === "Google Chrome" && entry.version === "131.0.0.0",
      ),
    );
  }
  assert.equal(updatedRuntime.offset, -540);
  assert.equal(updatedRuntime.timezone, "Asia/Tokyo");
  assert.equal(updatedRuntime.language, "ja-JP");
  assert.deepEqual(updatedRuntime.languages, ["ja-JP", "ja", "en"]);
  assert.equal(updatedRuntime.intlLocale, "ja-JP");
  assert(updatedRuntime.webglRenderer.includes("Adreno (TM) 640"));
  assert(updatedRuntime.webglVersion.includes("Chromium"));

  const webglIdentityCases = [
    {
      name: "macOS Safari",
      userAgentPreset: "macos",
      webglPreset: "auto",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Apple Inc. (WebKit)",
        unmaskedRenderer: "Apple GPU",
      },
    },
    {
      name: "macOS Chrome",
      userAgentPreset: "macos_chrome",
      webglPreset: "auto",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Apple)",
        unmaskedRenderer: "ANGLE (Apple,",
      },
    },
    {
      name: "Windows Edge",
      userAgentPreset: "windows",
      webglPreset: "auto",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Intel)",
        unmaskedRenderer: "Direct3D11",
      },
    },
    {
      name: "iPhone Safari",
      userAgentPreset: "iphone",
      webglPreset: "auto",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Apple Inc. (WebKit)",
        unmaskedRenderer: "Apple GPU",
      },
    },
    {
      name: "Android Chrome",
      userAgentPreset: "android",
      webglPreset: "auto",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Qualcomm)",
        unmaskedRenderer: "Adreno (TM) 640",
      },
    },
    {
      name: "Safari rejects Windows GPU",
      userAgentPreset: "macos",
      webglPreset: "surface_pro_7",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Apple Inc. (WebKit)",
        unmaskedRenderer: "Apple GPU",
      },
    },
    {
      name: "Windows rejects Apple GPU",
      userAgentPreset: "windows",
      webglPreset: "apple",
      expected: {
        vendor: "WebKit",
        renderer: "WebKit WebGL",
        unmaskedVendor: "Google Inc. (WebKit, Intel)",
        unmaskedRenderer: "Direct3D11",
      },
    },
  ];
  const webglIdentityResults = await page.evaluate(async (cases) => {
    const results = [];
    for (const testCase of cases) {
      window.__sgUpdateConfig(testCase.config);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const gl2 = document.createElement("canvas").getContext("webgl2");
      const debugInfo2 = gl2.getExtension("WEBGL_debug_renderer_info");
      results.push({
        name: testCase.name,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        unmaskedRenderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
        version: gl.getParameter(gl.VERSION),
        nativeVersion: window.__sgNativeWebGL.getParameter.call(gl, gl.VERSION),
        webgl2Vendor: gl2.getParameter(gl2.VENDOR),
        webgl2Renderer: gl2.getParameter(gl2.RENDERER),
        webgl2Version: gl2.getParameter(gl2.VERSION),
        webgl2UnmaskedVendor: gl2.getParameter(
          debugInfo2.UNMASKED_VENDOR_WEBGL,
        ),
        webgl2UnmaskedRenderer: gl2.getParameter(
          debugInfo2.UNMASKED_RENDERER_WEBGL,
        ),
        nativeWebgl2Version: window.__sgNativeWebGL2.getParameter.call(
          gl2,
          gl2.VERSION,
        ),
      });
    }
    return results;
  }, webglIdentityCases.map((testCase) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.useragent.preset = testCase.userAgentPreset;
    config.webgl.preset = testCase.webglPreset;
    return { ...testCase, config };
  }));
  for (const [index, result] of webglIdentityResults.entries()) {
    const expected = webglIdentityCases[index].expected;
    assert.equal(result.vendor, expected.vendor, result.name);
    assert.equal(result.renderer, expected.renderer, result.name);
    assert.equal(result.unmaskedVendor, expected.unmaskedVendor, result.name);
    assert.equal(
      result.unmaskedRenderer.includes(expected.unmaskedRenderer),
      true,
      result.name,
    );
    assert.equal(result.version, result.nativeVersion, result.name);
    assert.equal(result.webgl2Vendor, result.vendor, result.name);
    assert.equal(result.webgl2Renderer, result.renderer, result.name);
    assert.equal(result.webgl2UnmaskedVendor, result.unmaskedVendor, result.name);
    assert.equal(result.webgl2UnmaskedRenderer, result.unmaskedRenderer, result.name);
    assert.equal(result.webgl2Version, result.nativeWebgl2Version, result.name);
    const creepJsWebglMismatch =
      result.unmaskedVendor &&
      result.unmaskedRenderer &&
      result.vendor &&
      !result.unmaskedVendor.toLowerCase().includes(result.vendor.toLowerCase()) &&
      result.vendor.toLowerCase() !== "google inc.";
    assert.equal(creepJsWebglMismatch, false, result.name);
  }

  const beforeDisable = result.reports.length;
  const disabledState = await page.evaluate(
    async (disabledConfig) => {
      window.__sgUpdateConfig(disabledConfig);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
      const gl = document.createElement("canvas").getContext("webgl");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      return {
        userAgent: navigator.userAgent,
        nativeUserAgent: window.__sgNativeUserAgent,
        language: navigator.language,
        nativeLanguage: window.__sgNativeLanguage,
        languages: Array.from(navigator.languages),
        nativeLanguages: window.__sgNativeLanguages,
        webglVendor: gl.getParameter(gl.VENDOR),
        nativeWebglVendor: window.__sgNativeWebGL.getParameter.call(
          gl,
          gl.VENDOR,
        ),
        reportCount: window.__sgReports.length,
      };
    },
    { ...DEFAULT_CONFIG, enabled: false },
  );
  assert.equal(disabledState.userAgent, disabledState.nativeUserAgent);
  assert.equal(disabledState.language, disabledState.nativeLanguage);
  assert.deepEqual(disabledState.languages, disabledState.nativeLanguages);
  assert.equal(disabledState.webglVendor, disabledState.nativeWebglVendor);
  assert.equal(disabledState.reportCount, beforeDisable);

  const child = page.frames().find((frame) => frame !== page.mainFrame());
  await child.evaluate(() => {
    const canvas = document.getElementById("child-canvas");
    canvas.getContext("2d").getImageData(0, 0, 1, 1);
  });
  await child.waitForTimeout(25);
  assert(
    await child.evaluate(() =>
      window.__sgReports.some((message) => message.feature === "canvas"),
    ),
    "all_frames injection did not protect the child frame",
  );
  await context.close();

  const synchronizedConfig = structuredClone(DEFAULT_CONFIG);
  synchronizedConfig.proxy = {
    ...synchronizedConfig.proxy,
    enabled: true,
    routingMode: "protect-all",
    activeProfile: "Tokyo",
    bypassList: [],
    profiles: [
      {
        name: "Tokyo",
        host: "proxy.test",
        port: 443,
        scheme: "https",
        location: {
          city: "Tokyo",
          region: "Tokyo",
          country: "Japan",
          countryCode: "JP",
          loc: "35.6762,139.6503",
          org: "",
          timezone: "Asia/Tokyo",
          source: "test",
        },
      },
    ],
  };
  const locationContext = await browser.newContext();
  await locationContext.addInitScript({
    content: protectionInitScript(synchronizedConfig),
  });
  const locationPage = await locationContext.newPage();
  await locationPage.goto(`http://site.test:${port}/`);
  await locationPage.waitForFunction(() => window.__sgHarnessReady === true);
  await locationPage.waitForTimeout(40);
  const synchronizedLocation = await locationPage.evaluate(async (nextConfig) => {
    window.__sgUpdateConfig(nextConfig);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const position = await new Promise((resolvePromise, rejectPromise) =>
      navigator.geolocation.getCurrentPosition(resolvePromise, rejectPromise),
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      reports: window.__sgReports
        .filter((message) => message.type === "fingerprint-detected")
        .map((message) => message.feature),
    };
  }, synchronizedConfig);
  assert.deepEqual(
    [synchronizedLocation.latitude, synchronizedLocation.longitude],
    [35.68, 139.65],
  );
  assert(synchronizedLocation.accuracy >= 2500);
  assert.equal(synchronizedLocation.timezone, "Asia/Tokyo");
  assert(synchronizedLocation.reports.includes("geolocation"));
  await locationContext.close();
}

async function testAllowlistAndChallengeFrames(browser, port) {
  const allowlistedConfig = structuredClone(DEFAULT_CONFIG);
  allowlistedConfig.globalWhitelist = "site.test";
  const allowlistedContext = await browser.newContext();
  await allowlistedContext.addInitScript({
    content: protectionInitScript(allowlistedConfig),
  });
  const allowlistedPage = await allowlistedContext.newPage();
  allowlistedPage.on("pageerror", (error) =>
    console.error("Allowlisted page error:", error),
  );
  await allowlistedPage.goto(`http://site.test:${port}/`);
  await allowlistedPage.waitForTimeout(40);
  const allowlisted = await allowlistedPage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext("2d").getImageData(0, 0, 1, 1);
    const userAgent = navigator.userAgent;
    const gl = document.createElement("canvas").getContext("webgl");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return {
      userAgent,
      nativeUserAgent: window.__sgNativeUserAgent,
      webglVendor: gl.getParameter(gl.VENDOR),
      nativeWebglVendor: window.__sgNativeWebGL.getParameter.call(
        gl,
        gl.VENDOR,
      ),
      reports: window.__sgReports.length,
    };
  });
  assert.equal(allowlisted.userAgent, allowlisted.nativeUserAgent);
  assert.equal(allowlisted.webglVendor, allowlisted.nativeWebglVendor);
  assert.equal(allowlisted.reports, 0);
  await allowlistedContext.close();

  const featureAllowlistedConfig = structuredClone(DEFAULT_CONFIG);
  featureAllowlistedConfig.canvas.whitelist = "site.test";
  featureAllowlistedConfig.webgl.whitelist = "site.test";
  featureAllowlistedConfig.useragent.whitelist = "";
  const featureContext = await browser.newContext();
  await featureContext.addInitScript({
    content: protectionInitScript(featureAllowlistedConfig),
  });
  const featurePage = await featureContext.newPage();
  await featurePage.goto(`http://site.test:${port}/`);
  const featureResult = await featurePage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext("2d").getImageData(0, 0, 1, 1);
    const userAgent = navigator.userAgent;
    const gl = document.createElement("canvas").getContext("webgl");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return {
      userAgent,
      nativeUserAgent: window.__sgNativeUserAgent,
      webglVendor: gl.getParameter(gl.VENDOR),
      nativeWebglVendor: window.__sgNativeWebGL.getParameter.call(
        gl,
        gl.VENDOR,
      ),
      reports: window.__sgReports.map((message) => message.feature),
    };
  });
  assert.equal(featureResult.userAgent === featureResult.nativeUserAgent, false);
  assert.equal(featureResult.webglVendor, featureResult.nativeWebglVendor);
  assert(!featureResult.reports.includes("canvas"));
  assert(!featureResult.reports.includes("webgl"));
  assert(featureResult.reports.includes("user-agent"));
  await featureContext.close();

  const challengeContext = await browser.newContext();
  await challengeContext.addInitScript({
    content: protectionInitScript(DEFAULT_CONFIG),
  });
  await challengeContext.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><script>${protectionSources}</script></head><body></body></html>`,
    }),
  );
  await challengeContext.route("https://geo.captcha-delivery.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><script>${protectionSources}</script></head><body></body></html>`,
    }),
  );
  const challengePage = await challengeContext.newPage();
  challengePage.on("pageerror", (error) =>
    console.error("Challenge page error:", error),
  );
  await challengePage.goto("https://challenges.cloudflare.com/");
  await challengePage.waitForTimeout(25);
  const challenge = await challengePage.evaluate(() => ({
    userAgent: navigator.userAgent,
    nativeUserAgent: window.__sgNativeUserAgent,
    reports: window.__sgReports.length,
  }));
  assert.equal(challenge.userAgent, challenge.nativeUserAgent);
  assert.equal(challenge.reports, 0);
  await challengePage.goto("https://geo.captcha-delivery.com/");
  await challengePage.waitForTimeout(25);
  const dataDomeChallenge = await challengePage.evaluate(() => ({
    userAgent: navigator.userAgent,
    nativeUserAgent: window.__sgNativeUserAgent,
    reports: window.__sgReports.length,
  }));
  assert.equal(dataDomeChallenge.userAgent, dataDomeChallenge.nativeUserAgent);
  assert.equal(dataDomeChallenge.reports, 0);
  await challengeContext.close();
}

async function testInvalidatedExtensionContext(browser, port) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: protectionInitScript(DEFAULT_CONFIG),
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://site.test:${port}/`);
  await page.waitForFunction(() => window.__sgHarnessReady === true);

  const invalidatedCalls = await page.evaluate(async () => {
    let calls = 0;
    chrome.runtime.sendMessage = () => {
      calls += 1;
      throw new Error("Extension context invalidated.");
    };
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext("2d").getImageData(0, 0, 1, 1);
    const gl = document.createElement("canvas").getContext("webgl");
    gl.getParameter(gl.VENDOR);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return calls;
  });

  assert.equal(invalidatedCalls, 1);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

async function testCosmeticFilteringAndElementPicker(browser, port) {
  const context = await browser.newContext();
  const pageErrors = [];
  await context.addInitScript({
    content: `
      window.__adblockMessages = [];
      window.__adblockListeners = [];
      Object.assign(window.chrome || (window.chrome = {}), {
        runtime: {
          lastError: null,
          onMessage: {
            addListener(listener) { window.__adblockListeners.push(listener); }
          },
          sendMessage(message, callback) {
            window.__adblockMessages.push(structuredClone(message));
            if (message.type === "get-cosmetic-rules") {
              callback({
                success: true,
                enabled: true,
                selectors: [".ad-banner"],
                youtubeEnhancements: false,
              });
            } else {
              callback({ success: true });
            }
          }
        }
      });
    `,
  });
  await context.route(`http://site.test:${port}/adblock-test`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head></head><body></body></html>",
    }),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://site.test:${port}/adblock-test`);
  await page.evaluate(() => {
    const ad = document.createElement("div");
    ad.className = "ad-banner";
    ad.textContent = "advertisement";
    const pick = document.createElement("div");
    pick.id = "pick-me";
    pick.textContent = "custom annoyance";
    pick.style.marginTop = "120px";
    document.body.append(ad, pick);
  });
  await page.addScriptTag({ content: adblockContentSources });
  const cosmeticState = await page.evaluate(() => ({
    messages: window.__adblockMessages,
    listeners: window.__adblockListeners.length,
    styles: document.querySelectorAll("style[data-stealth-guard-adblock]").length,
    display: getComputedStyle(document.querySelector(".ad-banner")).display,
  }));
  assert.equal(
    cosmeticState.display,
    "none",
    `Cosmetic filtering did not apply: ${JSON.stringify({ cosmeticState, pageErrors })}`,
  );
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".ad-banner")).display === "none",
  );
  await page.evaluate(() => {
    window.__adblockListeners[0](
      { type: "start-element-picker" },
      {},
      () => {},
    );
  });
  await page.hover("#pick-me");
  await page.click("#pick-me");
  await page.waitForFunction(() =>
    window.__adblockMessages.some(
      (message) =>
        message.type === "add-cosmetic-rule" && message.selector === "#pick-me",
    ),
  );
  await page.waitForTimeout(100);
  const invalidatedCalls = await page.evaluate(async () => {
    let calls = 0;
    chrome.runtime.sendMessage = () => {
      calls += 1;
      throw new Error("Extension context invalidated.");
    };
    const first = document.createElement("div");
    first.className = "new-cosmetic-token";
    document.body.appendChild(first);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
    const second = document.createElement("div");
    second.className = "another-cosmetic-token";
    document.body.appendChild(second);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
    return calls;
  });
  assert.equal(invalidatedCalls, 1);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

async function testYouTubeVideoAdSanitizer(browser) {
  const context = await browser.newContext();
  await context.addInitScript({ content: protectionInitScript(DEFAULT_CONFIG) });
  await context.route("https://www.youtube.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/youtubei/v1/player")) {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          adPlacements: [{ id: "video-ad" }],
          adSlots: [{ id: "slot" }],
          playerAds: [{ id: "player-ad" }],
          videoDetails: { videoId: "content-video" },
          playerResponse: {
            adPlacements: [{ id: "nested-ad" }],
            videoDetails: { videoId: "nested-content" },
          },
        }),
      });
      return;
    }
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><script>${protectionSources}</script></head><body></body></html>`,
    });
  });
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=content-video");
  const result = await page.evaluate(async () => {
    window.ytInitialPlayerResponse = {
      adPlacements: [{ id: "initial-ad" }],
      adSlots: [{ id: "initial-slot" }],
      videoDetails: { videoId: "initial-content" },
    };
    const parsed = JSON.parse(
      JSON.stringify({
        playerAds: [{ id: "parsed-ad" }],
        entries: [
          {
            command: {
              reelWatchEndpoint: { adClientParams: { isAd: true } },
            },
          },
          { command: { reelWatchEndpoint: { videoId: "short-content" } } },
        ],
      }),
    );
    const fetched = await fetch("/youtubei/v1/player?key=test", {
      method: "POST",
    }).then((response) => response.json());
    const xhr = await new Promise((resolvePromise, rejectPromise) => {
      const request = new XMLHttpRequest();
      request.open("GET", "/youtubei/v1/player?key=xhr");
      request.responseType = "json";
      request.timeout = 3000;
      request.onload = () => resolvePromise(request.response);
      request.onerror = rejectPromise;
      request.ontimeout = () => rejectPromise(new Error("YouTube XHR timed out"));
      request.send();
    });

    const player = document.createElement("div");
    player.id = "movie_player";
    player.className = "ad-showing";
    player.getStatsForNerds = () => ({ debug_info: "SSAP, AD segment" });
    player.getProgressState = () => ({ duration: 15, current: 1 });
    player.seekTo = (time) => {
      window.__youtubeSeekTarget = time;
      player.classList.remove("ad-showing");
    };
    document.body.appendChild(player);

    return {
      initial: window.ytInitialPlayerResponse,
      parsed,
      fetched,
      xhr,
    };
  });
  for (const payload of [result.initial, result.fetched, result.xhr]) {
    assert.equal("adPlacements" in payload, false);
    assert.equal("adSlots" in payload, false);
    assert.equal("playerAds" in payload, false);
  }
  assert.equal(result.initial.videoDetails.videoId, "initial-content");
  assert.equal(result.fetched.videoDetails.videoId, "content-video");
  assert.equal("adPlacements" in result.fetched.playerResponse, false);
  assert.equal(result.fetched.playerResponse.videoDetails.videoId, "nested-content");
  assert.equal("playerAds" in result.parsed, false);
  assert.equal(result.parsed.entries.length, 1);
  assert.equal(
    result.parsed.entries[0].command.reelWatchEndpoint.videoId,
    "short-content",
  );
  await page.waitForTimeout(750);
  const playerState = await page.evaluate(() => {
    const player = document.getElementById("movie_player");
    return {
      seekTarget: window.__youtubeSeekTarget,
      className: player && player.className,
      hasStats: Boolean(player && player.getStatsForNerds),
      hasProgress: Boolean(player && player.getProgressState),
      hasSeek: Boolean(player && player.seekTo),
    };
  });
  assert.equal(
    playerState.seekTarget,
    15,
    `YouTube server-side ad fallback did not seek: ${JSON.stringify(playerState)}`,
  );
  const allowlistedConfig = structuredClone(DEFAULT_CONFIG);
  allowlistedConfig.tracker.whitelist = "youtube.com";
  const allowlisted = await page.evaluate((nextConfig) => {
    window.__sgUpdateConfig(nextConfig);
    return JSON.parse('{"adPlacements":[{"id":"allowed"}]}');
  }, allowlistedConfig);
  assert.equal(allowlisted.adPlacements[0].id, "allowed");
  await context.close();
}

async function testPopup(browser) {
  const context = await browser.newContext();
  await context.addInitScript({ content: uiMockInitScript(DEFAULT_CONFIG) });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, "popup/popup.html")).href);
  await page.waitForSelector("#current-url:text-is('example.com')");
  await page.waitForSelector("#tracker-status:text-is('4 blocked')");
  await page.click("#tracker-details-toggle");
  await page.waitForSelector("#tracker-blocked-panel:not([hidden])");
  assert.equal(await page.locator("#tracker-blocked-list li").count(), 2);
  assert.match(await page.textContent("#tracker-blocked-panel"), /ads\.example/);
  assert.match(await page.textContent("#tracker-blocked-panel"), /×3/);
  assert.equal(
    await page.getAttribute("#tracker-details-toggle", "aria-expanded"),
    "true",
  );
  assert.match(
    await page.locator('#timezone-quick-select option[value="Europe/Paris"]').textContent(),
    /^(?:CET|CEST)\/Paris \(GMT\+\d+(?::\d{2})?\)$/,
  );
  const popupUserAgentOptions = await page
    .locator("#useragent-quick-select option")
    .allTextContents();
  assert(popupUserAgentOptions.includes("Windows Edge · Edge 101 (latest)"));
  assert(popupUserAgentOptions.includes("Android Chrome · Chrome 131 (latest)"));
  assert(popupUserAgentOptions.includes("macOS Safari · Safari 26.0 (latest)"));
  assert(popupUserAgentOptions.includes("macOS Safari · Safari 18.4"));
  assert(popupUserAgentOptions.includes("iPhone Safari · iOS 26.0 (latest)"));
  assert.equal(
    popupUserAgentOptions.filter((label) => label.includes("macOS Chrome · Chrome 150")).length,
    1,
  );
  assert.equal(popupUserAgentOptions.some((label) => label.includes("Firefox")), false);
  assert.equal(await page.locator(".identity-diagnostics").count(), 0);
  assert.equal(await page.locator("#toggle-adblock-site").isEnabled(), true);
  assert.equal(await page.locator("#toggle-cosmetic-site").isEnabled(), true);
  assert.equal(await page.locator("#block-element").isEnabled(), true);
  await page.screenshot({ path: join(tmpdir(), "stealth-guard-popup.png") });

  await page.evaluate(() => {
    window.__chromeState.failMessages["update-config"] = "Save denied";
  });
  await setChecked(page, "#canvas-enabled", false);
  await page.waitForFunction(
    () => document.getElementById("canvas-enabled").checked,
  );
  await page.evaluate(() => {
    delete window.__chromeState.failMessages["update-config"];
  });

  await setChecked(page, "#global-enabled", false);
  await page.waitForFunction(() => !window.__chromeState.config.enabled);
  await setChecked(page, "#global-enabled", true);
  await setChecked(page, "#notifications-enabled", true);
  await page.evaluate(() => {
    for (const input of document.querySelectorAll("[data-feature-toggle]")) {
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);
  assert(
    await page.evaluate(() =>
      [
        "proxy",
        "tracker",
        "useragent",
        "language",
        "timezone",
        "geolocation",
        "webrtc",
        "canvas",
        "clientrects",
        "font",
        "audiocontext",
        "webgl",
        "webgpu",
      ].every((feature) => !window.__chromeState.config[feature].enabled),
    ),
  );
  assert(await page.evaluate(() => window.__chromeState.reloads > 0));

  await page.selectOption("#webgl-quick-select", "apple");
  await page.selectOption("#useragent-quick-select", "macos|safari184");
  await page.waitForFunction(
    () =>
      window.__chromeState.config.useragent.preset === "macos" &&
      window.__chromeState.config.useragent.curlProfile === "safari184",
  );
  await page.selectOption("#useragent-quick-select", "android|auto");
  await page.selectOption("#language-quick-select", "sv-SE");
  await page.selectOption("#timezone-quick-select", "Asia/Tokyo");
  await page.waitForFunction(
    () =>
      window.__chromeState.config.webgl.preset === "apple" &&
      window.__chromeState.config.useragent.preset === "android" &&
      window.__chromeState.config.useragent.curlProfile === "auto" &&
      window.__chromeState.config.language.preset === "sv-SE" &&
      window.__chromeState.config.timezone.name === "Asia/Tokyo",
  );

  await page.click("#toggle-current-site");
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.globalWhitelist),
    "*.example.com",
  );
  await page.click("#toggle-current-site");
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.globalWhitelist),
    "",
  );

  await page.click('[data-feature="canvas"] .feature-name');
  await page.click("#open-options");
  await page.click("#open-selftest");
  await page.click("#test-webrtc");
  assert.equal(
    await page.evaluate(() => window.__chromeState.openedOptions),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.__chromeState.createdTabs.length),
    3,
  );
  assert(
    await page.evaluate(() =>
      window.__chromeState.createdTabs.some(
        (entry) =>
          entry.url === "options/options.html?tabId=1#selftest-section",
      ),
    ),
  );

  await page.fill("#session-name-input", "Work");
  await page.click("#save-session");
  await page.waitForSelector(".session-entry-name:text-is('Work')");
  await page.click('button[data-action="switch"]');
  await page.waitForFunction(
    () => window.__chromeState.activeSessionId === "session-1",
  );
  await page.evaluate(() => {
    window.prompt = () => "Personal";
  });
  await page.click('button[data-action="rename"]');
  await page.waitForSelector(".session-entry-name:text-is('Personal')");
  await page.click("#clear-current-session");
  await page.waitForFunction(
    () => window.__chromeState.activeSessionId === null,
  );
  await page.click('button[data-action="delete"]');
  await page.waitForSelector(".session-list-empty");
  await context.close();

  const noSiteContext = await browser.newContext();
  await noSiteContext.addInitScript({
    content: uiMockInitScript(DEFAULT_CONFIG, { tabUrl: null }),
  });
  const noSitePage = await noSiteContext.newPage();
  await noSitePage.goto(pathToFileURL(join(root, "popup/popup.html")).href);
  await noSitePage.waitForSelector("#current-url:text-is('No HTTP(S) site')");
  assert(await noSitePage.isDisabled("#toggle-current-site"));
  await noSitePage.click("#save-session");
  await noSitePage.waitForSelector("#session-status.error");
  await noSiteContext.close();
}

// Advanced proxy controls live in collapsed <details> groups, so a user has to
// expand one before its fields are reachable.
async function openProxyGroup(page, selector) {
  const group = page.locator(selector);
  if (!(await group.evaluate((el) => el.open))) {
    await group.locator("summary").click();
  }
  await group.locator(".proxy-group-panel").waitFor({ state: "visible" });
}

async function testOptions(browser) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript({ content: uiMockInitScript(DEFAULT_CONFIG) });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, "options/options.html")).href);
  await page.waitForSelector("#canvas-whitelist");
  assert.equal(await page.locator("#useragent-preset").count(), 1);
  assert.equal(await page.locator("#curl-profile").count(), 0);
  const optionsUserAgentOptions = await page
    .locator("#useragent-preset option")
    .allTextContents();
  assert(optionsUserAgentOptions.includes("Windows Edge · Edge 101 (latest)"));
  assert(optionsUserAgentOptions.includes("Android Chrome · Chrome 131 (latest)"));
  assert(optionsUserAgentOptions.includes("macOS Safari · Safari 26.0 (latest)"));
  assert(optionsUserAgentOptions.includes("macOS Safari · Safari 18.4"));
  assert(optionsUserAgentOptions.includes("iPhone Safari · iOS 26.0 (latest)"));
  assert.equal(
    optionsUserAgentOptions.filter((label) => label.includes("macOS Chrome · Chrome 150")).length,
    1,
  );
  assert.equal(optionsUserAgentOptions.some((label) => label.includes("Firefox")), false);
  await page.selectOption("#useragent-preset", "iphone|safari184_ios");
  await page.waitForFunction(
    () =>
      window.__chromeState.config.useragent.preset === "iphone" &&
      window.__chromeState.config.useragent.curlProfile === "safari184_ios",
  );
  await page.selectOption("#useragent-preset", "android|auto");
  await page.waitForFunction(
    () =>
      window.__chromeState.config.useragent.preset === "android" &&
      window.__chromeState.config.useragent.curlProfile === "auto",
  );
  await page.screenshot({
    path: join(tmpdir(), "stealth-guard-options.png"),
    fullPage: true,
  });

  await page.uncheck("#global-enabled");
  await page.fill("#canvas-whitelist", "*.custom.test");
  await page.selectOption("#canvas-noise-level", "high");
  await page.selectOption("#webgl-mode", "strict");
  await page.fill(
    "#webgl-compatibility-whitelist",
    "site.test, *.compatibility.test",
  );
  await page.selectOption("#language-preset", "sv-SE");
  await page.check("#tracker-enabled");
  await page.click("#tracker-lists-group > summary");
  await page.uncheck("#tracker-use-built-in");
  await page.uncheck('[data-filter-list-id="adguard-cookies"]');
  await page.click("#tracker-custom-group > summary");
  await page.fill("#tracker-custom-domains", "*.metrics.test");
  await page.waitForTimeout(1100);
  assert.deepEqual(
    await page.evaluate(() => [
      window.__chromeState.config.enabled,
      window.__chromeState.config.canvas.whitelist,
      window.__chromeState.config.canvas.noiseLevel,
      window.__chromeState.config.webgl.mode,
      window.__chromeState.config.webgl.compatibilityWhitelist,
      window.__chromeState.config.language.preset,
      window.__chromeState.config.tracker.enabled,
      window.__chromeState.config.tracker.useBuiltIn,
      window.__chromeState.config.tracker.filterLists.find(
        (entry) => entry.id === "adguard-cookies",
      ).enabled,
      window.__chromeState.config.tracker.customDomains,
    ]),
    [
      false,
      "*.custom.test",
      "high",
      "strict",
      "site.test, *.compatibility.test",
      "sv-SE",
      true,
      false,
      false,
      "*.metrics.test",
    ],
  );
  await page.click("#update-filter-lists");
  await page.waitForSelector(".toast.success.show");
  await page.check("#global-enabled");

  await page.click("#proxy-section .proxy-editor summary");
  await page.fill("#new-proxy-host", "bad host");
  await page.fill("#new-proxy-port", "0");
  await page.click("#add-proxy-profile");
  await page.waitForSelector(".toast.error.show");
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.proxy.profiles.length),
    0,
  );

  await page.fill("#new-proxy-host", "proxy.test");
  await page.fill("#new-proxy-port", "1080");
  await page.fill("#new-proxy-name", "Main");
  await page.click("#add-proxy-profile");
  await page.waitForSelector(".proxy-profile-card strong:text-is('Main')");
  await page.waitForFunction(
    () => window.__chromeState.config.proxy.profiles.length === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.profiles[0]),
    { name: "Main", host: "proxy.test", port: 1080, scheme: "socks5" },
  );

  await page.getByRole("button", { name: "Edit" }).click();
  await page.fill("#new-proxy-username", "proxy-user");
  await page.fill("#new-proxy-password", "proxy-secret");
  await page.click("#add-proxy-profile");
  await page.waitForSelector(".proxy-credential-badge:text-is('Credentials saved')");
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.proxyCredentials),
    {
      "proxy.test:1080": {
        username: "proxy-user",
        persisted: true,
      },
    },
  );

  await page.getByRole("button", { name: "Edit" }).click();
  await page.fill("#new-proxy-host", "renamed.proxy.test");
  await page.fill("#new-proxy-name", "Renamed");
  await page.click("#add-proxy-profile");
  await page.waitForSelector(".proxy-profile-card strong:text-is('Renamed')");
  await page.waitForFunction(
    () =>
      window.__chromeState.config.proxy.profiles[0]?.host ===
      "renamed.proxy.test",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.profiles[0]),
    {
      name: "Renamed",
      host: "renamed.proxy.test",
      port: 1080,
      scheme: "socks5",
    },
  );

  await page.click("#proxy-section .proxy-editor summary");
  await page.fill("#new-proxy-host", "backup.proxy.test");
  await page.fill("#new-proxy-port", "8080");
  await page.fill("#new-proxy-name", "Backup");
  await page.selectOption("#new-proxy-scheme", "http");
  await page.click("#add-proxy-profile");
  const backupCard = page.locator(".proxy-profile-card", { hasText: "Backup" });
  await page.selectOption("#proxy-active-profile", "Renamed");
  await openProxyGroup(page, "#proxy-advanced-group");
  await page.selectOption("#proxy-fallback-profiles", ["Backup"]);
  await openProxyGroup(page, "#proxy-routes-group");
  await page.fill("#new-proxy-route-pattern", "bad host");
  await page.click("#add-proxy-route");
  await page.waitForSelector(".toast.error.show");
  await page.fill("#new-proxy-route-pattern", "*.video.example");
  await page.selectOption("#new-proxy-route-profile", "Backup");
  await page.click("#add-proxy-route");
  await page.waitForSelector(".proxy-route-card", {
    hasText: "*.video.example",
  });
  await page.selectOption("#proxy-routing-mode", "protect-selected");
  // Controls that the mode ignores are removed, not left visible but inert.
  assert(await page.locator("#proxy-bypass-field").isHidden());
  assert(await page.locator("#proxy-default-field").isHidden());
  assert(await page.locator("#proxy-routes-group").evaluate((el) => el.open));
  await page.uncheck("#proxy-sync-timezone");
  await page.uncheck("#proxy-sync-geolocation");
  await page.uncheck("#proxy-sync-language");
  await page.click("#save-settings");
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.fallbackProfiles),
    ["Backup"],
  );
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.domainRoutes),
    [{ pattern: "*.video.example", profile: "Backup" }],
  );
  assert.deepEqual(
    await page.evaluate(() => [
      window.__chromeState.config.proxy.routingMode,
      window.__chromeState.config.proxy.syncTimezone,
      window.__chromeState.config.proxy.syncGeolocation,
      window.__chromeState.config.proxy.syncLanguage,
    ]),
    ["protect-selected", false, false, false],
  );
  await backupCard.getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(
    () => window.__chromeState.config.proxy.profiles.length === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.fallbackProfiles),
    [],
  );
  assert.deepEqual(
    await page.evaluate(() => window.__chromeState.config.proxy.domainRoutes),
    [],
  );

  // Leaving protect-selected brings the default-proxy control back.
  await page.selectOption("#proxy-routing-mode", "bypass-selected");
  await page.selectOption("#proxy-active-profile", "Renamed");
  await page.check("#proxy-sync-timezone");
  await page.check("#proxy-sync-geolocation");
  await page.check("#proxy-sync-language");
  await page.check("#proxy-enabled");
  await page.click("#save-settings");
  assert(await page.evaluate(() => window.__chromeState.reloads > 0));
  await openProxyGroup(page, "#proxy-diagnostics-group");
  await page.click("#refresh-proxy-diagnostics");
  await page.waitForSelector("#proxy-connection-history li:not(.empty-state)");
  const diagnosticsDownloadPromise = page.waitForEvent("download");
  await page.click("#export-proxy-diagnostics");
  const diagnosticsDownload = await diagnosticsDownloadPromise;
  const diagnosticsExport = JSON.parse(
    readFileSync(await diagnosticsDownload.path(), "utf8"),
  );
  assert.equal(
    diagnosticsExport.diagnostics.configuration.routingMode,
    "bypass-selected",
  );
  assert(!JSON.stringify(diagnosticsExport).includes("proxy-secret"));
  await page.click("#clear-proxy-history");
  await page.waitForSelector("#proxy-connection-history .empty-state");

  const importedConfig = structuredClone(DEFAULT_CONFIG);
  importedConfig.globalWhitelist = "*localhost*, *kameleoon*";
  importedConfig.canvas.whitelist = "*.imported.test";
  await page.setInputFiles("#import-file", {
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ config: importedConfig })),
  });
  await page.waitForFunction(
    () =>
      window.__chromeState.config.globalWhitelist ===
        "*localhost*, *kameleoon*" &&
      window.__chromeState.config.canvas.whitelist === "*.imported.test",
  );
  assert.equal(
    await page.inputValue("#global-whitelist"),
    "*localhost*, *kameleoon*",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-config");
  const download = await downloadPromise;
  assert(download.suggestedFilename().startsWith("stealth-guard-config-"));
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(exported.version, "1.0");
  assert.equal(exported.config.globalWhitelist, "*localhost*, *kameleoon*");
  assert.equal(exported.config.canvas.whitelist, "*.imported.test");
  assert(!JSON.stringify(exported).includes("proxy-secret"));

  await page.setInputFiles("#import-file", {
    name: "provider.ovpn",
    mimeType: "text/plain",
    buffer: Buffer.from("client\nremote vpn.example 1194"),
  });
  await page.waitForSelector(".toast.error.show");
  assert(
    (await page.textContent("#toast")).includes("Tunnel configs are unsupported"),
  );
  await page.setInputFiles("#import-file", {
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await page.waitForSelector(".toast.error.show");
  await page.setInputFiles("#import-file", {
    name: "wrong-shape.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ config: [] })),
  });
  await page.waitForSelector(".toast.error.show");
  await page.setInputFiles("#import-file", {
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1024 * 1024 + 1, 32),
  });
  await page.waitForSelector(".toast.error.show");

  await page.click("#reset-settings");
  await page.waitForFunction(
    () => window.__chromeState.config.proxy.profiles.length === 0,
  );
  await page.check("#proxy-enabled");
  await page.click("#save-settings");
  await page.waitForSelector(".toast.error.show");

  await page.uncheck("#proxy-enabled");
  await page.evaluate(() => {
    window.__chromeState.failMessages["update-config"] = "Save denied";
  });
  await page.fill("#global-whitelist", "failed.test");
  await page.waitForTimeout(1100);
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.globalWhitelist),
    DEFAULT_CONFIG.globalWhitelist,
  );
  await page.evaluate(() => {
    delete window.__chromeState.failMessages["update-config"];
    window.__chromeState.failReload = true;
  });
  await page.click("#save-settings");
  await page.waitForSelector(".toast.success.show");
  await context.close();
}

async function testSelfTest(browser) {
  const context = await browser.newContext();
  await context.addInitScript({ content: uiMockInitScript(DEFAULT_CONFIG) });
  const page = await context.newPage();
  // The popup and the context menu both deep-link into the options page.
  const selfTestUrl = pathToFileURL(join(root, "options/options.html"));
  selfTestUrl.searchParams.set("tabId", "1");
  selfTestUrl.hash = "selftest-section";
  await page.goto(selfTestUrl.href);
  await page.waitForSelector("#selftest-summary[data-state='success']");
  assert.match(await page.textContent("#selftest-summary"), /passed/i);
  assert.equal(await page.textContent("#result-language"), "en-US · en-US, en");
  assert.equal(
    await page.textContent("#result-webrtc"),
    `${DEFAULT_CONFIG.webrtc.policy} · controlled_by_this_extension`,
  );
  await page.click("#selftest-detectors-group summary");
  assert.equal(
    await page.getAttribute("a.reference", "href"),
    "https://creepjs.org/checker#scan",
  );
  assert.equal(await page.locator(".benchmark-grid > a").count(), 7);
  await context.close();
}

async function testUiInitializationFailures(browser) {
  const initScript = uiMockInitScript(DEFAULT_CONFIG, {
    failMessages: { "get-config": "Background unavailable" },
  });

  const popupContext = await browser.newContext();
  await popupContext.addInitScript({ content: initScript });
  const popup = await popupContext.newPage();
  await popup.goto(pathToFileURL(join(root, "popup/popup.html")).href);
  await popup.waitForFunction(() =>
    document.body.textContent.includes("Failed to load settings"),
  );
  await popupContext.close();

  const optionsContext = await browser.newContext();
  await optionsContext.addInitScript({ content: initScript });
  const optionsPage = await optionsContext.newPage();
  await optionsPage.goto(pathToFileURL(join(root, "options/options.html")).href);
  await optionsPage.waitForSelector(".toast.error.show");
  assert(
    (await optionsPage.textContent("#toast")).includes("Failed to load settings"),
  );
  await optionsContext.close();
}

async function testAuxiliaryVpnApiFailures(browser) {
  const initScript = uiMockInitScript(DEFAULT_CONFIG, {
    failMessages: {
      "get-proxy-runtime-status": "Handler unavailable",
      "get-proxy-credential-status": "Handler unavailable",
      "get-proxy-diagnostics": "Handler unavailable",
    },
  });

  const popupContext = await browser.newContext();
  await popupContext.addInitScript({ content: initScript });
  const popup = await popupContext.newPage();
  await popup.goto(pathToFileURL(join(root, "popup/popup.html")).href);
  await popup.waitForSelector("#current-url:text-is('example.com')");
  assert(
    !(await popup.textContent("body")).includes("Failed to load settings"),
  );
  await popupContext.close();

  const optionsContext = await browser.newContext();
  await optionsContext.addInitScript({ content: initScript });
  const optionsPage = await optionsContext.newPage();
  await optionsPage.goto(pathToFileURL(join(root, "options/options.html")).href);
  await optionsPage.waitForSelector("#canvas-whitelist");
  assert.equal(
    await optionsPage.inputValue("#global-whitelist"),
    DEFAULT_CONFIG.globalWhitelist,
  );
  assert(
    !(await optionsPage.textContent("body")).includes("Failed to load settings"),
  );
  await optionsContext.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChrome(),
    args: [
      `--host-resolver-rules=MAP site.test 127.0.0.1, MAP challenges.cloudflare.com 127.0.0.1, MAP geo.captcha-delivery.com 127.0.0.1`,
      "--enable-webgl",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });

  try {
    await testProtectionRuntime(browser, server.port);
    await testAllowlistAndChallengeFrames(browser, server.port);
    await testInvalidatedExtensionContext(browser, server.port);
    await testCosmeticFilteringAndElementPicker(browser, server.port);
    await testYouTubeVideoAdSanitizer(browser);
    await testPopup(browser);
    await testOptions(browser);
    await testSelfTest(browser);
    await testUiInitializationFailures(browser);
    await testAuxiliaryVpnApiFailures(browser);
    console.log("End-to-end browser checks passed");
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  if (process.env.GITHUB_ACTIONS === "true") {
    const message = String((error && (error.stack || error.message)) || error)
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    console.error(`::error title=End-to-end browser checks failed::${message}`);
  }
  process.exitCode = 1;
});
