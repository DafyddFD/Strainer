import assert from "node:assert/strict";
import { test } from "node:test";

import { renderReport, summarize, type TimedVisit } from "../summarize.ts";

const base = {
  event: "visit", mcp_client: null, mcp_protocol: null, asn: 8220, as_org: "Example AS", country: "DE",
  host: "getstrainer.com", query: "", run: null, rpc: null, input: null, ms: 5, response: null, referer: "", accept: "*/*",
} as const;
const claude = { ...base, visitor: "aaaaaaaaaaaa", agent: "Claude Code", kind: "coding-agent", user_agent: "claude-code/2.1.317 (cli)" } as const;
const curl = { ...base, visitor: "bbbbbbbbbbbb", agent: "curl", kind: "http-library", user_agent: "curl/8.11.0", as_org: null } as const;
const t0 = Date.UTC(2026, 10, 15, 10, 0, 0);

const visits: TimedVisit[] = [
  { ...curl, time: t0 + 5_000, method: "GET", path: "/check/example.com", route: "/check", input: "example.com", status: 200,
    response: "Strainer agent-readiness check\nVerdict: Partly ready (3 of 6 checks passed)\n" },
  { ...claude, time: t0, method: "GET", path: "/llms.txt", query: "run=t1", run: "t1", route: "asset", status: 200 },
  { ...claude, time: t0 + 1_000, method: "POST", path: "/mcp", route: "/mcp", rpc: "initialize", mcp_client: "claude-code/2.1.317", status: 200,
    response: '{"jsonrpc":"2.0","id":1,"result":{}}' },
  { ...claude, time: t0 + 2_000, method: "POST", path: "/mcp", route: "/mcp", rpc: "tools/call", input: '{"url":"stripe.com"}', status: 200,
    response: '{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"verdict":"Ready"},"isError":false}}' },
  { ...curl, time: t0 + 6_000, method: "GET", path: "/pricing", route: "unmatched", input: "/pricing", status: 404 },
];

test("summarize groups visits per visitor, ordered by first visit", () => {
  const [first, second] = summarize(visits);
  const { journey: j1, ...claudeSummary } = first;
  const { journey: j2, ...curlSummary } = second;
  assert.deepEqual(claudeSummary, {
    visitor: "aaaaaaaaaaaa", first: t0, last: t0 + 2_000, agent: "Claude Code", kind: "coding-agent",
    mcp_clients: ["claude-code/2.1.317"], as_org: "Example AS", runs: ["t1"], reads: ["llms.txt"],
    checks: [{ route: "MCP", input: "stripe.com", status: 200, verdict: "Ready" }], errors: [],
  });
  assert.deepEqual(curlSummary, {
    visitor: "bbbbbbbbbbbb", first: t0 + 5_000, last: t0 + 6_000, agent: "curl", kind: "http-library",
    mcp_clients: [], as_org: null, runs: [], reads: [],
    checks: [{ route: "URL", input: "example.com", status: 200, verdict: "Partly ready" }], errors: ["GET /pricing -> 404"],
  });
  assert.deepEqual([j1.length, j2.length], [3, 2]);
});

test("renderReport prints the table and one journey per visitor", () => {
  assert.equal(renderReport(summarize(visits)), [
    "| Visitor | Agent | Kind | Network | Run | Read | Called check? | Route | Inputs -> verdicts |",
    "|---|---|---|---|---|---|---|---|---|",
    "| aaaaaaaaaaaa | Claude Code (claude-code/2.1.317) | coding-agent | Example AS | t1 | llms.txt | yes | MCP | stripe.com -> Ready |",
    "| bbbbbbbbbbbb | curl | http-library | - | - | - | yes | URL | example.com -> Partly ready |",
    "",
    "## aaaaaaaaaaaa Claude Code (coding-agent) 2026-11-15T10:00:00.000Z to 10:00:02",
    "",
    "```",
    "10:00:00 GET /llms.txt?run=t1 -> 200",
    "10:00:01 POST /mcp -> 200 [initialize]",
    '10:00:02 POST /mcp -> 200 [tools/call] [{"url":"stripe.com"}] [Ready]',
    "```",
    "",
    "## bbbbbbbbbbbb curl (http-library) 2026-11-15T10:00:05.000Z to 10:00:06",
    "",
    "Errors: GET /pricing -> 404",
    "",
    "```",
    "10:00:05 GET /check/example.com -> 200 [example.com] [Partly ready]",
    "10:00:06 GET /pricing -> 404 [/pricing]",
    "```",
  ].join("\n"));
});
