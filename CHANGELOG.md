# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Pull-request CI for syntax, manifest integrity, and 100% deterministic-core coverage.
- Dependabot, contribution guidance, security policy, and structured issue templates.
- Manifest consistency validation and test coverage for session/cookie helpers.

### Changed

- Configuration loads, saves, and imports now normalize malformed values to the safe schema.
- Popup and options surfaces have improved focus visibility, responsive styling, and assistive-technology labels.
- Session operations verify the target tab before mutating cookies or web storage.

### Fixed

- Allowlisted or disabled User-Agent protection now preserves the native `navigator.userAgentData` value.
- Session snapshots no longer collect host-only cookies from unrelated sibling subdomains or cross browser cookie-store boundaries.
- Malformed settings imports no longer crash the options page before background validation.

## 1.0.10 - 2026-01-23

- Hardened document-start config delivery and browser policy application.
- Added quality gates and capped saved sessions per domain.
