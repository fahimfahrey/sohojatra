"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type RideMap from "./RideMap";

const RideMapDynamic = dynamic(() => import("./RideMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[250px] sm:h-[300px] lg:h-[350px] w-full rounded-2xl bg-gray-100 animate-pulse flex items-center justify-center text-gray-500 text-sm">
      Loading map…
    </div>
  ),
});

type RideMapProps = ComponentProps<typeof RideMap>;

export default function RideMapLoader(props: RideMapProps) {
  return <RideMapDynamic {...props} />;
}
