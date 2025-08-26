import { supabase } from "./supabase";

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
  const result = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error) {
    throw result.error;
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
          console.error("Error creating user during login:", insertError);
        }
      }
    } catch (err) {
      console.error("Error checking/creating user during login:", err);
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
    throw result.error;
  }

  if (!result.data.user) {
    throw new Error("Failed to create user");
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
        console.error("Failed to create user profile", profileError);
        throw profileError;
      }
    }
  } catch (err: any) {
    // If error is not a "record not found" error, then log it
    if (err?.code !== "PGRST116") {
      console.error("Error checking/creating user profile:", err);
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
  // Build a redirect back to the app after OAuth completes
  // Use production domain for OAuth redirect
  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const siteUrl = isDevelopment 
    ? window.location.origin 
    : 'https://www.sohojatra.com'; // Replace with your actual domain
  
  const redirectUrl = `${siteUrl}/auth/callback`;

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
        console.error("Error creating user during OAuth:", insertError);
      }
    }
  } catch (err) {
    console.error("Error checking/creating user during OAuth:", err);
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
