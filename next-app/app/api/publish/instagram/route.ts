
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// export const runtime = "nodejs";
// export const maxDuration = 60;

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const GRAPH_URL = "https://graph.instagram.com";

async function instagramRequest(
    path: string,
    params: Record<string, string>
) {
    const response = await fetch(`${GRAPH_URL}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            ...params,
            access_token: process.env.INSTAGRAM_ACCESS_TOKEN!,
        }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(data.error?.message ?? "Instagram API request failed");
    }

    return data;
}

export async function POST(request: Request) {
    try {
        const { videoKey, caption } = await request.json();

        if (
            typeof videoKey !== "string" ||
            !videoKey.startsWith("demo/") ||
            typeof caption !== "string"
        ) {
            return NextResponse.json(
                { error: "Provide a valid demo videoKey and caption." },
                { status: 400 }
            );
        }

        const userId = process.env.INSTAGRAM_USER_ID;
        if (!userId || !process.env.INSTAGRAM_ACCESS_TOKEN) {
            return NextResponse.json(
                { error: "Instagram environment variables are missing." },
                { status: 500 }
            );
        }

        const { data: signed, error: signedError } =
            await supabase.storage
                .from("videos")
                .createSignedUrl(videoKey, 60 * 60);

        if (signedError || !signed?.signedUrl) {
            throw new Error(signedError?.message ?? "Could not sign video URL");
        }

        const container = await instagramRequest(`${userId}/media`, {
            media_type: "REELS",
            video_url: signed.signedUrl,
            caption,
        });

        const creationId = container.id as string;

        // Allow Instagram time to fetch and process the video.
        let status = "";
        for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 5000));

            const url = new URL(`${GRAPH_URL}/${creationId}`);
            url.searchParams.set("fields", "status_code,status");
            url.searchParams.set(
                "access_token",
                process.env.INSTAGRAM_ACCESS_TOKEN!
            );


            let response: Response | undefined;
            let lastError: unknown;

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    response = await fetch(url);
                    break;
                } catch (error) {
                    lastError = error;

                    if (attempt < 2) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, 1500 * (attempt + 1))
                        );
                    }
                }
            }

            if (!response) {
                console.error("Instagram status request failed:", lastError);
                throw new Error(
                    "Could not reach Instagram to check processing status. Retry the status check; do not create another Reel."
                );
            }


            const result = await response.json();

            if (!response.ok || result.error) {
                throw new Error(
                    result.error?.message ?? "Could not check Reel processing"
                );
            }

            status = result.status_code;

            console.log("Instagram container status:", {
                creationId,
                status: result.status_code,
                details: result.status,
            });

            if (status === "FINISHED") break;
            if (status === "ERROR" || status === "EXPIRED") {
                throw new Error(`Instagram video processing failed: ${status}`);
            }
        }

        if (status !== "FINISHED") {
            return NextResponse.json({
                success: false,
                pending: status === "IN_PROGRESS",
                message:
                    status === "IN_PROGRESS"
                        ? "Instagram is still processing the video."
                        : `Instagram processing did not finish. Status: ${status || "unknown"}`,
                creationId,
                status,
            });
        }


        const published = await instagramRequest(`${userId}/media_publish`, {
            creation_id: creationId,
        });

        return NextResponse.json({
            success: true,
            publishedId: published.id,
        });
    } catch (error) {
        console.error("Instagram publishing error:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected publishing error",
            },
            { status: 500 }
        );
    }
}
