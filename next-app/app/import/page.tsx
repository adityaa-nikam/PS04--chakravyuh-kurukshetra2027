"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ImportRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (!params.has("mode")) {
      params.set("mode", "youtube");
    }
    router.replace(`/?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#0c061d] text-white flex flex-col items-center justify-center gap-4 font-sans">
      <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium text-violet-200">
        Redirecting to Astra Studio unified workstation...
      </p>
    </div>
  );
}

export default function ImportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0c061d] text-white flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ImportRedirect />
    </Suspense>
  );
}
