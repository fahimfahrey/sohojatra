import { NavigateFunction, Location } from "react-router-dom";
import { Session } from "@supabase/supabase-js";

interface LocationState {
  from?: Location;
  [key: string]: unknown;
}

// Get supabase project id from environment
const getSupabaseProjectId = (): string => {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return projectId ? projectId.toString() : "";
};

// Get the local storage key for auth token
export const getAuthTokenKey = (): string => {
  return "sb-" + getSupabaseProjectId() + "-auth-token";
};

// Check if there's a valid token in localStorage
export const hasValidToken = (): boolean => {
  try {
    const tokenKey = getAuthTokenKey();
    const tokenStr = localStorage.getItem(tokenKey);

    if (!tokenStr) return false;

    const token = JSON.parse(tokenStr);

    if (!token || !token.expires_at || !token.user) return false;

    const expiryTime = new Date(token.expires_at * 1000);
    const now = new Date();

    return now < expiryTime;
  } catch (error) {
    return false;
  }
};

// Get user info from token
export const getUserFromToken = (): {
  id: string;
  name: string;
  email: string;
} | null => {
  try {
    const tokenKey = getAuthTokenKey();
    const tokenStr = localStorage.getItem(tokenKey);

    if (!tokenStr) return null;

    const token = JSON.parse(tokenStr);

    if (!token || !token.user || !token.user.id) return null;

    return {
      id: token.user.id,
      name:
        token.user.user_metadata?.name ||
        token.user.user_metadata?.full_name ||
        token.user.email?.split("@")[0] ||
        "User",
      email: token.user.email || "",
    };
  } catch (error) {
    return null;
  }
};

// Save the last visited protected route to local storage
export const saveLastRoute = (path: string): void => {
  if (path && !path.includes("/login") && !path.includes("/register")) {
    localStorage.setItem("lastRoute", path);
  }
};

// Get the last protected route or return default
export const getLastRoute = (): string => {
  const lastRoute = localStorage.getItem("lastRoute");
  return lastRoute || "/dashboard";
};

// Clear the saved route (typically after successful navigation)
export const clearLastRoute = (): void => {
  localStorage.removeItem("lastRoute");
};

// Helper function to redirect after successful authentication
export const redirectAfterLogin = (
  navigate: NavigateFunction,
  state?: LocationState | null,
): void => {
  const destination = state?.from?.pathname || getLastRoute();

  // Make sure we clear the route before navigation to avoid loops
  clearLastRoute();

  // Attempt navigation with a delay to ensure auth state is properly updated
  setTimeout(() => {
    navigate(destination, { replace: true });
  }, 500); // Increased delay to allow more time for auth state to propagate
};

// Helper to check if the current user session is valid
export const isSessionValid = (session: Session | null): boolean => {
  if (!session) {
    return false;
  }

  // Check if token is expired
  if (session.expires_at) {
    const expiryTime = new Date(session.expires_at * 1000);
    const now = new Date();
    const isValid = now < expiryTime;

    if (!isValid) {
      return false;
    }

    return true;
  }

  return true; // If no expiry info, assume it's valid
};
