import { handleCheck } from "../checker/respond.ts";
import type { FetchLike } from "../checker/http.ts";
import { classifyAgent } from "./agents.ts";
import { handleMcp } from "./mcp.ts";
import { type Visit, type VisitRoute, visitorId } from "./visit.ts";

interface Env {
  CHECK_LIMIT: RateLimit;
  ASSETS: Fetcher;
  VISITOR_SALT?: string;
}

type Route = "/check" | "/api/check" | "/mcp";

interface Handled {
  response: Response;
  rpc: string | null;
  input: string | null;
  client?: string | null;
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

async function handleAny(route: Route | null, request: Request, env: Env): Promise<Handled & { route: VisitRoute }> {
  if (route) return { ...(await handle(route, request, env)), route };
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return { response: asset, rpc: null, input: null, route: "asset" };
  return { ...(await unmatched(new URL(request.url), env)), route: "unmatched" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const handled = await handleAny(routeOf(url.pathname), request, env);
    const { response } = handled;

    const header = (name: string) => request.headers.get(name) ?? "";
    const userAgent = header("user-agent");
    const cf = (request as { cf?: { asn?: number; asOrganization?: string; country?: string } }).cf;
    const logsBody = handled.route !== "asset" && handled.route !== "unmatched";
    const visit: Visit = {
      event: "visit",
      visitor: await visitorId(env.VISITOR_SALT ?? "", header("cf-connecting-ip"), userAgent),
      ...classifyAgent(userAgent),
      mcp_client: handled.client ?? null,
      mcp_protocol: request.headers.get("mcp-protocol-version"),
      asn: cf?.asn ?? null,
      as_org: cf?.asOrganization ?? null,
      country: cf?.country ?? null,
      method: request.method,
      host: url.host,
      path: url.pathname,
      query: url.search.slice(1, 301),
      run: url.searchParams.get("run")?.slice(0, 60) ?? null,
      route: handled.route,
      rpc: handled.rpc,
      input: handled.input,
      status: response.status,
      ms: Date.now() - started,
      response: logsBody ? (await response.clone().text()).slice(0, MAX_LOGGED_RESPONSE) : null,
      user_agent: userAgent,
      referer: header("referer"),
      accept: header("accept").slice(0, 200),
    };
    console.log(visit);
    return response;
  },
} satisfies ExportedHandler<Env>;
