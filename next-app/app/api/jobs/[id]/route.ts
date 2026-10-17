import { jobStatus, preflight } from "../http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return jobStatus(request, (await context.params).id); }
export const OPTIONS = preflight;
