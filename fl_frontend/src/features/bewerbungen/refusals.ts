import { mapAlreadyEnteredRefusal } from "@/features/teams/refusals";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungHerkunft } from "./constants";

/** Where a club is created and reactivated, named as the sidemenu entry reads. */
const TEAMS_PAGE = "Teams";

/**
 * A triage refusal as the message it should render, or `null` when the code is none of these.
 *
 * The `REQ-ENTER` codes are the season's own entry rules, which
 * `fl_backend/app/api/bewerbungen/admin_router.py` reuses rather than restates.
 */
export function mapTriageRefusal(error: unknown, herkunft: BewerbungHerkunft | null): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // One code for both endpoints: what is refused is deciding an application twice, and which press
    // arrived second is nothing an administrator can act on differently.
    case "REQ-BEWERBUNG-001":
      return {
        error: buildRefusal({
          reason: "Über diese Bewerbung ist schon entschieden worden, und eine Entscheidung wird einmal getroffen",
          repair: "Lade die Seite neu",
        }),
      };
    case "REQ-BEWERBUNG-002":
      return {
        error: buildRefusal({
          reason:
            "Diese Bewerbung nennt weder genau einen bestehenden Verein noch genau eine neue Schule, und damit steht nicht fest, wer aufgenommen würde",
          repair: { before: "Lehne sie ab und lege das Team", after: "selbst an" },
          where: TEAMS_PAGE,
        }),
      };
    // The application's own validator asserts no more than `docs/backend/spec.md :: I16`, while `teams`
    // reads a club through a stricter model, so a school's details can make no club. Nothing edits them.
    case "REQ-BEWERBUNG-003":
      return {
        error: buildRefusal({
          // The fields are named as `BewerbungAngabenPanel` labels them, so the administrator reading this finds
          // each one. Schulform is absent because the validator's enum keeps it out of this rule.
          reason:
            "Die Angaben dieser Schule ergeben kein gültiges Team: Team, vollständiger Name, Kürzel, Adresse oder Website passen nicht in die Form, die ein Team haben muss",
          repair: { before: "Lehne die Bewerbung ab und lege das Team", after: "mit korrigierten Angaben selbst an" },
          where: TEAMS_PAGE,
        }),
      };
    // Reachable from a page that was open while a seat's state moved: the view closes the acceptance
    // while a seat is outstanding, so the reload is what puts the current state in front of the
    // administrator, seat by seat.
    case "REQ-BEWERBUNG-013":
      return {
        error: buildRefusal({
          reason: "Nicht jede Kontaktperson dieser Bewerbung hat ihren Eintrag bestätigt",
          repair: "Lade die Seite neu",
        }),
      };
    // `REQ-ENTER-001` to `-003` open with the sentence
    // `fl_frontend/src/features/teams/refusals.ts :: mapEntryRefusal` renders too, so only the repair
    // below is this one's own; `fl_frontend/src/features/bewerbungen/actions.test.ts` holds the pairs equal.
    case "REQ-ENTER-001":
      return {
        error: buildRefusal({
          reason: "Diese Saison ist nicht mehr in Planung, und aufgenommen wird nur in eine geplante Saison",
          repair: "Lehne die Bewerbung ab",
        }),
      };
    // On the picker: the field at fault is the one the admin can move, and a message under the
    // control that is itself the way out carries no repair sentence (`docs/frontend/spec.md` §1.12).
    case "REQ-ENTER-002":
      return { fieldErrors: { gruppe: "Diese Gruppe gibt es in dieser Saison nicht." } };
    case "REQ-ENTER-003":
      return { fieldErrors: { gruppe: "Diese Gruppe ist schon voll." } };
    // Two unique indexes answer an acceptance: a new school's club meets `uniq_shorthand` under a
    // Kürzel nothing edits, a picked club already in the season the junction's. The decline enters
    // nothing and passes `null`, leaving the code to the shared reader.
    case "DB-COMMON-002": {
      if (herkunft === "neue_schule") {
        return {
          error: buildRefusal({
            reason: "Das Kürzel dieser Schule hat schon ein anderes Team, vielleicht ein stillgelegtes",
            repair: { before: "Ändere das Kürzel des anderen Teams", after: "und nimm die Bewerbung danach an" },
            where: TEAMS_PAGE,
          }),
        };
      }
      const schonInDerSaison = herkunft === "bestehendes_team" ? mapAlreadyEnteredRefusal(error) : null;

      return schonInDerSaison === null ? null : { error: schonInDerSaison };
    }
    // „Stillgelegt“ is what every admin surface calls `inactive_since`, the club editor included.
    // „Verlassen“ is an `austritt`, another record on another page.
    case "REQ-ENTER-005":
      return {
        error: buildRefusal({
          reason: "Das Team dieser Bewerbung ist stillgelegt und kann in keine Saison aufgenommen werden",
          repair: { before: "Reaktiviere es", after: "und nimm die Bewerbung danach an" },
          where: TEAMS_PAGE,
        }),
      };
    default:
      return null;
  }
}

/** A re-send refusal as the message it should render, or `null` when the code is none of these. */
export function mapEinwilligungErneutRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The code the two decisions answer, given the re-send's own words: a link minted against a
    // decided application would ask somebody to confirm a seat nothing is waiting for.
    case "REQ-BEWERBUNG-001":
      return buildRefusal({
        reason: "Über diese Bewerbung ist schon entschieden worden, und ein neuer Link wäre nicht mehr zu beantworten",
        repair: "Lade die Seite neu",
      });
    // Answered, declined, or a seat an application from before the workflow holds: one sentence for
    // all three, because the control is offered from a page whose state has since moved.
    case "REQ-BEWERBUNG-011":
      return buildRefusal({
        reason: "Für diese Rolle steht keine Bestätigung mehr aus",
        repair: "Lade die Seite neu",
      });
    default:
      return null;
  }
}

/** Both administrative repairs answer `REQ-BEWERBUNG-001` with this: a decided application's contact block is what the decision was taken against. */
const ANGABEN_STEHEN_FEST = buildRefusal({
  reason: "Über diese Bewerbung ist schon entschieden worden, und ihre Angaben stehen damit fest",
  repair: "Lade die Seite neu",
});

/** `REQ-BEWERBUNG-014` from either repair, worded as the submission words the same collision. */
const ADRESSE_SCHON_VERGEBEN = "Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen.";

/** A correction refusal as the message it should render, or `null` when the code is none of these. */
export function mapKontaktEmailRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-BEWERBUNG-001":
      return { error: ANGABEN_STEHEN_FEST };
    // The pencil stands on a seat the page drew as outstanding, so the person answered under it: the
    // correction is refused because their own answer named this address, not because a rule shut a box.
    case "REQ-BEWERBUNG-011":
      return {
        error: buildRefusal({
          reason: "Für diese Rolle hat die Person inzwischen selbst geantwortet, und danach wird ihre Adresse nicht mehr geändert",
          repair: "Lade die Seite neu",
        }),
      };
    // Under the field rather than over the panel: the box holding the refused address is the one
    // thing to change, and the submission words the same collision the same way.
    case "REQ-BEWERBUNG-014":
      return { fieldErrors: { email: ADRESSE_SCHON_VERGEBEN } };
    default:
      return null;
  }
}

/** A reseat refusal as the message it should render, or `null` when the code is none of these. */
export function mapKontaktSitzRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-BEWERBUNG-001":
      return { error: ANGABEN_STEHEN_FEST };
    // The control stands on a seat the page drew as a Widerspruch, so the seat has moved under it —
    // never that a rule shut a door: the one open seat is the one its own holder stepped out of.
    case "REQ-BEWERBUNG-011":
      return {
        error: buildRefusal({
          reason: "Neu besetzt wird nur eine Rolle, deren Person selbst widersprochen hat, und für diese Rolle gilt das nicht mehr",
          repair: "Lade die Seite neu",
        }),
      };
    case "REQ-BEWERBUNG-014":
      return { fieldErrors: { email: ADRESSE_SCHON_VERGEBEN } };
    default:
      return null;
  }
}
