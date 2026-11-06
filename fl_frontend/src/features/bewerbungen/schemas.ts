// Redesign: goes with its last importer.
import z from "zod";

import { FLKontaktRolle } from "@/core/generated/client/types";

/** The wire names a seat by this closed set; an input naming another is refused before it is sent. */
export const FLKontaktRolleSchema = z.enum(FLKontaktRolle, {
  error: "Diese Rolle gibt es in einer Bewerbung nicht.",
});
