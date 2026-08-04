# Stealth Guard Architecture

## Runtime

Stealth Guard is a Manifest V2 extension with a persistent background page, direct classic-script loading, and no production build step. Code runs in four contexts:

1. The background page owns normalized configuration and browser-wide policy.
2. An isolated content script starts in every frame at `document_start`.
3. An injected MAIN-world function patches fingerprinting APIs.
4. Popup and options pages call the background through runtime messages.

## Essential Modules

| Path | Responsibility |
| --- | --- |
| `manifest.json` | Permissions, entry points, and dependency order. |
| `background.js` | Startup, serialized config mutation/rollback, User-Agent headers, WebRTC policy, messages, notifications, and context menus. |
| `content-scripts/injector.js` | Fail-closed bootstrap, trusted config delivery, challenge-frame exclusion, and authenticated alert forwarding. |
| `content-scripts/main.js` | MAIN-world Canvas, WebGL, Font, ClientRects, WebGPU, Audio, timezone, User-Agent, and WebRTC hooks. |
| `lib/config.js` | Defaults, explicit-schema normalization, persistence, UA presets, and the privacy-safe content projection. |
| `lib/adblock.js` | AdGuard/uBlock-compatible safe filter parsing, network matching, and cosmetic selector lookup. |
| `lib/domainFilter.js` | The sole hostname, wildcard, and allowlist implementation. |
| `lib/proxy.js` | Proxy/profile validation, optional location lookup, PAC generation, and browser proxy settings. |
| `lib/session.js` | Serialized per-site session lifecycle plus hostname and cookie-scope helpers. |
| `lib/runtime.js` / `lib/storage.js` | Promise wrappers for extension messages and storage. |
| `popup/*` | Quick controls, site allowlisting, triggered features, and sessions. |
| `options/*` | Autosaved settings, proxy profiles, import/export, reset, and tab refresh. |

## Initialization And Data Flow

1. Background scripts load in this order: `runtime` → `storage` → `adblock` → `config` → `domainFilter` → `proxy` → `session` → `background`.
2. Background startup loads and normalizes storage, applies the HTTP User-Agent listener, WebRTC policy, and proxy settings, then publishes the config and creates context menus. A failed startup remains unset and is retried by the next message.
3. Frame scripts load in this order: `domainFilter` → `config` → `main` → `injector` → `adblock`.
4. The injector installs MAIN-world wrappers immediately with normalized defaults, then replaces their mutable config with trusted storage/background updates.
5. Only `createContentConfig()` output crosses into MAIN world. Proxy profiles, session data, and unknown imported fields never cross that boundary.
6. Config mutations are serialized, persisted, applied only to affected browser subsystems, rolled back on failure, and broadcast to HTTP(S) tabs.
7. Session mutations are separately serialized. Every cookie/storage mutation rechecks that the target tab is still on the requested HTTP(S) hostname.
8. MAIN-world alerts use per-frame channel names and tokens; the isolated injector authenticates them before sending `fingerprint-detected`.

Persistent keys are `stealth-guard-config`, `stealth-guard-filter-cache`, `stealth-guard-proxy-credentials`, `stealth-guard-proxy-history`, `stealth-guard-sessions`, and `stealth-guard-active-sessions`.

## Interaction Points

- Configuration: `get-config`, `update-config`, `reset-config`, `add-to-whitelist`, `remove-from-whitelist`, and background `config-updated` broadcasts.
- Status and setup: `get-triggered-features`, `fingerprint-detected`, and `prepare-proxy-profile`.
- Sessions: `get-sessions`, `save-session`, `switch-session`, `rename-session`, `delete-session`, and `clear-current-session`.
- Browser hooks: `webRequest.onBeforeSendHeaders`, WebRTC privacy settings, proxy settings/errors, tab update/removal, install, context menus, notifications, cookies, and tab script execution.

## Guidance

- Bump the extension version for every repository change. Keep `manifest.json`, `package.json`, and the root package entries in `package-lock.json` synchronized; use a patch bump unless a different release level is explicitly requested.
- Preserve MV2, the persistent background page, and direct browser loading unless intentionally migrating the architecture.
- Preserve manifest script order; `npm run manifest` enforces it.
- Keep all allowlist/PAC pattern semantics in `lib/domainFilter.js`.
- Keep MAIN-world data restricted to `createContentConfig()`.
- WebRTC and proxy settings are browser-global; never vary them by active tab.
- Keep caller-owned descriptors, arrays, typed arrays, and option objects unchanged when patching browser APIs.
- Run `npm run check`. It covers syntax and manifest integrity, 100% deterministic-core coverage, background integration, and Chromium-driven protection/popup/options workflows. The harness does not load MV2 into current Chrome; perform a native unpacked-extension smoke test in an MV2-capable Opera build for release validation.
