"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { activateSaison, patchSaison, postSaison, swapGruppen } from "./mutations";
import { FLActivateSaisonPayloadSchema, FLPatchSaisonPayloadSchema, FLPostSaisonPayloadSchema, FLSwapGruppenPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
} from "./schemas";

const SAISON_ID_TAKEN = "Diese Saison-ID ist bereits vergeben. Wähle eine andere oder bearbeite die vorhandene Saison.";

/** A rules 409 as the message it should render, or `null` when the code is none of these. */
function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-RULES-001":
      return { fieldErrors: { "rules.qualifiers_per_group": "Gruppen mal Qualifikanten muss eine Zweierpotenz von 2 bis 16 ergeben." } };
    case "REQ-RULES-002":
      return { fieldErrors: { "rules.number_of_groups": "Eine Gruppe, die noch Teams hält, kann nicht wegfallen." } };
    case "REQ-RULES-003":
      return { fieldErrors: { "rules.teams_per_group": "Mindestens eine Gruppe hält schon mehr Teams als dieses Maximum." } };
    case "REQ-RULES-004":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group": "Ein Platz im KO-Baum verweist auf eine Platzierung, die dann nicht mehr erreicht wird.",
        },
      };
    case "REQ-RULES-007":
      return { fieldErrors: { "rules.qualifiers_per_group": "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst." } };
    // Only a step that introduces or worsens it is refused, and an equal count is allowed — so the
    // message says "mehr" rather than promising a rule the server does not apply.
    case "REQ-RULES-008":
      return { fieldErrors: { "rules.draw_points": "Ein Unentschieden darf nicht mehr Punkte bringen als ein Sieg." } };
    case "REQ-RULES-009":
      return { fieldErrors: { "rules.max_kadergroesse": "Mindestens ein Kader hat schon mehr Spieler als dieses Maximum." } };
    // On the winner's box, which is the one to raise, and only there: `<FieldError>` renders under
    // the input whose `name` the key matches, and the pair's own row picks it up through
    // `saisonDraftStatus`'s `errorPaths`.
    case "REQ-RULES-010":
      return {
        fieldErrors: {
          "rules.forfeit_ergebnis.sieger_tore":
            "Diese Saison spielt eine KO-Runde, in der ein Unentschieden niemanden weiterbringt. Sieger und Verlierer brauchen unterschiedliche Tore.",
        },
      };
    // Both freezes can hold at once and neither message can see which does, so each names only what
    // it freezes and closes with the four fields neither reaches. `FormRegelnSection`'s note has the
    // season's status and lists the rest per case.
    case "REQ-RULES-005":
      return {
        error:
          "Diese Saison ist abgeschlossen, deshalb sind Punkte, die Reihenfolge bei Punktgleichheit und die Qualifikanten festgeschrieben. " +
          "Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar.",
      };
    // A bare message, the shape `REQ-RULES-005` uses: the two freezes refuse the same class of edit
    // in one panel, and one answering through field paths would split that into two mechanisms.
    case "REQ-RULES-011":
      return {
        error:
          "Für diese Saison sind bereits Spiele angesetzt, und sie sind aus diesen Zahlen entstanden. Gruppen, Teams pro Gruppe und " +
          "Qualifikanten stehen damit fest; einen neuen Spielplan legt die Verwaltung nicht an. Nichtantreten, Kadergröße, Stufen und der " +
          "Zeitraum bleiben änderbar.",
      };
    case "REQ-RULES-006":
      return {
        error:
          "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder oder verschiebe die überzähligen Spiele.",
      };
    case "REQ-DATE-004":
      return {
        error: "Mindestens ein Spieltag liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verschiebe diese Spieltage.",
      };
    default:
      return null;
  }
}

/** `teams` too: the league table is scored from `rules` on read, so an edit moves every standing. */
function invalidateSaisonAndTable(): void {
  updateTag("saisons");
  updateTag("teams");
}

/**
 * Every read that omits `saison_id` answers differently after this, and its cache entry carries no
 * season id to invalidate more narrowly by.
 */
function invalidateRollover(): void {
  updateTag("saisons");
  updateTag("spiele");
  updateTag("spieltage");
  updateTag("teams");
}

export async function postSaisonAction(
  rawPayload: FLPostSaisonPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // `REQ-RULES-001` is checked first: a duplicate `_id` arrives from the index with no error code
    // to discriminate on, so it can only be the fallback.
    let postOperation;
    try {
      postOperation = await postSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return { success: false, error: VALIDATION_FAILED, ...refusal };
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: SAISON_ID_TAKEN, fieldErrors: { id: SAISON_ID_TAKEN } };
      }
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen der neuen Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    // A create lands `future`, so nothing resolving the current season moves. Only the list does.
    updateTag("saisons");

    return {
      success: true,
      created_id: postOperation.created_id,
      message: `Saison ${postOperation.created_id} angelegt. Sie ist geplant, noch nicht aktiv.`,
    };
  });
}

export async function patchSaisonAction(rawPayload: FLPatchSaisonPayload): Promise<{
  success: boolean;
  saison?: FLPatchSaisonResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Every rules refusal has to reach the editor rather than the error page: the panel the admin is
    // looking at is where the wrong value still sits.
    let patchOperation;
    try {
      patchOperation = await patchSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: "Bei der Bearbeitung der Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSaisonAndTable();

    return {
      success: true,
      saison: patchOperation,
      message: "Saison gespeichert!",
    };
  });
}

/**
 * The only path to `status: "active"`, under two refusals: `REQ-ACTIVATE-001` while the outgoing
 * season has unplayed fixtures, demotion to `past` freezing its table into the record;
 * `REQ-ACTIVATE-002` on a `past` target, which nothing reopens.
 */
export async function activateSaisonAction(rawPayload: FLActivateSaisonPayload): Promise<{
  success: boolean;
  saison?: FLActivateSaisonResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("activateSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLActivateSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The panel closes the control for both, so either one arriving here means the page is stale. The
    // first names the remedy; the second has none, and says so rather than implying one.
    let activateOperation;
    try {
      activateOperation = await activateSaison(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        if (error.serverErrorCode === "REQ-ACTIVATE-001") {
          return {
            success: false,
            error: "Die laufende Saison hat noch Spiele ohne Ergebnis. Trage die Ergebnisse ein oder sage die Spiele ab.",
          };
        }
        if (error.serverErrorCode === "REQ-ACTIVATE-002") {
          return {
            success: false,
            error:
              "Diese Saison ist inzwischen abgeschlossen und wird nicht wieder zur laufenden: Die Punkte, die Gruppen und die Tabelle " +
              "daraus halten fest, was gespielt wurde. Der Abschluss lässt sich in der Verwaltung nicht zurücknehmen. Lade die Seite neu.",
          };
        }
      }
      throw error;
    }

    if (!activateOperation.acknowledged) {
      return { success: false, error: "Bei der Umstellung der Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateRollover();

    // Any count but 1 is worth naming: 0 is a no-op, and more than one means the database had drifted
    // into a state nothing can express and this call repaired it.
    const demoted = activateOperation.deactivated;
    const message =
      demoted === 0
        ? `Saison ${validated.data.id} war bereits aktiv.`
        : demoted === 1
          ? `Saison ${validated.data.id} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`
          : `Saison ${validated.data.id} ist jetzt aktiv. ${String(demoted)} vorher aktive Saisons wurden abgeschlossen.`;

    return { success: true, saison: activateOperation, message };
  });
}

/**
 * Two clubs exchange groups. **`spiele` is invalidated as well as `teams`**: the same transaction
 * rewrites every drawn Gruppenphase fixture fielding either club, so a cached schedule would name the
 * club that used to play there.
 */
export async function swapGruppenAction(rawPayload: FLSwapGruppenPayload): Promise<{
  success: boolean;
  swap?: FLSwapGruppenResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("swapGruppenAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSwapGruppenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The first five mean the picture moved under a stale page, so each says to reload.
    // `REQ-SWAP-006` has no client counterpart and arrives on a current page, so it names a repair.
    let swapOperation;
    try {
      swapOperation = await swapGruppen(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        if (error.serverErrorCode === "REQ-SWAP-001") {
          return {
            success: false,
            error: "Die beiden Mannschaften stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-003") {
          return {
            success: false,
            error: "Diese Saison ist inzwischen abgeschlossen. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-002") {
          return {
            success: false,
            error: "In der KO-Runde dieser Saison wurde inzwischen gespielt oder abgesagt. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-004") {
          return {
            success: false,
            error: "Mindestens eine der beiden Mannschaften hat in ihrer Gruppe inzwischen gespielt. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-005") {
          return {
            success: false,
            error:
              "Durch den Tausch stünde eine Mannschaft zweimal an einem Spieltag. Verschiebe eines der beiden Spiele und lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-006") {
          // Lifting the record is an open path, so the sentence names all three steps.
          return {
            success: false,
            error:
              "Durch den Tausch käme eine ausgeschiedene Mannschaft auf Spiele, die nach ihrem Austritt stattfinden können. Hebe den Austritt auf, tausche die Gruppen und trage ihn danach erneut ein.",
          };
        }
      }
      throw error;
    }

    if (!swapOperation.acknowledged) {
      return { success: false, error: "Beim Tausch der Gruppen ist ein unerwarteter Fehler aufgetreten" };
    }

    // Both layers: the base tag serves reads that named no season, the granular one those that named
    // this season.
    updateTag("teams");
    updateTag(`teams:saison_id:${validated.data.saison_id}`);

    updateTag("spiele");
    updateTag(`spiele:saison_id:${validated.data.saison_id}`);

    const umgeschrieben =
      swapOperation.rewritten_spiele === 0
        ? "Angesetzte Spiele gab es für die beiden noch keine."
        : swapOperation.rewritten_spiele === 1
          ? "Ein angesetztes Spiel wurde mitgetauscht."
          : `${String(swapOperation.rewritten_spiele)} angesetzte Spiele wurden mitgetauscht.`;

    return {
      success: true,
      swap: swapOperation,
      message: `Die beiden Mannschaften stehen jetzt in Gruppe ${swapOperation.team1_gruppe} und Gruppe ${swapOperation.team2_gruppe}. ${umgeschrieben}`,
    };
  });
}
