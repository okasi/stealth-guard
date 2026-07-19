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
const chromeCandidates = [
  process.env.CHROME_PATH,
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
      "Chrome or Chromium was not found. Set CHROME_PATH to run end-to-end tests.",
    );
  }
  return executablePath;
}

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

const protectionSources = [
  "lib/domainFilter.js",
  "lib/config.js",
  "content-scripts/main.js",
  "content-scripts/injector.js",
]
  .map(readSource)
  .join("\n");

function protectionInitScript(config) {
  return `
    (() => {
      const storedConfig = ${JSON.stringify(config)};
      const nativeUserAgentGetter = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent").get;
      window.__sgNativeUserAgent = nativeUserAgentGetter.call(navigator);
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
        beginRenderPass(descriptor) { return descriptor; }
      }
      class FakeGPUQueue {
        writeBuffer() { return true; }
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

function uiMockInitScript(config) {
  return `
    (${function installUiMock(initialConfig) {
      const state = (window.__chromeState = {
        config: structuredClone(initialConfig),
        sessions: [],
        activeSessionId: null,
        reloads: 0,
        createdTabs: [],
        openedOptions: 0,
      });

      function responseFor(message) {
        if (message.type === "get-config") {
          return { config: structuredClone(state.config) };
        }
        if (message.type === "update-config") {
          state.config = structuredClone(message.config);
          return { success: true };
        }
        if (message.type === "reset-config") {
          state.config = structuredClone(initialConfig);
          return { success: true };
        }
        if (message.type === "get-triggered-features") {
          return { features: ["canvas", "user-agent"] };
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
            callback([
              { id: 1, url: "https://www.example.com/account", active: true },
            ]);
          },
          reload(tabId, options, callback) {
            if (typeof options === "function") callback = options;
            state.reloads++;
            if (callback) callback();
          },
          create(details) {
            state.createdTabs.push(details);
          },
        },
      };
      Object.assign(window.chrome, fakeChrome);
      window.confirm = () => true;
      window.prompt = (message, value) => value || "Renamed Session";
    }.toString()})(${JSON.stringify(config)});
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
      const canvasData = Array.from(context.getImageData(0, 0, 1, 1).data);

      const webglCanvas = document.createElement("canvas");
      const gl = webglCanvas.getContext("webgl");
      if (!gl) throw new Error("WebGL context unavailable");
      const webglVendor = gl.getParameter(7936);

      const span = document.createElement("span");
      span.style.cssText = "display:inline-block;width:123px;font:16px Arial";
      span.textContent = "fingerprint";
      document.body.appendChild(span);
      const fontWidth = span.offsetWidth;
      const measuredWidth = context.measureText("fingerprint").width;

      const timezoneOffset = new Date(
        "2026-01-15T12:00:00Z",
      ).getTimezoneOffset();
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
      encoder.beginRenderPass({
        colorAttachments: [{ clearValue: { r: 1, g: 1, b: 1, a: 1 } }],
      });
      const queue = new GPUQueue();
      queue.writeBuffer({}, 0, new Uint8Array([10, 20, 30, 40]));

      const offline = new OfflineAudioContext(1, 128, 44100);
      const audioBuffer = offline.createBuffer(1, 128, 44100);
      const audioData = audioBuffer.getChannelData(0);
      const audioSample = audioData[0];

      const userAgent = navigator.userAgent;
      const peer = new RTCPeerConnection();
      peer.close();

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      return {
        canvasData,
        webglVendor,
        fontWidth,
        measuredWidth,
        timezoneOffset,
        rectValues,
        gpuLimit,
        audioSample,
        userAgent,
        nativeUserAgent: window.__sgNativeUserAgent,
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
    content: protectionInitScript(DEFAULT_CONFIG),
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error("Protection page error:", error),
  );
  await page.goto(`http://site.test:${port}/`);
  await page.waitForFunction(() => window.__sgHarnessReady === true);
  await page.waitForTimeout(25);

  const result = await exerciseProtections(page);
  const features = new Set(result.reports);
  for (const feature of [
    "canvas",
    "webgl",
    "font",
    "timezone",
    "clientrects",
    "webgpu",
    "audiocontext",
    "user-agent",
    "webrtc",
  ]) {
    assert(features.has(feature), `Missing browser-level ${feature} alert`);
  }
  assert.notEqual(result.userAgent, result.nativeUserAgent);
  assert.equal(result.timezoneOffset, -60);
  assert.equal(typeof result.webglVendor, "string");
  assert.equal(typeof result.gpuLimit, "number");

  const beforeDisable = result.reports.length;
  const disabledState = await page.evaluate(
    async (disabledConfig) => {
      window.__sgUpdateConfig(disabledConfig);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      return {
        userAgent: navigator.userAgent,
        nativeUserAgent: window.__sgNativeUserAgent,
        reportCount: window.__sgReports.length,
      };
    },
    { ...DEFAULT_CONFIG, enabled: false },
  );
  assert.equal(disabledState.userAgent, disabledState.nativeUserAgent);
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return {
      userAgent,
      nativeUserAgent: window.__sgNativeUserAgent,
      reports: window.__sgReports.length,
    };
  });
  assert.equal(allowlisted.userAgent, allowlisted.nativeUserAgent);
  assert.equal(allowlisted.reports, 0);
  await allowlistedContext.close();

  const challengeContext = await browser.newContext();
  await challengeContext.addInitScript({
    content: protectionInitScript(DEFAULT_CONFIG),
  });
  const challengePage = await challengeContext.newPage();
  challengePage.on("pageerror", (error) =>
    console.error("Challenge page error:", error),
  );
  await challengePage.goto(`http://challenges.cloudflare.com:${port}/`);
  await challengePage.waitForTimeout(25);
  const challenge = await challengePage.evaluate(() => ({
    userAgent: navigator.userAgent,
    nativeUserAgent: window.__sgNativeUserAgent,
    reports: window.__sgReports.length,
  }));
  assert.equal(challenge.userAgent, challenge.nativeUserAgent);
  assert.equal(challenge.reports, 0);
  await challengeContext.close();
}

async function testPopup(browser) {
  const context = await browser.newContext();
  await context.addInitScript({ content: uiMockInitScript(DEFAULT_CONFIG) });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, "popup/popup.html")).href);
  await page.waitForSelector("#current-url:text-is('example.com')");
  await page.screenshot({ path: join(tmpdir(), "stealth-guard-popup.png") });

  await page.$eval("#canvas-enabled", (input) => {
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.canvas.enabled),
    false,
  );
  assert(await page.evaluate(() => window.__chromeState.reloads > 0));

  await page.click("#toggle-current-site");
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.globalWhitelist),
    "*.example.com",
  );

  await page.fill("#session-name-input", "Work");
  await page.click("#save-session");
  await page.waitForSelector(".session-entry-name:text-is('Work')");
  await page.evaluate(() => {
    window.prompt = () => "Personal";
  });
  await page.click('button[data-action="rename"]');
  await page.waitForSelector(".session-entry-name:text-is('Personal')");
  await page.click('button[data-action="delete"]');
  await page.waitForSelector(".session-list-empty");
  await context.close();
}

async function testOptions(browser) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript({ content: uiMockInitScript(DEFAULT_CONFIG) });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, "options/options.html")).href);
  await page.waitForSelector("#canvas-whitelist");
  await page.screenshot({
    path: join(tmpdir(), "stealth-guard-options.png"),
    fullPage: true,
  });

  await page.fill("#canvas-whitelist", "*.custom.test");
  await page.waitForTimeout(1100);
  assert.equal(
    await page.evaluate(() => window.__chromeState.config.canvas.whitelist),
    "*.custom.test",
  );

  await page.click("#proxy-section details summary");
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

  await page.selectOption("#proxy-active-profile", "Main");
  await page.check("#proxy-enabled");
  await page.click("#save-settings");
  assert(await page.evaluate(() => window.__chromeState.reloads > 0));

  const importedConfig = structuredClone(DEFAULT_CONFIG);
  importedConfig.canvas.whitelist = "*.imported.test";
  await page.setInputFiles("#import-file", {
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ config: importedConfig })),
  });
  await page.waitForFunction(
    () => window.__chromeState.config.canvas.whitelist === "*.imported.test",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-config");
  const download = await downloadPromise;
  assert(download.suggestedFilename().startsWith("stealth-guard-config-"));

  await page.click("#reset-settings");
  await page.waitForFunction(
    () => window.__chromeState.config.proxy.profiles.length === 0,
  );
  await page.check("#proxy-enabled");
  await page.click("#save-settings");
  await page.waitForSelector(".toast.error.show");
  await context.close();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChrome(),
    args: [
      `--host-resolver-rules=MAP site.test 127.0.0.1, MAP challenges.cloudflare.com 127.0.0.1`,
      "--enable-webgl",
      "--use-angle=swiftshader",
    ],
  });

  try {
    await testProtectionRuntime(browser, server.port);
    await testAllowlistAndChallengeFrames(browser, server.port);
    await testPopup(browser);
    await testOptions(browser);
    console.log("End-to-end browser checks passed");
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
