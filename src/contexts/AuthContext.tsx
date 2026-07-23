"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { UserType } from "@/types";
import { createClient } from "@/lib/supabase/client";

interface AuthContextType {
  user: UserType | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isEmailConfirmed: boolean;
  setUser: (user: UserType | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: UserType | null;
}) {
  const [user, setUserState] = useState<UserType | null>(initialUser);
  const [isLoading] = useState(false);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState(true);

  // Server actions (login/signup) set the auth cookie server-side and
  // revalidate the layout, which re-renders with a fresh initialUser prop.
  // useState ignores prop changes after mount, so sync explicitly — otherwise
  // the client keeps the stale user until a full reload.
  useEffect(() => {
    setUserState(initialUser);
    setIsEmailConfirmed(true);
  }, [initialUser]);

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        const { data: profile } = await supabase
          .from("users")
          .select("name, email")
          .eq("id", session.user.id)
          .maybeSingle();

        setUserState({
          id: session.user.id,
          email: profile?.email ?? session.user.email ?? "",
          name:
            profile?.name ??
            (session.user.user_metadata?.name as string | undefined) ??
            session.user.email?.split("@")[0] ??
            "User",
        });
        setIsEmailConfirmed(session.user.email_confirmed_at !== null);
      } else if (event === "SIGNED_OUT") {
        setUserState(null);
        setIsEmailConfirmed(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        isEmailConfirmed,
        setUser: setUserState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
