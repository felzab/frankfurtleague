import { SERVER_COPY } from "@/core/serverCopy";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import type { Code } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";

// Two messages for one unique index, which spans retired clubs. Only the create can be answered by
// reaching for the club already holding the letters; an edit has this club open and needs the field.
export const SHORTHAND_TAKEN_ON_CREATE = "Dieses Kürzel hat schon ein anderes Team, vielleicht ein stillgelegtes, das Du reaktivieren kannst.";
export const SHORTHAND_TAKEN_ON_EDIT = "Bitte wähle ein anderes Kürzel: dieses hat schon ein anderes Team, vielleicht ein stillgelegtes.";

/** `null` for any code but the unique index's, which is always `taken`: a club's only unique key is its shorthand. */
export function mapShorthandRefusal(error: unknown, taken: string): { fieldErrors: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode !== "duplicate_key") return null;

  return { fieldErrors: { shorthand: taken } };
}

/** `null` where the refusal is something else; it lands on no field, the retire control being a dialog. */
export function mapRetireRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "retire_blocked") return null;

  return "Das Team spielt in einer laufenden oder geplanten Saison und kann nicht stillgelegt werden.";
}

/**
 * `null` for any code but the unique index's, which on the junction's natural key says the club already
 * stands in the season.
 */
export function mapAlreadyEnteredRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "duplicate_key") return null;

  return "Dieses Team ist schon in dieser Saison. Lade die Seite neu.";
}

/**
 * What each entry rule refused, the sentence before any repair. Apart from the repairs because a repair
 * names a control, and the club editor and the team create have different ones.
 */
const ENTRY_REASONS = {
  // `entry_saison_not_future`, `entry_gruppe_not_offered` and `entry_gruppe_full` open with the sentence
  // `fl_frontend/src/features/bewerbungen/refusals.ts :: mapTriageRefusal` renders too.
  entry_saison_not_future: "Diese Saison ist nicht mehr in Planung, und aufgenommen wird nur in eine geplante Saison",
  entry_gruppe_not_offered: "Diese Gruppe gibt es in dieser Saison nicht",
  entry_gruppe_full: "Diese Gruppe ist schon voll",
  entry_gruppe_locked: "Für dieses Team sind in dieser Saison schon Spiele angelegt, deshalb kann es die Gruppe nicht allein wechseln",
  team_retired: "Dieses Team ist inzwischen stillgelegt und kann in keine Saison aufgenommen werden",
} as const satisfies Partial<Record<Code, string>>;

const isEntryCode = (code: string | undefined): code is keyof typeof ENTRY_REASONS => code !== undefined && Object.hasOwn(ENTRY_REASONS, code);

// My wording, 2026-10-02: a retired club takes no entry until it is reactivated, so the one repair
// names that step first.
const ANGELEGT_ABER_STILLGELEGT =
  "Das Team wurde angelegt, ist aber inzwischen stillgelegt und kann in keine Saison aufgenommen werden. Reaktiviere es auf seiner Seite und nimm es danach dort in eine Saison auf. Ein erneutes Anlegen scheitert am Kürzel.";

/**
 * The team create's answer where its club stands and the entry was refused. A rule's reason alone: the
 * club editor's repairs name controls on its own page, and this answer's one repair is the way there.
 */
export function mapCreatedClubEntryRefusal(error: unknown): string {
  const code = isRefusal(error) ? error.serverErrorCode : undefined;
  if (code === "team_retired") return ANGELEGT_ABER_STILLGELEGT;

  const reason = isEntryCode(code) ? `: ${ENTRY_REASONS[code]}.` : ".";
  return `Das Team wurde angelegt, konnte aber nicht in die Saison aufgenommen werden${reason} Nimm es auf seiner Seite in eine Saison auf. Ein erneutes Anlegen scheitert am Kürzel.`;
}

/**
 * The club editor's answer to a rule its season panel's writes refuse, the entry and the season row's edit: the
 * reason, and the repair its own page offers.
 */
export function mapEntryRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;
  // The row's edit alone: the entry refuses a season no longer planned as `entry_saison_not_future`.
  if (error.serverErrorCode === "saison_past") return { error: SERVER_COPY.refusalLine.saison_past };
  if (error.serverErrorCode === "entry_saison_not_future") {
    return { error: buildRefusal({ reason: ENTRY_REASONS["entry_saison_not_future"], repair: "Nimm das Team in eine geplante Saison auf" }) };
  }
  // Both land under the `gruppe` picker, which is itself the way out, so neither carries a repair
  // sentence.
  if (error.serverErrorCode === "entry_gruppe_not_offered") {
    return { fieldErrors: { gruppe: `${ENTRY_REASONS["entry_gruppe_not_offered"]}.` } };
  }
  if (error.serverErrorCode === "entry_gruppe_full") {
    return { fieldErrors: { gruppe: `${ENTRY_REASONS["entry_gruppe_full"]}.` } };
  }
  if (error.serverErrorCode === "entry_gruppe_locked") {
    // Names the route still open rather than stopping at the refusal: the swap control sits under
    // the locked Gruppe row on the page this message lands on.
    return {
      error: buildRefusal({
        reason: ENTRY_REASONS["entry_gruppe_locked"],
        repair: "Tausche die Gruppe stattdessen mit einem zweiten Team, unter der gesperrten Gruppe auf dieser Seite",
      }),
    };
  }
  if (error.serverErrorCode === "team_retired") {
    // Raised only by the club editor's season panel, and only while its page still believes the club
    // is active — so the words are `buildTeamBanners`'s, which the same panel shows once the page
    // catches up.
    return {
      error: buildRefusal({
        reason: ENTRY_REASONS["team_retired"],
        repair: "Reaktiviere es über den Kopf der Seite und nimm es danach hier auf",
      }),
    };
  }
  return null;
}
