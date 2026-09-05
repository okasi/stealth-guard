import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { DEFAULT_FILTER_LISTS, normalizeFilterListEntries } = require(
  "../../lib/filterLists.js",
);
const {
  createAdblockEngine,
  domainMatches,
  getCosmeticSelectors,
  mergeCompiledRules,
  normalizeFilterSubscriptions,
  parseCosmeticRule,
  parseFilterList,
  parseNetworkOptions,
  parseNetworkRule,
  isSafeRegexPattern,
  shouldBlockRequest,
} = require("../../lib/adblock.js");

test("shares immutable filter-list defaults across config and adblock", () => {
  expect(DEFAULT_FILTER_LISTS).toHaveLength(3);
  expect(normalizeFilterListEntries(DEFAULT_FILTER_LISTS)).toEqual(
    DEFAULT_FILTER_LISTS,
  );
  expect(normalizeFilterListEntries([{ id: "custom", url: "https://example.test/filter" }], false)).toEqual([
    {
      id: "custom",
      name: "custom",
      url: "https://example.test/filter",
      enabled: true,
    },
  ]);
});

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
  expect(
    normalizeFilterSubscriptions(
      Array.from({ length: 40 }, (_, index) => ({
        id: `list-${index}`,
        url: `https://example.test/${index}`,
      })),
    ),
  ).toHaveLength(32);
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

test("preserves trailing wildcard domain scopes on network rules", () => {
  const scoped = parseFilterList("/index.js^$domain=daft.*|dsex.*");
  expect(scoped.network.block[0].options.domains).toEqual(["daft.*", "dsex.*"]);

  const engine = createAdblockEngine(scoped);
  const details = (url) => ({ url, type: "script" });
  expect(
    shouldBlockRequest(
      engine,
      details("https://assets.daft.ie/pkg/index.js"),
      "www.daft.ie",
      "assets.daft.ie",
    ),
  ).toBe(true);
  expect(
    shouldBlockRequest(
      engine,
      details("https://www.prisjakt.nu/a/app/index.js"),
      "www.prisjakt.nu",
      "www.prisjakt.nu",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      details("https://assets.blocket.se/pkg/app/index.js"),
      "www.blocket.se",
      "assets.blocket.se",
    ),
  ).toBe(false);
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

test("covers supported network option aliases, negations, and rejection paths", () => {
  expect(
    parseNetworkOptions("css,doc,frame,xhr,~image,,~third-party"),
  ).toMatchObject({
    types: ["stylesheet", "document", "subdocument", "xmlhttprequest"],
    excludedTypes: ["image"],
    thirdParty: false,
  });
  expect(parseNetworkOptions("first-party").thirdParty).toBe(false);
  expect(parseNetworkOptions("~first-party").thirdParty).toBe(true);
  expect(
    parseNetworkOptions(
      "domain=site.example|~excluded.example|bad host,match-case,~important,elemhide",
    ),
  ).toMatchObject({
    domains: ["site.example"],
    excludedDomains: ["excluded.example"],
    matchCase: true,
    important: false,
  });
  expect(parseNetworkOptions("~match-case,important")).toMatchObject({
    matchCase: false,
    important: true,
  });
  expect(parseNetworkOptions("redirect=noopjs")).toBeNull();
  expect(parseNetworkOptions("unknown-option")).toBeNull();
});

test("rejects malformed network, cosmetic, hosts, and extended rules", () => {
  expect(parseNetworkRule("")).toBeNull();
  expect(parseNetworkRule("x".repeat(2049))).toBeNull();
  expect(parseNetworkRule("*".repeat(17))).toBeNull();
  expect(parseNetworkRule("*")).toBeNull();
  expect(parseNetworkRule("*$script")).toMatchObject({ kind: "url" });
  expect(parseNetworkRule("/[/")).toMatchObject({ kind: "regex" });
  expect(parseNetworkRule("/valid/$match-case")).toMatchObject({
    kind: "regex",
    flags: "",
  });

  for (const rule of [
    "##",
    `##${"x".repeat(2049)}`,
    "##div{color:red}",
    "##div:has-text(ad)",
  ]) {
    expect(parseCosmeticRule(rule)).toBeNull();
  }
  expect(parseCosmeticRule("not cosmetic")).toBeNull();
  expect(parseCosmeticRule(" ,bad/domain,site.example##.ad")).toMatchObject({
    domains: ["site.example"],
  });

  const compiled = parseFilterList(
    [null, "127.0.0.1 localhost", "#?#extended", "[/metadata]", "! comment"].join(
      "\n",
    ),
  );
  expect(compiled.stats).toEqual({ network: 0, cosmetic: 0, ignored: 2 });
  expect(parseFilterList(null)).toEqual(expect.objectContaining({ version: 2 }));
});

test("malformed scopes never become global blocking rules", () => {
  const rules = [
    "/index.js$domain=bad/host", "/index.js$domain=", "/index.js$from=~bad/host",
    "bad/host##.ad", "##div{color:red}", "bad/host#@#.ad",
  ];
  expect(parseFilterList(rules.join("\n")).stats).toEqual({
    network: 0, cosmetic: 0, ignored: rules.length,
  });
});

test("handles sparse compiled data and every request matching boundary", () => {
  const emptyEngine = createAdblockEngine(null);
  expect(createAdblockEngine({ version: 2, network: {}, cosmetic: {} }).cosmeticFallback).toEqual([]);
  expect(
    shouldBlockRequest(emptyEngine, null, "page.test", "request.test"),
  ).toBe(false);
  expect(
    shouldBlockRequest(emptyEngine, {}, "page.test", "request.test"),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      emptyEngine,
      { url: "https://request.test" },
      "",
      "request.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      emptyEngine,
      { url: "https://request.test" },
      "page.test",
      "",
    ),
  ).toBe(false);
  expect(getCosmeticSelectors(null, "page.test")).toEqual([]);
  expect(getCosmeticSelectors(emptyEngine, "")).toEqual([]);

  const merged = mergeCompiledRules([
    null,
    { version: 1 },
    { version: 2, network: {}, cosmetic: {}, stats: {} },
    {
      version: 2,
      network: { allow: [{ id: "allow" }] },
      cosmetic: { allow: [{ id: "cosmetic-allow" }] },
      stats: { network: 1, cosmetic: 2, ignored: 3 },
    },
  ]);
  expect(merged.network.allow).toEqual([{ id: "allow" }]);
  expect(merged.cosmetic.allow).toEqual([{ id: "cosmetic-allow" }]);
  expect(merged.stats).toEqual({ network: 1, cosmetic: 2, ignored: 3 });

  const rules = parseFilterList(
    [
      "||types.test^$script,~image",
      "||excluded-type.test^$~image",
      "||party.test^$third-party",
      "||scoped.test^$domain=page.test|~excluded.test",
      "||excluded-domain.test^$domain=excluded.test|~excluded.test",
      "|https://start.test/path|$match-case",
      "plain-token",
    ].join("\n"),
  );
  const engine = createAdblockEngine(rules);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://types.test/a", type: "image" },
      "page.test",
      "types.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://excluded-type.test/a", type: "image" },
      "page.test",
      "excluded-type.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://party.test/a", type: "script" },
      "party.test",
      "party.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://excluded-domain.test/a", type: "script" },
      "excluded.test",
      "excluded-domain.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://scoped.test/a", type: "script" },
      "other.test",
      "scoped.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://scoped.test/a", type: "script" },
      "excluded.test",
      "scoped.test",
    ),
  ).toBe(false);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://start.test/path", type: "main_frame" },
      "page.test",
      "start.test",
    ),
  ).toBe(true);
  expect(
    shouldBlockRequest(
      engine,
      { url: "https://none.test", type: "sub_frame" },
      "page.test",
      "none.test",
    ),
  ).toBe(false);
});

test("indexes wildcard domains, invalid runtime regexes, and cosmetic fallbacks", () => {
  for (let index = 0; index < 260; index += 1) {
    expect(
      domainMatches(`a.cache-${index}.test`, `*.cache-${index}.test`),
    ).toBe(true);
  }
  expect(domainMatches("a.cache-259.test", "*.cache-259.test")).toBe(true);
  expect(domainMatches("a.repeat.test", "*.repeat.test")).toBe(true);
  expect(domainMatches("b.repeat.test", "*.repeat.test")).toBe(true);
  expect(domainMatches("", "*.cache-1.test")).toBe(false);
  expect(domainMatches("a.test", "")).toBe(false);

  const compiled = parseFilterList(
    [
      "##body > aside",
      "##.short.longer-token",
      "#@#.generic-exception",
    ].join("\n"),
  );
  compiled.network.block.push({
    allow: false,
    kind: "regex",
    pattern: "[",
    flags: "",
    options: parseNetworkOptions(""),
  });
  const engine = createAdblockEngine(compiled);
  expect(engine.block.fallback).toEqual([]);
  expect(getCosmeticSelectors(engine, "site.test", null)).toContain(
    "body > aside",
  );
  expect(getCosmeticSelectors(engine, "site.test", ["longer-token"])).toContain(
    ".short.longer-token",
  );

  const cappedFallbacks = parseFilterList(
    Array.from(
      { length: 501 },
      (_, index) => `##aside:nth-child(${index + 1})`,
    ).join("\n"),
  );
  expect(createAdblockEngine(cappedFallbacks).cosmeticFallback).toHaveLength(500);
});


test("indexes substring literals without losing URL matches or exceptions", () => {
  const engine = createAdblockEngine(parseFilterList([
    "adserver$script",
    "adserver$xmlhttprequest",
    "@@trusted-adserver$script",
    "tracking*pixel$script",
    "||ads.example^$image",
    "||ads.example^$script",
    "##.slot.banner",
    "##.slot.footer",
  ].join("\n")));
  const blocked = (path, type = "script") => shouldBlockRequest(
    engine, { url: `https://cdn.example/${path}`, type }, "site.example", "cdn.example",
  );
  expect(blocked("my-adserver-bundle.js")).toBe(true);
  expect(blocked("my-adserver-bundle.js", "xmlhttprequest")).toBe(true);
  expect(blocked("my-trusted-adserver-bundle.js")).toBe(false);
  expect(blocked("some-tracking-token/pixel.gif")).toBe(true);
  expect(blocked("adse-but-no-full-match.js")).toBe(false);
});
