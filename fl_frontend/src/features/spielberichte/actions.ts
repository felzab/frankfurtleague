"use server";

import { frontend_config } from "@/core/config";
import { spielberichtePatchSpielbericht } from "@/core/generated/client/sdk";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPIELBERICHT_GESCHLOSSEN_REFUSAL } from "./constants";
import { FLSpielberichtPayloadSchema } from "./schemas";
import { mapSpielberichtRefusal } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type z from "zod";

/**
 * An administrator's correction of a report. A step-up write: it overwrites the referee's account, and
 * no undo takes it back.
 */
export async function patchAdminSpielberichtAction(
  spielId: string,
  rawPayload: z.input<typeof FLSpielberichtPayloadSchema>,
): Promise<ActionResult> {
  return runAdminMutation("patchAdminSpielberichtAction", { stepUp: true }, async () => {
    // Inside the spine, never ahead of it: a caller the guard turns away is the spine's to answer whatever the switch reads.
    if (frontend_config.SPIELBERICHT_EINGABE !== "on") return { success: false, error: SPIELBERICHT_GESCHLOSSEN_REFUSAL };

    const id = CustomObjectIdStringSchema.safeParse(spielId);
    const validated = FLSpielberichtPayloadSchema.safeParse(rawPayload);
    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    try {
      await spielberichtePatchSpielbericht(id.data, validated.data);
    } catch (error) {
      const refusal = mapSpielberichtRefusal(error, "admin");
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    // No tag moves: the report is read uncached wherever it is read, and the spine's refresh brings the editor's read back.
    return { success: true, message: "Spielbericht gespeichert" };
  });
}
