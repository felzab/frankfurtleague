"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { RECORDED_FACTS_NONE } from "./constants";
import { activateSaison, generateSpielplan, patchSaison, postSaison, swapGruppen, undrawSpielplan } from "./mutations";
import {
  FLActivateSaisonPayloadSchema,
  FLGenerateSpielplanPayloadSchema,
  FLPatchSaisonPayloadSchema,
  FLPostSaisonPayloadSchema,
  FLSwapGruppenPayloadSchema,
  FLUndrawSpielplanPayloadSchema,
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
  FLUndrawSpielplanPayload,
  FLUndrawSpielplanResponse,
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

/**
 * `REQ-DATE-005`'s shared half: the dates repair every state, because
 * `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an even `teams_per_group`
 * down to the odd one and a smaller number does not always buy a day back.
 */
const SPAN_BELOW_SCHEDULE =
  "Der Zeitraum dieser Saison ist zu kurz für die Spieltage, die sich aus ihren Regeln ergeben: je ein Spieltag für jede Runde " +
  "der Gruppenphase und für jede KO-Runde. Zwei Spieltage dürfen nicht auf denselben Tag fallen. Verlege das Enddatum nach " +
  "hinten oder das Startdatum nach vorne. Das hilft in jedem Fall.";

/** A stored-rules fault as the generator must report it: the rule, then where it is repaired. */
const rulesFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt Regeln und speichere sie.`;

/**
 * The same fault where the DRAW carried the numbers itself. `REQ-RULES-011` freezes them everywhere
 * else, so sending an admin to the rules panel would name a field they cannot type in.
 */
const shapeFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt Spielplan und lege ihn noch einmal neu an.`;

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
          "Diese Saison ist abgeschlossen, deshalb sind Punkte, Tiebreak und Qualifikanten festgeschrieben. " +
          "Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar.",
      };
    // A bare message, the shape `REQ-RULES-005` uses: the two freezes refuse the same class of edit
    // in one panel, and one answering through field paths would split that into two mechanisms.
    case "REQ-RULES-011":
      return {
        error:
          "Für diese Saison sind schon Spiele angesetzt, und sie sind aus diesen Zahlen entstanden. Die Qualifikanten änderst Du, " +
          "indem Du den Spielplan mit der neuen Zahl neu anlegst. Beides entsteht in einem Schritt. Gruppen und Teams pro Gruppe " +
          "hängen dagegen an den Teams, die in dieser Saison stehen: Nimm dafür zuerst den Spielplan zurück, passe die Teams an und " +
          "lege ihn danach neu an. Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar.",
      };
    case "REQ-RULES-006":
      return {
        error: "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder.",
      };
    case "REQ-DATE-004":
      return {
        error: "Mindestens ein Spieltag liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verschiebe diese Spieltage.",
      };
    // Bare like the two freezes: several fields could repair this and none is at fault. The tail is
    // this path's own: an edit reaches every rule, so the second repair names no single panel.
    case "REQ-DATE-005":
      return {
        error: `${SPAN_BELOW_SCHEDULE} Weniger Spieltage ergeben sich nur aus anderen Regeln, und die lassen sich nicht in jeder Saison noch ändern.`,
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
function mapSpielplanRefusal(error: unknown, carriedShape: boolean): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  // Which panel holds the three numbers this draw was judged on, and therefore where the repair is.
  const shapeFault = carriedShape ? shapeFaultMessage : rulesFaultMessage;

  switch (error.serverErrorCode) {
    // Both step aside for a confirmed replace, so either arriving means the season gained rows after
    // this page rendered: the request went out as a first draw because that is what the panel saw.
    case "REQ-SPIELPLAN-001":
      return "Für diese Saison sind inzwischen Spiele angelegt, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
    case "REQ-SPIELPLAN-002":
      return "Für diese Saison gibt es inzwischen Spieltage, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
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
    // The window closed under a confirmed replace, so the page is stale. A reload, like `-001`: the
    // panel it returns to names the half that closed and, for the record half, the way out of it.
    case "REQ-SPIELPLAN-005":
      return (
        `Ein Spielplan lässt sich nur für eine geplante Saison neu anlegen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
        "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu."
      );
    // The draw judges its own three numbers and the season's stored rest, so the first two are
    // repaired wherever this request took them from and the last two only in the rules panel.
    // `stored=None` there, so no narrowing rule answers.
    case "REQ-RULES-001":
      return shapeFault(
        `${carriedShape ? "Aus diesen Zahlen" : "Aus den Regeln dieser Saison"} entsteht keine KO-Runde. ${BRACKET_HAS_NO_SHAPE}`,
      );
    case "REQ-RULES-007":
      return shapeFault(GROUP_OVER_QUALIFIES);
    case "REQ-RULES-008":
      return rulesFaultMessage(DRAW_BEATS_WIN);
    case "REQ-RULES-010":
      return rulesFaultMessage(FORFEIT_CANNOT_DECIDE);
    // NOT through `shapeFault`, whose two tails both send the admin to change a number: the repair
    // that works whatever the numbers are is the season's dates. Only where a smaller one could be
    // typed differs, which is what the ternary carries.
    case "REQ-DATE-005":
      return (
        `${SPAN_BELOW_SCHEDULE} Weniger Spieltage ergeben sich sonst nur aus kleineren Zahlen im Abschnitt ` +
        `${carriedShape ? "Spielplan" : "Regeln"}, und nicht jede kleinere Zahl spart einen Spieltag.`
      );
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

    // Every mapped refusal is read first: a duplicate `_id` arrives from the unique index with no
    // rule code to discriminate on, so "die ID ist vergeben" can only be the fallback.
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
            error: "Diese Saison ist inzwischen abgeschlossen und wird nicht wieder zur laufenden Saison. Lade die Seite neu.",
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
 * The one path to a season's fixtures, on `POST /saisons/{saison_id}/spielplan`. **`replace` deletes
 * the season's matchdays and fixtures and draws fresh ones** (`REQ-SPIELPLAN-005`), and nothing
 * writes them back (`docs/backend/spec.md :: I26`).
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
      // Read off the VALIDATED payload rather than the raw one: what the endpoint judged is what
      // survived the parse, and a fault message naming the wrong panel is worse than a bare one.
      const refusal = mapSpielplanRefusal(error, (validated.data.shape ?? null) !== null);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!generateOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des Spielplans ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpielplan(validated.data.id);

    // `stehen` and not `hat`, so the shared phrase can stay nominative for the panel's readout too.
    const umfang = describeSpielplanUmfang(generateOperation.spieltage, generateOperation.spiele);

    // Said first where a replace ran: reporting only what was written would leave the admin unsure
    // that the rows they confirmed the deletion of are actually gone.
    const geloescht =
      validated.data.replace === true ? `Die bisherigen Spieltage und Spiele von Saison ${validated.data.id} sind gelöscht. ` : "";

    return {
      success: true,
      spielplan: generateOperation,
      message: `${geloescht}In Saison ${validated.data.id} stehen jetzt ${umfang}, noch ohne Zeitraum und ohne Termin. Seinen Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite, die Termine der Spiele danach.`,
    };
  });
}

/**
 * The one path back out of a draw, on `DELETE /saisons/{saison_id}/spielplan`. **Destructive without
 * an inverse** (`docs/backend/spec.md :: I26`): nothing writes the removed rows back, and a fresh
 * draw draws its own.
 */
export async function undrawSpielplanAction(rawPayload: FLUndrawSpielplanPayload): Promise<{
  success: boolean;
  undraw?: FLUndrawSpielplanResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("undrawSpielplanAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLUndrawSpielplanPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let undrawOperation;
    try {
      undrawOperation = await undrawSpielplan(validated.data);
    } catch (error) {
      // The panel closes the control for both halves, so this arriving means the season moved under
      // a page still offering the press. A reload returns to that panel, which names any way out.
      if (error instanceof APIBadStatusError && error.statusCode === 409 && error.serverErrorCode === "REQ-SPIELPLAN-006") {
        return {
          success: false,
          error:
            `Ein Spielplan lässt sich nur für eine geplante Saison zurücknehmen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
            "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu.",
        };
      }
      throw error;
    }

    if (!undrawOperation.acknowledged) {
      return { success: false, error: "Beim Zurücknehmen des Spielplans ist ein unerwarteter Fehler aufgetreten" };
    }

    // The draw's tag set, this removing exactly what that write created.
    invalidateSpielplan(validated.data.id);

    // A season can carry the watermark with neither collection behind it, so a zero pair does not by
    // itself mean nothing was removed. Hence three messages rather than one sentence over the counts.
    const removedRows = undrawOperation.spieltage > 0 || undrawOperation.spiele > 0;

    const message = removedRows
      ? `Der Spielplan von Saison ${validated.data.id} ist zurückgenommen. Gelöscht wurden ${describeSpielplanUmfang(undrawOperation.spieltage, undrawOperation.spiele)}. Gruppen, Teams pro Gruppe und Qualifikanten lassen sich jetzt wieder im Abschnitt Regeln ändern, die Teams über die Teamseite.`
      : undrawOperation.watermark_cleared
        ? `Saison ${validated.data.id} hielt weder Spieltage noch Spiele. Die Angabe, dass ihr Spielplan steht, ist jetzt entfernt.`
        : `Saison ${validated.data.id} hatte keinen Spielplan mehr, deshalb wurde nichts gelöscht.`;

    return { success: true, undraw: undrawOperation, message };
  });
}
