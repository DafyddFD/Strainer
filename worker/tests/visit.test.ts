import assert from "node:assert/strict";
import { test } from "node:test";

import { verdictOf } from "../visit.ts";

test("verdictOf reads the JSON report", () => {
  assert.equal(verdictOf('{"kind":"agent_readiness","verdict":"Not ready","checks":[]}'), "Not ready");
});

test("verdictOf reads the text report", () => {
  assert.equal(verdictOf("Strainer agent-readiness check\nVerdict: Partly ready (3 of 6 checks passed)\n"), "Partly ready");
});

test("verdictOf reads an MCP tools/call result", () => {
  assert.equal(verdictOf('{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"verdict":"Ready"},"isError":false}}'), "Ready");
});

test("verdictOf reports an MCP tool error", () => {
  assert.equal(verdictOf('{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"bad url"}],"isError":true}}'), "tool error");
});

test("verdictOf is null without a verdict", () => {
  assert.deepEqual(
    [verdictOf(null), verdictOf(""), verdictOf('{"jsonrpc":"2.0","id":1,"result":{}}'), verdictOf("Too many checks.\n")],
    [null, null, null, null],
  );
});
