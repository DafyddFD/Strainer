import type { Visit } from "./visit.ts";

export interface PostHogEnv {
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
}

export interface PostHogEvent {
  event: "agent_request";
  distinct_id: string;
  timestamp: string;
  properties: Omit<Visit, "event"> & {
    $process_person_profile: false;
    $geoip_disable: true;
    $lib: "strainer-worker";
    $current_url: string;
    $host: string;
    $pathname: string;
  };
}

export function toEvent(visit: Visit, timestamp: string): PostHogEvent {
  const { event: _, ...fields } = visit;
  return {
    event: "agent_request",
    distinct_id: visit.visitor,
    timestamp,
    properties: {
      ...fields,
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: "strainer-worker",
      $current_url: `https://${visit.host}${visit.path}${visit.query ? `?${visit.query}` : ""}`,
      $host: visit.host,
      $pathname: visit.path,
    },
  };
}

// Scanners probing for .env and .git files are most of the traffic and none of the signal.
export function capture(env: PostHogEnv, ctx: ExecutionContext, visit: Visit): void {
  if (!env.POSTHOG_KEY || !env.POSTHOG_HOST || visit.kind === "scanner") return;
  const body = JSON.stringify({ api_key: env.POSTHOG_KEY, ...toEvent(visit, new Date().toISOString()) });
  ctx.waitUntil(
    fetch(`${env.POSTHOG_HOST}/i/v0/e/`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {}),
  );
}
