// Static files are served before this code runs. Only paths with no matching file reach it.

import { handleCheck } from "../checker/respond.ts";
import { handleMcp } from "./mcp.ts";

interface Env {
  CHECK_LIMIT: RateLimit;
}

type Route = "/check" | "/api/check" | "/mcp";

interface Handled {
  response: Response;
  rpc: string | null;
  input: string | null;
}

const MAX_LOGGED_RESPONSE = 16_000;

function routeOf(pathname: string): Route | null {
  if (pathname === "/check" || pathname.startsWith("/check/")) return "/check";
  if (pathname === "/api/check") return "/api/check";
  if (pathname === "/mcp") return "/mcp";
  return null;
}

async function dispatch(route: Route, request: Request): Promise<Handled> {
  const url = new URL(request.url);
  if (route === "/mcp") return handleMcp(request);
  if (route === "/api/check") {
    const input = url.searchParams.get("url");
    return { response: await handleCheck(request, input, route, "json"), rpc: null, input };
  }
  const raw = url.pathname.slice("/check/".length);
  const input = raw ? decodeURIComponent(raw) : null;
  return { response: await handleCheck(request, input, route, "text"), rpc: null, input };
}

function rateLimited(route: Route): Response {
  const message = "Too many checks from this address. Wait one minute and try again.";
  return route === "/check"
    ? new Response(`${message}\n`, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" } })
    : Response.json({ error: "rate_limited", message }, { status: 429, headers: { "Retry-After": "60" } });
}

async function handle(route: Route, request: Request, env: Env): Promise<Handled> {
  const { success } = await env.CHECK_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
  return success ? dispatch(route, request) : { response: rateLimited(route), rpc: null, input: null };
}

// MCP clients probe /.well-known/ for OAuth metadata and need a real 404 there, not the homepage.
function unmatched(url: URL): Handled {
  const response = url.pathname.startsWith("/.well-known/")
    ? new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    : Response.redirect(new URL("/", url).toString(), 302);
  return { response, rpc: null, input: url.pathname };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const route = routeOf(url.pathname);
    const { response, rpc, input } = route ? await handle(route, request, env) : unmatched(url);

    const body = await response.clone().text();
    console.log({
      event: "request",
      route: route ?? "unmatched",
      method: request.method,
      rpc,
      input,
      user_agent: request.headers.get("user-agent") ?? "",
      referer: request.headers.get("referer") ?? "",
      country: (request as { cf?: { country?: string } }).cf?.country ?? null,
      status: response.status,
      ms: Date.now() - started,
      response: body.slice(0, MAX_LOGGED_RESPONSE),
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
