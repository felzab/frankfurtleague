"use server";
import { auth } from "@/core/auth";
import { patchAdminSpielData } from "./mutations";
import type { PatchAdminSpielDataPayload } from "./types";
import { updateTag } from "next/cache";

type FormState = {
  message?: string;
  success: boolean;
  error?: string;
} | null;

export async function patchAdminSpielDataAction(
  spiel_id: string,
  id_team1: string,
  id_team2: string,
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. Mandatory Server-Side Security Check
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  // 1. SAFELY extract strings directly from FormData
  // ?.toString() guarantees we get a string or undefined. It ignores Files.
  const tore1Str = formData.get("tore_team1")?.toString();
  const tore2Str = formData.get("tore_team2")?.toString();
  const mietpreisStr = formData.get("mietpreis")?.toString();

  // 2. Build the dictionary safely
  const updateDict: PatchAdminSpielDataPayload = {
    spiel_id: spiel_id,
    datum: formData.get("datum")?.toString() || "",
    uhrzeit: formData.get("uhrzeit")?.toString() || "",
    ort: formData.get("ort")?.toString() || "",
    schiedsrichter: formData.get("schiedsrichter")?.toString() || "",
    mietpreis: !mietpreisStr ? 0 : Number(mietpreisStr),
    team1: {
      team_id: id_team1,
      name: formData.get("name_team1")?.toString() || "",
      tore: !tore1Str ? null : Number(tore1Str),
    },
    team2: {
      team_id: id_team2,
      name: formData.get("name_team2")?.toString() || "",
      tore: !tore2Str ? null : Number(tore2Str),
    },
  };

  updateTag("spielplan");
  updateTag("spielhistorie");
  updateTag("all_spiele");
  updateTag("spiele_preview");

  updateTag("saisontabelle");
  updateTag("all_team_with_spieler");

  const patch_operation = await patchAdminSpielData(updateDict);

  return { success: Boolean(patch_operation.acknowledged), message: "Die Spiel-Daten wurden aktualisiert" };
}
