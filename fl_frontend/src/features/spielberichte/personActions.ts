"use server";

import { frontend_config } from "@/core/config";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPIELBERICHT_GESCHLOSSEN_REFUSAL } from "./constants";
import { putSpielbericht } from "./mutations";
import { FLSpielberichtPayloadSchema } from "./schemas";
import { mapSpielberichtRefusal } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type z from "zod";

/**
 * The booked referee's report. It claims the referee's own record rather than a seat, and the backend
 * judges the booking; no cache tag moves, the report being read uncached wherever it is read.
 */
export async function putSpielberichtAction(spielId: string, rawPayload: z.input<typeof FLSpielberichtPayloadSchema>): Promise<ActionResult> {
  return runPersonRecordMutation("putSpielberichtAction", async () => {
    // Inside the spine, never ahead of it: a caller with no session is the spine's to answer whatever the switch reads.
    if (frontend_config.SPIELBERICHT_EINGABE !== "on") return { success: false, error: SPIELBERICHT_GESCHLOSSEN_REFUSAL };

    const id = CustomObjectIdStringSchema.safeParse(spielId);
    const validated = FLSpielberichtPayloadSchema.safeParse(rawPayload);
    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    try {
      await putSpielbericht(id.data, validated.data);
    } catch (error) {
      const refusal = mapSpielberichtRefusal(error, "schiedsrichter");
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: "Spielbericht gespeichert" };
  });
}
