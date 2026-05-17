import type { Metadata } from "next";
import FindRidesView from "@/components/pages/FindRidesView";

export const metadata: Metadata = {
  title: "Find Rides",
};

export default function FindRidesPage() {
  return <FindRidesView />;
}
