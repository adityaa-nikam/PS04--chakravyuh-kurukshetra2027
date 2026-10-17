import { createHash, timingSafeEqual } from "node:crypto";
export class JobHttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function access(request: Request) {
  const configured = process.env.ASTRA_ACCESS_TOKEN;
  if (!configured || configured.length < 24) throw new JobHttpError(503, "SERVER_CONFIGURATION", "The server owner must configure an ASTRA_ACCESS_TOKEN of at least 24 characters.");
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(request, origin)) throw new JobHttpError(403, "ORIGIN_DENIED", "This website origin is not allowed.");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(digest(supplied), digest(configured))) throw new JobHttpError(401, "UNAUTHORIZED", "Enter the laptop server access token.");
}
function allowedOrigin(request: Request, origin: string) {
  const url = new URL(request.url), host = request.headers.get("host");
  const browserOrigin = host && /^[a-z0-9.:[\]-]+$/i.test(host) ? `${url.protocol}//${host}` : url.origin;
  return origin === url.origin || origin === browserOrigin || (process.env.ASTRA_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(s => /^https?:\/\//.test(s)).includes(origin);
}
export function responseHeaders(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigin(request, origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Range, Accept-Ranges");
  }
  return headers;
}
export function preflight(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(request, origin)) return Response.json({ error: { code: "ORIGIN_DENIED", message: "This website origin is not allowed." } }, { status: 403 });
  return new Response(null, { status: 204, headers: responseHeaders(request) });
}
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new JobHttpError(400, "INVALID_JSON", "JSON body required.");
  const decoder = new TextDecoder(); let body = "", size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new JobHttpError(413, "BODY_TOO_LARGE", "Request exceeds 8 KB."); }
    body += decoder.decode(value, { stream: true });
  } body += decoder.decode(); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(body) as unknown; } catch { throw new JobHttpError(400, "INVALID_JSON", "Provide valid JSON."); }
}
export function failure(request: Request, error: unknown) {
  const known = error instanceof JobHttpError;
  return Response.json({ error: { code: known ? error.code : "INVALID_REQUEST", message: known ? error.message : "Invalid prompt, options, or job ID." } }, { status: known ? error.status : 400, headers: responseHeaders(request) });
}
