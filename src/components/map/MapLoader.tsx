"use client";

import dynamic from "next/dynamic";

const GlobalMap = dynamic(() => import("./GlobalMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] sm:h-[400px] w-full rounded-2xl bg-gray-100 animate-pulse flex items-center justify-center text-gray-500 text-sm">
      Loading map…
    </div>
  ),
});

export default GlobalMap;
