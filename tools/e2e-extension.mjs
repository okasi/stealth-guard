import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { connect, createServer as createSocketServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const root = fileURLToPath(new URL("..", import.meta.url));
const executablePath = process.env.OPERA_PATH;
if (!executablePath)
  throw new Error("Set OPERA_PATH to an MV2-capable Opera executable");
const dir = mkdtempSync(join(tmpdir(), "sg-native-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(dir, "key.pem"),
    "-out",
    join(dir, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdio: "ignore" },
);
let proxyRequests = 0;
let challenges = 0;
let filterFailure = false;
const proxyHosts = [];

const html =
  '<!doctype html><html><head><script>window.firstIdentity={ua:navigator.userAgent,language:navigator.language};</script></head><body><div id="advert">Ad</div><div id="content">Content</div><div id="picked">Pick me</div></body></html>';
function serve(req, res) {
  if (req.url.includes("/filters.txt")) {
    res.writeHead(filterFailure ? 503 : 200, { "Content-Type": "text/plain" });
    res.end("||ads.audit.test^\naudit.test###advert\n##.late-ad\n");
  } else if (req.headers.host?.startsWith("api.ipify.org")) {
    res.setHeader("Content-Type", "application/json");
    res.end('{"ip":"203.0.113.42"}');
  } else if (req.url.includes("/headers")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.headers));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  }
}
const http = createServer(serve);
const https = createSecureServer(
  {
    key: readFileSync(join(dir, "key.pem")),
    cert: readFileSync(join(dir, "cert.pem")),
  },
  serve,
);
const auth = "Basic " + Buffer.from("audit:local-only").toString("base64");
function authenticated(req, res) {
  if (req.headers["proxy-authorization"] === auth) {
    proxyRequests++;
    proxyHosts.push(req.headers.host);
    return true;
  }
  challenges++;
  res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="SG audit"' });
  res.end();
  return false;
}
const proxy = createServer((req, res) => {
  if (authenticated(req, res)) serve(req, res);
});
function tunnelProxyRequest(req, socket) {
  if (req.headers["proxy-authorization"] !== auth) {
    challenges++;
    socket.end(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="SG audit"\r\nContent-Length: 0\r\n\r\n',
    );
    return;
  }
  proxyRequests++;
  proxyHosts.push(req.url);
  const tunnel = connect(https.address().port, "127.0.0.1", () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.pipe(tunnel);
    tunnel.pipe(socket);
  });
  tunnel.on("error", () => socket.destroy());
  socket.on("error", () => tunnel.destroy());
}
proxy.on("connect", tunnelProxyRequest);
const httpsProxy = createSecureServer(
  {
    key: readFileSync(join(dir, "key.pem")),
    cert: readFileSync(join(dir, "cert.pem")),
  },
  (request, response) => {
    if (authenticated(request, response)) serve(request, response);
  },
);
httpsProxy.on("connect", tunnelProxyRequest);
const socksConnections = { 4: 0, 5: 0 };
const socks = createSocketServer((socket) => {
  let buffer = Buffer.alloc(0);
  let greeting = true;
  const receive = (data) => {
    buffer = Buffer.concat([buffer, data]);
    const version = buffer[0];
    let length, port;
    if (version === 5 && greeting) {
      if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
      buffer = buffer.subarray(2 + buffer[1]);
      greeting = false;
      socket.write(Buffer.from([5, 0]));
      if (buffer.length) receive(Buffer.alloc(0));
      return;
    }
    if (version === 5) {
      if (buffer.length < 5) return;
      length = buffer[3] === 1 ? 10 : buffer[3] === 4 ? 22 : 7 + buffer[4];
      if (buffer.length < length) return;
      port = buffer.readUInt16BE(length - 2);
    } else if (version === 4) {
      if (buffer.length < 9) return;
      length = buffer.indexOf(0, 8) + 1;
      if (!length) return;
      if (buffer.readUInt32BE(4) > 0 && buffer.readUInt32BE(4) < 256) {
        length = buffer.indexOf(0, length) + 1;
        if (!length) return;
      }
      port = buffer.readUInt16BE(2);
    } else {
      socket.destroy();
      return;
    }
    socksConnections[version]++;
    socket.off("data", receive);
    const target = port === 443 ? https : http;
    const tunnel = connect(target.address().port, "127.0.0.1", () => {
      socket.write(
        Buffer.from(
          version === 4
            ? [0, 90, 0, 0, 127, 0, 0, 1]
            : [5, 0, 0, 1, 127, 0, 0, 1, 0, 0],
        ),
      );
      if (buffer.length > length) tunnel.write(buffer.subarray(length));
      socket.pipe(tunnel);
      tunnel.pipe(socket);
    });
    tunnel.on("error", () => socket.destroy());
    socket.on("error", () => tunnel.destroy());
  };
  socket.on("data", receive);
});
const servers = [http, https, proxy, httpsProxy, socks];
for (const s of servers) await new Promise((r) => s.listen(0, "127.0.0.1", r));
let context;
try {
  context = await chromium.launchPersistentContext(join(dir, "browser"), {
    executablePath,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--disable-extensions-except=" + root,
      "--load-extension=" + root,
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP *.audit.test 127.0.0.1, MAP audit.test 127.0.0.1",
      "--enable-webgl",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });
  const manager = await context.newPage();
  await manager.goto("opera://extensions");
  const extension = await manager.evaluate(
    () =>
      new Promise((r) =>
        chrome.developerPrivate.getExtensionsInfo({}, (xs) =>
          r(
            xs
              .filter((x) => x.location === "UNPACKED")
              .map(({ id, state, manifestErrors, runtimeErrors }) => ({
                id,
                state,
                manifestErrors,
                runtimeErrors,
              }))[0],
          ),
        ),
      ),
  );
  assert.equal(extension.state, "ENABLED");
  assert.deepEqual(extension.manifestErrors, []);
  console.log("Native extension loaded", extension);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extension.id}/options/options.html`);
  async function message(request) {
    return options.evaluate(
      (request) =>
        new Promise((resolve, reject) =>
          chrome.runtime.sendMessage(request, (response) =>
            chrome.runtime.lastError
              ? reject(new Error(chrome.runtime.lastError.message))
              : resolve(response),
          ),
        ),
      request,
    );
  }
  async function ok(request) {
    const result = await message(request);
    assert.notEqual(result?.success, false, JSON.stringify(result));
    assert.ok(result);
    return result;
  }
  let config = (await ok({ type: "get-config" })).config;
  config.tracker.filterLists = config.tracker.filterLists.map((x) => ({
    ...x,
    enabled: false,
  }));
  config.tracker.useBuiltIn = false;
  config.tracker.autoUpdate = false;
  config.useragent.preset = "android";
  config.language.preset = "ja-JP";
  config.timezone.name = "Asia/Tokyo";
  await ok({ type: "update-config", config });
  const page = await context.newPage();
  const site = `http://audit.test:${http.address().port}`;
  await page.goto(site);
  await page.waitForFunction(() => navigator.userAgent.includes("Android"));
  let identity = await page.evaluate(() => ({
    first: window.firstIdentity,
    ua: navigator.userAgent,
    language: navigator.language,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  console.log("Native page", identity);
  assert.equal(identity.language, "ja-JP");
  assert.equal(identity.zone, "Asia/Tokyo");
  let headers = await page.evaluate(() =>
    fetch("/headers").then((r) => r.json()),
  );
  assert.equal(headers["user-agent"], identity.ua);
  assert.match(headers["accept-language"], /^ja-JP/);
  const tabId = await options.evaluate(
    (site) =>
      new Promise((r) =>
        chrome.tabs.query({}, (tabs) =>
          r(tabs.find((t) => t.url?.startsWith(site)).id),
        ),
      ),
    site,
  );
  const diagnostics = (
    await ok({
      type: "get-identity-diagnostics",
      tabId,
      hostname: "audit.test",
    })
  ).diagnostics;
  assert.equal(diagnostics.webrtc.effectivePolicy, "disable_non_proxied_udp");
  // Download a real HTTPS subscription, then exercise blocking and cosmetic injection.
  config.tracker.filterLists = [
    {
      id: "audit",
      name: "Local audit",
      url: `https://127.0.0.1:${https.address().port}/filters.txt`,
      enabled: true,
    },
  ];
  await ok({ type: "update-config", config });
  console.log("filter update", await ok({ type: "update-adblock-filters" }));
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#advert")).display === "none",
  );
  assert.equal(
    await page.evaluate(
      (port) =>
        fetch(`http://ads.audit.test:${port}/ad.js`).then(
          () => false,
          () => true,
        ),
      http.address().port,
    ),
    true,
  );
  await ok({ type: "add-to-whitelist", domain: "audit.test" });
  await page.waitForFunction(() => !navigator.userAgent.includes("Android"));
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#advert")).display !== "none",
  );
  await ok({ type: "remove-from-whitelist", domain: "audit.test" });
  await page.waitForFunction(() => navigator.userAgent.includes("Android"));
  // Existing elements can acquire filter tokens after startup.
  await page.evaluate(
    () => (document.querySelector("#content").className = "late-ad"),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#content")).display === "none",
  );
  // The picker persists through the real tab-to-background message API.
  await options.evaluate(
    (tabId) =>
      new Promise((r) =>
        chrome.tabs.sendMessage(tabId, { type: "start-element-picker" }, r),
      ),
    tabId,
  );
  await page.hover("#picked");
  await page.click("#picked");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#picked")).display === "none",
  );
  assert.match(
    (await ok({ type: "get-config" })).config.tracker.customFilters,
    /audit\.test###picked/,
  );
  // Worker construction reads the live toggle without reloading the page.
  async function workerIdentity() {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const url = URL.createObjectURL(
            new Blob(["postMessage(navigator.userAgent)"], {
              type: "application/javascript",
            }),
          );
          const worker = new Worker(url);
          const timeout = setTimeout(
            () => finish(new Error("Worker timed out")),
            5000,
          );
          function finish(error, value) {
            clearTimeout(timeout);
            worker.terminate();
            URL.revokeObjectURL(url);
            error ? reject(error) : resolve(value);
          }
          worker.onmessage = (event) => finish(null, event.data);
          worker.onerror = () => finish(new Error("Worker failed"));
        }),
    );
  }
  assert.equal(await workerIdentity(), identity.ua);
  config = (await ok({ type: "get-config" })).config;
  config.worker.enabled = false;
  await ok({ type: "update-config", config });
  assert.notEqual(await workerIdentity(), identity.ua);
  config.worker.enabled = true;
  await ok({ type: "update-config", config });
  assert.equal(await workerIdentity(), identity.ua);
  // Native cookies and web storage survive session save / clear / restore.
  await page.evaluate(() => {
    document.cookie = "audit=one; path=/";
    localStorage.setItem("audit", "one");
    sessionStorage.setItem("audit", "one");
  });
  const saved = await ok({
    type: "save-session",
    tabId,
    hostname: "audit.test",
    name: "Original",
  });
  await ok({
    type: "rename-session",
    sessionId: saved.session.id,
    name: "Renamed",
  });
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    ok({ type: "clear-current-session", tabId, hostname: "audit.test" }),
  ]);
  assert.equal(await page.evaluate(() => localStorage.getItem("audit")), null);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    ok({
      type: "switch-session",
      tabId,
      hostname: "audit.test",
      sessionId: saved.session.id,
    }),
  ]);
  await page.waitForFunction(() => localStorage.getItem("audit") === "one");
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("audit")),
    "one",
  );
  assert.match(await page.evaluate(() => document.cookie), /audit=one/);
  await ok({ type: "delete-session", sessionId: saved.session.id });
  assert.deepEqual(
    (await ok({ type: "get-sessions", hostname: "audit.test" })).sessions,
    [],
  );
  // Real browser proxy settings, Basic authentication, CONNECT and verification.
  const profile = {
    name: "Local audit",
    host: "127.0.0.1",
    port: proxy.address().port,
    scheme: "http",
    location: {
      city: "Tokyo",
      country: "Japan",
      countryCode: "JP",
      timezone: "Asia/Tokyo",
      loc: "35.68,139.69",
    },
  };
  config = (await ok({ type: "get-config" })).config;
  config.proxy = {
    ...config.proxy,
    profiles: [profile],
    activeProfile: profile.name,
    enabled: false,
  };
  await ok({ type: "update-config", config });
  await ok({
    type: "set-proxy-credentials",
    profile,
    credentials: { username: "audit", password: "local-only", persist: false },
  });
  config.proxy.enabled = true;
  await ok({ type: "update-config", config });
  assert.equal(
    (await ok({ type: "verify-proxy-connection" })).status.exitIp,
    "203.0.113.42",
  );
  await page.goto(site + "/proxied");
  assert.ok(proxyRequests > 0);
  assert.ok(challenges > 0);
  console.log("Proxy requests/challenges", proxyRequests, challenges);
  config.proxy.routingMode = "protect-selected";
  config.proxy.activeProfile = null;
  config.proxy.domainRoutes = [
    { pattern: "audit.test", profile: profile.name },
  ];
  await ok({ type: "update-config", config });
  await page.goto(site + "/split");
  const before = proxyHosts.filter((host) =>
    host.startsWith("direct.audit.test"),
  ).length;
  const direct = await context.newPage();
  await direct.goto(`http://direct.audit.test:${http.address().port}/direct`);
  assert.equal(
    proxyHosts.filter((host) => host.startsWith("direct.audit.test")).length,
    before,
  );
  await direct.close();
  config.proxy.enabled = false;
  await ok({ type: "update-config", config });
  await ok({ type: "clear-proxy-credentials", profile });
  await ok({ type: "clear-proxy-history" });
  filterFailure = true;
  const failed = await message({ type: "update-adblock-filters" });
  console.log("Failed filter refresh", failed);
  assert.equal(failed.success, false);
  await page.goto(site);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#advert")).display === "none",
  );
  // All supported browser proxy protocols use real local transports.
  for (const scheme of ["https", "socks4", "socks5"]) {
    const candidate = {
      ...profile,
      name: scheme,
      scheme,
      port: (scheme === "https" ? httpsProxy : socks).address().port,
    };
    config.proxy = {
      ...config.proxy,
      enabled: false,
      routingMode: "protect-all",
      profiles: [candidate],
      activeProfile: candidate.name,
      domainRoutes: [],
      fallbackProfiles: [],
    };
    await ok({ type: "update-config", config });
    if (scheme === "https")
      await ok({
        type: "set-proxy-credentials",
        profile: candidate,
        credentials: {
          username: "audit",
          password: "local-only",
          persist: false,
        },
      });
    config.proxy.enabled = true;
    await ok({ type: "update-config", config });
    assert.equal(
      (await ok({ type: "verify-proxy-connection" })).status.exitIp,
      "203.0.113.42",
      scheme,
    );
    await page.goto(site + "/" + scheme);
    config.proxy.enabled = false;
    await ok({ type: "update-config", config });
  }
  assert.ok(socksConnections[4] > 0);
  assert.ok(socksConnections[5] > 0);
  console.log("HTTP, HTTPS, SOCKS4 and SOCKS5 transports passed");
  // Real UI loads and persists a setting through the background API.
  await options.reload();
  await options.waitForFunction(
    () => document.querySelector("#language-preset").value === "ja-JP",
  );
  await options.selectOption("#language-preset", "sv-SE");
  await page.waitForFunction(() => navigator.language === "sv-SE");
  await options.selectOption("#selftest-tab", String(tabId));
  await options.click("#run-selftest");
  await options.waitForFunction(
    () => document.querySelector("#selftest-summary").dataset.state,
  );
  assert.equal(
    await options.locator("#selftest-summary").getAttribute("data-state"),
    "success",
    JSON.stringify(
      await options
        .locator(".identity-grid span")
        .evaluateAll((elements) =>
          elements.map((x) => ({
            id: x.id,
            state: x.dataset.state,
            text: x.textContent,
          })),
        ),
    ),
  );
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extension.id}/popup/popup.html`);
  await popup.waitForFunction(
    () => !document.body.textContent.includes("Loading settings"),
  );
  assert.ok(await popup.locator("#global-enabled").count());
  assert.ok(
    !(await popup.locator("body").innerText()).includes(
      "Failed to load settings",
    ),
  );
  await popup.close();
  await manager.reload();
  const errors = await manager.evaluate(
    (id) =>
      new Promise((r) =>
        chrome.developerPrivate.getExtensionsInfo({}, (xs) =>
          r(xs.find((x) => x.id === id).runtimeErrors),
        ),
      ),
    extension.id,
  );
  assert.deepEqual(errors, []);
  console.log("Native extension integration checks passed");
} finally {
  if (context) await context.close();
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
  rmSync(dir, { recursive: true, force: true });
}
