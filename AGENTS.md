# Stealth Guard

## Runtime

Stealth Guard is a Manifest V2 extension with a persistent background page,
direct classic-script loading, and no production build step. It has four
runtime contexts:

1. `background.js` owns normalized configuration, browser-global policy,
   network listeners, storage, proxy state, and message dispatch.
2. `content-scripts/injector.js` runs in the isolated world in every frame at
   `document_start`, installs the fail-closed MAIN-world bootstrap, and
   authenticates alerts and configuration updates.
3. `content-scripts/main.js` runs in the MAIN world and patches fingerprinting,
   identity, WebRTC, worker, and YouTube surfaces.
4. `popup/*` and `options/*` are extension pages that use background messages.

## Essential modules

| Path | Responsibility |
| --- | --- |
| `manifest.json` | MV2 permissions, entry points, and script dependency order. |
| `lib/filterLists.js` | Shared filter-list defaults and HTTPS subscription normalization. |
| `lib/gpuProfiles.js` | Safe ClearCote combined WebGL/WebGPU profile normalization and summaries. |
| `lib/config.js` | Explicit-schema defaults, persistence, identity presets, and the privacy-safe content projection. |
| `lib/domainFilter.js` | The sole hostname, wildcard, and allowlist matcher. |
| `lib/adblock.js` | Safe AdGuard/uBlock subset parsing, indexing, network matching, and cosmetic selector lookup. |
| `lib/curlProfiles.js` | Validated curl-impersonate browser/API profiles and refresh metadata. |
| `lib/proxy.js` | Proxy validation, location lookup, PAC generation, and browser proxy settings. |
| `lib/proxyCredentials.js` | Separate session/persistent credentials and bounded proxy-auth retries. |
| `lib/session.js` | Serialized per-site session lifecycle, cookie scope, and tab-host revalidation. |
| `lib/runtime.js` / `lib/storage.js` | Promise wrappers for extension APIs. |
| `tools/e2e.mjs` | Chromium-driven protection, popup, options, and failure-path checks. |

## Initialization and data flow

1. The background bundle loads `runtime` → `storage` → `filterLists` →
   `adblock` → `gpuProfiles` → `config` → `curlProfiles` → `domainFilter` → `proxy` →
   `proxyCredentials` → `session` → `background`.
2. Background startup loads and normalizes local state, installs the UA,
   tracker, WebRTC, proxy-auth, and proxy policies, schedules refreshes, and
   creates context menus. Initialization is retried by the next message after
   a startup failure.
3. The content bundle loads `filterLists` → `domainFilter` → `gpuProfiles` →
   `config` → `curlProfiles` → `main` → `injector` → the isolated adblock controller.
4. The injector installs MAIN-world wrappers with safe defaults immediately,
   then applies trusted local storage/background updates. Only
   `createContentConfig()` output crosses into MAIN world; proxy endpoints,
   credentials, sessions, route tables, and unknown imported fields do not.
5. Configuration changes are serialized, persisted, applied to affected
   browser-global subsystems, rolled back on failure, and broadcast to HTTP(S)
   tabs. Session mutations are separately serialized and recheck the tab host
   before and between cookie/storage mutations.

Persistent keys include `stealth-guard-config`,
`stealth-guard-filter-cache`, `stealth-guard-curl-profiles`,
`stealth-guard-proxy-credentials`, `stealth-guard-proxy-history`,
`stealth-guard-sessions`, and `stealth-guard-active-sessions`.

## Interaction points

- Configuration: `get-config`, `update-config`, `reset-config`, allowlist
  messages, and `config-updated` broadcasts.
- Protection status: `fingerprint-detected`, `get-triggered-features`,
  identity self-test, cosmetic-rule, adblock-list, and curl-profile messages.
- Proxy: profile preparation, credential status/update/clear, runtime status,
  verification, diagnostics, history clear, and proxy error/settings events.
- Sessions: `get-sessions`, `save-session`, `switch-session`, `rename-session`,
  `delete-session`, and `clear-current-session`.
- Browser hooks: header rewriting, blocking web requests, privacy WebRTC policy,
  proxy settings/authentication, tabs, cookies, alarms, notifications, and
  context menus.

## Guidance

- Preserve MV2, the persistent background page, direct loading, and manifest
  script order. Run `npm run manifest` after dependency-order changes.
- Keep all hostname/wildcard semantics in `lib/domainFilter.js` and all
  browser proxy application in `lib/proxy.js`.
- Keep browser-global WebRTC and proxy policy independent of the active tab.
- Keep caller-owned descriptors, arrays, typed arrays, and option objects
  unchanged when patching browser APIs.
- Bump the patch version in `manifest.json`, `package.json`, and both root
  package entries in `package-lock.json` for every repository change.
- Run `npm run check`. It validates syntax, manifest integrity, deterministic
  core coverage, background integration, and browser-driven E2E workflows.
  Current Chrome cannot load MV2; release validation still needs an unpacked
  smoke test in an MV2-capable Opera build.
