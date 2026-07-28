# Stealth Guard browser VPN — master technical PRD

Status: proposed

Audience: product, extension, security, QA, and support

Primary platform: Stealth Guard Manifest V2 persistent-background extension

Research inputs: [Windscribe Chrome extension](https://chromewebstore.google.com/detail/free-vpn-for-chrome-vpn-e/hnmpcagpplmpfojmgmnngilcnanddlhb), [ExpressVPN Chrome extension](https://chromewebstore.google.com/detail/expressvpn-vpn-proxy-brow/fgddmllnllkalaagkghckoinaemmogpe), and [Proton VPN Chrome extension](https://chromewebstore.google.com/detail/proton-vpn-fast-secure/jplgfhpmjnbigmhklmmbgecoobifkmpa).

## 1. Product decision

Build a provider-neutral **browser VPN mode** on top of Stealth Guard's existing proxy/profile/PAC system. Users provide raw browser-proxy credentials, proxy profiles, or Stealth Guard provider bundles; Stealth Guard does not provide user accounts or an OAuth login. The first release will route supported browser traffic through configured HTTP(S)/SOCKS proxy endpoints, add reliable connection and server-selection behavior, expose understandable split tunneling, and synchronize VPN location with Stealth Guard's leak/fingerprint protections.

This is not a device-wide VPN. Stealth Guard will not ship or depend on a native companion.

Chrome's proxy API can consume proxy endpoints, but it cannot execute OpenVPN, WireGuard, IKEv2, or other tunnel configurations. Therefore Stealth Guard supports browser-proxy configuration only. A provider that distributes `.ovpn` or similar tunnel profiles must also expose an HTTP(S) or Chrome-compatible SOCKS proxy endpoint; otherwise it is incompatible.

| User-supplied input | Result |
| --- | --- |
| HTTP(S) proxy host/port and credentials | Supported |
| Chrome-compatible SOCKS endpoint | Supported within Chrome API limitations |
| Provider username/password without a proxy endpoint | Insufficient; reject with an explanation |
| OpenVPN `.ovpn`, WireGuard, IKEv2, or other tunnel profile | Unsupported; reject without saving secrets or changing proxy settings |

## 2. Goals and success measures

### Goals

1. Connect the browser to a selected or automatically chosen compatible proxy endpoint with bounded recovery and truthful status.
2. Safely import, store, use, and remove user-supplied service credentials while preventing origin servers from receiving proxy authentication material.
3. Support global, bypass/exclude, include-only, and per-domain location routing through a single browser-global PAC policy.
4. Detect proxy ownership conflicts and proxy failures without silently reporting a protected state.
5. Coordinate WebRTC, geolocation, timezone, language, user-agent, and other existing Stealth Guard protections with the effective VPN route.
6. Preserve MV2, persistent background, classic-script loading, current manifest order, serialized config mutation/rollback, and the `createContentConfig()` boundary.

### Success measures

- At least 99% of successful connect attempts reach verified `CONNECTED` within 10 seconds on a healthy test network.
- No proxy credential is returned for an origin-auth challenge, an unknown proxy hostname, or after the retry bound.
- A route corpus of at least 1,000 allow/bypass/include/location rules compiles deterministically and matches the reference hostname evaluator.
- Browser restart and extension background restart reconcile to the correct protected/unprotected state without a false-positive protected badge.
- A proxy-control conflict is visible within 2 seconds of the settings event.
- Real-browser release validation shows no public HTTP(S)/WebSocket direct fallback while fail-closed mode is active and the selected proxy is unreachable.

## 3. Non-goals

- Tunneling other applications or the operating system.
- Supporting arbitrary UDP or claiming full DNS-tunnel coverage.
- Importing or executing WireGuard, OpenVPN, IKEv2, or TUN-interface configurations. Providers must supply a compatible browser proxy endpoint instead.
- Reusing vendor endpoints, credentials, server lists, source code, branding, or proprietary location data.
- Building Secure Core/multi-hop inside the extension. Multi-hop requires compatible provider proxy endpoints.
- Shipping or integrating with any native desktop host.
- Replacing Stealth Guard's existing fingerprinting or allowlist architecture.

## 4. Personas and primary journeys

### Quick-connect user

The user imports or enters a service configuration, clicks Connect, receives the fastest healthy configured endpoint, sees a verified exit location/IP, and can disconnect with one click.

### Configuration-import user

The user pastes proxy credentials or imports a structured Stealth Guard provider bundle. Stealth Guard validates and previews all endpoints and secrets before saving. If the user selects an OpenVPN, WireGuard, or other tunnel profile, Stealth Guard rejects it with a clear browser-proxy compatibility explanation and does not retain its contents.

### Location user

The user searches countries/cities, inspects availability/load, chooses a logical location, reconnects to a different physical endpoint if required, and can reuse recent/favorite locations.

### Split-tunnel user

The user chooses one of three comprehensible policies:

- **Protect all**: proxy public traffic except explicit bypass rules.
- **Bypass selected sites**: protect all except listed domains.
- **Protect selected sites**: direct by default and proxy only listed domains.

An advanced route may send a domain to a specific VPN location. Every direct rule warns that the site will see the user's direct IP and may see direct DNS/WebRTC behavior.

### Failure-sensitive user

The user selects Standard recovery or Fail Closed. Standard recovery tries alternate endpoints and then disconnects visibly. Fail Closed keeps a mandatory blocking proxy policy applied until recovery or an explicit disconnect.

## 5. Product scope and priority

### P0 — required for initial credential-based VPN

- Manual entry and import of HTTP, HTTPS, SOCKS4, and SOCKS5 endpoints; username/password authentication is P0 for HTTP(S), while SOCKS authentication is enabled only where verified to work through the target browser API.
- A versioned Stealth Guard provider-bundle format for multiple endpoints, logical locations, routing defaults, and optional health/check-IP metadata.
- Early rejection of OpenVPN, WireGuard, IKEv2, and other tunnel-profile formats without persisting file contents or changing proxy state.
- Secure-by-design secret handling, redacted UI/logs/exports, clear/delete controls, and session-only or persisted credential choices.
- Quick Connect, explicit location connect, disconnect, reconnect, and change location.
- Authenticated HTTP(S) proxy support via `onAuthRequired`; SOCKS behavior follows Chrome's supported proxy model and must not claim unsupported username/password handling.
- Logical location → physical endpoint selection and bounded failover.
- External exit-IP/location verification.
- Proxy ownership/conflict detection.
- Protect-all and bypass-selected policies.
- WebRTC leak prevention while protected.
- Restart recovery, error taxonomy, toolbar/popup status, and minimal diagnostics.
- Standard and Fail Closed failure policies.

### P1 — competitive routing and usability

- Include-only split tunneling.
- Per-domain location routes.
- Fastest, random, and last-location strategies.
- Search, recents, favorites, endpoint/load hints, and auto-connect on browser start.
- Proxy port/protocol alternatives supplied by the imported configuration.
- Connection notifications and consented diagnostic export.
- Location/timezone/language alignment with the effective route.
- Managed settings for organizations.

### P2 — provider-dependent differentiation

- Multi-hop/Secure-route catalog and UI.
- Dedicated IP endpoints and lifecycle UI.
- Related-domain rule groups.
- Free-tier rotation/cooldown and quota UI.
- Service announcements/offers.

Windscribe-style content blocking and Stealth Guard's existing anti-fingerprinting features remain adjacent privacy capabilities, not prerequisites for VPN transport.

## 6. Coverage and claims

The UI and documentation must state:

- “Protects supported traffic in this browser through the configured proxy connection.”
- “Does not protect other applications or your whole device.”
- “Sites set to Direct can see your normal network identity.”
- “Some control traffic, local addresses, and configured bypass destinations do not use the proxy.”

Only verified HTTPS proxy profiles may be described as encrypting the browser-to-proxy hop. HTTP and SOCKS profiles remain available as Custom Proxy profiles but receive no encryption claim. Product/security documentation must describe what the proxy operator can observe and how onward traffic is handled. Marketing must not claim full-device VPN, universal DNS tunneling, or UDP coverage for browser-only mode.

## 7. Functional requirements

### 7.1 Configuration import and credentials

- **VPN-CRED-001**: Do not require Stealth Guard account creation, OAuth, subscription, or entitlement APIs. Connection inputs are supplied directly by the user or an administrator.
- **VPN-CRED-002**: Support manual proxy profiles with scheme, host, port, optional username/password, display name, logical location metadata, and optional health/check URL.
- **VPN-CRED-003**: Support a versioned JSON provider bundle containing multiple logical locations and endpoints. Normalize through an explicit schema; reject unknown executable fields, PAC JavaScript, scripts, and remote code.
- **VPN-CRED-004**: Reject `.ovpn`, WireGuard, IKEv2, and other tunnel-profile formats before import. Show “Stealth Guard requires an HTTP(S) or compatible SOCKS proxy endpoint; this tunnel configuration cannot run in a Chrome extension.”
- **VPN-CRED-005**: Rejected tunnel profiles must not be persisted, logged, copied into diagnostics, parsed for private keys, or cause any proxy-setting mutation.
- **VPN-CRED-006**: Treat supported provider bundles as hostile. Enforce file-size, endpoint-count, string-length, encoding, hostname, port, and explicit-schema limits; reject scripts, PAC JavaScript, remote code, local file references, and certificate/private-key fields.
- **VPN-CRED-007**: Offer **Use for this browser session** and **Save on this device**. Explain that extension local storage is not an operating-system credential vault and can be read if the extension context or browser profile is compromised.
- **VPN-CRED-008**: Never put usernames, passwords, private keys, inline certificates, tokens, or full imported configs in PAC, logs, notifications, normal exports, URL query strings, MAIN-world config, or content-script messages.
- **VPN-CRED-009**: `onAuthRequired` may answer only when `details.isProxy` is true and the challenger exactly matches an active configured proxy endpoint.
- **VPN-CRED-010**: Bound authentication retries by request ID, cancel unknown/repeated challenges, and clear counters on completion/error. Never answer an origin-server authentication challenge.
- **VPN-CRED-011**: Editing/removing a profile or clearing credentials immediately clears its in-memory secret, request retry state, active connection, and persisted secret when applicable.
- **VPN-CRED-012**: Normal configuration export redacts secrets. A separate secret-inclusive backup requires an explicit warning and should use user-supplied encryption; otherwise it is not offered.

### 7.2 Location directory and selection

- **VPN-LOC-001**: A provider bundle may contain a versioned directory of logical locations, physical endpoints, supported ports/protocols, availability hints, features, and stable IDs. Manual profiles form a one-location directory locally.
- **VPN-LOC-002**: UI names and country/city metadata belong to logical locations; hostnames and ports belong to physical endpoints. Bundle-derived endpoints are read-only until converted into manual profiles.
- **VPN-LOC-003**: Persist the last normalized imported directory. If a bundle declares a remote refresh URL, refresh only with explicit consent, HTTPS, an allowlisted origin, an explicit maximum staleness, and signature verification. Reject invalid signatures/schema versions.
- **VPN-LOC-004**: Quick Connect scores only configured, healthy endpoints using available capacity/load hints, latency or geographic distance, recent failure penalty, and small jitter to prevent herding.
- **VPN-LOC-005**: Support fastest, random, last choice, explicit logical location, recent locations, and favorites. A random choice must still exclude unavailable endpoints.
- **VPN-LOC-006**: Rotate physical endpoints without changing the user's logical location when possible.
- **VPN-LOC-007**: Directory and selection code must not expose imported files, provider hostnames, or credentials to page contexts.

### 7.3 Proxy policy and PAC

- **VPN-PROXY-001**: Extend the existing `lib/proxy.js`; it remains the only browser proxy application layer.
- **VPN-PROXY-002**: Preserve a fast `fixed_servers` path only when there is one active HTTPS proxy and no routing rule requiring PAC. All other modes use `pac_script` with `mandatory: true`.
- **VPN-PROXY-003**: A PAC result may return an ordered list of compatible HTTPS endpoints for same-location fallback.
- **VPN-PROXY-004**: PAC must route local/plain hostnames, loopback, RFC 1918 private ranges, and explicitly required directory/health/check endpoints directly.
- **VPN-PROXY-005**: Public HTTP, HTTPS, FTP, WS, and WSS behavior must be explicitly tested. Unsupported schemes route direct and are documented.
- **VPN-PROXY-006**: Compile routing precedence deterministically:
  1. non-proxyable/local/control destinations → Direct;
  2. explicit safety bypass → Direct;
  3. user domain rule → Direct or named logical location;
  4. include-only miss → Direct;
  5. default active location → its endpoint list;
  6. otherwise → Direct.
- **VPN-PROXY-007**: Use `lib/domainFilter.js` for normalization and matching semantics. PAC compilation must be tested against that reference implementation.
- **VPN-PROXY-008**: Escape all PAC literals, cap rule count/size, prohibit arbitrary PAC input, and reject ambiguous or invalid patterns during config normalization.
- **VPN-PROXY-009**: Proxy configuration is browser-global and must never vary based on active tab.
- **VPN-PROXY-010**: Before and after each settings mutation, inspect `levelOfControl` and effective value. Surface `CONFLICT` when another extension/policy owns the proxy.
- **VPN-PROXY-011**: On normal disconnect, remove the VPN policy and restore the recorded safe prior mode only if Stealth Guard still owns the setting. Existing Stealth Guard custom-proxy behavior must remain explicit and must not be silently overwritten.

### 7.4 Split tunneling and domain routes

- **VPN-ROUTE-001**: Offer Protect All, Bypass Selected, and Protect Selected as mutually exclusive top-level policies.
- **VPN-ROUTE-002**: Domain rules support exact domain, domain plus subdomains, Direct, Default VPN, or a named logical VPN location.
- **VPN-ROUTE-003**: The current global allowlist remains semantically Direct and takes precedence over configured browser VPN routing unless the user deliberately changes that product contract.
- **VPN-ROUTE-004**: UI must show the effective rule for the current tab and why it matched.
- **VPN-ROUTE-005**: Direct rules display an exposure warning at creation and in route details.
- **VPN-ROUTE-006**: Related-domain groups, if added, must be transparent, versioned, and editable after expansion. No hidden vendor-defined routing.
- **VPN-ROUTE-007**: A config mutation persists, applies, verifies, and broadcasts atomically through the existing serialized rollback path.

### 7.5 Connection lifecycle and resilience

Canonical states:

`UNCONFIGURED`, `IDLE`, `CONNECTING`, `CONNECTED`, `DEGRADED`, `RECONNECTING`, `DISCONNECTING`, `ERROR`, `CONFLICT`, and `UNSUPPORTED_CONFIG`.

- **VPN-CONN-001**: A successful `chrome.proxy.settings.set` is not a successful connection. `CONNECTED` requires an exit check through the effective proxy.
- **VPN-CONN-002**: The exit check returns observed IP, location, proxy/service request ID, and freshness; verify it is compatible with the selected logical location.
- **VPN-CONN-003**: Connect is serialized and cancellable. A newer user intent supersedes an older pending attempt.
- **VPN-CONN-004**: Retry the current endpoint only for transient errors, then rotate physical endpoints, then optionally reselect the same country/fastest location. Backoff is bounded and jittered.
- **VPN-CONN-005**: Do not retry invalid credentials, unsupported configuration, policy conflict, invalid directory, or user disconnect as transient network failures.
- **VPN-CONN-006**: Standard mode restores an unprotected state after retries are exhausted and clearly reports the failure.
- **VPN-CONN-007**: Fail Closed mode leaves a mandatory PAC with no public `DIRECT` fallback, reports `ERROR — traffic blocked`, and remains until recovery or explicit disconnect.
- **VPN-CONN-008**: A toolbar “Protected” state requires both ownership of effective proxy settings and recent verification. Stale verification produces `DEGRADED`, not a false protected status.
- **VPN-CONN-009**: Persist connection intent and non-secret selected logical IDs. On background/browser startup, reconcile intent, credentials, actual proxy settings, and reachability before broadcasting status.
- **VPN-CONN-010**: Auto-connect waits for normalized configuration and available credentials and never races startup proxy restoration.

### 7.6 Leak and fingerprint coordination

- **VPN-PRIV-001**: When protected and enabled, set `chrome.privacy.network.webRTCIPHandlingPolicy` to `disable_non_proxied_udp`; restore the prior/default value on disconnect only if Stealth Guard still controls it.
- **VPN-PRIV-002**: WebRTC is browser-global. Never vary the Chrome privacy setting by active tab; warn that Direct routes weaken the guarantee for those sites.
- **VPN-PRIV-003**: Pass only privacy-safe, normalized effective route metadata through `createContentConfig()`—for example country code, timezone, language, coarse coordinates, and protection state. Never include imported configuration, endpoint hosts, secrets, route tables, or proxy credentials.
- **VPN-PRIV-004**: Geolocation spoofing should use service-provided coarse location centroids with bounded per-session jitter and internally consistent accuracy.
- **VPN-PRIV-005**: Timezone, language, and user-agent policies must follow explicit user settings. “Match VPN” uses the effective route for the current site; a Direct route must not pretend to be VPN-routed without a clear override.
- **VPN-PRIV-006**: Existing Canvas/WebGL/Font/ClientRects/WebGPU/Audio protections remain independent of connection status.

### 7.7 UI, diagnostics, and support

- **VPN-UI-001**: Popup shows actual state, selected/effective location, connect/disconnect, exit verification age, current-site route, and concise errors.
- **VPN-UI-002**: Location picker supports search, country/city grouping, fastest/recent/favorite sections, availability, and accessible keyboard navigation.
- **VPN-UI-003**: Options contain configuration import/profile management, credential persistence choice, auto-connect, failure policy, split tunneling, leak protection, diagnostics consent, and coverage explanation.
- **VPN-UI-004**: Changing mode or location previews whether it will disconnect, preserve site rules, or expose direct traffic.
- **VPN-UI-005**: Error messages distinguish missing configuration, incompatible tunnel profile, missing credentials, network offline, proxy timeout, proxy authentication, server failure, verification mismatch, settings conflict, and invalid policy.
- **VPN-DIAG-001**: Local diagnostics contain timestamps, state transitions, logical IDs, redacted error categories, proxy-control state, and build/platform versions. They never contain URLs visited, tokens, passwords, raw cookies, full IPs, or unredacted proxy hosts.
- **VPN-DIAG-002**: Diagnostic upload and product analytics are off unless covered by an explicit, documented consent and retention policy.
- **VPN-DIAG-003**: Provide a user-visible export and clear action. Debug logs use bounded ring storage.

### 7.8 Managed policy and custom proxies

- **VPN-MGMT-001**: Managed policy may lock auto-connect, allowed locations, split-tunnel mode/rules, WebRTC protection, Fail Closed, diagnostics, and whether custom proxies are permitted.
- **VPN-MGMT-002**: Managed values are visibly locked and schema-normalized before use.
- **VPN-CUSTOM-001**: Existing user-created SOCKS/HTTP/HTTPS profiles become the foundation of credential-based browser VPN mode while retaining a clear **Custom Proxy** label where coverage guarantees cannot be verified.
- **VPN-CUSTOM-002**: Secrets are stored separately from normalized, normally exportable profile metadata.
- **VPN-CUSTOM-003**: The user chooses one default route owner. Per-domain routes can combine profiles only when PAC precedence is unambiguous.

## 8. Proposed extension architecture

Preserve background script order and insert new classic-script modules before `background.js` only through an intentional manifest update verified by `npm run manifest`:

| Module | Responsibility |
| --- | --- |
| `lib/vpnImport.js` | validate provider bundles and reject tunnel-profile formats without retaining their contents |
| `lib/vpnDirectory.js` | normalize, cache, and query imported logical locations/physical endpoints |
| `lib/vpnCredentials.js` | session/persisted secret handling and strict proxy 407 handler |
| `lib/vpnRouting.js` | normalized route model and deterministic PAC inputs using `domainFilter` |
| `lib/vpnConnection.js` | serialized intent/state machine, endpoint scoring, retries, verification, recovery |
| `lib/proxy.js` | remains sole settings/PAC application layer; gains endpoint lists and direct/include route actions |
| `background.js` | startup orchestration, messages, browser listeners, broadcasts, notifications |

No new module may install its own competing proxy-setting listener or hostname matcher.

### Background-only data

- Raw supported provider-bundle input while it is being validated.
- Proxy usernames/passwords.
- Full directory, physical endpoint hosts/ports, endpoint health.
- Complete route table, diagnostics, retry counters, request authentication map.

### Content projection

Only the output of `createContentConfig()` crosses to MAIN world. Add a minimal effective-site projection if needed:

```text
vpn: {
  protected: boolean,
  route: "vpn" | "direct",
  countryCode: string,
  timezone: string,
  languages: string[],
  coarseLocation: { latitude, longitude, accuracy } | null
}
```

This object contains no provider identifiers, endpoint details, imported configuration, credentials, certificate/key material, or other sites' rules.

## 9. Data model

Illustrative normalized state; exact names may change during implementation:

```text
config.vpn = {
  enabled,
  profileSetId,
  credentialPersistence: "session" | "device",
  autoConnect,
  selection: { strategy, logicalLocationId },
  routingMode: "protect-all" | "bypass-selected" | "protect-selected",
  routes: [{ pattern, includeSubdomains, action, logicalLocationId? }],
  failurePolicy: "standard" | "fail-closed",
  preventWebRTC,
  alignFingerprint: { geolocation, timezone, languages },
  diagnosticsConsent
}

runtime.vpn = {
  state,
  intentId,
  logicalLocationId,
  physicalEndpointId,
  verifiedAt,
  observedExitSummary,
  lastError,
  retryStage,
  proxyControlLevel
}
```

Persist normalized preferences, non-secret profile metadata, logical IDs, imported directory data, and connection intent. Keep credentials, request retry maps, and transient endpoint health in memory for session-only mode. Device persistence requires an explicit warning because extension storage is not a secure enclave. Tunnel-profile contents and private keys are never persisted.

## 10. Configuration and provider contracts

Stealth Guard does not require its own authentication backend. It accepts these input classes:

1. **Manual browser proxy** — scheme, host, port, optional username/password, display/location metadata, and optional check-IP URL.
2. **Stealth Guard provider bundle** — versioned JSON containing logical locations, browser-compatible endpoints, routing defaults, optional refresh/health metadata, and optional embedded credentials.

OpenVPN, WireGuard, IKEv2, and other tunnel configurations are explicitly outside this contract and are rejected.

A provider used in browser-proxy mode must supply reachable HTTP(S) or Chrome-compatible SOCKS endpoints and document authentication, traffic-class support, DNS behavior, capacity, privacy/retention, and acceptable use. Optional remote directories or health feeds must use HTTPS and signed, schema-versioned responses. Check-IP services must resist caching and return enough coarse metadata to verify that the configured route is active.

Control/check endpoints that bypass the proxy need a narrow explicit list. Avoid broad provider-domain bypasses.

## 11. Error taxonomy

| Category | Examples | Retry | User outcome |
| --- | --- | --- | --- |
| Offline | browser/network unavailable | wait for online | connecting or blocked if Fail Closed |
| Directory | unavailable, stale, invalid signature | cached fallback if valid; bounded refresh | error, never trust invalid data |
| Credentials | 407, missing/wrong username or password | bounded challenge retry | edit or clear credentials |
| Endpoint | timeout, tunnel failure, 5xx | rotate endpoint and back off | reconnect/degraded/error |
| Verification | direct IP, wrong country, stale/cached response | rotate/reapply once | never show Protected |
| Policy conflict | not controllable/overridden | no automatic fight loop | conflict instructions |
| Configuration | invalid route/profile/PAC limit | no | rollback mutation |
| Unsupported config | tunnel profile or unsupported proxy scheme | no | explain that a browser proxy endpoint is required |

## 12. Security and privacy requirements

- Threat model malicious pages, malicious origin authentication challenges, compromised stored config, hostile imported settings, other proxy extensions, stale directory/cache, service-worker/background restart, captive portals, and local network destinations.
- Keep exact-host allowlists for authentication challengers; wildcard only a dedicated proxy service suffix after validation.
- Never ship a static shared proxy credential. User-supplied credentials belong only to that user's local profile.
- Reject tunnel-profile files without retaining or rendering their contents; a failed import must not leave private keys or credentials in state.
- Ensure PAC strings cannot escape into executable code; use schema limits and differential tests.
- Treat local/private bypass as a documented privacy tradeoff and prevent user-created patterns from overriding required control safety in unsafe ways.
- Clear or restore proxy/WebRTC settings on uninstall/disable where browser lifecycle permits; never clear another controller's setting.
- Redact endpoints and IPs from routine logs. Do not record browsing destinations.
- Complete legal review for proxy operation, abuse handling, data processing, sanctions/export controls, consumer claims, and jurisdiction before launch.

## 13. Rollout plan

### Phase 0 — contract and threat model

Freeze product claims, provider-bundle schema, unsupported-format detection, credential-persistence behavior, endpoint trust model, routing precedence, prior-setting restoration behavior, and incident procedures. Build a fake local authenticated proxy/directory service for deterministic testing.

### Phase 1 — credential-based connection core

Add manual HTTP(S)/SOCKS profiles, strict 407 handling, secret lifecycle, connection state machine, ownership checks, exit verification, WebRTC policy, restart reconciliation, and popup status. Ship behind a development flag.

### Phase 2 — directory and resilience

Add imported-directory normalization, optional signed remote refresh, logical/physical model, Quick Connect scoring, endpoint rotation, auto-connect, recents/favorites, Standard/Fail Closed recovery, and production-grade diagnostics.

### Phase 3 — routing

Add bypass-selected, include-only, and per-location rules; current-site explanation; direct-route warnings; deterministic PAC differential tests; and migration of existing custom profiles.

### Phase 4 — location alignment and policy

Add coarse geolocation/timezone/language synchronization, managed settings, optional quota/load/cooldown UI, and polish/accessibility/localization.

### Phase 5 — provider extensions

Only after provider proxy support: multi-hop, dedicated IP, and related-domain groups.

Each phase requires `npm run check` plus manual unpacked-extension validation in an MV2-capable Opera build.

## 14. Test and release acceptance

### Deterministic core tests

- Schema normalization rejects unknown executable fields and invalid credential/endpoint data in user imports.
- Unsupported tunnel-profile detection rejects representative OpenVPN, WireGuard, and IKEv2 files without storing contents or applying settings.
- Domain patterns produce identical decisions in `domainFilter` and generated PAC for exact, wildcard, suffix, prefix, IDN, mixed-case, port-bearing URL, and invalid inputs.
- PAC literals resist quotes, slashes, control characters, and code-injection payloads.
- Route precedence covers local/control, allowlist, direct, named location, include-only miss, default, and disconnected cases.
- Fastest selection is deterministic under a fixed random seed and excludes down/ineligible endpoints.
- Retry state stops at limits and immediately honors a newer disconnect/change-location intent.
- Credentials are returned only for exact configured proxy challenges and never for origin authentication.

### Background integration tests

- Settings set/get, level-of-control conflict, rollback, proxy error, auth challenge, tab broadcasts, startup recovery, offline/online, credential removal/change, and config update serialization.
- WebRTC setting applies only as a browser-global consequence of protected state and restores safely.
- No full VPN config, secret, endpoint, certificate/key material, or credential field appears in `createContentConfig()` or page-facing messages.
- Custom proxy profiles and existing allowlists retain documented behavior after migration.

### Browser workflows

- Enter/import credentials, connect fastest, verify exit, change location, reconnect, disconnect, auto-connect, browser restart, extension restart, clear secrets.
- Select representative OpenVPN, WireGuard, and IKEv2 files and confirm the UI reports Unsupported Configuration without retaining contents or applying browser proxy settings.
- Create each routing mode and verify two tabs simultaneously take different PAC decisions without changing global settings.
- Simulate dead endpoint, bad credential, missing saved credential after restart, captive portal, check-IP mismatch, another proxy extension, and managed policy.
- Confirm Direct-rule warning and effective route in popup.
- Confirm Fail Closed blocks public traffic through endpoint exhaustion and remains visibly blocked.
- Confirm HTTP(S), FTP, WS/WSS, WebRTC, geolocation, timezone, and service-control bypass behavior.

### Release gates

- Security review of proxy-auth challenge handling, credential/config storage, unsupported-file rejection, optional directory verification, PAC compiler, content projection, and logging.
- Privacy/legal approval of product claims and data flows.
- Accessibility and localization review.
- Load/failover exercise against production-like proxy capacity.
- Manual Opera MV2 smoke test and `npm run check` green.

## 15. Open decisions

1. Which browser-proxy provider-bundle schema and import formats beyond manual profiles are required for the first release?
2. What is the exact interaction between the existing global allowlist and VPN-only split tunneling?
3. Should disconnect restore system proxy or a recorded prior custom Stealth Guard profile?
4. Which check/health/directory endpoints must be direct, and can configuration avoid remote control dependencies?
5. Which proxy protocols and browser traffic classes must imported providers guarantee?
6. Should device-persisted raw credentials be allowed by default, given extension storage is readable to a compromised extension context?
7. Does Fail Closed remain enabled across restart when session-only credentials have disappeared, and what is the safe recovery UI?
8. Which effective-route attributes should drive timezone/language/geolocation spoofing on Direct routes?
9. Are free-tier rotation, multi-hop, or dedicated IP part of the business model, and what backend capabilities exist?
10. Which provider documentation or discovery mechanisms can reliably tell users where to obtain browser-proxy endpoints instead of tunnel profiles?

## 16. Recommendation

Start with Phase 0 and a fake authenticated proxy plus representative provider bundles, then implement P0 as an extension of the current serialized proxy architecture. The highest-risk work is not the connect button; it is safe raw-secret handling, hostile config parsing, accurate protected-state verification, PAC precedence, ownership conflicts, and fail-closed behavior. Do not add native messaging or any tunnel-runtime path.
