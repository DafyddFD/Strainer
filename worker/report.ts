// Usage: node worker/report.ts [--since 2h] [--run TAG] [--all]
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.

import { parseArgs } from "node:util";
import { renderReport, summarize, type TimedVisit } from "./summarize.ts";
import type { Visit } from "./visit.ts";

const LIMIT = 2000;
const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

const { values } = parseArgs({
  options: { since: { type: "string", default: "2h" }, run: { type: "string" }, all: { type: "boolean", default: false } },
});
const since = /^(\d+)([smhd])$/.exec(values.since);
if (!since) throw new Error(`--since must look like 30m, 2h or 1d, not ${values.since}`);
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");

const to = Date.now();
const from = to - Number(since[1]) * UNITS[since[2]];
const reply = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    queryId: "strainer-visits",
    view: "events",
    limit: LIMIT,
    timeframe: { from, to },
    parameters: { filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: "strainer" }] },
  }),
});
const body = await reply.json();
if (!reply.ok || !body.success) throw new Error(`Cloudflare query failed (${reply.status}): ${JSON.stringify(body.errors ?? body)}`);

const events: { source?: Visit; $metadata: { timestampNs: number | string } }[] = body.result?.events?.events ?? [];
const hidden = new Set(values.all ? [] : ["scanner", "search-crawler"]);
const visits: TimedVisit[] = events
  .filter((e) => e.source?.event === "visit" && !hidden.has(e.source.kind))
  .map((e) => ({ ...(e.source as Visit), time: Math.floor(Number(e.$metadata.timestampNs) / 1e6) }));

const { run } = values;
const summaries = summarize(visits).filter((s) => !run || s.runs.includes(run));

if (events.length >= LIMIT) console.log(`Warning: Cloudflare returned ${LIMIT} events, the maximum. Results may be cut off; use a shorter --since.\n`);
console.log(`Visits from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}: ${summaries.length} visitors.\n`);
console.log(renderReport(summaries));
