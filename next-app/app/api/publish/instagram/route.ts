import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// export const runtime = "nodejs";
// export const maxDuration = 30;

const GRAPH_URL = "https://graph.instagram.com";
const BUCKET = "videos";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const userId = process.env.INSTAGRAM_USER_ID;

type Job = {
    id: string;
    video_key: string;
    caption: string;
    upload_status: string;
    publish_status: string;
    instagram_container_id: string | null;
    instagram_media_id: string | null;
    last_error: string | null;
};

async function saveJob(id: string, values: Record<string, unknown>) {
    const { error } = await supabase
        .from("publishing_jobs")
        .update({
            ...values,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id);

    if (error) throw new Error(`Saving checkpoint failed: ${error.message}`);
}

async function graphGet(path: string) {
    const url = new URL(`${GRAPH_URL}/${path}`);
    url.searchParams.set("access_token", token!);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(data.error?.message ?? "Instagram request failed");
    }

    return data;
}

async function graphPost(path: string, params: Record<string, string>) {
    const response = await fetch(`${GRAPH_URL}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            ...params,
            access_token: token!,
        }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(data.error?.message ?? "Instagram request failed");
    }

    return data;
}

async function getJob(jobId: string): Promise<Job> {
    const { data, error } = await supabase
        .from("publishing_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Publishing job not found.");

    return data as Job;
}

function jobResponse(job: Job, message?: string) {
    return NextResponse.json({
        success: job.publish_status === "published",
        jobId: job.id,
        status: job.publish_status,
        videoKey: job.video_key,
        containerId: job.instagram_container_id,
        publishedId: job.instagram_media_id,
        message: message ?? job.last_error ?? undefined,
    });
}

async function createContainer(job: Job) {
    // Generate a NEW signed URL from the persistent object path.
    // Never save this temporary URL in the database.
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(job.video_key, 60 * 60);

    if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? "Could not create a fresh video URL.");
    }

    const container = await graphPost(`${userId}/media`, {
        media_type: "REELS",
        video_url: data.signedUrl,
        caption: job.caption,
    });

    await saveJob(job.id, {
        instagram_container_id: container.id,
        publish_status: "processing",
        last_error: null,
    });

    return container.id as string;
}

async function processJob(job: Job, action: string) {
    if (job.publish_status === "published" && job.instagram_media_id) {
        return jobResponse(job, "This Reel is already published.");
    }

    if (job.publish_status === "unknown" || job.publish_status === "publishing") {
        return NextResponse.json(
            {
                success: false,
                status: "unknown",
                jobId: job.id,
                message:
                    "The previous publish result is uncertain. Verify the Instagram account before attempting another publish.",
            },
            { status: 409 }
        );
    }

    let containerId = job.instagram_container_id;
    let containerStatus = "";

    if (containerId) {
        const current = await graphGet(containerId);
        containerStatus = current.status_code ?? "";

        if (containerStatus === "FINISHED") {
            // Continue below and publish the existing container.
        } else if (containerStatus === "IN_PROGRESS") {
            await saveJob(job.id, {
                publish_status: "processing",
                last_error: null,
            });

            return NextResponse.json({
                success: false,
                pending: true,
                status: "processing",
                jobId: job.id,
                containerId,
                message: "Instagram is still processing the existing container.",
            });
        } else if (containerStatus === "ERROR" || containerStatus === "EXPIRED") {
            // A replacement container is justified only when the old one failed.
            containerId = await createContainer(job);
            containerStatus = "IN_PROGRESS";

            return NextResponse.json({
                success: false,
                pending: true,
                status: "processing",
                jobId: job.id,
                containerId,
                message: "Created a replacement container. Instagram is processing it.",
            });
        } else {
            return NextResponse.json({
                success: false,
                status: "unknown",
                jobId: job.id,
                containerId,
                message: `Unexpected Instagram container status: ${containerStatus || "unknown"}.`,
            }, { status: 409 });
        }
    } else {
        containerId = await createContainer(job);

        return NextResponse.json({
            success: false,
            pending: true,
            status: "processing",
            jobId: job.id,
            containerId,
            message: "Container created. Instagram is processing the video.",
        });
    }

    if (!containerId || containerStatus !== "FINISHED") {
        return NextResponse.json({
            success: false,
            pending: true,
            status: "processing",
            jobId: job.id,
            containerId,
            message: "Waiting for Instagram processing.",
        });
    }

    // Persist before publishing. If the response is lost, don't blindly retry.
    await saveJob(job.id, {
        publish_status: "publishing",
        last_error: null,
    });

    let published;

    try {
        published = await graphPost(`${userId}/media_publish`, {
            creation_id: containerId,
        });
    } catch (error) {
        await saveJob(job.id, {
            publish_status: "unknown",
            last_error:
                error instanceof Error ? error.message : "Publish result uncertain",
        });

        return NextResponse.json({
            success: false,
            status: "unknown",
            jobId: job.id,
            message:
                "The publish response was lost or failed. Check Instagram before retrying to prevent a duplicate Reel.",
        }, { status: 502 });
    }

    await saveJob(job.id, {
        publish_status: "published",
        instagram_media_id: published.id,
        last_error: null,
    });

    return NextResponse.json({
        success: true,
        status: "published",
        jobId: job.id,
        publishedId: published.id,
        message: "Instagram Reel published successfully.",
    });
}

export async function POST(request: Request) {
    try {
        if (!token || !userId) {
            return NextResponse.json(
                { error: "Instagram environment variables are missing." },
                { status: 500 }
            );
        }

        const body = await request.json();
        const action = body.action ?? "start";
        const { jobId, videoKey, caption = "" } = body;

        if (
            !["start", "check", "retry"].includes(action) ||
            typeof jobId !== "string"
        ) {
            return NextResponse.json(
                { error: "Provide a valid action and jobId." },
                { status: 400 }
            );
        }

        let job: Job;

        if (action === "start") {
            if (
                typeof videoKey !== "string" ||
                !videoKey.startsWith("demo/") ||
                typeof caption !== "string"
            ) {
                return NextResponse.json(
                    { error: "A valid videoKey and caption are required." },
                    { status: 400 }
                );
            }

            const { data: existing, error: lookupError } = await supabase
                .from("publishing_jobs")
                .select("*")
                .eq("id", jobId)
                .maybeSingle();

            if (lookupError) throw new Error(lookupError.message);

            if (existing) {
                job = existing as Job;

                if (job.video_key !== videoKey) {
                    return NextResponse.json(
                        { error: "This job belongs to a different video." },
                        { status: 409 }
                    );
                }
            } else {
                const { data, error } = await supabase
                    .from("publishing_jobs")
                    .insert({
                        id: jobId,
                        video_key: videoKey,
                        caption,
                        upload_status: "completed",
                        publish_status: "pending",
                    })
                    .select("*")
                    .single();

                if (error) throw new Error(error.message);
                job = data as Job;
            }
        } else {
            job = await getJob(jobId);

            if (action === "retry" && job.publish_status === "failed") {
                // Allow a failed job to be retried. Keep the permanent video path.
                await saveJob(job.id, {
                    publish_status: "processing",
                    last_error: null,
                });

                job = await getJob(job.id);
            }
        }

        if (action === "check") {
            if (job.publish_status === "published") {
                return jobResponse(job);
            }

            if (!job.instagram_container_id) {
                return jobResponse(job, "No Instagram container exists yet.");
            }

            const current = await graphGet(job.instagram_container_id);
            const code = current.status_code ?? "";

            if (code === "FINISHED") {
                await saveJob(job.id, {
                    publish_status: "processing",
                    last_error: null,
                });
            } else if (code === "ERROR" || code === "EXPIRED") {
                await saveJob(job.id, {
                    publish_status: "failed",
                    last_error: `Instagram container status: ${code}`,
                });
            }

            job = await getJob(job.id);
            return jobResponse(
                job,
                code === "FINISHED"
                    ? "Instagram processing finished. Retry to publish."
                    : `Instagram container status: ${code || "unknown"}`
            );
        }

        return await processJob(job, action);
    } catch (error) {
        console.error("Instagram publishing error:", error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Unexpected error",
            },
            { status: 500 }
        );
    }
}