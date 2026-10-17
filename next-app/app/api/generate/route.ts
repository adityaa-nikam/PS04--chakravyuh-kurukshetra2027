import { createJob, preflight } from "../jobs/http";
export async function POST(request: Request) { return createJob(request); }
export const OPTIONS = preflight;
