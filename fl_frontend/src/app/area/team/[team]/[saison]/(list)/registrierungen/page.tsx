import { cache } from "react";

import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getOpenRegistrierungen } from "@/features/registrierungen/queries";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { kaderName } from "@/features/spieler/constants";
import { ListPage } from "@/kit/ListPage";
import { CONFIRMED_CHIP, UNCONFIRMED_CHIP } from "@/kit/stateChips";
import { pageMetadata } from "@/shared/utils/metadata";

import { RegistrierungTable } from "./RegistrierungTable";

import type { FLOpenRegistrierung } from "@/core/generated/client/types";
import type { TeamSeat } from "@/features/roles/resolvers";
import type { TableHead } from "@/kit/Table";
import type { Metadata, Route } from "next";
import type { Admission } from "./RegistrierungDialog";
import type { RegistrierungRow } from "./RegistrierungTable";

type Props = PageProps<"/area/team/[team]/[saison]/registrierungen">;

const WORDS = AREA_COPY.team.registrierung;

const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamRegistrierungen.path(team, saison);

/** Keyed on the seat's two ids rather than the seat, since `cache` compares its arguments by identity. */
const registrierungenRead = cache(getOpenRegistrierungen);
const registrierungenOf = (seat: TeamSeat) => registrierungenRead(seat.team_id, seat.saison_id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return teamMetadata(params, address, registrierungenOf, async () => pageMetadata(ROUTES.teamRegistrierungen, address(await params)));
}

/**
 * What „Aufnehmen“ does in the row's dialog. Locked while the pupil has not confirmed, the reason the pupil can still
 * change, before a full squad, which the team changes; asked where the address is a stored person's under other details;
 * else at once, into that stored person or a new one.
 */
function admissionOf(row: FLOpenRegistrierung): Admission {
  if (!row.admissible) return { kind: "locked", reason: COPY.shared.afterConfirmation };
  if (row.kader_full) return { kind: "locked", reason: WORDS.kaderFull };
  if (row.person?.deviates_from === true) return { kind: "asks", spieler_id: row.person.spieler_id, name: kaderName(row.person) };
  return { kind: "once", spieler_id: row.person?.spieler_id ?? null };
}

/**
 * One pending registration: its row, the name, whether the pupil confirmed and the received day, a row opening its
 * dialog; the dialog, its notes as the line under the pupil's name, every fact the registration holds, and its two acts.
 */
function rowOf(row: FLOpenRegistrierung): RegistrierungRow {
  const name = kaderName(row);
  const notes = [...(row.person === null ? [] : [WORDS.returning]), ...(row.nummer_double ? [COPY.kader.nummerDouble] : [])];
  const line = notes.length === 0 ? undefined : COPY.shared.line(notes);
  const received = { record: formatDate(dayOf(row.submitted_at)) };
  return {
    id: row.registrierung_id,
    name: { record: name },
    chip: row.admissible ? CONFIRMED_CHIP : UNCONFIRMED_CHIP,
    ...(line === undefined ? {} : { line }),
    cells: { received },
    entry: {
      decided: { registrierung_id: row.registrierung_id },
      name,
      ...(line === undefined ? {} : { notes: line }),
      facts: [
        { label: COPY.kader.nummer, value: row.nummer === null ? COPY.shared.noValue : { record: row.nummer }, figures: true },
        { label: COPY.kader.position, value: row.position === null ? COPY.shared.noValue : { record: row.position } },
        { label: COPY.kader.stufe, value: row.stufe === null ? COPY.shared.noValue : { record: row.stufe } },
        { label: COPY.shared.facts.received, value: received, figures: true },
      ],
      admission: admissionOf(row),
    },
  };
}

/**
 * The table's head: the name and the day it came in, as the administration's Registrierungen list stands in two
 * columns, every other fact and both acts in the row's dialog, so a desktop name is never pressed thin by them.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.shared.facts.state },
  columns: [{ key: "received", label: COPY.shared.facts.received, hideOnPhone: true, width: "date" }],
};

/** The empty list's state: only the league mints and mails a team's registration link, so it names whom to ask. */
const EMPTY = {
  kind: "none",
  plural: ROUTES.teamRegistrierungen.title,
  glyph: "registrierungen",
  line: WORDS.linkFromLeague({ href: KONTAKT_MAILTO as Route, label: { record: KONTAKT_EMAIL } }),
} as const;

/** The page's one read, after the seat it is drawn for, handed to its template running. */
async function readRegistrierungen(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { registrierungen } = await readAsSeatHolder(() => registrierungenOf(seat));
  return {
    drawn: (
      <RegistrierungTable
        head={HEAD}
        rows={registrierungen.map(rowOf)}
        empty={EMPTY}
      />
    ),
  };
}

/**
 * The team's Registrierungen: every pending registration of the season, newest first, searched by name as the Kader is,
 * each row opening its dialog, where it is admitted or declined.
 */
export default function RegistrierungenPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamRegistrierungen" } }}
      list={{
        kind: "table",
        search: { label: AREA_COPY.team.registrierung.search },
        head: HEAD,
        content: readRegistrierungen(params),
      }}
    />
  );
}
