import { jobVideo, preflight } from "../../http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return jobVideo(request, (await context.params).id); }
export const OPTIONS = preflight;
