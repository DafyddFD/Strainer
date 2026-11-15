// GET /check/example.com  ->  plain-text report an agent can read (add ?format=json for JSON)
// GET /check              ->  short instructions

import { handleCheck } from "../../checker/respond.ts";

export const onRequestGet = async (context: {
  request: Request;
  params: { target?: string | string[] };
}): Promise<Response> => {
  const raw = context.params.target;
  const target = Array.isArray(raw) ? raw.join("/") : raw || null;
  return handleCheck(context.request, target ? decodeURIComponent(target) : null, "/check", "text");
};
