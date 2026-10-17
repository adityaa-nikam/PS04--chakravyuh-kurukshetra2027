import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { access, boundedJson, failure, preflight, responseHeaders, JobHttpError } from "./security";
import { jobIdSchema, resumeInputSchema } from "./contracts";
import { jobs, type JobService } from "./service";
export { preflight };
export async function createJob(request: Request, service = jobs) {
  try { access(request); const job = service().create(await boundedJson(request)); return Response.json(job, { status: 202, headers: responseHeaders(request) }); }
  catch (error) { return failure(request, error); }
}
export async function jobStatus(request: Request, id: string, service = jobs) {
  try { access(request); jobIdSchema.parse(id); return Response.json(service().get(id), { headers: responseHeaders(request) }); }
  catch (error) { return failure(request, error); }
}
export async function resumeJob(request: Request, id: string, service = jobs) {
  try { access(request); jobIdSchema.parse(id); const input = resumeInputSchema.parse(await boundedJson(request)); return Response.json(service().resume(id, input.approveOverrun), { status: 202, headers: responseHeaders(request) }); }
  catch (error) { return failure(request, error); }
}
export function jobVideo(request: Request, id: string, service: () => JobService = jobs) {
  try {
    access(request); jobIdSchema.parse(id); const file = service().video(id), size = statSync(file).size;
    const range = request.headers.get("range"); let start = 0, end = size - 1;
    const headers = responseHeaders(request); headers.set("Content-Type", "video/mp4"); headers.set("Accept-Ranges", "bytes"); headers.set("Content-Disposition", `attachment; filename="astra-${id}.mp4"`);
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || !match[1] && !match[2]) throw new JobHttpError(416, "INVALID_RANGE", "Unsupported byte range.");
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw new JobHttpError(416, "INVALID_RANGE", "Byte range is outside this video.");
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  } catch (error) { return failure(request, error); }
}
