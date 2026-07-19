import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDomainPatternTools,
  DomainFilter,
  getDomainPatternParts,
  matchesDomainPattern,
  normalizeDomainPattern,
  normalizeHostname,
  parseDomainPatterns,
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

test("DomainFilter applies global and per-feature allowlists", () => {
  const config = {
    enabled: true,
    globalWhitelist: "*.trusted.test",
    canvas: { enabled: true, whitelist: "*.canvas.test" },
    webgl: { enabled: false, whitelist: "" },
  };
  const filter = new DomainFilter(config);

  expect(filter.shouldActivateFeature("https://site.test", "canvas")).toBe(
    true,
  );
  expect(
    filter.shouldActivateFeature("https://app.trusted.test", "canvas"),
  ).toBe(false);
  expect(
    filter.shouldActivateFeature("https://app.canvas.test", "canvas"),
  ).toBe(false);
  expect(filter.shouldActivateFeature("not a url", "canvas")).toBe(false);
  expect(filter.shouldActivateFeature("https://site.test", "webgl")).toBe(
    false,
  );
  expect(filter.shouldActivateFeature("https://site.test", "missing")).toBe(
    false,
  );
  expect(
    new DomainFilter({ ...config, enabled: false }).shouldActivateFeature(
      "https://site.test",
      "canvas",
    ),
  ).toBe(false);

  expect(filter.isAllowlisted(" WWW.TRUSTED.TEST ", "*.trusted.test")).toBe(
    true,
  );
  expect(filter.isAllowlisted("", "*.trusted.test")).toBe(false);
  expect(filter.isAllowlisted("site.test", null)).toBe(false);
  expect(filter.matchesPattern("webmail.site.test", "webmail.*")).toBe(true);
  expect(filter.extractHostname("https://Example.com/path")).toBe(
    "example.com",
  );
  expect(filter.extractHostname("bad url")).toBeNull();
});

test("allowlist helpers add covered domains once and remove every covering rule", () => {
  const filter = new DomainFilter();
  const added = filter.addDomainToAllowlist("Example.com", "test.com");

  expect(added).toBe("test.com, *.example.com");
  expect(filter.addDomainToAllowlist("www.example.com", added)).toBe(added);
  expect(filter.addDomainToAllowlist("*bad*", added)).toBe(added);
  expect(filter.addDomainToAllowlist("", added)).toBe(added);
  expect(filter.addDomainToAllowlist("solo.test", "")).toBe("*.solo.test");
  expect(
    filter.removeDomainFromAllowlist(
      "app.example.com",
      "*.example.com, other.test",
    ),
  ).toBe("other.test");
  expect(filter.removeDomainFromAllowlist("", added)).toBe(added);
  expect(filter.removeDomainFromAllowlist("example.com", null)).toBeNull();
});
