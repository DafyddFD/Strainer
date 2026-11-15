// Run with: node --test checker/tests/
// No network: every site is faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { blockedCrawlers } from "../checks.ts";
import { InputError, normaliseTarget, visibleText } from "../http.ts";
import { renderText, runCheck } from "../index.ts";
import { handleCheck } from "../respond.ts";

type Page = { status?: number; body: string; type?: string };

function fakeSite(pages: Record<string, Page>) {
  return async (input: string): Promise<Response> => {
    const page = pages[input];
    if (!page) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(page.body, { status: page.status ?? 200, headers: { "content-type": page.type ?? "text/html" } });
  };
}

const filler = "Good Co sells a data API for sales teams. ".repeat(20);

const goodSite = fakeSite({
  "https://good.example.com/": {
    body: `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Good Co"}</script></head>
      <body><nav><a href="/pricing">Pricing</a><a href="https://docs.good.example.com/">Docs</a></nav><main>${filler}</main>
      <script>var hidden = "this text must not count";</script></body></html>`,
  },
  "https://good.example.com/llms.txt": { body: "# Good Co\n> Data API for sales teams.\n", type: "text/plain" },
  "https://good.example.com/robots.txt": { body: "User-agent: *\nDisallow: /admin\n", type: "text/plain" },
  "https://good.example.com/pricing": { body: `<html><body><h1>Pricing</h1><p>Starter is $49 per month. ${filler}</p></body></html>` },
});

const bareSite = fakeSite({
  "https://bare.example.com/": { body: `<html><body><div id="root"></div><script src="/app.js"></script></body></html>` },
  "https://bare.example.com/llms.txt": { body: "<!doctype html><html><body>App</body></html>" },
  "https://bare.example.com/robots.txt": { body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n", type: "text/plain" },
});

test("normaliseTarget accepts bare domains and full addresses", () => {
  assert.equal(normaliseTarget("stripe.com"), "https://stripe.com");
  assert.equal(normaliseTarget("  https://Stripe.com/pricing?x=1 "), "https://stripe.com");
  assert.equal(normaliseTarget("http://example.org"), "https://example.org");
});

test("normaliseTarget rejects anything that is not a public website", () => {
  for (const bad of ["", "localhost", "http://127.0.0.1", "http://[::1]/", "ftp://example.com", "https://example.com:8443", "intranet", "a.local", "https://user:pw@example.com"]) {
    assert.throws(() => normaliseTarget(bad), InputError, bad);
  }
});

test("visibleText ignores scripts, styles and tags", () => {
  assert.equal(visibleText("<p>Hello <b>there</b></p><script>var x = 1;</script><style>p{}</style>"), "Hello there");
});

test("blockedCrawlers reads per-crawler and wildcard groups", () => {
  assert.deepEqual(blockedCrawlers("User-agent: GPTBot\nDisallow: /\n"), ["GPTBot"]);
  assert.deepEqual(blockedCrawlers("User-agent: *\nDisallow: /\n").length, 7);
  assert.deepEqual(blockedCrawlers("User-agent: *\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /\n").includes("ClaudeBot"), false);
  assert.deepEqual(blockedCrawlers("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n"), ["GPTBot", "ClaudeBot"]);
  assert.deepEqual(blockedCrawlers("User-agent: *\nDisallow: /private\n"), []);
});

test("a well-prepared site passes all six checks", async () => {
  const report = await runCheck("good.example.com", goodSite);
  assert.equal(report.url, "https://good.example.com");
  assert.equal(report.total, 6);
  assert.deepEqual(report.checks.map((check) => check.status), ["pass", "pass", "pass", "pass", "pass", "pass"]);
  assert.equal(report.verdict, "Ready");
  const pricing = report.checks.find((check) => check.id === "pricing_page");
  assert.match(pricing!.finding, /Price figures are visible/);
});

test("a JavaScript-only site that blocks GPTBot fails clearly", async () => {
  const report = await runCheck("https://bare.example.com/some/page", bareSite);
  const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
  assert.equal(byId.llms_txt.status, "fail");
  assert.equal(byId.ai_crawlers.status, "fail");
  assert.match(byId.ai_crawlers.finding, /GPTBot/);
  assert.equal(byId.readable_without_js.status, "fail");
  assert.equal(byId.structured_data.status, "fail");
  assert.equal(byId.pricing_page.status, "fail");
  assert.equal(byId.docs_or_api.status, "fail");
  assert.equal(report.verdict, "Not ready");
  assert.ok(report.checks.every((check) => check.status !== "fail" || check.fix));
});

test("a site that cannot be loaded is reported as unknown, not as failing", async () => {
  const down = async (): Promise<Response> => {
    throw new Error("network down");
  };
  const report = await runCheck("down.example.com", down);
  assert.equal(report.verdict, "Could not check");
  assert.ok(report.checks.every((check) => check.status === "unknown"));
});

test("renderText is plain and carries the verdict and every check", async () => {
  const text = renderText(await runCheck("good.example.com", goodSite), "https://x.test/api/check?url=good.example.com");
  assert.match(text, /^Agent-readiness check for https:\/\/good\.example\.com\n/);
  assert.match(text, /Verdict: Ready \(6 of 6 checks passed\)/);
  assert.equal((text.match(/^PASS: /gm) || []).length, 6);
  assert.ok(!text.includes("—"), "no em dashes");
});

test("the request handler returns usage, bad-input and format variants", async () => {
  const usage = await handleCheck(new Request("https://site.test/check"), null, "/check", "text");
  assert.equal(usage.status, 200);
  assert.match(await usage.text(), /site\.test\/check\/example\.com/);

  const bad = await handleCheck(new Request("https://site.test/api/check?url=localhost"), "localhost", "/api/check", "json");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad_input");

  const missing = await handleCheck(new Request("https://site.test/api/check"), null, "/api/check", "json");
  assert.equal(missing.status, 400);
});

test("a site that answers every address with its homepage does not get credit for a pricing page", async () => {
  const home = `<html><body><main>We help with $15T of purchases. ${filler}</main></body></html>`;
  const catchAll = async (): Promise<Response> => new Response(home, { status: 200, headers: { "content-type": "text/html" } });
  const report = await runCheck("spa.example.com", catchAll);
  const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
  assert.equal(byId.pricing_page.status, "fail");
  assert.equal(byId.llms_txt.status, "fail");
});

test("a blog post about developer tools is not mistaken for docs", async () => {
  const site = fakeSite({
    "https://blog.example.com/": {
      body: `<html><body><a href="/blog/best-geo-tools-for-developer-tools-2026">Best GEO Tools for Dev Tools 2026: A vs B vs C compared in depth</a><main>${filler}</main></body></html>`,
    },
  });
  const report = await runCheck("blog.example.com", site);
  assert.equal(report.checks.find((check) => check.id === "docs_or_api")!.status, "fail");

  const withDocs = fakeSite({
    "https://blog.example.com/": { body: `<html><body><a href="/docs/quickstart.html">Start</a><main>${filler}</main></body></html>` },
  });
  const second = await runCheck("blog.example.com", withDocs);
  assert.equal(second.checks.find((check) => check.id === "docs_or_api")!.status, "pass");
});
