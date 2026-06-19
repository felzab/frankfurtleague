"use server";
import { auth } from "@/core/auth";
import { patchAdminSpielData } from "./mutations";
import type { PatchAdminSpielDataPayload } from "./types";
import { updateTag } from "next/cache";
import type { FormState } from "@/shared/types/sharedTypes";

export async function patchAdminSpielDataAction(prevState: FormState, formData: FormData): Promise<FormState> {
  // Server-Side Security Check
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const spielId = formData.get("spielId")?.toString();

  const team1Id = formData.get("team1Id")?.toString();
  const team1Name = formData.get("team1Name")?.toString();
  const team1Shorthand = formData.get("team1Shorthand")?.toString();

  const team2Id = formData.get("team2Id")?.toString();
  const team2Name = formData.get("team2Name")?.toString();
  const team2Shorthand = formData.get("team2Shorthand")?.toString();

  if (!spielId || !team1Id || !team1Name || !team2Id || !team2Name) {
    return { success: false, error: "Fehlende Identifikationsdaten für das Spiel oder die Teams." };
  }

  // ?.toString() guarantees we get a string or undefined. It ignores Files.
  const tore1Str = formData.get("tore_team1")?.toString();
  const tore2Str = formData.get("tore_team2")?.toString();

  const ortString = formData.get("ort_payload")?.toString();
  const schiedsrichterString = formData.get("schiedsrichter_payload")?.toString();

  const ortPayload = ortString ? JSON.parse(ortString) : null;
  const schiedsrichterPayload = schiedsrichterString ? JSON.parse(schiedsrichterString) : null;

  const updateDict: PatchAdminSpielDataPayload = {
    spiel_id: spielId,
    is_canceled: formData.get("is_canceled") === "true",
    datum: formData.get("datum")?.toString() || "",
    uhrzeit: formData.get("uhrzeit")?.toString() || "",
    ort: ortPayload,
    schiedsrichter: schiedsrichterPayload,
    team1: {
      team_id: team1Id,
      name: team1Name ?? "",
      tore: !tore1Str ? null : Number(tore1Str),
      shorthand: team1Shorthand ?? "",
    },
    team2: {
      team_id: team2Id,
      name: team2Name ?? "",
      tore: !tore2Str ? null : Number(tore2Str),
      shorthand: team2Shorthand ?? "",
    },
  };

  const patch_operation = await patchAdminSpielData(updateDict);
  if (!patch_operation.acknowledged) {
    return { success: false, error: "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spiele");
  updateTag("teams");

  return { success: Boolean(patch_operation.acknowledged), message: "Die Spieldaten wurden erfolgreich aktualisiert" };
}
