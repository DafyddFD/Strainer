#!/usr/bin/env bash
# Usage: worker/smoke.sh <base-url>   (RATE=0 skips the rate-limit test)
B=${1:-http://127.0.0.1:8799}; fail=0
ok(){ echo "PASS $1"; }; bad(){ echo "FAIL $1: $2"; fail=1; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
rpc(){ curl -s "$B/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$1"; }

curl -s --retry 40 --retry-delay 1 --retry-connrefused -o /dev/null "$B/" || { echo "server not up"; exit 1; }

[ "$(code $B/)" = 200 ] && curl -s $B/ | grep -q '<html' && ok "homepage served" || bad "homepage" "$(code $B/)"
[ "$(code -L $B/deck.html)" = 200 ] && ok "deck served (after redirect to /deck, as on Pages)" || bad "deck" "$(code -L $B/deck.html)"
[ "$(code $B/llms.txt)" = 200 ] && ok "llms.txt served" || bad "llms.txt" "$(code $B/llms.txt)"
for p in /checker/index.ts /worker/index.ts /wrangler.jsonc /README.md /.gitignore /.assetsignore; do
  c=$(code "$B$p"); [ "$c" = 404 ] && ok "source hidden $p (404)" || bad "source exposed $p" "$c"; done
c=$(code $B/.well-known/oauth-protected-resource); [ "$c" = 404 ] && ok "oauth discovery returns 404" || bad "oauth discovery" "$c"
for p in /pricing /some/old/link /index.php; do
  [ "$(code "$B$p")" = 404 ] && curl -s "$B$p" | grep -q 'Page not found' && ok "unmatched $p returns the 404 page" || bad "unmatched $p" "$(code "$B$p")"; done
h=$(echo "$B" | sed -E 's#^https?://##'); t=$(curl -s "$B/check/$h")
case "$B" in https://*) echo "$t" | grep -q '^PASS: llms.txt' && ok "the site can check itself" || bad "self-check" "$t";; esac
c=$(code $B/.well-known/mcp.json); [ "$c" = 404 ] && ok "other .well-known path returns 404" || bad ".well-known" "$c"

curl -s $B/check | grep -q 'agent-readiness check' && ok "/check usage text" || bad "/check usage" ""
t=$(curl -s $B/check/stripe.com); echo "$t" | grep -q '^Verdict: ' && ok "/check/stripe.com text report" || bad "/check text" "$t"
j=$(curl -s "$B/api/check?url=stripe.com"); [ "$(echo "$j" | jq -r .kind)" = agent_readiness ] && ok "/api/check JSON report" || bad "/api/check" "$j"

r=$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"v","version":"0"}}}')
[ "$(echo "$r" | jq -r .result.protocolVersion)" = 2025-06-18 ] && ok "mcp initialize negotiates version" || bad "initialize" "$r"
[ "$(code $B/mcp -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')" = 202 ] && ok "mcp notification 202" || bad "notification" ""
r=$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'); [ "$(echo "$r" | jq -r '.result.tools[0].name')" = check_agent_readiness ] && ok "mcp tools/list" || bad "tools/list" "$r"
r=$(rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_agent_readiness","arguments":{"url":"stripe.com"}}}')
[ "$(echo "$r" | jq -r '.result.structuredContent.url')" = https://stripe.com ] && echo "$r" | jq -r '.result.content[0].text' | grep -q '^Verdict: ' && ok "mcp tools/call without initialize" || bad "tools/call" "$r"
r=$(rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"check_agent_readiness","arguments":{"url":"localhost"}}}')
[ "$(echo "$r" | jq -r .result.isError)" = true ] && ok "mcp rejects localhost as tool error" || bad "localhost" "$r"
curl -s $B/mcp | grep -q 'tools/call' && ok "GET /mcp gives curl instructions" || bad "GET /mcp" ""
[ "$(code -H 'Accept: text/event-stream' $B/mcp)" = 405 ] && ok "GET /mcp SSE returns 405" || bad "SSE" ""

if [ "${RATE:-1}" = 1 ]; then
  codes=$(for i in $(seq 1 25); do code "$B/check"; echo; done | sort | uniq -c | tr '\n' ' ')
  echo "$codes" | grep -q 429 && ok "rate limit returns 429 ($codes)" || bad "rate limit" "$codes"
fi
exit $fail
