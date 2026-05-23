import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const ACTIVITY_COOKIE = "sb-last-activity";

function secureCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: options.path ?? "/",
  };
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(
              name,
              value,
              secureCookieOptions(options),
            );
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = Date.now();
  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/auth");

  const isRideDetailPage = /^\/rides\/[^/]+$/.test(pathname);

  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/create-ride") ||
    pathname === "/rides" ||
    pathname.startsWith("/email-confirmation");

  if (user) {
    const lastRaw = request.cookies.get(ACTIVITY_COOKIE)?.value;
    const last = lastRaw ? Number(lastRaw) : NaN;
    const expired = Number.isFinite(last) && now - last > SESSION_IDLE_MS;

    if (expired) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      url.searchParams.set("reason", "timeout");
      const redirect = NextResponse.redirect(url);
      redirect.cookies.delete(ACTIVITY_COOKIE);
      return redirect;
    }

    supabaseResponse.cookies.set(
      ACTIVITY_COOKIE,
      String(now),
      secureCookieOptions({ maxAge: SESSION_IDLE_MS / 1000 }),
    );
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute && !pathname.startsWith("/auth/callback")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (
    user &&
    isProtected &&
    !isRideDetailPage &&
    pathname !== "/email-confirmation" &&
    !user.email_confirmed_at
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/email-confirmation";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
