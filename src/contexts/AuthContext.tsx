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
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState(true);

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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
