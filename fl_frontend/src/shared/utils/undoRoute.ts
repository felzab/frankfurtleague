import { NextResponse } from "next/server";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";

import { ADMIN_FORBIDDEN, runAdminMutation } from "./adminMutation";
import { buildRefusal } from "./refusal";

import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

/**
 * What a cross-site caller is told, answered 200 for the reason `publicRoute.ts` states: a non-2xx
 * lands in the dispatch's rejection arm, which blames the transport and sends the admin to check a
 * connection that is fine.
 */
const FREMDE_HERKUNFT =
  "Die Änderung steht weiterhin. Diese Anfrage kam nicht von dieser Seite. Lade die Seite neu und nimm sie dann erneut zurück.";

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
 * The spine the page-owned editors' undo handlers share, leaving each route only what is its own.
 */
export async function handleUndoRequest<TPayload>(request: NextRequest, route: UndoRoute<TPayload>): Promise<NextResponse> {
  // Same-origin only; the session check below is what authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: FREMDE_HERKUNFT });
  }

  const result = await runAdminMutation(route.mutationName, async () => {
    if (!(await getAdminSession())) {
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

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
