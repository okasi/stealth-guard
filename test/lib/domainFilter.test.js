import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDomainPatternTools,
  addDomainToAllowlist,
  getDomainPatternParts,
  isCloudflareChallengeHostname,
  isDomainAllowlisted,
  isFeatureActiveForHostname,
  matchesDomainPattern,
  normalizeDomainPattern,
  normalizeHostname,
  parseDomainPatterns,
  removeDomainFromAllowlist,
} = require("../../lib/domainFilter.js");

test("normalizes hostnames and accepts only supported domain pattern shapes", () => {
  expect(normalizeHostname(" Example.COM. ")).toBe("example.com");
  expect(normalizeHostname(null)).toBe("");
  expect(
    [
      "example.com",
      "*.example.com",
      "webmail.*",
      "*example.com",
      "*localhost*",
      "10.*",
    ].map(normalizeDomainPattern),
  ).toEqual([
    "example.com",
    "*.example.com",
    "webmail.*",
    "*example.com",
    "*localhost*",
    "10.*",
  ]);
  expect(
    [
      "",
      "bad host",
      "https://example.com",
      "**.example.com",
      "*",
      "example..com",
      null,
    ].map(normalizeDomainPattern),
  ).toEqual([null, null, null, null, null, null, null]);
});

test("parses and caches comma-separated patterns", () => {
  const source = " Example.com, *.Test.COM ,, bad host ";
  const first = parseDomainPatterns(source);
  const second = parseDomainPatterns(source);

  expect(first).toEqual(["example.com", "*.test.com"]);
  expect(second).toBe(first);
  expect(parseDomainPatterns(null)).toEqual([]);
});

test("classifies and matches every supported pattern type", () => {
  expect(getDomainPatternParts("webmail.*")).toEqual({
    pattern: "webmail.*",
    type: "prefix",
    value: "webmail",
  });
  expect(getDomainPatternParts("*.example.com").type).toBe("suffix");
  expect(getDomainPatternParts("*example.com").type).toBe("suffix");
  expect(getDomainPatternParts("*local*").type).toBe("wildcard");
  expect(getDomainPatternParts("example.com").type).toBe("plain");
  expect(getDomainPatternParts("bad host")).toBeNull();

  expect([
    matchesDomainPattern("example.com", "example.com"),
    matchesDomainPattern("www.example.com", "example.com"),
    matchesDomainPattern("sub.example.com", "*.example.com"),
    matchesDomainPattern("example.com", "*example.com"),
    matchesDomainPattern("webmail.company.test", "webmail.*"),
    matchesDomainPattern("foo-local-bar", "*local*"),
    matchesDomainPattern("foo-local-bar", "*local*"),
    matchesDomainPattern("other.test", "*.example.com"),
    matchesDomainPattern("", "example.com"),
    matchesDomainPattern("example.com", "bad host"),
  ]).toEqual([true, true, true, true, true, true, true, false, false, false]);
});

test("isolated pattern tool instances maintain their own caches", () => {
  const firstTools = createDomainPatternTools();
  const secondTools = createDomainPatternTools();
  const first = firstTools.parsePatterns("example.com");
  const cached = firstTools.parsePatterns("example.com");
  const separate = secondTools.parsePatterns("example.com");

  expect(cached).toBe(first);
  expect(separate).not.toBe(first);
  for (let index = 0; index < 260; index++) {
    firstTools.parsePatterns(`site-${index}.test`);
  }
  expect(firstTools.matches("www.example.com", "example.com")).toBe(true);
});

test("feature activation applies global and per-feature allowlists", () => {
  const config = {
    enabled: true,
    globalWhitelist: "*.trusted.test",
    canvas: { enabled: true, whitelist: "*.canvas.test" },
    webgl: { enabled: false, whitelist: "" },
  };

  expect(isFeatureActiveForHostname(config, "canvas", "site.test")).toBe(true);
  expect(
    isFeatureActiveForHostname(config, "canvas", "app.trusted.test"),
  ).toBe(false);
  expect(
    isFeatureActiveForHostname(config, "canvas", "app.canvas.test"),
  ).toBe(false);
  expect(isFeatureActiveForHostname(config, "webgl", "site.test")).toBe(false);
  expect(isFeatureActiveForHostname(config, "missing", "site.test")).toBe(false);
  expect(isFeatureActiveForHostname(config, "canvas", "")).toBe(false);
  expect(isFeatureActiveForHostname(null, "canvas", "site.test")).toBe(false);
  expect(
    isFeatureActiveForHostname({ ...config, enabled: false }, "canvas", "site.test"),
  ).toBe(false);

  expect(isDomainAllowlisted(" WWW.TRUSTED.TEST ", "*.trusted.test")).toBe(true);
  expect(isDomainAllowlisted("", "*.trusted.test")).toBe(false);
  expect(isDomainAllowlisted("site.test", null)).toBe(false);
});

test("allowlist helpers add covered domains once and remove every covering rule", () => {
  const added = addDomainToAllowlist("Example.com", "test.com");

  expect(added).toBe("test.com, *.example.com");
  expect(addDomainToAllowlist("www.example.com", added)).toBe(added);
  expect(addDomainToAllowlist("*bad*", added)).toBe(added);
  expect(addDomainToAllowlist("", added)).toBe(added);
  expect(addDomainToAllowlist("solo.test", "")).toBe("*.solo.test");
  expect(
    removeDomainFromAllowlist(
      "app.example.com",
      "*.example.com, other.test",
    ),
  ).toBe("other.test");
  expect(removeDomainFromAllowlist("", added)).toBe(added);
  expect(removeDomainFromAllowlist("example.com", null)).toBeNull();
});

test("Cloudflare challenge detection accepts only the owned challenge domain", () => {
  expect(isCloudflareChallengeHostname("challenges.cloudflare.com")).toBe(true);
  expect(isCloudflareChallengeHostname("nested.challenges.cloudflare.com.")).toBe(true);
  expect(isCloudflareChallengeHostname("cloudflare.com")).toBe(false);
  expect(isCloudflareChallengeHostname(null)).toBe(false);
});
