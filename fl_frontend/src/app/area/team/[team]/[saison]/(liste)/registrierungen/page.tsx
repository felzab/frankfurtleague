import { cache } from "react";

import { ListPage } from "@/kit/ListPage";

import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getOpenRegistrierungen } from "@/features/registrierungen/queries";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { kaderName } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import { RegistrierungTable } from "./RegistrierungTable";

import type { FLOpenRegistrierung } from "@/core/generated/client/types";
import type { TeamSeat } from "@/features/roles/resolvers";
import type { TableHead } from "@/kit/Table";
import type { Metadata, ResolvingMetadata, Route } from "next";
import type { Admission, Decided } from "./RegistrierungDialog";
import type { RegistrierungRow } from "./RegistrierungTable";

type Props = PageProps<"/area/team/[team]/[saison]/registrierungen">;

const WORDS = COPY.area.team.registrierung;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamRegistrierungen.path(team, saison);

/** The page's one read, memoised for the render on its two ids, which `cache` compares by identity, so the tab's title and the page share it. */
const registrierungenRead = cache(getOpenRegistrierungen);
const registrierungenOf = (seat: TeamSeat) => registrierungenRead(seat.team_id, seat.saison_id);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return teamMetadata(params, address, registrierungenOf, async () => pageMetadata(parent, ROUTES.teamRegistrierungen, address(await params)));
}

/**
 * What „Aufnehmen“ does in the row's dialog. Locked while the pupil has not confirmed, the reason the pupil can still
 * change, before a full squad, which the team changes; asked where the address is a stored person's under other details;
 * else at once, into that stored person or a new one.
 */
function admissionOf(row: FLOpenRegistrierung): Admission {
  if (!row.admissible) return { kind: "locked", reason: WORDS.awaitsConfirmation };
  if (row.kader_full) return { kind: "locked", reason: WORDS.kaderFull };
  if (row.person?.deviates_from === true) return { kind: "asks", spieler_id: row.person.spieler_id, name: kaderName(row.person) };
  return { kind: "once", spieler_id: row.person?.spieler_id ?? null };
}

/**
 * One pending registration: its row, the name, whether the pupil confirmed and the received day, a row opening its
 * dialog; the dialog, its notes as the line under the pupil's name, every fact the registration holds, and its two acts.
 */
function rowOf(row: FLOpenRegistrierung, at: Omit<Decided, "registrierung_id">): RegistrierungRow {
  const name = `${row.first_name} ${row.last_name}`;
  const notes = [...(row.person === null ? [] : [WORDS.returning]), ...(row.nummer_double ? [COPY.admin.spieler.nummerDouble] : [])];
  const line = notes.length === 0 ? undefined : SERVER_COPY.area.line(notes);
  const received = { record: formatDate(dayOf(row.submitted_at)) };
  return {
    id: row.registrierung_id,
    name: { record: name },
    chip: row.admissible ? { tone: "success", label: COPY.admin.confirmed } : { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
    ...(line === undefined ? {} : { line }),
    cells: { received },
    entry: {
      decided: { ...at, registrierung_id: row.registrierung_id },
      name,
      ...(line === undefined ? {} : { notes: line }),
      facts: [
        { label: SERVER_COPY.season.column.nummer, value: row.nummer === null ? COPY.shared.noValue : { record: row.nummer }, figures: true },
        { label: COPY.admin.spieler.position, value: row.position === null ? COPY.shared.noValue : { record: row.position } },
        { label: COPY.admin.spieler.stufe, value: row.stufe === null ? COPY.shared.noValue : COPY.admin.saison.stufe[row.stufe] },
        { label: COPY.admin.bewerbung.received, value: received, figures: true },
      ],
      admission: admissionOf(row),
    },
  };
}

/**
 * The table's head, drawn while the rows are read and over them once they are: the name and the day it came in, as the
 * administration's Registrierungen list stands in two columns, every other fact and both acts in the row's dialog, so a
 * desktop name is never pressed thin by them.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [{ key: "received", label: COPY.admin.bewerbung.received, hideOnPhone: true, width: "date" }],
};

/** The empty list's state: only the league mints and mails a team's registration link, so it names whom to ask. */
const EMPTY = {
  kind: "none",
  plural: ROUTES.teamRegistrierungen.title,
  glyph: "registrierungen",
  line: { ...WORDS.linkFromLeague, link: { href: KONTAKT_MAILTO as Route, label: { record: KONTAKT_EMAIL } } },
} as const;

/**
 * The page's one read, after the seat it is drawn for, handed to its template running, as the Kader hands its own: the
 * table, and the line the administration's list stands over a list its read's cap cut short.
 */
async function readRegistrierungen(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { team_id, saison_id, registrierungen, complete } = await readAsSeatHolder(() => registrierungenOf(seat));
  return {
    cut: complete ? null : COPY.admin.registrierung.cut,
    drawn: (
      <RegistrierungTable
        head={HEAD}
        rows={registrierungen.map((row) => rowOf(row, { team_id, saison_id }))}
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
  const read = readRegistrierungen(params);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamRegistrierungen" } }}
      notice={read.then(({ cut }) => cut)}
      list={{
        kind: "table",
        search: { label: COPY.admin.registrierung.search },
        head: HEAD,
        wait: 3,
        content: read.then(({ drawn }) => ({ drawn })),
      }}
    />
  );
}
