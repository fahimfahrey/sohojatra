"use client";

import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/contexts/AuthContext";
import { RideProvider } from "@/contexts/RideContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { AblyProvider } from "@/contexts/AblyContext";
import { CsrfProvider } from "@/contexts/CsrfContext";
import FloatingCallButton from "@/components/layout/FloatingCallButton";
import { PWAInstallPrompt } from "@/components/shared/PWAInstallPrompt";
import { StaleDataBanner } from "@/components/shared/StaleDataBanner";
import type { UserType } from "@/types";
import type { NotificationMessage } from "@/types";

interface AppProvidersProps {
  children: React.ReactNode;
  initialUser: UserType | null;
  initialNotifications?: NotificationMessage[];
  csrfToken: string;
}

export function AppProviders({
  children,
  initialUser,
  initialNotifications = [],
  csrfToken,
}: AppProvidersProps) {
  return (
    <CsrfProvider token={csrfToken}>
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
            <StaleDataBanner />
            {children}
            <FloatingCallButton />
            <PWAInstallPrompt />
          </NotificationProvider>
        </RideProvider>
      </AblyProvider>
    </AuthProvider>
    </CsrfProvider>
  );
}
