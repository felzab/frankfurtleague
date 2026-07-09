import z from "zod";

import { getCurrentSeason } from "./queries";

import type { NextPageProps } from "@/shared/types/types";

const saisonIdSchema = z.string().trim().length(4).optional().catch(undefined);

export async function resolveSaisonId(searchParamsPromise: NextPageProps["searchParams"]): Promise<string> {
  return saisonIdSchema.parse((await searchParamsPromise)?.saison_id) ?? (await getCurrentSeason()).saison.id;
}
