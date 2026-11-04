import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { frontend_config } from "./config";
import { ROUTES } from "./routes";

import type { NextRequest } from "next/server";

/**
 * The pages a mailed link opens whose token must leave the address: one leads a signed-out visitor through the
 * sign-in, whose return address and Turnstile's script would both carry it, the other loads Turnstile itself. The
 * proxy swaps the token for a cookie on the first request, so no address such a page renders under holds it.
 * `fl_frontend/src/proxy.ts :: config` spells the same paths in its matcher, which takes literals alone.
 */
export const MAILED_LINK_PAGES: readonly string[] = [ROUTES.accountErasure.path(), ROUTES.registrierung.path()];

/** The parameter every mailed link carries its token under. */
const TOKEN_PARAMETER = "token";

/** One name for every page: each page's cookie is bound to that page's path, so no page reads another's token. */
const MAILED_LINK_COOKIE = "mailed_link";

/**
 * Long enough for the sign-in a link may wait on; the mail's own link stays valid past it. The privacy notice
 * states the hour (`fl_frontend/src/core/serverCopy.ts`, `website.browser`).
 */
const MAILED_LINK_SECONDS = 60 * 60;

/**
 * The proxy's answer to a mailed link's first request: a redirect to `page`'s plain address, its token held in
 * `page`'s cookie, or `null` where the request carries no token. A repeated parameter is no link at all, so it
 * deletes a cookie an earlier link left rather than keeping that link alive. A single empty one never reaches here:
 * Next's matcher reads an empty query value as absent, so the page renders on the cookie it holds, as its plain
 * address does, and no mail sends that spelling.
 */
export function swapMailedLinkToken(req: NextRequest, page: string): NextResponse | null {
  const tokens = req.nextUrl.searchParams.getAll(TOKEN_PARAMETER);
  if (tokens.length === 0) return null;

  const answer = NextResponse.redirect(new URL(page, req.nextUrl));
  const [token] = tokens;
  if (tokens.length !== 1 || token === undefined) {
    answer.cookies.delete({ name: MAILED_LINK_COOKIE, path: page });
    return answer;
  }

  answer.cookies.set(MAILED_LINK_COOKIE, token, {
    httpOnly: true,
    // Never `strict`: the cookie is set on a redirect a click in a mail program starts, and a browser sends no
    // `strict` cookie down a redirect chain another site began, so the page would read nothing.
    sameSite: "lax",
    path: page,
    maxAge: MAILED_LINK_SECONDS,
    // As the library decides its own cookies' (`fl_frontend/src/core/auth/library.ts :: cookieNaming`).
    secure: new URL(frontend_config.AUTH_URL).protocol === "https:",
  });
  return answer;
}

/** The token the proxy took out of the requested page's address, or `null` where no link brought one. */
export async function mailedLinkToken(): Promise<string | null> {
  const token = (await cookies()).get(MAILED_LINK_COOKIE)?.value;
  return token === undefined || token === "" ? null : token;
}

/**
 * Deletes `page`'s cookie once its link has done its work, as the privacy notice promises, so a later visitor of a
 * shared browser opening the plain address meets no earlier person's link. Only a server action or a route handler may
 * write a cookie, so the act completing the link calls this, never the page; the path is the one the proxy set, which
 * a browser matches the deletion on.
 */
export async function forgetMailedLink(page: string): Promise<void> {
  (await cookies()).delete({ name: MAILED_LINK_COOKIE, path: page });
}
