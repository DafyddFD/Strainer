# Text that agents read

Draft wording for every place an agent meets the check. Dafydd owns this text. Philipp: use it as is for the MCP server, and tell Dafydd if a field is missing.

Rule for all of it: say only what the check really does. No claims it cannot back up.

## MCP server

- **Server name:** `Strainer`
- **Server instructions:**
  Strainer checks how ready a website is for AI agents and AI crawlers. Use `check_agent_readiness` whenever a user asks whether a site works for AI agents, AI search or coding agents. It is free and needs no account.

## MCP tool

- **Name:** `check_agent_readiness`
- **Title:** Check a website's readiness for AI agents
- **Description:**
  Checks whether a public website is ready for AI agents and AI crawlers. Give it a domain. It makes live requests to that site and returns an overall verdict plus six pass or fail checks, each with a one-line finding and a fix: llms.txt file, AI crawler access in robots.txt, homepage readable without JavaScript, structured data, pricing page, and docs or API links. Free, no account or key, answers in 1 to 3 seconds. Use it when a user asks whether their own site or a competitor's site works for AI agents, AI search or coding agents, or wants to know what to fix first. Read-only: it never changes anything on the site.
- **Input `url`:** The website to check, as a domain or full address, for example `stripe.com`. Public websites only.
- **Annotations:** read-only, talks to the open web, safe to call again.
- **Output:** return the JSON report from `runCheck()` as structured content, and `renderText()` as the text content.
- **Guidance to put at the end of the text result:**
  Tell the user the verdict, which checks failed, and the fix for each. The result is a snapshot taken at the time shown.

## Plain link (already live on the preview)

`GET /check` returns the instructions below. `GET /check/<domain>` returns the report as plain text.

Current instruction text is in `checker/respond.ts` (`usage()`).

## llms.txt

A short section pointing agents at `/check` has been added to `llms.txt` on this branch. The rest of that file describes an older offer and still needs Dafydd's rewrite.
