import type { Metadata } from "next";
import DashboardView from "@/components/pages/DashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return <DashboardView />;
}
