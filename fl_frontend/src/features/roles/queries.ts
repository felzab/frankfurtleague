import "server-only";

import { cache } from "react";

import { dayOf, formatPeriod } from "@/core/format";
import { schiedsrichterGetSelfSaisons, spielerGetSelfSaisons } from "@/core/generated/client/sdk";
import { rolesOf } from "@/core/roles";
import { getSubjectSession } from "@/core/subject";
import { isRoleGone } from "@/features/roles/resolvers";
import { getSaisonFrame } from "@/features/saisons/queries";
import { runPersonRead } from "@/shared/utils/personRead";

import type { Role } from "@/core/roles";
import type { Saisons } from "@/kit/FrameNav";

/** The two Funktionen a person holds across every season, each with a place of its own under `/area`. */
export type PersonKind = Extract<Role["kind"], "spieler" | "schiedsrichter">;

/** Each place's own read of its seasons, the newest first: a pupil's squad rows' and a referee's fixtures'. */
const OWN_SAISONS = { spieler: spielerGetSelfSaisons, schiedsrichter: schiedsrichterGetSelfSaisons } as const;

/**
 * The seasons a pupil's or a referee's own pages stand in, as their frame's season button offers them, and `standard`,
 * the one their Übersicht opens on where the address names none: the season the site is on where the person's
 * records stand in it, else their newest. `null` where they stand in none, as a referee booked to no fixture yet: the
 * frame then draws no season button, and its Übersicht leads to the place's address without a season.
 *
 * The frame's own read, which a page of the place shares: its address without a season sends the reader on to
 * `standard`, and a season's page holds the season of its address to the list. A session turned away and a person
 * holding no such Funktion are answered `null` without a read. One whose Funktion the backend finds gone after that
 * check is refused `role_not_held` here, for the page to send on (`readAsRoleHolder`); the frame reads through
 * `getOwnSaisons`, which answers that refusal `null`, since a refusal would fail the frame around the page's redirect.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments rather than the caller.
export const readOwnSaisons = cache(async (kind: PersonKind): Promise<Saisons | null> => {
  const subject = await getSubjectSession();
  if (subject === null || !rolesOf(subject).roles.some((role) => role.kind === kind)) return null;

  const { saisons: own } = await runPersonRead(() => OWN_SAISONS[kind]());
  const [newest] = own;
  if (newest === undefined) return null;
  // The public frame's read, cached for every visitor, names the season the site is on.
  const { active_saison_id: running } = await getSaisonFrame();
  return {
    entries: own.map((saison) => ({ id: saison.id, span: formatPeriod(dayOf(saison.start_date), dayOf(saison.end_date)) })),
    standard: own.find((saison) => saison.id === running)?.id ?? newest.id,
  };
});

/** The frame's read of `readOwnSaisons`: a Funktion the backend finds gone draws no season button. */
export const getOwnSaisons = cache(async (kind: PersonKind): Promise<Saisons | null> =>
  readOwnSaisons(kind).catch((error: unknown) => {
    if (isRoleGone(error)) return null;
    throw error;
  }),
);
