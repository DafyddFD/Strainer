import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyAgent } from "../agents.ts";

const SEEN: [string, string, string][] = [
  ["claude-code/2.1.317 (cli)", "Claude Code", "coding-agent"],
  ["claude-code/2.1.322 (t3-code, agent-sdk/0.3.321)", "Claude Code", "coding-agent"],
  ["codex-mcp-client/0.163.0", "Codex", "coding-agent"],
  ["opencode/1.18.18", "OpenCode", "coding-agent"],
  ["undici", "undici", "http-library"],
  ["node", "node", "http-library"],
  ["Go-http-client/2.0", "Go-http-client", "http-library"],
  ["Python/3.14 aiohttp/3.14.5", "aiohttp", "http-library"],
  ["curl/8.11.0", "curl", "http-library"],
  ["Mozilla/5.0 (l9scan/2.0.33e27393e2431313e2838313; +https://leakix.net)", "LeakIX", "scanner"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "Browser", "browser"],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36", "HeadlessChrome", "headless-browser"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ClaudeBot", "ai-crawler"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT-User", "ai-assistant"],
  ["openai-mcp/1.0.0", "ChatGPT connector", "ai-assistant"],
  ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot", "search-crawler"],
  ["", "(no user agent)", "unknown"],
  ["SomeTool/1.0", "SomeTool", "unknown"],
];

for (const [ua, agent, kind] of SEEN) {
  test(`classifies ${JSON.stringify(ua)}`, () => {
    assert.deepEqual(classifyAgent(ua), { agent, kind });
  });
}
