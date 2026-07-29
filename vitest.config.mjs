import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "lib/config.js",
        "lib/domainFilter.js",
        "lib/proxy.js",
        "lib/proxyCredentials.js",
        "lib/runtime.js",
        "lib/session.js",
        "lib/storage.js",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
