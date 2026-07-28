# Browser VPN reverse-engineering dossier

This directory contains a clean-room technical analysis of three Chrome extensions and a product requirements document for extending Stealth Guard with browser-scoped VPN functionality.

## Chrome extensions analyzed

| Product | Chrome Web Store link | Extension ID |
| --- | --- | --- |
| Windscribe | <https://chromewebstore.google.com/detail/free-vpn-for-chrome-vpn-e/hnmpcagpplmpfojmgmnngilcnanddlhb> | `hnmpcagpplmpfojmgmnngilcnanddlhb` |
| ExpressVPN | <https://chromewebstore.google.com/detail/expressvpn-vpn-proxy-brow/fgddmllnllkalaagkghckoinaemmogpe> | `fgddmllnllkalaagkghckoinaemmogpe` |
| Proton VPN | <https://chromewebstore.google.com/detail/proton-vpn-fast-secure/jplgfhpmjnbigmhklmmbgecoobifkmpa> | `jplgfhpmjnbigmhklmmbgecoobifkmpa` |

## Contents

- [Comparative findings](./comparative-findings.md) — per-product architecture, behavior, feature inventory, and cross-product matrix.
- [Master technical PRD](./master-technical-prd.md) — proposed scope, architecture, requirements, data contracts, rollout, and acceptance criteria for Stealth Guard.
- [Evidence register](./evidence-register.md) — analyzed versions, package hashes, public sources, method, and confidence limits.

## The most important finding

The standalone modes in Windscribe, ExpressVPN, and Proton VPN are browser proxy clients. They route supported browser traffic through authenticated HTTPS forward proxies using `chrome.proxy`; they do not create an operating-system VPN tunnel.

ExpressVPN also has a separate Remote Control Mode. That mode talks to its installed desktop application through Chrome native messaging, and the desktop application owns the device-wide VPN tunnel. This is documented only as an observed competitor feature; Stealth Guard will not implement a native companion. Stealth Guard should describe its implementation as an **encrypted browser proxy** or **browser VPN**, with a prominent coverage explanation.

## Clean-room boundary

The CRX packages were downloaded, unpacked, and inspected in a temporary working directory. Minified bundles were formatted only to make control flow inspectable. The packages and formatted proprietary source are not committed here. These documents contain behavioral observations and independently written requirements; they do not copy implementation code, service credentials, private keys, or token values.

The Windscribe and Proton products have official public source repositories. They were used to validate behavior. ExpressVPN also publishes a repository, but its public code represents the older desktop-control architecture and not all of the current standalone proxy implementation, so current ExpressVPN proxy findings come primarily from the released package.

## Intended use

This dossier is an input to design, not an authorization to reuse vendor code or infrastructure. The Stealth Guard PRD assumes users supply raw provider credentials or configuration files instead of creating a Stealth Guard account. Browser-compatible HTTP(S)/SOCKS endpoints can be used directly, subject to Chrome's authentication limitations. OpenVPN, WireGuard, and other tunnel profiles are unsupported. A provider must expose a browser-compatible proxy endpoint for Stealth Guard to use it.
