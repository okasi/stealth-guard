import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  createAdblockEngine,
  getCosmeticSelectors,
  mergeCompiledRules,
  normalizeFilterSubscriptions,
  parseFilterList,
  isSafeRegexPattern,
  shouldBlockRequest,
} = require("../../lib/adblock.js");

test("normalizes safe HTTPS filter subscriptions", () => {
  expect(
    normalizeFilterSubscriptions([
      { id: " My List! ", name: " Test ", url: "https://example.test/a", enabled: false },
      { id: "mylist", url: "https://duplicate.test/a" },
      { id: "bad", url: "http://example.test/a" },
    ]),
  ).toEqual([
    {
      id: "mylist",
      name: "Test",
      url: "https://example.test/a",
      enabled: false,
    },
  ]);
  expect(normalizeFilterSubscriptions([])).toHaveLength(3);
});

test("parses and matches common AdGuard and uBlock network rules", () => {
  const compiled = parseFilterList(`
! comment
||ads.example^$third-party,script
@@||ads.example/needed.js$domain=site.example
||force.example^$important
@@||force.example^
/tracking\\d+/$xmlhttprequest
0.0.0.0 hosts.example
||ignored.example^$redirect=noopjs
  `);
  const engine = createAdblockEngine(compiled);
  const details = (url, type = "script") => ({ url, type });

  expect(
    shouldBlockRequest(
      engine,
      details("https://ads.example/banner.js"),
      "site.example",
      "ads.example",
    ),
  ).toBe(true);
  expect(
    shouldBlockRequest(
      engine,
      details("https://ads.example/needed.js"),
      "site.example",
      "ads.example",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      details("https://ads.example/banner.png", "image"),
      "site.example",
      "ads.example",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      details("https://force.example/a"),
      "site.example",
      "force.example",
    ),
  ).toBe(true);
  expect(
    shouldBlockRequest(
      engine,
      details("https://cdn.example/tracking42", "xmlhttprequest"),
      "site.example",
      "cdn.example",
    ),
  ).toBe(true);
  expect(
    shouldBlockRequest(
      engine,
      details("https://hosts.example/a"),
      "site.example",
      "hosts.example",
    ),
  ).toBe(true);
});

test("rejects regex patterns with common denial-of-service shapes", () => {
  expect(isSafeRegexPattern("tracking\\d+")).toBe(true);
  expect(isSafeRegexPattern("(a+)+$")).toBe(false);
  expect(isSafeRegexPattern("(.)\\1")).toBe(false);
  expect(isSafeRegexPattern("(?<=ad)slot")).toBe(false);
  expect(isSafeRegexPattern("x".repeat(513))).toBe(false);
  expect(parseFilterList("/(a+)+$/").stats.network).toBe(0);
});

test("merges cosmetic rules, domain restrictions, and exceptions", () => {
  const first = parseFilterList(`
##.generic-ad
site.example##.site-ad
site.example#@#.allowed-ad
site.example##.allowed-ad
site.*##.entity-ad
site.*#@#.entity-allowed
site.*##.entity-allowed
~excluded.example,site.example##.scoped-ad
  `);
  const second = parseFilterList("##[data-ad-slot]");
  const engine = createAdblockEngine(mergeCompiledRules([first, second]));

  expect(getCosmeticSelectors(engine, "site.example", ["generic-ad"])).toEqual(
    expect.arrayContaining([
      ".generic-ad",
      ".site-ad",
      ".scoped-ad",
      ".entity-ad",
      "[data-ad-slot]",
    ]),
  );
  expect(getCosmeticSelectors(engine, "site.example", ["allowed-ad"]))
    .not.toContain(".allowed-ad");
  expect(getCosmeticSelectors(engine, "site.example", ["entity-allowed"]))
    .not.toContain(".entity-allowed");
  expect(getCosmeticSelectors(engine, "excluded.example", ["scoped-ad"]))
    .not.toContain(".scoped-ad");
});

test("merges filter lists larger than the JavaScript argument limit", () => {
  const compiled = parseFilterList("||large.example^");
  compiled.network.block = Array.from(
    { length: 150_000 },
    () => compiled.network.block[0],
  );
  compiled.stats.network = compiled.network.block.length;

  const merged = mergeCompiledRules([compiled]);

  expect(merged.network.block).toHaveLength(150_000);
  expect(merged.stats.network).toBe(150_000);
});
