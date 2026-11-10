import { ListPage } from "@/kit/ListPage";

import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getOpenRegistrierungen } from "@/features/registrierungen/queries";
import { readAsSeatHolder, requireTeamSeats, teamSeatsAt } from "@/features/roles/resolvers";
import { kaderName } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { runPersonRead } from "@/shared/utils/personRead";

import { RegistrierungActs } from "./RegistrierungActs";

import type { FLOpenRegistrierung } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata, Route } from "next";
import type { Admission, Decided } from "./RegistrierungActs";

type Props = PageProps<"/area/team/[team]/[saison]/registrierungen">;

const WORDS = COPY.area.team.registrierung;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamRegistrierungen.path(team, saison);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(teamSeatsAt(params, address), async () => pageMetadata(parent, ROUTES.teamRegistrierungen, address(await params)));
}

/**
 * What „Aufnehmen“ does on the row. Locked while the pupil has not confirmed, the reason the pupil can still change,
 * before a full squad, which the team changes; asked where the address is a stored person's under other details; else at
 * once, into that stored person or a new one.
 */
function admissionOf(row: FLOpenRegistrierung): Admission {
  if (!row.admissible) return { kind: "locked", reason: WORDS.awaitsConfirmation };
  if (row.kader_full) return { kind: "locked", reason: WORDS.kaderFull };
  if (row.person?.deviates_from === true) return { kind: "asks", spieler_id: row.person.spieler_id, name: kaderName(row.person) };
  return { kind: "once", spieler_id: row.person?.spieler_id ?? null };
}

/** One pending registration: its name, whether the pupil confirmed, its notes in one muted line, and its two acts. */
function rowOf(row: FLOpenRegistrierung, at: Omit<Decided, "registrierung_id">): TableRow {
  const name = `${row.first_name} ${row.last_name}`;
  const notes = [...(row.person === null ? [] : [WORDS.returning]), ...(row.nummer_double ? [COPY.admin.spieler.nummerDouble] : [])];
  return {
    id: row.registrierung_id,
    name: { record: name },
    chip: row.admissible ? { tone: "success", label: COPY.admin.confirmed } : { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
    ...(notes.length === 0 ? {} : { line: WORDS.notes(notes) }),
    cells: {
      nummer: row.nummer === null ? COPY.shared.noValue : { record: row.nummer },
      position: row.position === null ? COPY.shared.noValue : { record: row.position },
      stufe: row.stufe === null ? COPY.shared.noValue : COPY.admin.saison.stufe[row.stufe],
      received: { record: formatDate(dayOf(row.submitted_at)) },
    },
    acts: (
      <RegistrierungActs
        decided={{ ...at, registrierung_id: row.registrierung_id }}
        admission={admissionOf(row)}
        name={name}
        // The decline mails the pupil only where they confirmed their address.
        mailed={row.admissible}
      />
    ),
  };
}

/** The table's head, drawn while the rows are read and over them once they are; a phone's row is its name, chip and acts. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  columns: [
    { key: "nummer", label: SERVER_COPY.season.column.nummer, figures: true, hideOnPhone: true, width: "count" },
    { key: "position", label: COPY.admin.spieler.position, hideOnPhone: true },
    { key: "stufe", label: COPY.admin.spieler.stufe, hideOnPhone: true },
    { key: "received", label: COPY.admin.bewerbung.received, hideOnPhone: true, width: "date" },
  ],
  acts: [COPY.shared.verb.admit, COPY.shared.verb.decline],
};

/** The page's one read, handed to its template running, as an administration page hands its own. */
async function readRegistrierungen(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { team_id, saison_id, registrierungen } = await readAsSeatHolder(() =>
    runPersonRead(() => getOpenRegistrierungen(seat.team_id, seat.saison_id)),
  );
  return registrierungen.map((row) => rowOf(row, { team_id, saison_id }));
}

/**
 * The team's Registrierungen: every pending registration of the season, newest first, each admitted or declined on its
 * row, and searched by name as the Kader is.
 */
export default function RegistrierungenPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamRegistrierungen" } }}
      list={{
        kind: "table",
        search: { label: COPY.admin.registrierung.search },
        head: HEAD,
        wait: 3,
        content: readRegistrierungen(params).then((rows) => ({
          table: {
            label: ROUTES.teamRegistrierungen.title,
            rows,
            empty: {
              kind: "none",
              plural: ROUTES.teamRegistrierungen.title,
              glyph: "registrierungen",
              // Only the league mints and mails a team's registration link, so an empty list names whom to ask.
              line: { ...WORDS.linkFromLeague, link: { href: KONTAKT_MAILTO as Route, label: { record: KONTAKT_EMAIL } } },
            } as const,
          },
        })),
      }}
    />
  );
}
