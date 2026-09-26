import { NextResponse } from "next/server";

import { getSignInDestination } from "@/core/auth";
import { logger } from "@/core/logging";

import { AENDERUNG_STEHT_WEITERHIN, isRefusal, RUECKNAHME_UNKLAR } from "./actionError";
import { ADMIN_FORBIDDEN, runAdminRouteWrite } from "./adminMutation";
import { buildRefusal } from "./refusal";

import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

/**
 * What a cross-site caller is told, answered 200 for the reason `publicRoute.ts` states: a non-2xx
 * lands in the dispatch's rejection arm, which calls the undo unclear where this one certainly did
 * not run.
 */
const FREMDE_HERKUNFT = `Diese Anfrage kam nicht von dieser Seite. Lade die Seite neu und nimm sie dann erneut zurück. ${AENDERUNG_STEHT_WEITERHIN}`;

const UNDO_RESTORED = "Die Änderung wurde zurückgenommen.";
const UNDO_UNREADABLE = buildRefusal({ reason: "Die Rücknahme wurde nicht ausgeführt", repair: "Lade die Seite neu" });

/**
 * What one slice's replay answers: why it did not commit, that nobody can tell whether it did, or
 * what a commit cost.
 *
 * Fields rather than a string meaning failure: a replay can land and still owe the admin a sentence.
 */
export type UndoReport = {
  /** The German refusal where the restore did not fully commit; absent where it did. */
  refusal?: string;
  /**
   * The German where the replay's write went unacknowledged, which may still have landed: answered as
   * of unknown outcome, so the dispatch titles it unclear rather than refused.
   */
  unclear?: string;
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
 * The sentence a slice's own table words for the refusal its replay met, at whatever status its rule
 * answers with, or `undefined` for any other failure, which the route rethrows.
 */
export function replayRefusal(error: unknown, refusals: Readonly<Record<string, string>>): string | undefined {
  const code = isRefusal(error) ? error.serverErrorCode : undefined;
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

  const guarded = await runAdminRouteWrite(route.mutationName, async () => {
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

    // `success` here means only that the replay ran: its report is answered below.
    return { success: true as const, report };
  });

  // 200 for every answer but a turned-away caller's, the body carrying it: the dispatch reads any other
  // non-2xx as a transport failure (`docs/frontend/spec.md` §1.3).
  if (guarded.forbidden) {
    // `fl_frontend/src/proxy.ts`'s two destinations, which the proxy never applies here: a session the landing
    // sends to `/bereich` is 403, and any other is 401, which sends it somewhere it gets further.
    const status = (await getSignInDestination()) === "/bereich" ? 403 : 401;
    return NextResponse.json({ success: false, error: ADMIN_FORBIDDEN }, { status });
  }

  const result = guarded.answer;
  if (!result.success) {
    // Only a throw answers an unknown outcome here, in the shared reader's sentence for an unclear
    // save, where this write took a change back.
    const unclear = "outcome" in result && result.outcome === "unknown";
    return NextResponse.json(unclear ? { ...result, error: RUECKNAHME_UNKLAR } : result);
  }

  const { refusal, unclear, cost } = result.report;
  if (unclear !== undefined) return NextResponse.json({ success: false, error: unclear, outcome: "unknown" });
  if (refusal !== undefined) return NextResponse.json({ success: false, error: refusal });

  // The standard sentence FIRST and the cost after it: the undo landed, and what it cost is the
  // second fact rather than a replacement for the first.
  return NextResponse.json({
    success: true,
    message: cost === undefined ? UNDO_RESTORED : `${UNDO_RESTORED} ${cost}`,
    warn: cost !== undefined,
  });
}
