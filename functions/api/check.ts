// GET /api/check?url=example.com  ->  JSON report (add &format=text for plain text)

import { handleCheck } from "../../checker/respond.ts";

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const target = new URL(context.request.url).searchParams.get("url");
  return handleCheck(context.request, target, "/api/check", "json");
};
