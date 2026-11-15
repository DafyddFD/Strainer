import type { Kind } from "./visit.ts";

// First match wins. Scanners and named agents come before the generic "Mozilla/" rule
// because their user agents often contain "Mozilla" too.
const REGISTRY: [RegExp, string, Kind][] = [
  [/l9scan|leakix/i, "LeakIX", "scanner"],
  [/zgrab/i, "zgrab", "scanner"],
  [/masscan/i, "masscan", "scanner"],
  [/nuclei/i, "Nuclei", "scanner"],
  [/CensysInspect/i, "Censys", "scanner"],
  [/Expanse/i, "Expanse", "scanner"],
  [/internet-measurement/i, "internet-measurement", "scanner"],
  [/Nmap/i, "Nmap", "scanner"],

  [/claude-code/i, "Claude Code", "coding-agent"],
  [/codex/i, "Codex", "coding-agent"],
  [/opencode/i, "OpenCode", "coding-agent"],
  [/Cursor\//i, "Cursor", "coding-agent"],
  [/gemini-cli|GeminiCLI/i, "Gemini CLI", "coding-agent"],
  [/goose/i, "Goose", "coding-agent"],
  [/mcp-remote/i, "mcp-remote", "coding-agent"],

  [/Claude-User/i, "Claude-User", "ai-assistant"],
  [/ChatGPT-User/i, "ChatGPT-User", "ai-assistant"],
  [/openai-mcp/i, "ChatGPT connector", "ai-assistant"],
  [/Perplexity-User/i, "Perplexity-User", "ai-assistant"],
  [/MistralAI-User/i, "MistralAI-User", "ai-assistant"],
  [/DuckAssistBot/i, "DuckAssistBot", "ai-assistant"],

  [/ClaudeBot/i, "ClaudeBot", "ai-crawler"],
  [/Claude-SearchBot/i, "Claude-SearchBot", "ai-crawler"],
  [/GPTBot/i, "GPTBot", "ai-crawler"],
  [/OAI-SearchBot/i, "OAI-SearchBot", "ai-crawler"],
  [/PerplexityBot/i, "PerplexityBot", "ai-crawler"],
  [/Google-CloudVertexBot/i, "Google-CloudVertexBot", "ai-crawler"],
  [/Amazonbot/i, "Amazonbot", "ai-crawler"],
  [/Bytespider/i, "Bytespider", "ai-crawler"],
  [/CCBot/i, "CCBot", "ai-crawler"],
  [/meta-externalagent/i, "meta-externalagent", "ai-crawler"],
  [/cohere-ai/i, "cohere-ai", "ai-crawler"],

  [/Googlebot/i, "Googlebot", "search-crawler"],
  [/GoogleOther/i, "GoogleOther", "search-crawler"],
  [/bingbot/i, "Bingbot", "search-crawler"],
  [/Applebot/i, "Applebot", "search-crawler"],
  [/DuckDuckBot/i, "DuckDuckBot", "search-crawler"],
  [/YandexBot/i, "YandexBot", "search-crawler"],
  [/Baiduspider/i, "Baiduspider", "search-crawler"],

  [/^curl\//i, "curl", "http-library"],
  [/Wget/i, "Wget", "http-library"],
  [/python-requests/i, "python-requests", "http-library"],
  [/python-httpx/i, "python-httpx", "http-library"],
  [/aiohttp/i, "aiohttp", "http-library"],
  [/Python-urllib/i, "Python-urllib", "http-library"],
  [/undici/i, "undici", "http-library"],
  [/node-fetch/i, "node-fetch", "http-library"],
  [/^node$/i, "node", "http-library"],
  [/axios/i, "axios", "http-library"],
  [/Go-http-client/i, "Go-http-client", "http-library"],
  [/okhttp/i, "okhttp", "http-library"],
  [/Java\//, "Java", "http-library"],

  [/HeadlessChrome/, "HeadlessChrome", "headless-browser"],
  [/^Mozilla\//, "Browser", "browser"],
];

export function classifyAgent(ua: string): { agent: string; kind: Kind } {
  const match = REGISTRY.find(([pattern]) => pattern.test(ua));
  if (match) return { agent: match[1], kind: match[2] };
  return { agent: ua.split(/[\s/;(]/)[0] || "(no user agent)", kind: "unknown" };
}
