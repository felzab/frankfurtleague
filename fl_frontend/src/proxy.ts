import { NextResponse } from "next/server";
import { auth } from "./core/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // Not logged in -> Send to sign in
  if (!isLoggedIn) {
    const loginUrl = new URL("/signin", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in, but NOT an admin -> Kick to homepage
  if (req.auth?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Authorized Admin -> Let them through
  return NextResponse.next();
});

// Only run this file if the URL starts with /admin
export const config = {
  matcher: ["/admin/:path*"],
};
