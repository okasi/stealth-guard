# Browser Privacy Benchmarks

Use these checks for native, unpacked-extension validation in an MV2-capable
Opera build. Automated Chrome results without the extension loaded are useful
only as environment baselines and must not be reported as Stealth Guard results.

## Recurring Reference

[CreepJS Checker](https://creepjs.org/checker#scan) is the recurring reference
benchmark. Re-run it after meaningful fingerprint-protection changes and before
releases.

## Manual Test Suite

- [Sannysoft Bot Test](https://bot.sannysoft.com/)
- [Rebrowser Bot Detector](https://bot-detector.rebrowser.net/)
- [Scrapfly Automation Detector](https://scrapfly.io/web-scraping-tools/automation-detector)
- [Device & Browser Info: Are You a Bot?](https://deviceandbrowserinfo.com/are_you_a_bot)
- [APIVoid Bot Detection Test](https://www.apivoid.com/tools/bot-detection-test/)
- [Infosimples Detect Headless](https://infosimples.github.io/detect-headless/)
- [CreepJS Checker](https://creepjs.org/checker#scan)

## Test Procedure

1. Start a clean Opera profile that supports Manifest V2.
2. Load this repository as an unpacked extension and confirm Stealth Guard is
   enabled.
3. Record the Opera version, operating system, extension commit/version, active
   User-Agent/WebGL presets, allowlists, proxy state, and whether the profile is
   clean or reused.
4. Run each site once with Stealth Guard disabled to establish the same-profile
   baseline.
5. Clear site data, enable Stealth Guard, and run the site again without changing
   other browser conditions.
6. Capture screenshots and record every failed, suspicious, inconsistent, or
   blocked check. Avoid reducing a detailed report to a single pass/fail score.

## Result Template

```text
Date:
Commit/version:
Opera version:
Operating system:
Profile state:
Protection configuration:
Proxy state:

Site:
Baseline result:
Protected result:
Triggered Stealth Guard features:
Regressions or inconsistencies:
Screenshot/evidence:
Notes:
```
