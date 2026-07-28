# Evidence register

Analysis date: 2026-07-28

## Released packages analyzed

| Product | Chrome extension ID | Version | Manifest | CRX SHA-256 |
| --- | --- | ---: | ---: | --- |
| Windscribe | `hnmpcagpplmpfojmgmnngilcnanddlhb` | 4.2.8 | V3 | `8b336f22d8ef3b4abc774c4e32bf239ca5b0e8e2954b9af3599541a6e7ba22d8` |
| ExpressVPN | `fgddmllnllkalaagkghckoinaemmogpe` | 8.0.10.1876 | V3 | `8fa5199112de8bbd8693c444830fd5e381f44a0f2525ef4d4fd3a47ff5e04888` |
| Proton VPN | `jplgfhpmjnbigmhklmmbgecoobifkmpa` | 1.3.5 | V3 | `b381fc763ebb12467bed4b8fb29050d2d77b6b868b9eaaf7e6fa91c6b92e0143` |

The version numbers above came from the unpacked manifests and matched the Chrome Web Store listings at analysis time.

## Package-level permissions and entry points

| Product | Important permissions | Background | Other execution contexts |
| --- | --- | --- | --- |
| Windscribe | proxy, privacy, webRequest, webRequestAuthProvider, DNR, scripting, offscreen, alarms, notifications, management, optional contentSettings | module service worker | dynamically registered privacy scripts; DNR/uBlock-derived resources |
| ExpressVPN | proxy, privacy, webRequestAuthProvider, nativeMessaging, cookies, DNR, notifications | service worker | isolated and MAIN-world location-spoof scripts in all frames at `document_start` |
| Proton VPN | proxy, privacy, webRequestAuthProvider, scripting, idle, notifications | service worker | account-site external messaging; managed-storage schema |

## Method

1. Download each published CRX3 package and record its SHA-256 hash.
2. Strip the CRX header, decompress the ZIP payload, and inspect the manifest, locale catalogs, assets, schemas, and executable JavaScript.
3. Format minified bundles in a temporary directory and trace proxy settings, PAC generation, authentication challenges, connection state, server selection, leak protection, and user-visible states.
4. Compare released behavior with official public source where available.
5. Compare the findings with Stealth Guard's existing `lib/proxy.js`, configuration model, background lifecycle, popup/options surfaces, and MV2 constraints.

No vendor endpoint was authenticated against and no live VPN subscription was used. Network behavior is therefore inferred from executable control flow, API contracts, UI text, and published documentation rather than packet captures.

## Public source baselines

- [Windscribe browser extension source](https://github.com/Windscribe/browser-extension-mv3): inspected revision `b851b5f3`, whose package version was 4.2.1. It is very close to, but not identical with, released version 4.2.8.
- [Proton VPN browser extension source](https://github.com/ProtonVPN/proton-vpn-browser-extension): inspected revision `09398025`; version 1.3.5 matched the released package.
- [ExpressVPN browser extension source](https://github.com/expressvpn/expressvpn_browser_extension): inspected revision `e6ad806`; this is useful for the native desktop-control design but predates the current standalone proxy mode.

## Primary documentation

- Chrome Web Store: [Windscribe](https://chromewebstore.google.com/detail/free-vpn-for-chrome-vpn-e/hnmpcagpplmpfojmgmnngilcnanddlhb), [ExpressVPN](https://chromewebstore.google.com/detail/expressvpn-vpn-proxy-brow/fgddmllnllkalaagkghckoinaemmogpe), and [Proton VPN](https://chromewebstore.google.com/detail/proton-vpn-fast-secure/jplgfhpmjnbigmhklmmbgecoobifkmpa).
- Chrome extension APIs: [Proxy](https://developer.chrome.com/docs/extensions/reference/api/proxy), [webRequest authentication](https://developer.chrome.com/docs/extensions/reference/api/webRequest), [Privacy](https://developer.chrome.com/docs/extensions/reference/api/privacy), and [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Confidence labels

- **Confirmed**: directly observed in the exact released manifest or executable package, or in matching official source.
- **Strong inference**: control flow and strings agree, but the service was not exercised live.
- **Historical/reference**: present in an older public source revision and useful for architecture, but not treated as proof of the current release.

Service-side implementation, retention policy, cryptography beyond the browser-to-proxy TLS connection, operational capacity, and unpublished experimentation flags are outside the evidence boundary.
