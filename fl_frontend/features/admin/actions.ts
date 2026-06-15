"use server";
import { auth } from "@/core/auth";
import { patchAdminSpielData } from "./mutations";
import type { PatchAdminSpielDataPayload } from "./types";
import { updateTag } from "next/cache";
import type { FormState } from "@/shared/types/sharedTypes";

export async function patchAdminSpielDataAction(
  prevState: FormState,
  payload: {
    spielId: string;
    team1Id: string;
    team2Id: string;
    team1Name: string;
    team2Name: string;
    team1Shorthand: string;
    team2Shorthand: string;
    formData: FormData;
  },
): Promise<FormState> {
  const { spielId, team1Id, team2Id, team1Name, team2Name, team1Shorthand, team2Shorthand, formData } = payload;
  // Server-Side Security Check
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  // ?.toString() guarantees we get a string or undefined. It ignores Files.
  const tore1Str = formData.get("tore_team1")?.toString();
  const tore2Str = formData.get("tore_team2")?.toString();
  const mietpreisStr = formData.get("mietpreis")?.toString();

  const updateDict: PatchAdminSpielDataPayload = {
    spiel_id: spielId,
    datum: formData.get("datum")?.toString() || "",
    uhrzeit: formData.get("uhrzeit")?.toString() || "",
    ort: formData.get("ort")?.toString() || "",
    schiedsrichter: formData.get("schiedsrichter")?.toString() || "",
    mietpreis: !mietpreisStr ? 0 : Number(mietpreisStr),
    team1: {
      team_id: team1Id,
      name: team1Name ?? "",
      tore: !tore1Str ? null : Number(tore1Str),
      shorthand: team1Shorthand,
    },
    team2: {
      team_id: team2Id,
      name: team2Name ?? "",
      tore: !tore2Str ? null : Number(tore2Str),
      shorthand: team2Shorthand,
    },
  };

  const patch_operation = await patchAdminSpielData(updateDict);
  if (!patch_operation.acknowledged) {
    return { success: false, error: "Es ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spiele");

  return { success: Boolean(patch_operation.acknowledged), message: "Die Spiel-Daten wurden aktualisiert" };
}
