import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";

/**
 * Second layer behind `proxy.ts`: renders `children` only for an authenticated admin.
 *
 * Separate from `admin/layout.tsx` on purpose: a layout that `await`s this before returning any JSX
 * makes every byte of the admin shell — sidemenu, nav, chrome — dynamic. The guard sits inside the
 * layout's existing `Suspense` instead, so the shell prerenders and only the session check is a
 * request-time hole.
 *
 * **It must wrap `children`, never sit beside them.** As a sibling, the page's own hole could start
 * streaming data before the session check resolved; wrapping makes rendering the page conditional on
 * the guard returning.
 *
 * `connection()` stays first, per ADR-0006 — the builder stage has no reachable Mongo, and a
 * session lookup resolved at build time would fail `docker compose build`.
 *
 * **Known and accepted trade.** `proxy.ts` matches `/admin/:path*` and answers an unauthenticated
 * request with a 307 before this ever runs, which is the path every real user takes. If that matcher
 * ever stops covering a segment, this still redirects — but from inside a stream, so the response is
 * a 200 whose shell (nav labels only, no data) has already been sent. It fails closed either way,
 * just later and less cleanly than the proxy does.
 */
export async function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  await connection();
  if (!(await getAdminSession())) redirect("/signin");

  return <>{children}</>;
}
