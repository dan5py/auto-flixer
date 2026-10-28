import { describe, test, expect } from "bun:test";
import {
  isAllowedSender,
  parseHeaderAddress,
  isAllowedUrl,
  isConfirmationUrl,
  extractConfirmationLinks,
  getElapsedSecondsSinceEmailDate,
  LOCAL_HOST_ALLOWLIST,
} from "./index";

describe("isAllowedSender", () => {
  test("accepts info@netflix.com", () => {
    expect(isAllowedSender("info@netflix.com")).toBe(true);
  });

  test("accepts noreply@account.netflix.com", () => {
    expect(isAllowedSender("noreply@account.netflix.com")).toBe(true);
  });

  test("accepts case-insensitive Netflix domain", () => {
    expect(isAllowedSender("noreply@Netflix.COM")).toBe(true);
  });

  test("rejects spoofed domain with netflix suffix", () => {
    expect(isAllowedSender("info@fakenotnetflix.com")).toBe(false);
  });

  test("rejects unrelated sender", () => {
    expect(isAllowedSender("spam@example.org")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isAllowedSender("")).toBe(false);
  });
});

describe("parseHeaderAddress", () => {
  test("extracts the address from a display-name header", () => {
    expect(parseHeaderAddress("Netflix <info@account.netflix.com>")).toBe(
      "info@account.netflix.com",
    );
  });

  test("accepts a bare address", () => {
    expect(parseHeaderAddress("info@netflix.com")).toBe("info@netflix.com");
  });

  test("handles an encoded display name", () => {
    expect(
      parseHeaderAddress("=?UTF-8?B?TmV0ZmxpeA==?= <info@account.netflix.com>"),
    ).toBe("info@account.netflix.com");
  });

  test("returns empty string for a missing or empty header", () => {
    expect(parseHeaderAddress(null)).toBe("");
    expect(parseHeaderAddress("")).toBe("");
  });
});

describe("isAllowedUrl", () => {
  test("accepts https://www.netflix.com/account/update", () => {
    expect(isAllowedUrl("https://www.netflix.com/account/update")).toBe(true);
  });

  test("accepts https://netflix.com/confirm?token=abc", () => {
    expect(isAllowedUrl("https://netflix.com/confirm?token=abc")).toBe(true);
  });

  test("accepts subdomain URLs", () => {
    expect(isAllowedUrl("https://help.netflix.com/foo")).toBe(true);
  });

  test("rejects non-netflix domains", () => {
    expect(isAllowedUrl("https://evil.com/netflix.com/hack")).toBe(false);
  });

  test("rejects netflix.com as path component", () => {
    expect(isAllowedUrl("https://phishing.io/netflix.com")).toBe(false);
  });

  test("rejects invalid URLs", () => {
    expect(isAllowedUrl("not a url")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isAllowedUrl("")).toBe(false);
  });

  test("rejects fakenotnetflix.com", () => {
    expect(isAllowedUrl("https://fakenotnetflix.com/page")).toBe(false);
  });

  test("rejects 127.0.0.1", () => {
    expect(isAllowedUrl("http://127.0.0.1:3000/page")).toBe(false);
  });
});

describe("isConfirmationUrl", () => {
  test("accepts update-primary-location URL with token", () => {
    expect(
      isConfirmationUrl(
        "https://www.netflix.com/account/update-primary-location?nftoken=abc123&g=456",
      ),
    ).toBe(true);
  });

  test("accepts bare path without query params", () => {
    expect(
      isConfirmationUrl(
        "https://www.netflix.com/account/update-primary-location",
      ),
    ).toBe(true);
  });

  test("rejects other netflix.com paths", () => {
    expect(isConfirmationUrl("https://www.netflix.com/browse")).toBe(false);
    expect(isConfirmationUrl("https://www.netflix.com/account/settings")).toBe(
      false,
    );
  });

  test("rejects non-netflix domain with matching path", () => {
    expect(
      isConfirmationUrl(
        "https://evil.com/account/update-primary-location?nftoken=x",
      ),
    ).toBe(false);
  });

  test("rejects invalid URLs", () => {
    expect(isConfirmationUrl("not a url")).toBe(false);
    expect(isConfirmationUrl("")).toBe(false);
  });

  test("rejects 127.0.0.1 confirmation URL", () => {
    expect(
      isConfirmationUrl(
        "http://127.0.0.1:3000/account/update-primary-location?nftoken=abc",
      ),
    ).toBe(false);
  });
});

describe("extractConfirmationLinks", () => {
  test("extracts confirmation link from HTML with mixed links", () => {
    const html = `
      <a href="https://www.netflix.com/account/update-primary-location?nftoken=abc123">Confirm</a>
      <a href="https://www.netflix.com/browse">Browse</a>
      <a href="https://tracking.example.com/click?ref=123">Track</a>
    `;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([
      "https://www.netflix.com/account/update-primary-location?nftoken=abc123",
    ]);
  });

  test("ignores generic netflix links without the confirmation path", () => {
    const html = `
      <a href="https://www.netflix.com/confirm?t=1">Link 1</a>
      <a href="https://help.netflix.com/support">Link 2</a>
    `;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([]);
  });

  test("returns empty array when no links at all", () => {
    const html = `<a href="https://example.com/page">Click</a>`;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([]);
  });

  test("returns empty array for empty HTML", () => {
    expect(extractConfirmationLinks("")).toEqual([]);
  });

  test("handles single-quoted href attributes", () => {
    const html = `<a href='https://www.netflix.com/account/update-primary-location?nftoken=xyz'>Confirm</a>`;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([
      "https://www.netflix.com/account/update-primary-location?nftoken=xyz",
    ]);
  });

  test("ignores non-netflix domains and non-confirmation paths", () => {
    const html = `
      <a href="https://evil.com/account/update-primary-location?nftoken=hack">Bad</a>
      <a href="https://www.netflix.com/household/confirm?token=real">Wrong path</a>
      <a href="https://www.netflix.com/account/update-primary-location?nftoken=real">Good</a>
      <a href="javascript:alert(1)">XSS</a>
    `;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([
      "https://www.netflix.com/account/update-primary-location?nftoken=real",
    ]);
  });

  test("can be called multiple times without state leaking", () => {
    const html = `<a href="https://netflix.com/account/update-primary-location?t=1">A</a>`;
    const first = extractConfirmationLinks(html);
    const second = extractConfirmationLinks(html);
    expect(first).toEqual(second);
  });

  test("extracts 127.0.0.1 confirmation link with LOCAL_HOST_ALLOWLIST", () => {
    const html = `
      <a href="http://127.0.0.1:3000/account/update-primary-location?nftoken=abc">Confirm</a>
      <a href="http://127.0.0.1:3000/browse">Browse</a>
    `;
    const links = extractConfirmationLinks(html, LOCAL_HOST_ALLOWLIST);
    expect(links).toEqual([
      "http://127.0.0.1:3000/account/update-primary-location?nftoken=abc",
    ]);
  });

  test("ignores 127.0.0.1 confirmation link by default", () => {
    const html = `<a href="http://127.0.0.1:3000/account/update-primary-location?nftoken=abc">Confirm</a>`;
    const links = extractConfirmationLinks(html);
    expect(links).toEqual([]);
  });
});

describe("getElapsedSecondsSinceEmailDate", () => {
  test("returns elapsed seconds when date is valid", () => {
    const emailDate = "Thu, 26 Feb 2026 12:00:00 GMT";
    const nowMs = Date.parse("Thu, 26 Feb 2026 12:00:05 GMT");
    expect(getElapsedSecondsSinceEmailDate(emailDate, nowMs)).toBe(5);
  });

  test("returns 0 when date is in the future", () => {
    const emailDate = "Thu, 26 Feb 2026 12:00:10 GMT";
    const nowMs = Date.parse("Thu, 26 Feb 2026 12:00:05 GMT");
    expect(getElapsedSecondsSinceEmailDate(emailDate, nowMs)).toBe(0);
  });

  test("returns null for missing date", () => {
    expect(getElapsedSecondsSinceEmailDate(null, Date.now())).toBeNull();
  });

  test("returns null for invalid date format", () => {
    expect(
      getElapsedSecondsSinceEmailDate("not-a-date", Date.now()),
    ).toBeNull();
  });
});
