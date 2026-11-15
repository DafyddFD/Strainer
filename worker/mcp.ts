// Stateless MCP over Streamable HTTP: no sessions, plain JSON replies, and
// tools/call works without a prior initialize, so an agent with only an HTTP
// tool can call it with one POST.

import { isInputError, renderText, runCheck, VERSION } from "../checker/index.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TOOL_NAME = "check_agent_readiness";

const SERVER_INSTRUCTIONS =
  "Strainer checks how ready a website is for AI agents and AI crawlers. Use check_agent_readiness whenever a user asks " +
  "whether a site works for AI agents, AI search or coding agents. It is free and needs no account.";

const RESULT_GUIDANCE =
  "Tell the user the verdict, which checks failed, and the fix for each. The result is a snapshot taken at the time shown.";

const TOOL = {
  name: TOOL_NAME,
  title: "Check a website's readiness for AI agents",
  description:
    "Checks whether a public website is ready for AI agents and AI crawlers. Give it a domain. It makes live requests to " +
    "that site and returns an overall verdict plus six pass or fail checks, each with a one-line finding and a fix: " +
    "llms.txt file, AI crawler access in robots.txt, homepage readable without JavaScript, structured data, pricing page, " +
    "and docs or API links. Free, no account or key, answers in 1 to 3 seconds. Use it when a user asks whether their own " +
    "site or a competitor's site works for AI agents, AI search or coding agents, or wants to know what to fix first. " +
    "Read-only: it never changes anything on the site.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The website to check, as a domain or full address, for example stripe.com. Public websites only.",
      },
    },
    required: ["url"],
  },
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
};

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: HEADERS });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: HEADERS });
}

function instructions(origin: string): string {
  return [
    "Strainer MCP server: one tool, check_agent_readiness. Free, no sign-in, no session.",
    "",
    "Call it with one POST, no setup needed:",
    `  curl -s ${origin}/mcp -H 'Content-Type: application/json' \\`,
    `    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${TOOL_NAME}","arguments":{"url":"stripe.com"}}}'`,
    "",
    "Or add it as a connector:",
    `  claude mcp add --transport http strainer ${origin}/mcp`,
    "",
    `Plain-text version of the same check: ${origin}/check/stripe.com`,
    "",
  ].join("\n");
}

async function callTool(id: JsonRpcId, params: Record<string, unknown> | undefined): Promise<Response> {
  if (params?.name !== TOOL_NAME) return rpcError(id, -32602, `Unknown tool. The only tool is ${TOOL_NAME}.`);
  const url = (params.arguments as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string") return rpcError(id, -32602, "Missing argument: url (a website address, for example stripe.com).");
  try {
    const report = await runCheck(url);
    return rpcResult(id, { content: [{ type: "text", text: `${renderText(report)}\n${RESULT_GUIDANCE}\n` }], structuredContent: report, isError: false });
  } catch (error) {
    const message = isInputError(error) ? error.message : "The check failed unexpectedly. Try again.";
    return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
  }
}

async function handleMessage(message: JsonRpcRequest): Promise<Response> {
  const id = message.id ?? null;
  switch (message.method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      const protocolVersion = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "Strainer", version: VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: [TOOL] });
    case "tools/call":
      return callTool(id, message.params);
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcp(request: Request): Promise<{ response: Response; rpc: string | null; input: string | null }> {
  if (request.method === "GET") {
    const wantsStream = (request.headers.get("accept") ?? "").includes("text/event-stream");
    const response = wantsStream
      ? new Response(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } })
      : new Response(instructions(new URL(request.url).origin), {
          headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
        });
    return { response, rpc: null, input: null };
  }
  if (request.method === "OPTIONS") {
    const response = new Response(null, {
      status: 204,
      headers: { ...HEADERS, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "*" },
    });
    return { response, rpc: null, input: null };
  }
  if (request.method !== "POST") {
    return { response: new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET, POST" } }), rpc: null, input: null };
  }

  const raw = await request.text();
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(raw);
  } catch {
    return { response: rpcError(null, -32700, "Parse error: the body must be one JSON-RPC message.", 400), rpc: null, input: raw.slice(0, 300) };
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    return { response: rpcError(null, -32600, "Invalid request: send one JSON-RPC message.", 400), rpc: null, input: raw.slice(0, 300) };
  }

  const input = message.method === "tools/call" ? JSON.stringify(message.params?.arguments ?? null).slice(0, 300) : null;
  if (message.id === undefined) return { response: new Response(null, { status: 202, headers: HEADERS }), rpc: message.method, input };
  return { response: await handleMessage(message), rpc: message.method, input };
}
