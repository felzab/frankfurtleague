import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";
import { z } from "zod";

import { FLSpielOrtFieldSchema, FLSpielSchiedsrichterFieldSchema, FLSpielTeamFieldSchema } from "../spiele/schemas";

export const AdminPatchSpielDataPayloadSchema = z.object({
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  team1: FLSpielTeamFieldSchema,
  team2: FLSpielTeamFieldSchema,

  spiel_id: CustomObjectIdStringSchema,
  is_canceled: z.boolean(),
});

export type AdminPatchSpielDataPayload = z.infer<typeof AdminPatchSpielDataPayloadSchema>;
