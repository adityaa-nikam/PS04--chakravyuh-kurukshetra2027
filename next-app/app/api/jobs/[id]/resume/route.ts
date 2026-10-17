import { resumeJob, preflight } from "../../http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return resumeJob(request, (await context.params).id); }
export const OPTIONS = preflight;
