# Stealth Guard Architecture

## Runtime Model

- Manifest V2 extension with a persistent background page and no build step.
- Plain JavaScript files are loaded directly by the browser.
- Execution contexts:
  1. Background page for shared config, browser policies, messages, notifications, proxy, and sessions.
  2. Isolated content script at `document_start` in every frame.
  3. Injected MAIN-world runtime that patches fingerprinting APIs.
  4. Popup and options pages that communicate with the background.

## Essential Modules

| Path                          | Responsibility                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`               | Permissions, entry points, and script order.                                                                                          |
| `background.js`               | Initialization, config mutations, UA headers, WebRTC policy, proxy application, messages, sessions, context menus, and notifications. |
| `content-scripts/injector.js` | Fail-closed isolated-world bootstrap, trusted config delivery, challenge-frame exclusion, and authenticated alert forwarding.         |
| `content-scripts/main.js`     | MAIN-world Canvas, WebGL, Font, ClientRects, WebGPU, AudioContext, timezone, User-Agent, and WebRTC hooks.                            |
| `lib/config.js`               | Defaults, normalization, User-Agent presets, persistence, and the privacy-safe MAIN-world config projection.                          |
| `lib/domainFilter.js`         | Canonical hostname and wildcard allowlist semantics.                                                                                  |
| `lib/proxy.js`                | Proxy validation, optional location lookup, PAC generation, and browser proxy settings.                                               |
| `lib/session.js`              | Pure hostname, session-name, and cookie-scope helpers.                                                                                |
| `lib/storage.js`              | Promise wrapper for `chrome.storage.local`.                                                                                           |
| `lib/runtime.js`              | Promise-based runtime messaging shared by popup and options.                                                                          |
| `popup/*`                     | Quick controls, current-site allowlist, triggered features, and session switching.                                                    |
| `options/*`                   | Full settings, autosave, proxy profiles, import/export, reset, and tab refresh.                                                       |

## Initialization

1. Background scripts load in manifest order:
   `storage` -> `config` -> `domainFilter` -> `proxy` -> `session` -> `background`.
2. `initializeBackground()` loads normalized config, then applies:
   - HTTP User-Agent header listener.
   - Browser-global WebRTC policy.
   - Proxy settings.
   - Context menus.
3. `onInstalled` reuses initialized state, rebuilds menus, and opens options on first install.
4. Each frame loads:
   `domainFilter` -> `config` -> `main` -> `injector`.
5. The injector immediately installs MAIN-world wrappers with safe defaults, then reads trusted extension storage and updates the mutable MAIN-world config through a private event channel.
6. Cloudflare-owned challenge frames exit before MAIN-world installation.

## State And Data Flow

- Persistent keys:
  - `stealth-guard-config`
  - `stealth-guard-sessions`
  - `stealth-guard-active-sessions`
- Background owns normalized config, the cached `DomainFilter`, config mutation serialization, WebRTC application serialization, notification throttles, and per-tab triggered features.
- Only `createContentConfig()` output enters MAIN world. Proxy profiles and unknown imported fields never do.
- Config updates are saved, applied to affected browser subsystems, rolled back on failure, then broadcast to HTTP(S) tabs.
- MAIN-world alerts carry a per-frame private channel/token; the injector validates them before sending `fingerprint-detected`.

## Runtime Messages

| Type                                                          | Purpose                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `get-config` / `update-config` / `reset-config`               | Read or mutate normalized settings.                              |
| `add-to-whitelist` / `remove-from-whitelist`                  | Mutate the serialized global allowlist field.                    |
| `get-triggered-features`                                      | Read per-tab feature activity.                                   |
| `prepare-proxy-profile`                                       | Validate, normalize, and optionally locate/name a proxy profile. |
| `get-sessions`                                                | List saved sessions for a normalized hostname.                   |
| `save-session` / `switch-session`                             | Snapshot or restore cookies and current-tab web storage.         |
| `rename-session` / `delete-session` / `clear-current-session` | Maintain saved or active site sessions.                          |
| `fingerprint-detected`                                        | Record feature activity and optionally notify.                   |
| `config-updated`                                              | Background-to-injector trusted config broadcast.                 |

## Browser Hooks

- `webRequest.onBeforeSendHeaders`: HTTP User-Agent spoofing.
- `tabs.onUpdated` / `tabs.onRemoved`: triggered-feature cleanup.
- `runtime.onInstalled`: install-only lifecycle work.
- `contextMenus.onClicked`: allowlist actions and protection test link.
- `proxy.onProxyError`: proxy failure reporting.

## Important Guidance

- Preserve MV2 and direct browser loading unless the architecture is intentionally migrated.
- Keep `lib/domainFilter.js` as the only source of allowlist matching semantics.
- Keep MAIN-world configuration restricted to `createContentConfig()`.
- Browser-global WebRTC and proxy settings must not be changed per active tab.
- Session operations must verify that the target tab still belongs to the requested HTTP(S) hostname.
- Run `npm run check`; it includes syntax, manifest validation, 100% deterministic-core coverage, background integration tests, and Chrome-driven end-to-end checks.
