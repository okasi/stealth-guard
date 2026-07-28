# Comparative reverse-engineering findings

## Executive comparison

| Capability | Windscribe 4.2.8 | ExpressVPN 8.0.10.1876 | Proton VPN 1.3.5 |
| --- | --- | --- | --- |
| Standalone transport | HTTPS forward proxy through PAC | HTTPS forward proxy through PAC | HTTPS forward proxy; fixed server or PAC |
| Device-wide VPN | No | Yes, only by controlling desktop app | No |
| Proxy authentication | HTTP 407 challenge credentials | short-lived connection token as proxy credential | short-lived browser proxy token |
| Default location | Autopilot/best | Smart Location | fastest, random, or last choice |
| Per-site routing | direct allowlist and location rules | URL/country rules: direct or chosen location | exclude/bypass and include-only modes |
| Failover | endpoint retries, same-country/best fallback | alternate endpoint plus reconnect/error paths | alternate physical server and credential retry |
| Fail-closed option | Smokewall | desktop Network Lock only; no equivalent confirmed for standalone proxy | connection waiter/recovery primitives; no user-facing kill switch confirmed |
| Secure/multi-hop | no equivalent confirmed | no equivalent confirmed in proxy mode | Secure Core service locations |
| WebRTC protection | global browser privacy setting | global browser privacy setting | global browser privacy setting |
| Geolocation spoof | yes | yes | no equivalent confirmed |
| Other privacy suite | extensive blocker and anti-fingerprinting suite | focused on VPN, spoofing, diagnostics | focused on VPN, policy, notifications |

All three must manage a browser-global proxy setting. Their per-site behavior is implemented by compiling routing policy into one PAC program, not by changing the proxy when the active tab changes.

## Windscribe

### VPN and routing architecture

Windscribe installs a mandatory PAC script. A selected datacenter contributes multiple HTTPS proxy endpoints to the PAC result, giving Chrome an ordered fallback list. Users can select port 443 or 9443. The PAC sends local/private addresses, non-proxyable protocols, Windscribe control endpoints, and allowlisted destinations directly.

Connection flow:

1. Validate account/session and remaining data entitlement.
2. Select Autopilot or a user-selected country, city, and datacenter.
3. Compile endpoints plus direct/location-specific rules into PAC.
4. Apply the browser-global proxy setting.
5. Answer only proxy HTTP 407 challenges with the active proxy credentials.
6. verify the external IP using a check-IP service.
7. synchronize spoofing and toolbar/UI state.

The implementation checks `chrome.proxy.settings` for control by another extension or policy. Proxy errors trigger endpoint retry; policy can then choose the best location, another datacenter in the same country, or no fallback. Smokewall is the strongest fail-closed behavior among the three products: after the endpoint set is exhausted, Windscribe can leave a mandatory, non-working proxy policy active instead of restoring direct access.

### User-visible feature inventory

- Autopilot, location search, country/city/datacenter selection, favorites, sorting, location load, and keyboard shortcuts.
- Auto-connect, connection notifications, two selectable HTTPS proxy ports, external-IP validation, retry/failover policy, and Smokewall.
- Per-domain allowlist options for direct connection, ads, privacy features, and all subdomains. “Cruise Control” can route a domain through a specific location.
- Account sign-in/sign-up/sign-out, session polling, plan/data-usage state, newsfeed, preference import/export, themes, debug logging, and context menus.
- Ad Crusher, tracker/malware lists, Social Distancing, Cookie Go Away, regional/annoyance filters, link sanitization, and an embedded uBlock Lite-style dashboard backed by declarativeNetRequest rules.
- WebRTC Slayer, Location Warp, Time Warp, Language Warp, Split Personality/user-agent rotation, Worker/SharedWorker/service-worker blocking, notification blocking, and browser advertising-privacy controls.

### Lessons for Stealth Guard

Windscribe is the best reference for connection resilience and for coordinating VPN location with an existing fingerprint-protection suite. Its important patterns are mandatory PAC, several endpoints per location, explicit proxy ownership checks, authenticated challenge scoping, post-connect exit verification, and a user-selected failure policy.

## ExpressVPN

### Two materially different modes

**Proxy Mode** is standalone and covers supported traffic in the current browser. It authenticates with an OAuth/PKCE-style web flow, validates signed tokens, fetches a proxy-capable location directory, chooses a location endpoint, supplies a short-lived connection authorization token during proxy authentication, and validates connectivity through ping endpoints.

**Remote Control Mode** uses native messaging host `com.expressvpn.helper` to control the desktop application. Commands cover status, preferences, location selection, connect/disconnect/retry, sign-out/reset, and opening app screens. In this mode the desktop application supplies the device-wide VPN and features such as Network Lock. This architecture would require a separately installed and signed native host; adding `nativeMessaging` alone cannot make an extension device-wide.

### Smart Routing

Proxy Mode always expresses policy as PAC:

- A normal connected state sends most public traffic through one selected HTTPS proxy location.
- URL rules can send matching sites directly or through another location.
- Country rules map country-code domains to a selected proxy action.
- Associated-domain groups expand a rule to related service domains.
- Local names, private networks, authentication/API endpoints, and other service-owned control endpoints bypass the proxy.
- Smart Routing rules may stay active while the main connection is shown as off, so matching sites can still use a proxy.

The released UI warns that direct Smart Routing rules can expose IP, DNS, or WebRTC data for those sites.

### User-visible feature inventory

- Smart Location; recommended, all, recent, country, and city views; location search and location switching.
- Connect on browser launch, desktop notifications, reconnect/error states, diagnostics, IP/DNS/WebRTC leak-test links, and proxy-control conflict handling.
- Smart Routing by URL or country, with either “automatically connect to proxy” at a chosen location or “disable proxy.”
- Browser WebRTC blocking and HTML geolocation spoofing. The geolocation hook runs in the MAIN world at `document_start` and adds a small randomized offset around the VPN location.
- Dedicated IP purchase/setup/unlock/status UI. In Remote Control Mode, some details are delegated to the desktop application.
- Mode switching, account/subscription state, sign-out, referrals/promotions, ratings, support/chat/reporting, acknowledgements, language and display preferences.
- Consent-controlled crash, usability, speed-test, and connection diagnostics integrations; feature flags are present in the released bundle.

### Lessons for Stealth Guard

ExpressVPN provides the clearest product language for browser-versus-device coverage and the richest per-site routing model. Its credential scoping and Smart Routing behavior are useful references. Stealth Guard's product scope deliberately excludes ExpressVPN-style native desktop control.

## Proton VPN

### VPN and routing architecture

Proton uses HTTPS proxies and short-lived browser tokens. Regular global or exclude-list connections use `fixed_servers` with one `singleProxy`; include-only split tunneling uses PAC because only selected domains should be proxied. Localhost, plain hostnames, loopback, and RFC 1918 private networks remain direct. Proton service/API domains required for control traffic are also excluded from the tunnel.

Proxy credentials are fetched for a limited lifetime, cached, refreshed before expiry with jitter, and supplied only when a known Proton proxy issues a proxy authentication challenge. Authentication attempts are serialized and repeated challenges are bounded. The extension watches effective proxy control; if policy or another extension supersedes it, the UI disconnects with an explicit error.

The location directory distinguishes logical locations from physical endpoints. The fastest-location score incorporates availability/load, geographic distance, service cost/penalties, and small jitter. A down endpoint can be replaced with another physical server. Directory responses are cached and conditionally refreshed.

Secure Core locations expose an entry-country-to-exit-country choice. From the extension's perspective it is still one HTTPS proxy endpoint; the additional hop is implemented by Proton's service network.

### User-visible feature inventory

- Quick Connect using fastest, random, or last choice; country/city/server selection; search; recent choices; auto-connect and server-load display.
- Free-tier server rotation with cooldowns, paid-feature gates, upgrade surfaces, offers, notifications, support, rating, about, and onboarding.
- Secure Core, with entry and exit location presentation.
- Split tunneling with independent exclude/bypass and include-only domain lists, including subdomain options.
- Optional WebRTC protection while connected.
- Proton account-site integration, access/refresh session lifecycle, sign-out, and partner/OAuth onboarding paths.
- Managed enterprise policies that can set or lock auto-connect, crash reporting, notifications, WebRTC protection, Secure Core, split tunneling, and telemetry.
- Idle-aware refresh/recovery behavior and persisted connection intent across service-worker restarts.

### Lessons for Stealth Guard

Proton is the best reference for short-lived credential lifecycle, logical-versus-physical server modeling, fastest-server scoring, include-only split tunneling, managed policy, and restart recovery. Secure Core cannot be recreated in client code; it requires a compatible multi-hop service topology.

## Cross-product engineering patterns

### Patterns worth adopting

- Treat proxy settings and WebRTC policy as browser-global resources with explicit ownership checks.
- Compile one deterministic PAC from all routing sources; never switch global settings based on the focused tab.
- Keep service control/auth/check-IP endpoints direct to avoid bootstrap loops.
- Respond to authentication only for `isProxy` challenges from an allowlisted proxy host and bound retries per request.
- Use short-lived, proxy-specific credentials and keep account tokens out of PAC and page contexts.
- Separate logical locations shown to users from rotating physical proxy endpoints.
- Verify a connection by observing an exit IP through the applied proxy, not merely by accepting a successful settings call.
- Preserve connection intent and state-machine context so background restarts can safely reconcile browser state.
- Make direct rules visually explicit because they intentionally reveal the user's direct network identity.

### Patterns to avoid or qualify

- Do not call a browser proxy a device-wide VPN.
- Do not imply that HTTPS proxy transport covers arbitrary UDP, non-browser applications, browser DNS in every configuration, or extension/service control traffic that must bypass PAC.
- Do not label an error notification as a kill switch. A fail-closed mode requires mandatory PAC behavior, no direct fallback for public traffic, failure testing, and a persistent, clearly visible state.
- Do not store reusable proxy passwords in normal exported configuration. Base64 is encoding, not protection.
- Do not accept proxy credentials from pages or send full configuration into the MAIN world.
- Do not let split-tunnel UI create a second hostname semantics implementation; Stealth Guard's `lib/domainFilter.js` must remain authoritative.
