// Shared request handling for every route that exposes the check.
// Routes stay thin: they pick the target and the default format, this does the rest.

import { isInputError, renderText, runCheck, VERSION } from "./index.ts";
import type { FetchLike } from "./http.ts";

type Format = "json" | "text";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "X-Robots-Tag": "noindex",
};

function reply(body: string, status: number, format: Format): Response {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    },
  });
}

function pickFormat(request: Request, fallback: Format): Format {
  const asked = new URL(request.url).searchParams.get("format");
  if (asked === "json" || asked === "text") return asked;
  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (accept.includes("application/json")) return "json";
  if (accept.includes("text/plain") || accept.includes("text/markdown")) return "text";
  return fallback;
}

export function usage(origin: string): string {
  return [
    "Strainer agent-readiness check (free, no sign-up, no key).",
    "",
    "It checks whether a website is ready for AI agents: llms.txt, AI crawler access,",
    "readable homepage, structured data, pricing page, and docs or API links.",
    "",
    "How to run it:",
    `  Plain text: ${origin}/check/example.com`,
    `  JSON:       ${origin}/api/check?url=example.com`,
    "",
    "Replace example.com with the site to check. It answers in a few seconds.",
    "",
  ].join("\n");
}

export async function handleCheck(
  request: Request,
  rawTarget: string | null,
  route: string,
  fallback: Format,
  fetcher: FetchLike = fetch,
): Promise<Response> {
  const started = Date.now();
  const here = new URL(request.url);
  const format = pickFormat(request, fallback);
  const logBase = {
    event: "readiness_check",
    route,
    format,
    input: rawTarget ? rawTarget.slice(0, 300) : null,
    user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
    referer: (request.headers.get("referer") || "").slice(0, 300),
    version: VERSION,
  };

  if (!rawTarget) {
    console.log(JSON.stringify({ ...logBase, outcome: "usage", ms: Date.now() - started }));
    const text = usage(here.origin);
    return format === "json"
      ? reply(JSON.stringify({ error: "missing_url", message: "Add the website to check.", usage: text }, null, 2), 400, "json")
      : reply(text, 200, "text");
  }

  try {
    const report = await runCheck(rawTarget, fetcher);
    console.log(
      JSON.stringify({ ...logBase, outcome: "ok", target: report.url, verdict: report.verdict, passed: report.passed, ms: Date.now() - started }),
    );
    const jsonAddress = `${here.origin}/api/check?url=${encodeURIComponent(report.url.replace(/^https:\/\//, ""))}`;
    return format === "json" ? reply(JSON.stringify(report, null, 2), 200, "json") : reply(renderText(report, jsonAddress), 200, "text");
  } catch (error) {
    const message = isInputError(error) ? error.message : "The check failed unexpectedly. Try again.";
    const status = isInputError(error) ? 400 : 500;
    console.log(JSON.stringify({ ...logBase, outcome: isInputError(error) ? "bad_input" : "error", ms: Date.now() - started }));
    return format === "json"
      ? reply(JSON.stringify({ error: isInputError(error) ? "bad_input" : "internal_error", message }, null, 2), status, "json")
      : reply(`${message}\n\n${usage(here.origin)}`, status, "text");
  }
}
