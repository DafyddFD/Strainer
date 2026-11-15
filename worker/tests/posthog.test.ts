import assert from "node:assert/strict";
import { test } from "node:test";

import { toEvent } from "../posthog.ts";

const claude = {
  event: "visit", visitor: "a1b2c3d4e5f6", agent: "Claude Code", kind: "coding-agent", mcp_protocol: null,
  asn: 8220, as_org: "Example AS", country: "DE", host: "getstrainer.com", user_agent: "claude-code/2.1.317 (cli)", referer: "", accept: "*/*",
} as const;

test("toEvent maps an MCP tools/call visit", () => {
  const response = '{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"verdict":"Ready"},"isError":false}}';
  const visit = {
    ...claude, mcp_client: "claude-code/2.1.317", mcp_protocol: "2025-06-18", method: "POST", path: "/mcp", query: "", run: null,
    route: "/mcp", rpc: "tools/call", input: '{"url":"example.com"}', status: 200, ms: 812, response, verdict: "Ready", accept: "application/json, text/event-stream",
  } as const;
  assert.deepEqual(toEvent(visit, "2026-11-15T10:00:02.000Z"), {
    event: "agent_request",
    distinct_id: "a1b2c3d4e5f6",
    timestamp: "2026-11-15T10:00:02.000Z",
    properties: {
      visitor: "a1b2c3d4e5f6", agent: "Claude Code", kind: "coding-agent", mcp_client: "claude-code/2.1.317", mcp_protocol: "2025-06-18",
      asn: 8220, as_org: "Example AS", country: "DE", method: "POST", host: "getstrainer.com", path: "/mcp", query: "", run: null,
      route: "/mcp", rpc: "tools/call", input: '{"url":"example.com"}', status: 200, ms: 812, response, verdict: "Ready",
      user_agent: "claude-code/2.1.317 (cli)", referer: "", accept: "application/json, text/event-stream",
      $process_person_profile: false, $geoip_disable: true, $lib: "strainer-worker",
      $current_url: "https://getstrainer.com/mcp", $host: "getstrainer.com", $pathname: "/mcp",
    },
  });
});

test("toEvent keeps the query string in the current URL of an asset visit", () => {
  const visit = {
    ...claude, mcp_client: null, method: "GET", path: "/llms.txt", query: "run=t2", run: "t2",
    route: "asset", rpc: null, input: null, status: 200, ms: 3, response: null, verdict: null,
  } as const;
  assert.deepEqual(toEvent(visit, "2026-11-15T10:00:00.000Z"), {
    event: "agent_request",
    distinct_id: "a1b2c3d4e5f6",
    timestamp: "2026-11-15T10:00:00.000Z",
    properties: {
      visitor: "a1b2c3d4e5f6", agent: "Claude Code", kind: "coding-agent", mcp_client: null, mcp_protocol: null,
      asn: 8220, as_org: "Example AS", country: "DE", method: "GET", host: "getstrainer.com", path: "/llms.txt", query: "run=t2", run: "t2",
      route: "asset", rpc: null, input: null, status: 200, ms: 3, response: null, verdict: null,
      user_agent: "claude-code/2.1.317 (cli)", referer: "", accept: "*/*",
      $process_person_profile: false, $geoip_disable: true, $lib: "strainer-worker",
      $current_url: "https://getstrainer.com/llms.txt?run=t2", $host: "getstrainer.com", $pathname: "/llms.txt",
    },
  });
});
