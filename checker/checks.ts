// The individual checks. Each one answers a single yes/no question about a site.
// To add a check, write a function with the same shape and add it to CHECKS.

import { extractLinks, fetchText, visibleText } from "./http.ts";
import type { Fetched, FetchLike, Link } from "./http.ts";

export type Status = "pass" | "fail" | "unknown";

export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  finding: string;
  fix: string | null;
}

export interface CheckContext {
  origin: string;
  fetcher: FetchLike;
  homepage: Fetched;
  links: Link[];
}

export interface Check {
  id: string;
  title: string;
  run: (context: CheckContext) => Promise<Omit<CheckResult, "id" | "title">>;
}

export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
];

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function homepageUnavailable(context: CheckContext): Omit<CheckResult, "id" | "title"> | null {
  if (context.homepage.ok) return null;
  const reason = context.homepage.status
    ? `the site answered with status ${context.homepage.status}`
    : `the request ${context.homepage.error || "failed"}`;
  return {
    status: "unknown",
    finding: `Could not load the homepage (${reason}), so this could not be checked.`,
    fix: null,
  };
}

/** Which of the named crawlers a robots.txt shuts out of the whole site. */
export function blockedCrawlers(robotsTxt: string, crawlers: string[] = AI_CRAWLERS): string[] {
  type Group = { agents: string[]; disallowAll: boolean; allowAll: boolean };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallowAll: false, allowAll: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && (value === "/" || value === "/*")) current.disallowAll = true;
    if (field === "allow" && (value === "/" || value === "/*")) current.allowAll = true;
  }
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  return crawlers.filter((crawler) => {
    const own = groups.filter((group) => group.agents.includes(crawler.toLowerCase()));
    const applicable = own.length ? own : wildcard;
    return applicable.some((group) => group.disallowAll && !group.allowAll);
  });
}

const llmsTxt: Check = {
  id: "llms_txt",
  title: "llms.txt file",
  async run({ origin, fetcher }) {
    const address = `${origin}/llms.txt`;
    const page = await fetchText(fetcher, address);
    const looksLikeHtml = page.contentType.includes("html") || /^\s*<(!doctype|html)/i.test(page.text);
    if (page.ok && page.text.trim().length > 0 && !looksLikeHtml) {
      return { status: "pass", finding: `Found at ${address} (${count(page.text.trim().length)} characters).`, fix: null };
    }
    if (!page.ok && page.status === 0) {
      return { status: "unknown", finding: `The request for ${address} ${page.error || "failed"}.`, fix: null };
    }
    return {
      status: "fail",
      finding: page.ok ? `${address} returns a web page, not a text file.` : `No file at ${address} (status ${page.status}).`,
      fix: "Publish a plain-text llms.txt at the site root that says what the product is, who it is for, and links to pricing and docs.",
    };
  },
};

const aiCrawlers: Check = {
  id: "ai_crawlers",
  title: "AI crawlers allowed in robots.txt",
  async run({ origin, fetcher }) {
    const address = `${origin}/robots.txt`;
    const page = await fetchText(fetcher, address);
    if (!page.ok && page.status === 0) {
      return { status: "unknown", finding: `The request for ${address} ${page.error || "failed"}.`, fix: null };
    }
    const isText = page.ok && !/^\s*<(!doctype|html)/i.test(page.text);
    if (!isText) {
      return { status: "pass", finding: "There is no robots.txt, so no AI crawler is blocked by it.", fix: null };
    }
    const blocked = blockedCrawlers(page.text);
    if (blocked.length === 0) {
      return {
        status: "pass",
        finding: `robots.txt does not shut out any of the ${AI_CRAWLERS.length} main AI crawlers. Blocks set outside robots.txt are not visible to this check.`,
        fix: null,
      };
    }
    return {
      status: "fail",
      finding: `robots.txt blocks ${blocked.join(", ")} from the whole site.`,
      fix: "Remove the site-wide Disallow for these crawlers, or allow them on the pages buyers need (home, pricing, docs).",
    };
  },
};

const readableWithoutJs: Check = {
  id: "readable_without_js",
  title: "Homepage readable without JavaScript",
  async run(context) {
    const unavailable = homepageUnavailable(context);
    if (unavailable) return unavailable;
    const length = visibleText(context.homepage.text).length;
    if (length >= 500) {
      return { status: "pass", finding: `The raw homepage carries about ${count(length)} characters of readable text.`, fix: null };
    }
    return {
      status: "fail",
      finding: `The raw homepage carries only about ${count(length)} characters of readable text, so most content probably needs JavaScript to appear.`,
      fix: "Render the main homepage content on the server so it is present in the HTML that agents fetch.",
    };
  },
};

const structuredData: Check = {
  id: "structured_data",
  title: "Structured data on the homepage",
  async run(context) {
    const unavailable = homepageUnavailable(context);
    if (unavailable) return unavailable;
    const pattern = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
    const types = new Set<string>();
    let blocks = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(context.homepage.text)) !== null) {
      blocks += 1;
      try {
        const collect = (node: unknown): void => {
          if (Array.isArray(node)) return node.forEach(collect);
          if (node && typeof node === "object") {
            const record = node as Record<string, unknown>;
            const type = record["@type"];
            if (typeof type === "string") types.add(type);
            if (Array.isArray(type)) type.forEach((entry) => typeof entry === "string" && types.add(entry));
            if (record["@graph"]) collect(record["@graph"]);
          }
        };
        collect(JSON.parse(match[1]));
      } catch {
        // a block that does not parse still counts as an attempt, but adds no types
      }
    }
    if (blocks > 0 && types.size > 0) {
      return { status: "pass", finding: `Found JSON-LD structured data describing: ${[...types].slice(0, 6).join(", ")}.`, fix: null };
    }
    return {
      status: "fail",
      finding: blocks > 0 ? "Found a JSON-LD block, but it could not be read." : "No JSON-LD structured data on the homepage.",
      fix: "Add JSON-LD (schema.org Organization plus Product or SoftwareApplication) to the homepage.",
    };
  },
};

const pricingPage: Check = {
  id: "pricing_page",
  title: "Pricing page linked and readable",
  async run(context) {
    const unavailable = homepageUnavailable(context);
    if (unavailable) return unavailable;
    const linked = context.links.find(
      (link) => /\/(pricing|plans|prices?)(\/|$|\?|#|\.)/i.test(new URL(link.href).pathname + "/") || /\b(pricing|plans)\b/i.test(link.text),
    );
    const address = linked ? linked.href : `${context.origin}/pricing`;
    const page = await fetchText(context.fetcher, address);
    const length = page.ok ? visibleText(page.text).length : 0;
    if (page.ok && length >= 200) {
      const hasPrices = /[$€£]\s?\d|\d\s?(usd|eur|gbp)\b|per month|\/\s?mo\b|\/\s?month/i.test(visibleText(page.text));
      const where = linked ? `Linked from the homepage at ${address}` : `Not linked in the raw homepage, but found at ${address}`;
      return {
        status: "pass",
        finding: `${where}. ${hasPrices ? "Price figures are visible in the page text." : "No price figures are visible in the page text."}`,
        fix: hasPrices ? null : "Put actual prices in the page text so an agent can compare you without a sales call.",
      };
    }
    return {
      status: "fail",
      finding: linked
        ? `The homepage links to ${address}, but it could not be read (status ${page.status}, about ${count(length)} characters of text).`
        : "No pricing page is linked from the raw homepage, and none was found at /pricing.",
      fix: "Publish a pricing page with prices in plain text and link it from the homepage.",
    };
  },
};

const docsLink: Check = {
  id: "docs_or_api",
  title: "Docs or API description linked",
  async run(context) {
    const unavailable = homepageUnavailable(context);
    if (unavailable) return unavailable;
    const found = context.links.find((link) => {
      const url = new URL(link.href);
      const inAddress = /(^|[./-])(docs?|documentation|api|developers?|openapi|swagger|reference)([./-]|$)/i.test(
        `${url.hostname}${url.pathname}`,
      );
      return inAddress || /\b(docs|documentation|api|developers?|api reference)\b/i.test(link.text);
    });
    if (found) {
      return { status: "pass", finding: `The homepage links to ${found.href}${found.text ? ` ("${found.text}")` : ""}.`, fix: null };
    }
    return {
      status: "fail",
      finding: "No link to docs or an API description was found in the raw homepage.",
      fix: "Link your docs, and an OpenAPI description if you have an API, from the homepage.",
    };
  },
};

export const CHECKS: Check[] = [llmsTxt, aiCrawlers, readableWithoutJs, structuredData, pricingPage, docsLink];
