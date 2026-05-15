import React, { createContext, useContext, useState, useEffect } from "react";
import { UserType } from "../types";
import { supabase } from "../lib/supabase";
import {
  signIn,
  signUp,
  signOut,
  getCurrentSession,
  signInWithGoogle,
} from "../lib/auth";
import { getAuthTokenKey } from "../lib/sessionHelper";

interface AuthContextType {
  user: UserType | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<unknown>;
  loginWithGoogle: () => Promise<unknown>;
  register: (name: string, email: string, password: string) => Promise<unknown>;
  logout: () => void;
  isEmailConfirmed: boolean;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUserState] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState(false);

  // Function to refresh and synchronize session data
  const refreshSession = async () => {
    try {
      const session = await getCurrentSession();

      if (session?.user) {
        const userData = {
          id: session.user.id,
          name:
            session.user.user_metadata?.name ||
            session.user.user_metadata?.full_name ||
            session.user.email?.split("@")[0] ||
            "User",
          email: session.user.email || "",
        };

        setUserState(userData);
        setIsEmailConfirmed(session.user.email_confirmed_at !== null);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check for authentication directly from localStorage
    const tokenKey = getAuthTokenKey();
    const token = localStorage.getItem(tokenKey);

    if (token) {
      try {
        const tokenData = JSON.parse(token);
        if (tokenData.user) {
          const userData = {
            id: tokenData.user.id,
            name:
              tokenData.user.user_metadata?.name ||
              tokenData.user.user_metadata?.full_name ||
              tokenData.user.email?.split("@")[0] ||
              "User",
            email: tokenData.user.email || "",
          };
          setUserState(userData);
          setIsEmailConfirmed(tokenData.user.email_confirmed_at !== null);

          // Refresh session to get the latest data
          refreshSession();
        }
      } catch (error) {
        localStorage.removeItem(tokenKey);
      }
    } else {
      setIsLoading(false);
    }

    // Listen for auth state changes from Supabase
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        const userData = {
          id: session.user.id,
          name:
            session.user.user_metadata?.name ||
            session.user.user_metadata?.full_name ||
            session.user.email?.split("@")[0] ||
            "User",
          email: session.user.email || "",
        };
        setUserState(userData);
        setIsEmailConfirmed(session.user.email_confirmed_at !== null);
        setIsLoading(false);
      } else if (event === "SIGNED_OUT") {
        localStorage.removeItem(tokenKey);
        setUserState(null);
        setIsEmailConfirmed(false);
        setIsLoading(false);
      } else if (event === "USER_UPDATED") {
        refreshSession();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const result = await signIn({ email, password });
      return result;
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (name: string, email: string, password: string) => {
    setIsLoading(true);
    try {
      const result = await signUp({ name, email, password });
      return result;
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const result = await signInWithGoogle();
      return result;
    } catch (error) {
      throw error;
    } finally {
      // For OAuth, Supabase will redirect away; this finally may not run before navigation
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut();
      localStorage.removeItem(getAuthTokenKey());
      setUserState(null);
    } catch (error) {
      // Error signing out
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        isEmailConfirmed,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
