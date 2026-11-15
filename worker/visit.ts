export type Kind =
  | "coding-agent"
  | "ai-assistant"
  | "ai-crawler"
  | "search-crawler"
  | "headless-browser"
  | "browser"
  | "http-library"
  | "scanner"
  | "unknown";

export type VisitRoute = "/check" | "/api/check" | "/mcp" | "asset" | "unmatched";

export interface Visit {
  event: "visit";
  visitor: string;
  agent: string;
  kind: Kind;
  mcp_client: string | null;
  mcp_protocol: string | null;
  asn: number | null;
  as_org: string | null;
  country: string | null;
  method: string;
  host: string;
  path: string;
  query: string;
  run: string | null;
  route: VisitRoute;
  rpc: string | null;
  input: string | null;
  status: number;
  ms: number;
  response: string | null;
  user_agent: string;
  referer: string;
  accept: string;
}

// The salt keeps the hash from being reversed by hashing every IPv4 address.
export async function visitorId(salt: string, ip: string, userAgent: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}|${userAgent}`));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function verdictOf(response: string | null): string | null {
  if (!response) return null;
  try {
    const body = JSON.parse(response);
    return body?.verdict ?? body?.result?.structuredContent?.verdict ?? (body?.result?.isError ? "tool error" : null);
  } catch {
    return /^Verdict: (.+?)(?: \(|$)/m.exec(response)?.[1] ?? null;
  }
}
