// Static files are served before this code runs. Only paths with no matching file reach it.

import { handleCheck } from "../checker/respond.ts";
import type { FetchLike } from "../checker/http.ts";
import { handleMcp } from "./mcp.ts";

interface Env {
  CHECK_LIMIT: RateLimit;
  ASSETS: Fetcher;
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

const bare = (hostname: string) => hostname.replace(/^www\./, "");

// A Worker cannot reach its own domain over the network (Cloudflare answers 522), so a check
// of this very site reads the site's files directly instead. Other sites use the normal fetch.
function fetcherFor(request: Request, env: Env): FetchLike {
  const own = bare(new URL(request.url).hostname);
  return async (input, init) => {
    if (bare(new URL(input).hostname) !== own) return fetch(input, init);
    let response = await env.ASSETS.fetch(new Request(input, init));
    for (let hop = 0; hop < 3 && response.status >= 300 && response.status < 400; hop++) {
      const next = response.headers.get("location");
      if (!next) break;
      response = await env.ASSETS.fetch(new Request(new URL(next, input), init));
    }
    return response;
  };
}

async function dispatch(route: Route, request: Request, env: Env): Promise<Handled> {
  const fetcher = fetcherFor(request, env);
  const url = new URL(request.url);
  if (route === "/mcp") return handleMcp(request, fetcher);
  if (route === "/api/check") {
    const input = url.searchParams.get("url");
    return { response: await handleCheck(request, input, route, "json", fetcher), rpc: null, input };
  }
  const raw = url.pathname.slice("/check/".length);
  const input = raw ? decodeURIComponent(raw) : null;
  return { response: await handleCheck(request, input, route, "text", fetcher), rpc: null, input };
}

function rateLimited(route: Route): Response {
  const message = "Too many checks from this address. Wait one minute and try again.";
  return route === "/check"
    ? new Response(`${message}\n`, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" } })
    : Response.json({ error: "rate_limited", message }, { status: 429, headers: { "Retry-After": "60" } });
}

async function handle(route: Route, request: Request, env: Env): Promise<Handled> {
  const { success } = await env.CHECK_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
  return success ? dispatch(route, request, env) : { response: rateLimited(route), rpc: null, input: null };
}

// Unknown addresses get a real 404, never the homepage: agents and crawlers take a homepage at
// /pricing to mean "there is a pricing page". MCP clients probing /.well-known/ get plain text.
async function unmatched(url: URL, env: Env): Promise<Handled> {
  const plain = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (url.pathname.startsWith("/.well-known/")) return { response: plain(), rpc: null, input: url.pathname };
  const page = await env.ASSETS.fetch(new URL("/404", url));
  const response = page.ok
    ? new Response(page.body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
    : plain();
  return { response, rpc: null, input: url.pathname };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const route = routeOf(url.pathname);
    const { response, rpc, input } = route ? await handle(route, request, env) : await unmatched(url, env);

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
