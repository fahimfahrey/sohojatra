import { supabase } from "./supabase";
import { rateLimit } from "./rateLimit";

export type SignInCredentials = {
  email: string;
  password: string;
};

export type SignUpCredentials = {
  email: string;
  password: string;
  name: string;
};

export const signIn = async ({ email, password }: SignInCredentials) => {
  // Rate limit login attempts
  if (!rateLimit(`login:${email}`, 5, 15 * 60 * 1000)) {
    throw new Error("Too many login attempts. Please try again later.");
  }

  const result = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error) {
    // Generic error message to prevent user enumeration
    throw new Error("Invalid email or password");
  }

  // Ensure the user exists in the users table
  if (result.data?.user) {
    try {
      // Check if user exists in database
      const { data: existingUser, error: fetchError } = await supabase
        .from("users")
        .select("id")
        .eq("id", result.data.user.id)
        .single();

      if (fetchError || !existingUser) {
        // Create user if not found
        const userName =
          result.data.user.user_metadata?.name ||
          result.data.user.user_metadata?.full_name ||
          email.split("@")[0] ||
          "User";

        const { error: insertError } = await supabase.from("users").upsert({
          id: result.data.user.id,
          email: email,
          name: userName,
        });

        if (insertError && insertError.code !== "23505") {
          // Ignore duplicate key errors
        }
      }
    } catch (err) {
      // Error handling
    }
  }

  return result.data;
};

export const signUp = async ({ email, password, name }: SignUpCredentials) => {
  // First check if user already exists
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (existingUser) {
    throw new Error("User already registered");
  }

  // Get the current site URL to build a proper redirect URL
  const siteUrl = window.location.origin;
  const redirectUrl = `${siteUrl}/auth/verify`;

  const result = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name, // Store name in auth metadata
      },
      emailRedirectTo: redirectUrl, // Redirect to our verification handler
    },
  });

  if (result.error) {
    console.error("[auth.signUp] supabase signUp error", result.error);
    throw new Error("Failed to create account");
  }

  if (!result.data.user) {
    throw new Error("Failed to create account");
  }

  // The database trigger will handle user creation in most cases,
  // but we'll check if the user exists and only create if needed
  try {
    // First check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", result.data.user.id)
      .single();

    // Only create user if they don't already exist
    if (!existingUser) {
      const { error: profileError } = await supabase.from("users").insert({
        id: result.data.user.id,
        email,
        name,
      });

      if (profileError) {
        throw profileError;
      }
    }
  } catch (err: any) {
    // If error is not a "record not found" error, then throw it
    if (err?.code !== "PGRST116") {
      throw err;
    }
  }

  return result.data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
};

// Google OAuth sign-in
export const signInWithGoogle = async () => {
  // Allowed redirect URLs (whitelist)
  const ALLOWED_REDIRECT_URLS = [
    "https://sohojatra.vercel.app/auth/callback",
    "https://sohojatra.com/auth/callback",
    "http://localhost:5173/auth/callback", // Development only
  ];

  // Validate redirect URL
  const validateRedirectUrl = (url: string): boolean => {
    try {
      return ALLOWED_REDIRECT_URLS.includes(url);
    } catch {
      return false;
    }
  };

  const redirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL;

  // Validate redirect URL
  if (!validateRedirectUrl(redirectUrl)) {
    throw new Error("Invalid redirect URL configuration");
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    throw error;
  }

  return data;
};

// Handle user creation after OAuth sign-in
export const handleOAuthUserCreation = async (user: any) => {
  if (!user) return;

  try {
    // Check if user exists in database
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .single();

    if (fetchError || !existingUser) {
      // Create user if not found
      const userName =
        user.user_metadata?.name ||
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "User";

      const { error: insertError } = await supabase.from("users").upsert({
        id: user.id,
        email: user.email,
        name: userName,
      });

      if (insertError && insertError.code !== "23505") {
        // Ignore duplicate key errors
      }
    }
  } catch (err) {
    // Error handling
  }
};

export const getCurrentSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
};

export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  return data.user;
};

// Get the full user profile including name
export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
};
