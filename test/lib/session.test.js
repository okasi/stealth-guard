import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildCookieUrl,
  cookieMatchesHostname,
  normalizeSessionHostname,
  sanitizeSessionName,
} = require("../../lib/session.js");

test("normalizeSessionHostname accepts site hosts and rejects unsafe input", () => {
  const values = [
    " WWW.Example.COM ",
    "sub.example.com:8443",
    "example.com.",
    "",
    null,
    "bad host",
    "example.com/path",
    "[",
  ];

  const normalized = values.map(normalizeSessionHostname);

  expect(normalized).toEqual([
    "example.com",
    "sub.example.com",
    "example.com",
    "",
    "",
    "",
    "",
    "",
  ]);
});

test("sanitizeSessionName trims bounds and supplies a timestamped default", () => {
  const now = new Date("2026-01-02T03:04:05Z");
  const longName = "x".repeat(80);

  const trimmed = sanitizeSessionName("  Work  ", now);
  const bounded = sanitizeSessionName(longName, now);
  const fallback = sanitizeSessionName(null, now);

  expect(trimmed).toBe("Work");
  expect(bounded).toHaveLength(64);
  expect(fallback).toBe("Session " + now.toLocaleString());
});

test("buildCookieUrl normalizes cookie hosts paths and secure transport", () => {
  const secureCookie = { secure: true, domain: ".example.com", path: "account" };

  const secureUrl = buildCookieUrl(secureCookie, "fallback.test");
  const fallbackUrl = buildCookieUrl({}, "fallback.test");
  const invalid = () => buildCookieUrl({ domain: 7 }, "");

  expect(secureUrl).toBe("https://example.com/account");
  expect(fallbackUrl).toBe("http://fallback.test/");
  expect(invalid).toThrow("Invalid cookie host");
});

test("cookieMatchesHostname includes applicable cookies without collecting sibling subdomains", () => {
  const hostname = "www.example.com";
  const cookies = [
    { domain: ".example.com", hostOnly: false },
    { domain: "www.example.com", hostOnly: true },
    { domain: "login.example.com", hostOnly: true },
    { domain: "other.test", hostOnly: false },
    { domain: "", hostOnly: false },
    null
  ];

  const matches = cookies.map((cookie) =>
    cookieMatchesHostname(cookie, hostname),
  );
  const parentDomainMatch = cookieMatchesHostname(
    { domain: ".example.com", hostOnly: false },
    "app.example.com",
  );
  const hostOnlyParentMismatch = cookieMatchesHostname(
    { domain: "example.com", hostOnly: true },
    "app.example.com",
  );
  const missingHostname = cookieMatchesHostname({ domain: "example.com" }, "");

  expect(matches).toEqual([true, true, false, false, false, false]);
  expect(parentDomainMatch).toBe(true);
  expect(hostOnlyParentMismatch).toBe(false);
  expect(missingHostname).toBe(false);
});
