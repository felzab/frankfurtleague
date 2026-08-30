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

type UndoRoute<TPayload> = {
  mutationName: string;
  schema: ZodType<TPayload>;
  /** The German refusal where the restore did not fully commit, `undefined` where it did. */
  restore: (payload: TPayload) => Promise<string | undefined>;
  /**
   * Reached only where the restore committed, and guarded: the write has landed, so a failed
   * invalidation must not report a failure. The call stays in the route, where `revalidateTag`
   * and its `{ expire: 0 }` belong (`docs/frontend/spec.md` I14).
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

    const refusal = await route.restore(parsed.data);
    if (refusal !== undefined) {
      return { success: false as const, error: refusal };
    }

    try {
      route.invalidate(parsed.data);
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: UNDO_RESTORED };
  });

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
