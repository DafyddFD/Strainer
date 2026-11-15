// Small, dependency-free helpers for fetching other people's sites safely.
// Uses only web-standard APIs so it runs on Cloudflare, Node and anywhere else.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Fetched {
  ok: boolean;
  status: number;
  text: string;
  contentType: string;
  finalUrl: string;
  error?: string;
}

export const USER_AGENT = "StrainerReadinessCheck/0.1 (+https://getstrainer.com)";
const MAX_CHARS = 800_000;

export class InputError extends Error {}

/**
 * Turn whatever the caller sent ("stripe.com", "https://stripe.com/pricing")
 * into the site's https origin. Rejects anything that is not a public website.
 */
export function normaliseTarget(raw: string): string {
  const input = (raw || "").trim();
  if (!input) throw new InputError("No website address was given.");
  if (input.length > 300) throw new InputError("That address is too long.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InputError("That does not look like a website address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InputError("Only http and https addresses can be checked.");
  }
  if (url.port && url.port !== "443" && url.port !== "80") {
    throw new InputError("Addresses with a custom port cannot be checked.");
  }
  if (url.username || url.password) {
    throw new InputError("Addresses with a username or password cannot be checked.");
  }
  const host = url.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  const isLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test");
  if (isIp || isLocal || !host.includes(".")) {
    throw new InputError("Only public website domains can be checked.");
  }
  return `https://${host}`;
}

/** Fetch a page as text. Never throws: failures come back as ok=false. */
export async function fetchText(fetcher: FetchLike, url: string, timeoutMs = 6000): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
        "Accept-Language": "en",
      },
    });
    const text = (await response.text()).slice(0, MAX_CHARS);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text,
      contentType: (response.headers.get("content-type") || "").toLowerCase(),
      finalUrl: response.url || url,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      text: "",
      contentType: "",
      finalUrl: url,
      error: aborted ? "timed out" : "failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Visible text of an HTML page, without scripts, styles or tags. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Link {
  href: string;
  text: string;
}

/** Every <a href> on the page, resolved against the page's address. */
export function extractLinks(html: string, baseUrl: string): Link[] {
  const links: Link[] = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && links.length < 2000) {
    const rawHref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || /^(mailto|tel|javascript):/i.test(rawHref)) continue;
    try {
      const resolved = new URL(rawHref, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      links.push({ href: resolved.toString(), text: visibleText(match[4] || "").slice(0, 120) });
    } catch {
      // ignore links that are not valid addresses
    }
  }
  return links;
}
