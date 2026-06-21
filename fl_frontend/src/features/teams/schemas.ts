import { CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";
import z from "zod";

import { FLSpielerSchema } from "../spieler/schemas";

export const FLTeamStatistikSchema = z.object({
  anzahl_gespielte_spiele: z.int().nonnegative(),
  siege: z.int().nonnegative(),
  niederlagen: z.int().nonnegative(),
  unentschieden: z.int().nonnegative(),
  tore_geschossen: z.int().nonnegative(),
  tore_kassiert: z.int().nonnegative(),
  punkte: z.int().nonnegative(),
});
export type FLTeamStatistik = z.infer<typeof FLTeamStatistikSchema>;

export const FLTeamSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  gruppe: z.string().length(1),

  statistik: FLTeamStatistikSchema,

  is_placeholder: z.boolean(),
  is_disqualified: z.boolean(),
  shorthand: z.string().length(2),
  description: z.string(),
  full_name: z.string().nonempty(),
  website_url: z.url(),
  address: FLAddressSchema,
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

export const FLTeamCompactSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  statistik: FLTeamStatistikSchema,
  shorthand: z.string().length(2),
  address: FLAddressSchema,
});
export type FLTeamCompact = z.infer<typeof FLTeamCompactSchema>;

export const FLTeamWithSpielerSchema = z.object({
  spieler: z.array(FLSpielerSchema),
});
export type FLTeamWithSpieler = z.infer<typeof FLTeamWithSpielerSchema>;

export const FLGruppenSchema = z.object({
  A: z.array(FLTeamSchema),
  B: z.array(FLTeamSchema),
  C: z.array(FLTeamSchema),
  D: z.array(FLTeamSchema),
});
export type FLGruppen = z.infer<typeof FLGruppenSchema>;

export const FLTeamsListResponseSchema = z.object({
  format: z.literal("list"),
  teams: z.array(FLTeamSchema),
});
export type FLTeamsListResponse = z.infer<typeof FLTeamsListResponseSchema>;

export const FLTeamsCompactListResponseSchema = z.object({
  format: z.literal("compact"),
  teams: z.array(FLTeamCompactSchema),
});
export type FLTeamsCompactListResponse = z.infer<typeof FLTeamsCompactListResponseSchema>;

export const FLTeamsGroupedResponseSchema = z.object({
  format: z.literal("grouped"),
  gruppen: FLGruppenSchema,
});
export type FLTeamsGroupedResponse = z.infer<typeof FLTeamsGroupedResponseSchema>;

export const FLTeamsResponseSchema = z.discriminatedUnion("format", [
  FLTeamsListResponseSchema,
  FLTeamsCompactListResponseSchema,
  FLTeamsGroupedResponseSchema,
]);
export type FLTeamsResponse = z.infer<typeof FLTeamsResponseSchema>;
