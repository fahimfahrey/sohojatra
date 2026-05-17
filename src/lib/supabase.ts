"use client";

import { createClient as createBrowserClient } from "@/lib/supabase/client";

/** @deprecated Prefer `createClient()` from `@/lib/supabase/client` */
export const supabase = createBrowserClient();
