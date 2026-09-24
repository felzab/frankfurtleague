import { NextResponse } from "next/server";

import { getAdminSession, getSignInDestination } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { logger } from "@/core/logging";

import { AENDERUNG_STEHT_WEITERHIN } from "./actionError";
import { ADMIN_FORBIDDEN, runAdminMutation } from "./adminMutation";
import { buildRefusal } from "./refusal";

import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

/**
 * What a cross-site caller is told, answered 200 for the reason `publicRoute.ts` states: a non-2xx
 * lands in the dispatch's rejection arm, which blames the transport and sends the admin to check a
 * connection that is fine.
 */
const FREMDE_HERKUNFT = `${AENDERUNG_STEHT_WEITERHIN} Diese Anfrage kam nicht von dieser Seite. Lade die Seite neu und nimm sie dann erneut zurück.`;

const UNDO_RESTORED = "Die Änderung wurde zurückgenommen.";
const UNDO_UNREADABLE = buildRefusal({ reason: "Die Rücknahme wurde nicht ausgeführt", repair: "Lade die Seite neu" });

/**
 * What one slice's replay answers: why it did not commit, or what a commit cost.
 *
 * Two fields rather than a string meaning failure: a replay can land and still owe the admin a sentence.
 */
export type UndoReport = {
  /** The German refusal where the restore did not fully commit; absent where it did. */
  refusal?: string;
  /**
   * What a committed restore moved beyond the rows it put back. Present, it follows the standard
   * sentence and grades the toast a warning, so a replay with collateral does not read as a clean undo.
   */
  cost?: string;
};

type UndoRoute<TPayload> = {
  mutationName: string;
  schema: ZodType<TPayload>;
  restore: (payload: TPayload) => Promise<UndoReport>;
  /**
   * Reached wherever the restore ran, and guarded: a failed invalidation must not turn a landed write
   * into a reported failure. The call stays in the route, where `revalidateTag` and its
   * `{ expire: 0 }` belong (`docs/frontend/spec.md` I14 and I55).
   */
  invalidate: (payload: TPayload) => void;
};

/**
 * The sentence a slice's own table words for the 409 its replay met, or `undefined` for any other
 * failure, which the route rethrows.
 */
export function replayRefusal(error: unknown, refusals: Readonly<Record<string, string>>): string | undefined {
  const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
  // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
  return code == null || !Object.hasOwn(refusals, code) ? undefined : refusals[code];
}

/**
 * The table's reason, then what became of the change, which a cause alone leaves the admin guessing;
 * `closing` is the half that went back where a replay of two writes had restored the first.
 */
export function refusedReplay(error: unknown, refusals: Readonly<Record<string, string>>, closing = AENDERUNG_STEHT_WEITERHIN): UndoReport {
  const reason = replayRefusal(error, refusals);
  if (reason === undefined) throw error;

  return { refusal: `${reason} ${closing}` };
}

/**
 * The spine the page-owned editors' undo handlers share, leaving each route only what is its own.
 */
export async function handleUndoRequest<TPayload>(request: NextRequest, route: UndoRoute<TPayload>): Promise<NextResponse> {
  // Same-origin only; the session check below is what authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: FREMDE_HERKUNFT });
  }

  // 200 for every outcome but a turned-away caller, the body carrying it: the dispatch reads any other
  // non-2xx as a transport failure (`docs/frontend/spec.md` §1.3).
  let status: 200 | 401 | 403 = 200;

  const result = await runAdminMutation(route.mutationName, { readOnly: false }, async () => {
    // Asked only once refused, so an admin's undo pays one session read.
    if (!(await getAdminSession())) {
      // `fl_frontend/src/proxy.ts`'s two destinations, which the proxy never applies here: only a person's live
      // session is 403, and an administrator past a lifetime or short of the factor is 401, which sends them
      // somewhere they can get back in.
      status = (await getSignInDestination()) === "/" ? 403 : 401;
      return { success: false as const, error: ADMIN_FORBIDDEN };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = route.schema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: UNDO_UNREADABLE };
    }

    // In a `finally` rather than under the refusal below: a replay committing in parts leaves rows
    // written behind a refusal and behind a throw alike, and a cached read still serves what the undo
    // removed (`docs/frontend/spec.md` §1.5).
    let report: UndoReport = {};
    try {
      report = await route.restore(parsed.data);
    } finally {
      try {
        route.invalidate(parsed.data);
      } catch (invalidationError) {
        logger.warn("Undo cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
      }
    }

    if (report.refusal !== undefined) {
      return { success: false as const, error: report.refusal };
    }

    // The standard sentence FIRST and the cost after it: the undo landed, and what it cost is the
    // second fact rather than a replacement for the first.
    return {
      success: true as const,
      message: report.cost === undefined ? UNDO_RESTORED : `${UNDO_RESTORED} ${report.cost}`,
      warn: report.cost !== undefined,
    };
  });

  return NextResponse.json(result, { status });
}
