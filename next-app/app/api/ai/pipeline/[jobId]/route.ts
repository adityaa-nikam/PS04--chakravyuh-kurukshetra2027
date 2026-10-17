import { NextRequest, NextResponse } from "next/server";
import { PipelineClient } from "@/lib/pipeline/client";

/**
 * GET /api/ai/pipeline/[jobId]
 * Retrieves current job progress percentage, active stage, and generated reel artifacts.
 */
export async function GET(
  req: NextRequest,
  segmentData: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = await segmentData.params;
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json({ error: "jobId parameter is required" }, { status: 400 });
    }

    const job = await PipelineClient.getJobStatus(jobId);

    if (!job) {
      return NextResponse.json(
        { error: `Job with ID '${jobId}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
