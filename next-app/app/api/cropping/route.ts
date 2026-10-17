import { NextRequest, NextResponse } from "next/server";
import { PipelineClient } from "@/lib/pipeline/client";

/**
 * POST /api/cropping
 * Starts intelligent lecture highlight analysis and 9:16 crop planning.
 * Long-running AI work is queued/delegated to the Python AI worker.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { videoPath, jobId } = body;

    if (!videoPath) {
      return NextResponse.json(
        { error: "videoPath parameter is required." },
        { status: 400 }
      );
    }

    const job = await PipelineClient.startCroppingJob(videoPath, jobId);

    return NextResponse.json(
      {
        success: true,
        jobId: job.jobId,
        status: job.status,
        message: "Analysis job initiated. Poll /api/cropping/[jobId] for progress.",
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ status: "ok", service: "cropping" });
}
