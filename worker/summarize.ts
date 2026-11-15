import type { Kind, Visit } from "./visit.ts";

export type TimedVisit = Visit & { time: number };

export interface CheckCall {
  route: "URL" | "API" | "MCP";
  input: string | null;
  status: number;
  verdict: string | null;
}

export interface VisitorSummary {
  visitor: string;
  first: number;
  last: number;
  agent: string;
  kind: Kind;
  mcp_clients: string[];
  as_org: string | null;
  runs: string[];
  reads: string[];
  checks: CheckCall[];
  errors: string[];
  journey: TimedVisit[];
}

const READ_LABELS: Record<string, string> = { "/": "homepage", "/llms.txt": "llms.txt", "/robots.txt": "robots.txt" };
const CHECK_ROUTES = { "/check": "URL", "/api/check": "API", "/mcp": "MCP" } as const;

export function verdictOf(response: string | null): string | null {
  if (!response) return null;
  try {
    const body = JSON.parse(response);
    return body?.verdict ?? body?.result?.structuredContent?.verdict ?? (body?.result?.isError ? "tool error" : null);
  } catch {
    return /^Verdict: (.+?)(?: \(|$)/m.exec(response)?.[1] ?? null;
  }
}

function readOf(v: Visit): string | null {
  if (v.route === "asset") return READ_LABELS[v.path] ?? v.path;
  if (v.route === "/mcp" && v.method === "GET" && v.status === 200) return "/mcp instructions";
  if ((v.route === "/check" || v.route === "/api/check") && v.input === null && v.status !== 429) return "/check usage";
  return null;
}

function checkOf(v: Visit): CheckCall | null {
  if (v.route === "asset" || v.route === "unmatched") return null;
  if (v.route === "/mcp" ? v.rpc !== "tools/call" : v.input === null) return null;
  const input = v.route === "/mcp" ? mcpUrl(v.input) : v.input;
  return { route: CHECK_ROUTES[v.route], input, status: v.status, verdict: verdictOf(v.response) };
}

function mcpUrl(input: string | null): string | null {
  try {
    const url = JSON.parse(input ?? "null")?.url;
    return typeof url === "string" ? url : input;
  } catch {
    return input;
  }
}

const addOnce = (list: string[], item: string | null) => {
  if (item !== null && !list.includes(item)) list.push(item);
};

export function summarize(visits: TimedVisit[]): VisitorSummary[] {
  const byVisitor = new Map<string, VisitorSummary>();
  for (const v of [...visits].sort((a, b) => a.time - b.time)) {
    let s = byVisitor.get(v.visitor);
    if (!s) {
      s = { visitor: v.visitor, first: v.time, last: v.time, agent: v.agent, kind: v.kind, mcp_clients: [], as_org: v.as_org, runs: [], reads: [], checks: [], errors: [], journey: [] };
      byVisitor.set(v.visitor, s);
    }
    s.last = v.time;
    s.as_org ??= v.as_org;
    addOnce(s.mcp_clients, v.mcp_client);
    addOnce(s.runs, v.run);
    addOnce(s.reads, readOf(v));
    const check = checkOf(v);
    if (check) s.checks.push(check);
    if (v.status >= 400) s.errors.push(`${v.method} ${v.path} -> ${v.status}`);
    s.journey.push(v);
  }
  return [...byVisitor.values()];
}

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const cell = (text: string) => text.replaceAll("|", "\\|") || "-";

function journeyLine(v: TimedVisit): string {
  const target = v.query ? `${v.path}?${v.query}` : v.path;
  const extras = [v.rpc, v.input, verdictOf(v.response)].filter((x) => x !== null).map((x) => `[${x}]`);
  return [clock(v.time), v.method, target, "->", String(v.status), ...extras].join(" ");
}

export function renderReport(summaries: VisitorSummary[]): string {
  const lines = [
    "| Visitor | Agent | Kind | Network | Run | Read | Called check? | Route | Inputs -> verdicts |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of summaries) {
    const agent = s.mcp_clients.length ? `${s.agent} (${s.mcp_clients.join(", ")})` : s.agent;
    const routes = [...new Set(s.checks.map((c) => c.route))].join(", ");
    const results = s.checks.map((c) => `${c.input} -> ${c.verdict ?? c.status}`).join("; ");
    const row = [s.visitor, agent, s.kind, s.as_org ?? "", s.runs.join(", "), s.reads.join(", "), s.checks.length ? "yes" : "no", routes, results];
    lines.push(`| ${row.map(cell).join(" | ")} |`);
  }
  for (const s of summaries) {
    lines.push("", `## ${s.visitor} ${s.agent} (${s.kind}) ${new Date(s.first).toISOString()} to ${clock(s.last)}`, "");
    if (s.errors.length) lines.push(`Errors: ${s.errors.join("; ")}`, "");
    lines.push("```", ...s.journey.map(journeyLine), "```");
  }
  return lines.join("\n");
}
