import type { Metadata } from "next";
import RideDetailView from "@/components/pages/RideDetailView";

export const metadata: Metadata = {
  title: "Ride Details",
};

export default async function RideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RideDetailView rideId={id} />;
}
