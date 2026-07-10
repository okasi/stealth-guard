import { expect, test } from "vitest";
import {
  buildCookieUrl,
  cookieMatchesHostname,
  normalizeSessionHostname,
  sanitizeSessionName
} from "../../lib/session.js";

test("normalizeSessionHostname accepts site hosts and rejects unsafe input", () => {
  // Arrange
  const values = [" WWW.Example.COM ", "sub.example.com:8443", "example.com.", "", null, "bad host", "example.com/path", "["];

  // Act
  const normalized = values.map(normalizeSessionHostname);

  // Assert
  expect(normalized).toEqual(["example.com", "sub.example.com", "example.com", "", "", "", "", ""]);
});

test("sanitizeSessionName trims bounds and supplies a timestamped default", () => {
  // Arrange
  const now = new Date("2026-01-02T03:04:05Z");
  const longName = "x".repeat(80);

  // Act
  const trimmed = sanitizeSessionName("  Work  ", now);
  const bounded = sanitizeSessionName(longName, now);
  const fallback = sanitizeSessionName(null, now);

  // Assert
  expect(trimmed).toBe("Work");
  expect(bounded).toHaveLength(64);
  expect(fallback).toBe("Session " + now.toLocaleString());
});

test("buildCookieUrl normalizes cookie hosts paths and secure transport", () => {
  // Arrange
  const secureCookie = { secure: true, domain: ".example.com", path: "account" };

  // Act
  const secureUrl = buildCookieUrl(secureCookie, "fallback.test");
  const fallbackUrl = buildCookieUrl({}, "fallback.test");
  const invalid = () => buildCookieUrl({ domain: 7 }, "");

  // Assert
  expect(secureUrl).toBe("https://example.com/account");
  expect(fallbackUrl).toBe("http://fallback.test/");
  expect(invalid).toThrow("Invalid cookie host");
});

test("cookieMatchesHostname includes applicable cookies without collecting sibling subdomains", () => {
  // Arrange
  const hostname = "www.example.com";
  const cookies = [
    { domain: ".example.com", hostOnly: false },
    { domain: "www.example.com", hostOnly: true },
    { domain: "login.example.com", hostOnly: true },
    { domain: "other.test", hostOnly: false },
    { domain: "", hostOnly: false },
    null
  ];

  // Act
  const matches = cookies.map((cookie) => cookieMatchesHostname(cookie, hostname));
  const parentDomainMatch = cookieMatchesHostname({ domain: ".example.com", hostOnly: false }, "app.example.com");
  const hostOnlyParentMismatch = cookieMatchesHostname({ domain: "example.com", hostOnly: true }, "app.example.com");
  const missingHostname = cookieMatchesHostname({ domain: "example.com" }, "");

  // Assert
  expect(matches).toEqual([true, true, false, false, false, false]);
  expect(parentDomainMatch).toBe(true);
  expect(hostOnlyParentMismatch).toBe(false);
  expect(missingHostname).toBe(false);
});
