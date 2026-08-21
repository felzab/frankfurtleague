"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { activateSaison, generateSpielplan, patchSaison, postSaison, swapGruppen } from "./mutations";
import {
  FLActivateSaisonPayloadSchema,
  FLGenerateSpielplanPayloadSchema,
  FLPatchSaisonPayloadSchema,
  FLPostSaisonPayloadSchema,
  FLSwapGruppenPayloadSchema,
  MAX_QUALIFIERS,
} from "./schemas";
import { describeSpielplanUmfang } from "./utils";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
} from "./schemas";

const SAISON_ID_TAKEN = "Diese Saison-ID ist schon vergeben. Wähle eine andere oder bearbeite die vorhandene Saison.";

/**
 * The four stored-rules faults a DRAW raises as well as an edit, each worded once: the rules editor
 * seats the sentence under its field, and the generator, having no field, seats it in a message that
 * names where the repair is made.
 */
const BRACKET_HAS_NO_SHAPE = `Gruppen mal Qualifikanten muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`;
const GROUP_OVER_QUALIFIES = "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.";
const DRAW_BEATS_WIN = "Ein Unentschieden darf nicht mehr Punkte bringen als ein Sieg.";
const FORFEIT_CANNOT_DECIDE =
  "Diese Saison spielt eine KO-Runde, in der ein Unentschieden niemanden weiterbringt. Sieger und Verlierer brauchen unterschiedliche Tore.";

/** A stored-rules fault as the generator must report it: the rule, then where it is repaired. */
const rulesFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt Regeln und speichere sie.`;

/** A rules 409 as the message it should render, or `null` when the code is none of these. */
function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-RULES-001":
      return { fieldErrors: { "rules.qualifiers_per_group": BRACKET_HAS_NO_SHAPE } };
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
      return { fieldErrors: { "rules.qualifiers_per_group": GROUP_OVER_QUALIFIES } };
    // Only a step that introduces or worsens it is refused, and an equal count is allowed — so the
    // message says "mehr" rather than promising a rule the server does not apply.
    case "REQ-RULES-008":
      return { fieldErrors: { "rules.draw_points": DRAW_BEATS_WIN } };
    case "REQ-RULES-009":
      return { fieldErrors: { "rules.max_kadergroesse": "Mindestens ein Kader hat schon mehr Spieler als dieses Maximum." } };
    // On the winner's box, which is the one to raise, and only there: `<FieldError>` renders under
    // the input whose `name` the key matches, and the pair's own row picks it up through
    // `saisonDraftStatus`'s `errorPaths`.
    case "REQ-RULES-010":
      return { fieldErrors: { "rules.forfeit_ergebnis.sieger_tore": FORFEIT_CANNOT_DECIDE } };
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
          "Für diese Saison sind schon Spiele angesetzt, und sie sind aus diesen Zahlen entstanden. Gruppen, Teams pro Gruppe und " +
          "Qualifikanten stehen damit fest; einen neuen Spielplan legt die Verwaltung nicht an. Nichtantreten, Kadergröße, Stufen und der " +
          "Zeitraum bleiben änderbar.",
      };
    case "REQ-RULES-006":
      return {
        error: "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder.",
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

/**
 * `teams` too, for a reason no fixture count shows: a drawn season has fixtures still to play, which
 * `fl_backend/app/api/teams/services.py :: _may_hold_a_platz` reads when it breaks a tie, so the
 * group order moves without a single result being entered.
 */
function invalidateSpielplan(saisonId: string): void {
  updateTag("saisons");
  // Base tag alone, `getSpieltage` declaring no granular one.
  updateTag("spieltage");

  updateTag("spiele");
  updateTag(`spiele:saison_id:${saisonId}`);

  updateTag("teams");
  updateTag(`teams:saison_id:${saisonId}`);
}

/**
 * A generator 409 as the message it should render, or `null` for any other code. A state the panel
 * already closes the control for means the page went stale, so it says to reload; every other code
 * names a repair and where it is made.
 */
function mapSpielplanRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    // One-way, exactly as the activation is: nothing in the product draws a season twice.
    case "REQ-SPIELPLAN-001":
      return "Für diese Saison sind schon Spiele angelegt, und ein Spielplan entsteht genau einmal. Lade die Seite neu.";
    case "REQ-SPIELPLAN-002":
      return "Für diese Saison gibt es schon Spieltage. Ein Spielplan entsteht nur für eine Saison ganz ohne Spieltage. Lade die Seite neu.";
    // A LAUFENDE Saison still draws: activation is one-way, so refusing one would strand a season
    // activated before its draw. `REQ-ACTIVATE-003` is the half that keeps that state rare.
    case "REQ-SPIELPLAN-003":
      return "Diese Saison ist inzwischen abgeschlossen. Für eine abgeschlossene Saison entsteht kein Spielplan mehr. Lade die Seite neu.";
    // The endpoint names every off group in developer English. This says the class of repair
    // instead, and where it is made: group membership stands on the team pages. Short, over and
    // stranded share one repair.
    case "REQ-SPIELPLAN-004":
      return (
        "Für einen Spielplan muss jede Gruppe dieser Saison genau so viele Teams halten, wie die Regeln vorsehen, und kein Team darf in " +
        "einer Gruppe stehen, die diese Saison nicht anbietet. Passe die Gruppen über die Teamseite an."
      );
    // A draw judges the STORED rules, so every fault below reaches it on the same footing as an edit.
    // Reachable only by a hand edit, the create refusing each outright
    // (`fl_backend/app/api/saisons/admin_router.py :: generate_spielplan`).
    case "REQ-RULES-001":
      return rulesFaultMessage(`Aus den Regeln dieser Saison entsteht keine KO-Runde. ${BRACKET_HAS_NO_SHAPE}`);
    case "REQ-RULES-007":
      return rulesFaultMessage(GROUP_OVER_QUALIFIES);
    case "REQ-RULES-008":
      return rulesFaultMessage(DRAW_BEATS_WIN);
    case "REQ-RULES-010":
      return rulesFaultMessage(FORFEIT_CANNOT_DECIDE);
    default:
      return null;
  }
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
 * The only path to `status: "active"`, under three refusals: `REQ-ACTIVATE-001` while the outgoing
 * season still owes results, `REQ-ACTIVATE-002` on a `past` target nothing reopens, and
 * `REQ-ACTIVATE-003` on one with nothing drawn to play.
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

    // The panel closes the control for all three, so any of them arriving here means the page is
    // stale. Two name a remedy; `REQ-ACTIVATE-002` has none, and says so rather than implying one.
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
              "Diese Saison ist inzwischen abgeschlossen und wird nicht wieder zur laufenden Saison: Die Punkte, die Gruppen und die Tabelle " +
              "daraus halten fest, was gespielt wurde. Der Abschluss lässt sich in der Verwaltung nicht zurücknehmen. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-ACTIVATE-003") {
          return {
            success: false,
            error:
              "Diese Saison hat noch keinen Spielplan, und ohne Spiele wird sie nicht zur laufenden Saison. Lege den Spielplan an und stelle danach um.",
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
        ? `Saison ${validated.data.id} war schon aktiv.`
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
            error: "Die beiden Teams stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.",
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
            error: "Mindestens eines der beiden Teams hat in seiner Gruppe inzwischen gespielt. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-005") {
          return {
            success: false,
            error: "Durch den Tausch stünde ein Team zweimal an einem Spieltag. Verschiebe eines der beiden Spiele und lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-006") {
          // Lifting the record is an open path, so the sentence names all three steps.
          return {
            success: false,
            error:
              "Durch den Tausch käme ein ausgeschiedenes Team auf Spiele, die nach seinem Austritt stattfinden können. Hebe den Austritt auf, tausche die Gruppen und trage ihn danach erneut ein.",
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
      message: `Die beiden Teams stehen jetzt in Gruppe ${swapOperation.team1_gruppe} und Gruppe ${swapOperation.team2_gruppe}. ${umgeschrieben}`,
    };
  });
}

/**
 * The one path to a season's fixtures, on `POST /saisons/{saison_id}/spielplan`. **One-way like the
 * activation**: `REQ-SPIELPLAN-001` refuses a second draw, so there is no undo to offer beside it.
 */
export async function generateSpielplanAction(rawPayload: FLGenerateSpielplanPayload): Promise<{
  success: boolean;
  spielplan?: FLGenerateSpielplanResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("generateSpielplanAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLGenerateSpielplanPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let generateOperation;
    try {
      generateOperation = await generateSpielplan(validated.data);
    } catch (error) {
      const refusal = mapSpielplanRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!generateOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des Spielplans ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpielplan(validated.data.id);

    // `stehen` and not `hat`, so the shared phrase can stay nominative for the panel's readout too.
    const umfang = describeSpielplanUmfang(generateOperation.spieltage, generateOperation.spiele);

    return {
      success: true,
      spielplan: generateOperation,
      message: `In Saison ${validated.data.id} stehen jetzt ${umfang}, noch ohne Zeitraum und ohne Termin. Seinen Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite, die Termine der Spiele danach.`,
    };
  });
}
