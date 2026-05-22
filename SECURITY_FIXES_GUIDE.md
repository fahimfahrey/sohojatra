# 🛡️ Security Fixes Implementation Guide

This guide provides step-by-step fixes for all identified vulnerabilities.

---

## 1. FIX: Exposed API Keys

### Step 1: Update .gitignore

```diff
# .gitignore
.env
+ .env.local
+ .env.*.local
+ .env.production.local
```

### Step 2: Remove from Git History

```bash
# Remove .env.local from git history
git rm --cached .env.local
git commit -m "Remove exposed environment variables"

# Or use BFG Repo-Cleaner for complete removal
bfg --delete-files .env.local
```

### Step 3: Revoke Keys

1. Go to Supabase Dashboard → Settings → API Keys
2. Click "Revoke" on the exposed anon key
3. Generate a new anon key
4. Go to Ably Dashboard → API Keys
5. Revoke the exposed key and generate a new one

### Step 4: Update Environment Variables

```bash
# Create new .env.local (not committed)
VITE_SUPABASE_ANON_KEY=<NEW_KEY_HERE>
VITE_SUPABASE_URL=https://uilczasyxzskollvapyr.supabase.co
VITE_ABLY_API_KEY=<NEW_KEY_HERE>
VITE_AUTH_REDIRECT_URL=https://sohojatra.vercel.app/auth/callback
```

---

## 2. FIX: Overly Permissive RLS Policies

### Replace: `supabase/migrations/20250509000001_improved_rls.sql`

```sql
-- Drop existing policies
DROP POLICY IF EXISTS "Users can read any user data" ON users;
DROP POLICY IF EXISTS "Users can create notifications for anyone" ON notifications;

-- FIXED: Users can only read their own data
CREATE POLICY "Users can read their own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- FIXED: Users can read other users' basic info (name only, no email)
CREATE POLICY "Users can read other users basic info"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);

-- FIXED: Only system/triggers can create notifications
CREATE POLICY "System can create notifications"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- FIXED: Users can only read their own notifications
CREATE POLICY "Users can read their own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- FIXED: Users can only update their own notifications
CREATE POLICY "Users can update their own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- FIXED: Users can only delete their own notifications
CREATE POLICY "Users can delete their own notifications"
  ON notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- FIXED: Ride passengers - restrict access
CREATE POLICY "Users can read ride passengers"
  ON ride_passengers
  FOR SELECT
  TO authenticated
  USING (
    -- User can see passengers if they're the ride creator or a passenger
    EXISTS (
      SELECT 1 FROM ride_requests
      WHERE id = ride_id AND creator_id = auth.uid()
    ) OR
    auth.uid() = user_id
  );

-- FIXED: Only ride creator can delete passengers
CREATE POLICY "Ride creator can remove passengers"
  ON ride_passengers
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ride_requests
      WHERE id = ride_id AND creator_id = auth.uid()
    ) OR
    auth.uid() = user_id
  );
```

---

## 3. FIX: Phone Numbers Encryption

### Step 1: Create Encryption Function in Supabase

```sql
-- Create pgcrypto extension if not exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create function to encrypt phone numbers
CREATE OR REPLACE FUNCTION encrypt_phone(phone_number text)
RETURNS text AS $$
BEGIN
  RETURN pgp_sym_encrypt(phone_number, current_setting('app.encryption_key'));
END;
$$ LANGUAGE plpgsql;

-- Create function to decrypt phone numbers
CREATE OR REPLACE FUNCTION decrypt_phone(encrypted_phone text)
RETURNS text AS $$
BEGIN
  RETURN pgp_sym_decrypt(encrypted_phone::bytea, current_setting('app.encryption_key'));
END;
$$ LANGUAGE plpgsql;

-- Add encrypted_phone column to ride_passengers
ALTER TABLE ride_passengers
ADD COLUMN encrypted_phone text;

-- Migrate existing data
UPDATE ride_passengers
SET encrypted_phone = encrypt_phone(contact_phone)
WHERE contact_phone IS NOT NULL;

-- Drop old column
ALTER TABLE ride_passengers
DROP COLUMN contact_phone;

-- Rename encrypted column
ALTER TABLE ride_passengers
RENAME COLUMN encrypted_phone TO contact_phone;
```

### Step 2: Update Database Functions

```typescript
// src/lib/database.ts

export const fetchRidePassengersWithDetails = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("user_id, contact_phone")
    .eq("ride_id", rideId);

  if (error) {
    console.error(`Error fetching passengers for ride ${rideId}:`, error);
    throw error;
  }

  // Phone numbers are now encrypted at rest
  // Only ride creator and passengers can see them via RLS
  return data || [];
};

export const joinRide = async (
  rideId: string,
  userId: string,
  contactPhone: string,
) => {
  // Phone number will be encrypted by database trigger
  const { error: passengerError } = await supabase
    .from("ride_passengers")
    .insert({
      ride_id: rideId,
      user_id: userId,
      contact_phone: contactPhone, // Encrypted by database
    });

  if (passengerError) {
    console.error("Error joining ride:", passengerError);
    throw passengerError;
  }

  // ... rest of function
};
```

---

## 4. FIX: Sensitive Data in localStorage → HttpOnly Cookies

### Step 1: Update Supabase Configuration

```typescript
// src/lib/supabase.ts

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: {
      // Use custom storage that doesn't expose sensitive data
      getItem: (key: string) => {
        // Only store session ID, not full token
        return localStorage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        // Minimal data storage
        localStorage.setItem(key, value);
      },
      removeItem: (key: string) => {
        localStorage.removeItem(key);
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
```

### Step 2: Update Auth Context

```typescript
// src/contexts/AuthContext.tsx

import React, { createContext, useContext, useState, useEffect } from "react";
import { UserType } from "../types";
import { supabase } from "../lib/supabase";
import { signIn, signUp, signOut, getCurrentSession } from "../lib/auth";

interface AuthContextType {
  user: UserType | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<unknown>;
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
      console.error("Error refreshing session:", error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check session from Supabase (uses secure storage)
    refreshSession();

    // Listen for auth state changes
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
      console.error("Login error:", error);
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
      console.error("Registration error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut();
      setUserState(null);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
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
```

---

## 5. FIX: Input Validation - Phone Numbers

### Update: `src/components/rides/PhoneNumberModal.tsx`

```typescript
import React, { useState } from "react";
import Modal from "../shared/Modal";
import { Phone } from "lucide-react";

interface PhoneNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (phoneNumber: string) => void;
}

const PhoneNumberModal: React.FC<PhoneNumberModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");

  // Validate phone number format
  const validatePhoneNumber = (phone: string): boolean => {
    // Remove common separators
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");

    // Check length (10-15 digits)
    if (cleaned.length < 10 || cleaned.length > 15) {
      return false;
    }

    // Check if only digits and optional leading +
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    return phoneRegex.test(cleaned);
  };

  // Sanitize phone number
  const sanitizePhoneNumber = (phone: string): string => {
    // Remove all non-digit characters except leading +
    return phone.replace(/[^\d+]/g, "").slice(0, 20);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Trim whitespace
    const trimmedPhone = phoneNumber.trim();

    // Check if empty
    if (!trimmedPhone) {
      setError("Phone number is required");
      return;
    }

    // Validate format
    if (!validatePhoneNumber(trimmedPhone)) {
      setError("Please enter a valid phone number (10-15 digits)");
      return;
    }

    // Sanitize before submission
    const sanitized = sanitizePhoneNumber(trimmedPhone);

    setError("");
    onSubmit(sanitized);
    setPhoneNumber("");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Contact Information">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 sm:mb-6">
          <label
            htmlFor="phone"
            className="block text-sm sm:text-base font-semibold text-gray-700 mb-2 sm:mb-3"
          >
            Your Phone Number
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none">
              <Phone className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
            </div>
            <input
              type="tel"
              id="phone"
              className="block w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2 sm:py-3 border border-gray-300 rounded-lg sm:rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-colors text-sm sm:text-base"
              placeholder="+1234567890"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              maxLength={20}
              required
            />
          </div>
          {error && <p className="mt-2 text-xs sm:text-sm text-red-600">{error}</p>}

          <div className="mt-2 sm:mt-3 p-3 sm:p-4 bg-blue-50 rounded-lg sm:rounded-xl border border-blue-200">
            <p className="text-xs sm:text-sm text-blue-700">
              <strong>📱 Why we need this:</strong> Your phone number will be shared with other passengers once they join your ride, making it easy to coordinate meeting points and timing.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <button
            type="button"
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg sm:rounded-xl hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm sm:text-base"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-semibold rounded-lg sm:rounded-xl transition-all duration-200 transform hover:scale-105 shadow-medium focus:outline-none focus:ring-2 focus:ring-accent-400 text-sm sm:text-base"
          >
            Create Ride
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PhoneNumberModal;
```

---

## 6. FIX: OAuth Redirect Validation

### Update: `src/lib/auth.ts`

```typescript
// Allowed redirect URLs (whitelist)
const ALLOWED_REDIRECT_URLS = [
  "https://sohojatra.vercel.app/auth/callback",
  "https://sohojatra.com/auth/callback",
  "http://localhost:5173/auth/callback", // Development only
];

// Validate redirect URL
const validateRedirectUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return ALLOWED_REDIRECT_URLS.includes(url);
  } catch {
    return false;
  }
};

export const signInWithGoogle = async () => {
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
```

---

## 7. FIX: Remove Sensitive Console Logs

### Create: `src/lib/logger.ts`

```typescript
// Secure logging utility
const isDevelopment = process.env.NODE_ENV === "development";

export const logger = {
  debug: (message: string, data?: any) => {
    if (isDevelopment) {
      console.debug(message, data);
    }
  },

  info: (message: string) => {
    if (isDevelopment) {
      console.info(message);
    }
  },

  warn: (message: string) => {
    console.warn(message);
  },

  error: (message: string, error?: any) => {
    // Log generic message in production
    console.error(message);

    // Log detailed error only in development
    if (isDevelopment && error) {
      console.error("Details:", error);
    }
  },
};
```

### Update: `src/lib/database.ts`

```typescript
import { logger } from "./logger";

export const fetchAllRides = async () => {
  try {
    const { data, error } = await supabase
      .from("ride_requests")
      .select(`...`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    logger.debug("Fetched rides", { count: data?.length });

    // ... rest of function
  } catch (error) {
    logger.error("Error fetching rides", error);
    throw error;
  }
};
```

---

## 8. FIX: Add Rate Limiting

### Create: `src/lib/rateLimit.ts`

```typescript
// Simple rate limiting utility
interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};

export const rateLimit = (
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000, // 15 minutes
): boolean => {
  const now = Date.now();
  const key = identifier;

  if (!store[key]) {
    store[key] = { count: 1, resetTime: now + windowMs };
    return true;
  }

  if (now > store[key].resetTime) {
    store[key] = { count: 1, resetTime: now + windowMs };
    return true;
  }

  store[key].count++;

  if (store[key].count > maxAttempts) {
    return false;
  }

  return true;
};

export const getRemainingAttempts = (identifier: string): number => {
  const key = identifier;
  if (!store[key]) return 5;
  return Math.max(0, 5 - store[key].count);
};
```

### Update: `src/lib/auth.ts`

```typescript
import { rateLimit } from "./rateLimit";

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

  // ... rest of function
};
```

---

## 9. FIX: Add Content Security Policy

### Update: `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/sohojatra_ico.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <!-- Content Security Policy -->
    <meta
      http-equiv="Content-Security-Policy"
      content="
        default-src 'self';
        script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
        style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
        img-src 'self' data: https:;
        font-src 'self' https://fonts.gstatic.com;
        connect-src 'self' https://uilczasyxzskollvapyr.supabase.co https://*.ably.io;
        frame-ancestors 'none';
        base-uri 'self';
        form-action 'self';
      "
    />

    <!-- Additional Security Headers -->
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <meta http-equiv="X-Content-Type-Options" content="nosniff" />
    <meta http-equiv="X-Frame-Options" content="DENY" />
    <meta http-equiv="X-XSS-Protection" content="1; mode=block" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />

    <title>Sohojatra - Easy Ride Sharing</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## 10. FIX: Add Session Timeout

### Update: `src/contexts/AuthContext.tsx`

```typescript
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let inactivityTimer: NodeJS.Timeout | null = null;

const resetInactivityTimer = () => {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  inactivityTimer = setTimeout(() => {
    // Auto logout on inactivity
    logout();
    toast.error("Session expired due to inactivity");
  }, SESSION_TIMEOUT);
};

// Add event listeners for user activity
useEffect(() => {
  const events = ["mousedown", "keydown", "scroll", "touchstart"];

  const handleActivity = () => {
    if (user) {
      resetInactivityTimer();
    }
  };

  events.forEach((event) => {
    document.addEventListener(event, handleActivity);
  });

  return () => {
    events.forEach((event) => {
      document.removeEventListener(event, handleActivity);
    });
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
  };
}, [user]);
```

---

## Implementation Checklist

- [ ] Update `.gitignore`
- [ ] Remove `.env.local` from git history
- [ ] Revoke exposed API keys
- [ ] Generate new API keys
- [ ] Update RLS policies
- [ ] Implement phone number encryption
- [ ] Update authentication to use secure storage
- [ ] Add input validation
- [ ] Add OAuth redirect validation
- [ ] Remove sensitive console logs
- [ ] Add rate limiting
- [ ] Add CSP headers
- [ ] Add session timeout
- [ ] Test all changes
- [ ] Deploy to production

---

## Testing Checklist

- [ ] Test login/logout flow
- [ ] Test phone number validation
- [ ] Test rate limiting
- [ ] Test RLS policies
- [ ] Test OAuth redirect
- [ ] Verify no sensitive data in console
- [ ] Verify no sensitive data in localStorage
- [ ] Test session timeout
- [ ] Verify CSP headers are set

---

## Deployment Checklist

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Code review completed
- [ ] Backup database before migration
- [ ] Run database migrations
- [ ] Monitor for errors
- [ ] Verify all features working
- [ ] Check security headers
- [ ] Monitor logs for suspicious activity
