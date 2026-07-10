# Contributing to Stealth Guard

Thank you for helping improve Stealth Guard. Changes should preserve privacy, browser compatibility, and predictable site behavior.

## Development setup

1. Use Node.js 20.19+ or 22.12+.
2. Run `npm ci`.
3. Run `npm run check` before opening a pull request.
4. Load the repository as an unpacked extension in an MV2-compatible browser for manual verification.

There is no production build step. Source files are loaded directly by the extension, so keep browser compatibility in mind and do not introduce runtime npm dependencies.

## Testing expectations

- Use concise Vitest tests with Arrange, Act, and Assert comments.
- Keep the deterministic library layer at 100% statements, branches, functions, and lines coverage.
- Manually exercise affected browser lifecycle paths, especially proxy, cookies, WebRTC policy, and document-start injection.
- Include before/after screenshots for popup or options UI changes.

## Pull requests

Keep pull requests focused. Explain the user-visible effect, privacy implications, permissions impact, and verification performed. Never include real cookies, saved sessions, proxy credentials, or exported personal settings in fixtures or screenshots.

## Security reports

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).
