// Agent-readiness check: one website address in, one short verdict out.
// No dependencies. The same function backs the plain link, the API and any MCP tool.

import { CHECKS } from "./checks.ts";
import type { CheckResult } from "./checks.ts";
import { extractLinks, fetchText, InputError, normaliseTarget } from "./http.ts";
import type { FetchLike } from "./http.ts";

export { InputError, normaliseTarget } from "./http.ts";
export type { CheckResult } from "./checks.ts";

export const VERSION = "0.1";

export interface Report {
  kind: "agent_readiness";
  version: string;
  url: string;
  checked_at: string;
  verdict: "Ready" | "Partly ready" | "Not ready" | "Could not check";
  passed: number;
  total: number;
  summary: string;
  checks: CheckResult[];
  duration_ms: number;
}

export async function runCheck(rawTarget: string, fetcher: FetchLike = fetch, now: () => number = Date.now): Promise<Report> {
  const started = now();
  const origin = normaliseTarget(rawTarget);
  const homepage = await fetchText(fetcher, `${origin}/`);
  const links = homepage.ok ? extractLinks(homepage.text, homepage.finalUrl || `${origin}/`) : [];
  const context = { origin, fetcher, homepage, links };

  const checks: CheckResult[] = await Promise.all(
    CHECKS.map(async (check) => {
      try {
        return { id: check.id, title: check.title, ...(await check.run(context)) };
      } catch {
        return { id: check.id, title: check.title, status: "unknown" as const, finding: "This check hit an unexpected error.", fix: null };
      }
    }),
  );

  const passed = checks.filter((check) => check.status === "pass").length;
  const unknown = checks.filter((check) => check.status === "unknown").length;
  const total = checks.length;
  let verdict: Report["verdict"];
  if (unknown >= total - 1) verdict = "Could not check";
  else if (passed >= total - 1) verdict = "Ready";
  else if (passed >= Math.ceil(total / 2)) verdict = "Partly ready";
  else verdict = "Not ready";

  const failed = checks.filter((check) => check.status === "fail").map((check) => check.title);
  const summary =
    verdict === "Could not check"
      ? `${origin} could not be loaded, so its readiness for AI agents is unknown.`
      : `${origin} passed ${passed} of ${total} agent-readiness checks.` +
        (failed.length ? ` Not passed: ${failed.join("; ")}.` : " Nothing failed.");

  return {
    kind: "agent_readiness",
    version: VERSION,
    url: origin,
    checked_at: new Date(now()).toISOString(),
    verdict,
    passed,
    total,
    summary,
    checks,
    duration_ms: now() - started,
  };
}

/** Plain-text version of a report, for agents that read pages. */
export function renderText(report: Report, jsonAddress?: string): string {
  const label = { pass: "PASS", fail: "FAIL", unknown: "UNKNOWN" } as const;
  const lines = [
    `Agent-readiness check for ${report.url}`,
    `Verdict: ${report.verdict} (${report.passed} of ${report.total} checks passed)`,
    `Checked: ${report.checked_at}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`${label[check.status]}: ${check.title}. ${check.finding}`);
    if (check.fix) lines.push(`  Fix: ${check.fix}`);
  }
  lines.push(
    "",
    `Summary: ${report.summary}`,
    `Source: Strainer agent-readiness check v${report.version}. Based on live requests to the site at the time shown.`,
  );
  if (jsonAddress) lines.push(`Same result as JSON: ${jsonAddress}`);
  return lines.join("\n") + "\n";
}

export function isInputError(error: unknown): error is InputError {
  return error instanceof InputError;
}
