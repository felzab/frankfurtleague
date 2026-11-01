"use server";

import { spielberichtePutSpielberichtBericht } from "@/core/generated/client/sdk";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { FLSpielberichtPayloadSchema } from "./schemas";
import { mapSpielberichtRefusal } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type z from "zod";

/**
 * The booked referee's report. It claims the referee's own record rather than a seat, and the backend
 * judges the booking.
 */
export async function putSpielberichtAction(spielId: string, rawPayload: z.input<typeof FLSpielberichtPayloadSchema>): Promise<ActionResult> {
  return runPersonRecordMutation("putSpielberichtAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(spielId);
    const validated = FLSpielberichtPayloadSchema.safeParse(rawPayload);
    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    try {
      await spielberichtePutSpielberichtBericht(id.data, validated.data);
    } catch (error) {
      const refusal = mapSpielberichtRefusal(error, "schiedsrichter");
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: "Spielbericht gespeichert" };
  });
}
