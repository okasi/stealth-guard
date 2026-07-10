import { expect, test } from "vitest";
import {
  DomainFilter,
  cacheSetWithLimit,
  getWildcardRegex,
  parseWhitelistPatterns
} from "../../lib/domainFilter.js";

test("cacheSetWithLimit evicts the oldest entry when the limit is reached", () => {
  // Arrange
  const cache = new Map([["a", 1], ["b", 2]]);

  // Act
  cacheSetWithLimit(cache, "c", 3, 2);

  // Assert
  expect([...cache.keys()]).toEqual(["b", "c"]);
});

test("parseWhitelistPatterns trims lowercases and reuses cached arrays", () => {
  // Arrange
  const whitelist = " Example.com, *.Test.COM ,, webmail.* ";

  // Act
  const first = parseWhitelistPatterns(whitelist);
  const second = parseWhitelistPatterns(whitelist);

  // Assert
  expect(first).toEqual(["example.com", "*.test.com", "webmail.*"]);
  expect(second).toBe(first);
});

test("getWildcardRegex escapes regex characters and reuses cached regexes", () => {
  // Arrange
  const pattern = "*.example+test.com";

  // Act
  const first = getWildcardRegex(pattern);
  const second = getWildcardRegex(pattern);

  // Assert
  expect(first.test("sub.example+test.com")).toBe(true);
  expect(first.test("sub.example-test.com")).toBe(false);
  expect(second).toBe(first);
});

test("matches exact plain wildcard prefix suffix and generic patterns", () => {
  // Arrange
  const filter = new DomainFilter({});

  // Act
  const results = [
    filter.matchesPattern("example.com", "example.com"),
    filter.matchesPattern("www.example.com", "example.com"),
    filter.matchesPattern("deep.sub.example.com", "*.example.com"),
    filter.matchesPattern("example.com", "*example.com"),
    filter.matchesPattern("api.example.com", "*example.com"),
    filter.matchesPattern("other.com", "*example.com"),
    filter.matchesPattern("webmail.company.com", "webmail.*"),
    filter.matchesPattern("mail.company.com", "webmail.*"),
    filter.matchesPattern("foo-localhost-bar", "*localhost*"),
    filter.matchesPattern("foo-localhost-bar", "*missing*"),
    filter.matchesPattern("not-example.com", "example.com")
  ];

  // Assert
  expect(results).toEqual([true, true, true, true, true, false, true, false, true, false, false]);
});

test("isWhitelisted handles empty input trimming and case insensitive patterns", () => {
  // Arrange
  const filter = new DomainFilter({});

  // Act
  const empty = filter.isWhitelisted("example.com", "  ");
  const emptyHostname = filter.isWhitelisted(" ", "example.com");
  const trimmed = filter.isWhitelisted(" WWW.Example.COM ", "example.com");
  const missing = filter.isWhitelisted("other.com", "example.com");

  // Assert
  expect(empty).toBe(false);
  expect(emptyHostname).toBe(false);
  expect(trimmed).toBe(true);
  expect(missing).toBe(false);
});

test("shouldActivateFeature respects global state feature state URL validity and allowlists", () => {
  // Arrange
  const config = {
    enabled: true,
    globalWhitelist: "*.trusted.com",
    canvas: { enabled: true, whitelist: "*.canvas.test" },
    webgl: { enabled: false, whitelist: "" }
  };
  const filter = new DomainFilter(config);

  // Act
  const results = [
    new DomainFilter({ ...config, enabled: false }).shouldActivateFeature("https://site.test", "canvas"),
    filter.shouldActivateFeature("https://site.test", "missing"),
    filter.shouldActivateFeature("https://site.test", "webgl"),
    filter.shouldActivateFeature("not a url", "canvas"),
    filter.shouldActivateFeature("https://app.trusted.com", "canvas"),
    filter.shouldActivateFeature("https://app.canvas.test", "canvas"),
    filter.shouldActivateFeature("https://site.test", "canvas")
  ];

  // Assert
  expect(results).toEqual([false, false, false, false, false, false, true]);
});

test("whitelist string helpers add detect and remove exact and wildcard entries", () => {
  // Arrange
  const filter = new DomainFilter({});

  // Act
  const added = filter.addDomainToWhitelist("example.com", "test.com");
  const duplicate = filter.addDomainToWhitelist("example.com", added);
  const hasDomain = filter.isDomainInWhitelist("*.example.com", duplicate);
  const missingInput = filter.isDomainInWhitelist("", duplicate);
  const emptyAdded = filter.addDomainToWhitelist("solo.test", "");
  const removed = filter.removeDomainFromWhitelist("example.com", duplicate);
  const parentWildcardRemoved = filter.removeDomainFromWhitelist(
    "app.example.com",
    "*.example.com, other.test"
  );
  const unchangedAdd = filter.addDomainToWhitelist("", duplicate);
  const unchangedRemove = filter.removeDomainFromWhitelist("", duplicate);

  // Assert
  expect(added).toBe("test.com, *.example.com");
  expect(duplicate).toBe(added);
  expect(hasDomain).toBe(true);
  expect(missingInput).toBe(false);
  expect(emptyAdded).toBe("*.solo.test");
  expect(removed).toBe("test.com");
  expect(parentWildcardRemoved).toBe("other.test");
  expect(unchangedAdd).toBe(duplicate);
  expect(unchangedRemove).toBe(duplicate);
});

test("extractHostname returns hostnames and null for invalid URLs", () => {
  // Arrange
  const filter = new DomainFilter({});

  // Act
  const valid = filter.extractHostname("https://Example.com/path");
  const invalid = filter.extractHostname("not a url");

  // Assert
  expect(valid).toBe("example.com");
  expect(invalid).toBeNull();
});

test("cache and whitelist helpers handle non-string and empty-cache inputs", () => {
  // Arrange
  const cache = new Map();
  const filter = new DomainFilter({
    enabled: true,
    globalWhitelist: "",
    canvas: { enabled: true }
  });

  // Act
  cacheSetWithLimit(cache, "first", 1, 0);
  const parsed = parseWhitelistPatterns(null);
  const active = filter.shouldActivateFeature("https://site.test", "canvas");

  // Assert
  expect(cache.get("first")).toBe(1);
  expect(parsed).toEqual([]);
  expect(active).toBe(true);
});
