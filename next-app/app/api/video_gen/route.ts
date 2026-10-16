import { generateExplainerScript, ScriptGenerationError } from "./script-generator";

export async function POST(request: Request) {
  // Bound actual bytes even when Content-Length is absent or incorrect.
  const reader = request.body?.getReader();
  let body = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          return Response.json({ error: { code: "BODY_TOO_LARGE", message: "Request body must not exceed 8 KB." } }, { status: 413 });
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch {
      return Response.json({ error: { code: "INVALID_BODY", message: "Could not read the request body." } }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Send a valid JSON request body." } }, { status: 400 });
  }
  try {
    return Response.json(await generateExplainerScript(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ScriptGenerationError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Script generation failed unexpectedly." } }, { status: 500 });
  }
}
