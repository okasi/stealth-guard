# Stealth Guard

Manifest V2 extension: persistent background page, classic scripts, no production
build. `manifest.json` is the authoritative script order and permission list.

## Modules and boundaries

- `background.js`: startup, browser-global policy, request listeners, catalog
  refreshes, toolbar/status, and the runtime message dispatcher.
- `content-scripts/main.js`: serialized MAIN-world protections. Shared factories
  provide descriptor patches, WebGL noise, and inline/nested Worker bootstrap.
- `content-scripts/injector.js`: synchronous default protection, trusted config
  delivery, authenticated alerts, and page diagnostics.
- `content-scripts/adblock.js`: isolated-world cosmetic filtering and picker.
- `popup/`, `options/`: controls, imports/exports, sessions, and self-test UI;
  mutations go through background messages.
- `lib/config.js`: defaults, normalization, effective identity/routing, storage,
  and the explicit `createContentConfig()` page-safe projection.
- `lib/domainFilter.js`: hostname, wildcard, URL-host, and allowlist semantics.
- `lib/adblock.js`, `lib/filterLists.js`: bounded subscription normalization,
  safe filter parsing, indexed matching, and cosmetic selection.
- `lib/gpuProfiles.js`, `lib/curlProfiles.js`: validated GPU assets/imports and
  the canonical browser-identity catalog. `profiles/clearcote/` contains compact
  runtime profiles, their chooser index, and GPL attribution.
- `lib/proxy.js`, `lib/proxyCredentials.js`, `lib/session.js`: proxy policy and
  lookups, serialized credential persistence/authentication, and site sessions.
- `lib/runtime.js`, `lib/storage.js`: browser callbacks, messaging, queues,
  bounded concurrency, and local storage.

## Initialization and data flow

Background order: runtime → storage → filterLists → adblock → gpuProfiles →
curlProfiles → config → domainFilter → proxy → proxyCredentials → session →
background. Independent stored state loads concurrently; policy application
follows. Known messages await startup, retrying a failed initialization.
Extension-page senders use the requested tab; content senders use their own tab.

Content libraries load before main → injector → adblock at `document_start` in
every frame; cosmetic filtering runs only in the top frame. The injector applies
stored settings asynchronously after default wrappers. Project raw config once
with `createContentConfig()`; never re-normalize its projected result. Later
broadcasts supersede pending storage reads. Credentials, endpoints, routes,
sessions, and unknown import fields must remain outside MAIN-world config.

Config writes serialize, persist/apply with rollback, then broadcast to HTTP(S)
tabs. Downloads run outside that queue; catalog commits serialize against the
latest settings and persist before publication. Cosmetic updates invalidate old
responses. Credential writes publish only after storage succeeds. Session
mutations revalidate the target hostname before cookie/web-storage changes.

The curl catalog supplies request, Navigator, client-hint, Worker, and diagnostic
identity; do not add parallel User-Agent tables. URL-backed Workers stay native.
Inline Workers inherit the effective configuration at construction.

## Change and validation rules

- Preserve MV2, classic-script globals, and dependency order. Keep hostname
  matching in `domainFilter`, proxy application in `proxy`, and global
  WebRTC/proxy policy in the background.
- Use `createSerialQueue()` for ordered mutations and `mapWithConcurrency()`
  for bounded independent work. Preserve caller descriptors, options, arrays,
  and buffer regions outside the requested readback.
- Bump the patch version in `manifest.json`, `package.json`, and both root
  `package-lock.json` entries for each change set.
- Run `npm run check`: syntax/bundle compilation, manifest/assets/version checks,
  deterministic-library coverage, background tests, and the Chromium harness.
- Run `OPERA_PATH=/path/to/opera npm run e2e:extension` for release validation.
  It needs an MV2-capable Opera and OpenSSL; it uses a temporary browser profile
  and local HTTPS/proxy fixtures. See `BENCHMARKS.md` for scope and detector checks.
- `reverse-engineering/` contains research and a proposed PRD, not an inventory
  of implemented features. Keep README focused on installation and use.
