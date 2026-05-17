"use client";

import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/contexts/AuthContext";
import { RideProvider } from "@/contexts/RideContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { AblyProvider } from "@/contexts/AblyContext";
import FloatingCallButton from "@/components/layout/FloatingCallButton";
import { PWAInstallPrompt } from "@/components/shared/PWAInstallPrompt";
import type { UserType } from "@/types";
import type { NotificationMessage } from "@/types";

interface AppProvidersProps {
  children: React.ReactNode;
  initialUser: UserType | null;
  initialNotifications?: NotificationMessage[];
}

export function AppProviders({
  children,
  initialUser,
  initialNotifications = [],
}: AppProvidersProps) {
  return (
    <AuthProvider initialUser={initialUser}>
      <AblyProvider>
        <RideProvider>
          <NotificationProvider initialNotifications={initialNotifications}>
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 4000,
                className: "text-sm max-w-[90vw] sm:max-w-md",
                style: {
                  background: "#1f2937",
                  color: "#fff",
                  borderRadius: "12px",
                },
              }}
            />
            {children}
            <FloatingCallButton />
            <PWAInstallPrompt />
          </NotificationProvider>
        </RideProvider>
      </AblyProvider>
    </AuthProvider>
  );
}
