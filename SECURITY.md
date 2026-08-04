# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. Users should update before reporting a problem that may already be resolved.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. If it is unavailable, contact the maintainer through [okasi.me](https://okasi.me) and ask for a private reporting channel.

Include a concise impact statement, affected version, reproduction steps, and a proof of concept that does not expose real user data. Do not open a public issue until a fix is available and coordinated disclosure has been agreed.

You should receive an acknowledgment within seven days. Triage and remediation timelines depend on severity and reproducibility.

## Scope notes

Stealth Guard handles sensitive local state, including downloaded or custom
filter subscriptions, optional proxy configuration, and saved site sessions.
Reports involving filter-parser denial of service, untrusted subscription
handling, cookie scope, session isolation, configuration import, permission
abuse, MAIN-world injection, proxy routing, or browser-global privacy settings
are especially valuable.
