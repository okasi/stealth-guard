# Stealth Guard

## Runtime

Stealth Guard is a Manifest V2 extension with a persistent background page,
classic scripts, and no production build. The four runtime areas are:

- `background.js`: normalized configuration, browser-global policies, network
  listeners, storage, proxy state, and message dispatch.
- `content-scripts/injector.js`: isolated-world document-start bootstrap,
  trusted configuration delivery, and authenticated page alerts.
- `content-scripts/main.js`: MAIN-world fingerprint, identity, WebRTC, worker,
  and YouTube protections.
- `popup/` and `options/`: extension-page controls that call the background
  message API. `content-scripts/adblock.js` is the isolated-world cosmetic and
  element-picker controller.

## Essential modules

| Path | Responsibility |
| --- | --- |
| `manifest.json` | MV2 permissions, entry points, and script order. |
| `lib/runtime.js` / `lib/storage.js` | Browser API wrappers and shared runtime helpers. |
| `lib/config.js` | Explicit-schema defaults, persistence, identity presets, and page-safe projection. |
| `lib/domainFilter.js` | The only hostname, wildcard, and allowlist matcher. |
| `lib/adblock.js` / `lib/filterLists.js` | Safe rule parsing, matching, cosmetic lookup, and subscription defaults. |
| `lib/gpuProfiles.js` / `lib/curlProfiles.js` | Validated graphics and browser/API profile data. |
| `lib/proxy.js` / `lib/proxyCredentials.js` | Proxy validation, PAC/settings, location lookup, and bounded authentication. |
| `lib/session.js` | Serialized per-site session snapshots and tab-host revalidation. |
| `tools/e2e.mjs` | Chromium-driven protection, UI, integration, and failure-path checks. |

## Initialization and data flow

1. The background scripts load in this order: `runtime` → `storage` →
   `filterLists` → `adblock` → `gpuProfiles` → `config` → `curlProfiles` →
   `domainFilter` → `proxy` → `proxyCredentials` → `session` → `background`.
2. The content bundle loads `runtime` → `filterLists` → `domainFilter` →
   `gpuProfiles` → `config` → `curlProfiles` → `main` → `injector` →
   `adblock` at `document_start` in every frame.
3. Background startup normalizes local state, applies User-Agent, tracker,
   WebRTC, proxy, proxy-auth, refresh-alarm, and context-menu policies. Startup
   is retried by the next message after a failure.
4. The injector installs fail-closed MAIN-world wrappers immediately, then
   applies trusted local/background updates. Only `createContentConfig()` data
   crosses into the page; endpoints, credentials, sessions, routes, and
   unknown imported fields do not.
5. Config changes are serialized, persisted, applied atomically, rolled back
   on failure, and broadcast to HTTP(S) tabs. Session mutations are separately
   serialized and recheck the tab host before cookie/storage writes.

Persistent keys include `stealth-guard-config`, `stealth-guard-filter-cache`,
`stealth-guard-curl-profiles`, `stealth-guard-proxy-credentials`,
`stealth-guard-proxy-history`, `stealth-guard-sessions`, and
`stealth-guard-active-sessions`.

## Interaction points

- Config: `get-config`, `update-config`, `reset-config`, allowlist messages,
  and `config-updated` broadcasts.
- Protection: `fingerprint-detected`, triggered-feature diagnostics,
  identity self-test, cosmetic rules, adblock status/rules, and curl profiles.
- Proxy: profile preparation, credential status/update/clear, runtime status,
  verification, diagnostics, history, settings, and proxy-error events.
- Sessions: `get-sessions`, `save-session`, `switch-session`, `rename-session`,
  `delete-session`, and `clear-current-session`.
- Browser hooks: header rewriting, request blocking, WebRTC policy, proxy
  settings/authentication, tabs, cookies, alarms, notifications, and menus.

## Guidance

- Preserve MV2, the persistent background page, direct classic-script loading,
  and manifest dependency order. Run `npm run manifest` after order changes.
- Keep hostname matching in `lib/domainFilter.js` and browser proxy application
  in `lib/proxy.js`.
- Keep WebRTC and proxy policy browser-global, independent of the active tab.
- Browser patches must preserve caller-owned descriptors, arrays, typed arrays,
  and option objects.
- Bump the patch version in `manifest.json`, `package.json`, and both root
  package entries in `package-lock.json` for every repository change.
- Run `npm run check`. It covers syntax, manifest integrity, deterministic-core
  coverage, background integration, browser E2E, UI flows, and failure paths.
  Release validation still needs an unpacked smoke test in an MV2-capable
  Opera build because current Chrome cannot load MV2.
