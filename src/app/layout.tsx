import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";
import { SerwistProviderWrapper } from "@/components/providers/serwist-provider";
import { createClient } from "@/lib/supabase/server";
import { getProfileForUser } from "@/lib/auth/get-profile";
import type { NotificationMessage } from "@/types";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Sohojatra — Ride Sharing",
    template: "%s | Sohojatra",
  },
  description:
    "Share rides, split fares, and travel together across Bangladesh.",
  applicationName: "Sohojatra",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sohojatra",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/sohojatra_ico.png",
    apple: "/sohojatra-splash.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

async function getInitialSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, notifications: [] as NotificationMessage[] };
  }

  const profile = await getProfileForUser(
    user.id,
    user.email ?? "",
    user.user_metadata,
  );

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const mapped: NotificationMessage[] = (notifications ?? []).map((n) => ({
    id: n.id,
    userId: n.user_id,
    message: n.message,
    read: n.read,
    createdAt: n.created_at,
    type: n.type,
    rideId: n.ride_id ?? undefined,
  }));

  return { user: profile, notifications: mapped };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, notifications } = await getInitialSession();

  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} min-h-screen bg-gray-50 antialiased`}>
        <SerwistProviderWrapper>
          <AppProviders
            initialUser={user}
            initialNotifications={notifications}
          >
            {children}
          </AppProviders>
        </SerwistProviderWrapper>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
