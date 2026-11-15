// Stateless MCP over Streamable HTTP: no sessions, plain JSON replies, and
// tools/call works without a prior initialize, so an agent with only an HTTP
// tool can call it with one POST.

import { isInputError, renderText, runCheck, VERSION } from "../checker/index.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TOOL_NAME = "check_agent_readiness";

const TOOL = {
  name: TOOL_NAME,
  title: "Agent-readiness check",
  description:
    "Check whether a website is ready for AI agents. Runs six live checks (llms.txt, AI crawler access in robots.txt, " +
    "homepage readable without JavaScript, JSON-LD structured data, pricing page, docs or API links) and returns " +
    "a verdict with one line per check. Takes a few seconds. Free, no sign-in.",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", description: "The website to check, for example stripe.com" } },
    required: ["url"],
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
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
    return rpcResult(id, { content: [{ type: "text", text: renderText(report) }], structuredContent: report, isError: false });
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
        serverInfo: { name: "strainer-agent-readiness", title: "Strainer agent-readiness check", version: VERSION },
        instructions: TOOL.description,
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
