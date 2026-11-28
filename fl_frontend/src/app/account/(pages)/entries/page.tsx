import { MEDIA_MIN_AGE } from "@/core/bounds";
import { SCHIEDSRICHTER_TEXT_VERSIONS, SEAT_TEXT_VERSIONS, SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate, formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { getAccountEinwilligungen } from "@/features/account/queries";
import { kaderName } from "@/features/spieler/constants";
import { AccountPage } from "@/kit/AccountPage";
import { EmptyBox } from "@/kit/EmptyState";
import { pageMetadata } from "@/shared/utils/metadata";

import { EntriesBoxes } from "./EntriesBoxes";

import type { Copy } from "@/core/copy";
import type { FLAccountEinwilligungenResponse, FLAccountSeatPerson, FLEinwilligungState, FLKontaktSeat } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { Entry } from "./EntriesBoxes";

export const metadata = pageMetadata(ROUTES.accountEntries);

const { entries: WORDS } = ACCOUNT_COPY;

/** A fact of the record, a dash where it holds none. */
const fact = (label: Copy, value: string | null): Fact => ({
  label,
  value: value === null || value === "" ? COPY.shared.noValue : { record: value },
});

/** A birthdate as a list writes a day. */
const birthday = (date: string | null, label: Copy = COPY.shared.facts.birthday): Fact =>
  fact(label, date === null ? null : formatDate(dayOf(date)));

/**
 * A seat entry's facts in the referee box's order: name, birthday, the team where the seat has one, the seats held,
 * telephone. Seats storing the person alike list them once; a second spelling on another seat follows with its own
 * name, birthday and telephone.
 */
function seatFacts(persons: readonly FLAccountSeatPerson[], team: Fact | null, held: readonly FLKontaktSeat[]): Fact[] {
  const spellings = new Map<string, { person: FLAccountSeatPerson; seats: FLKontaktSeat[] }>();
  for (const person of persons) {
    const key = JSON.stringify([person.first_name, person.last_name, person.birth_date, person.phone]);
    const spelling = spellings.get(key) ?? { person, seats: [] };
    spelling.seats.push(person.seat);
    spellings.set(key, spelling);
  }
  // Two spellings would read as two „Name“ rows nobody can tell apart, so each names the seats storing it.
  const labelOf = (label: Copy, seats: readonly FLKontaktSeat[]) => (spellings.size === 1 ? label : WORDS.seatFact(label, seats));
  return [...spellings.values()].flatMap(({ person, seats }, index) => [
    fact(labelOf(COPY.shared.name, seats), `${person.first_name} ${person.last_name}`),
    birthday(person.birth_date, labelOf(COPY.shared.facts.birthday, seats)),
    ...(index === 0 ? [...(team === null ? [] : [team]), { label: COPY.team.seat, value: COPY.team.seatsHeld(held) }] : []),
    fact(labelOf(COPY.shared.facts.phone, seats), person.phone),
  ]);
}

/** Why the media choice may not be given, where the record is short of its floor and the choice is not held. */
const mediaFrom = (offered: boolean): Copy | null => (offered ? null : COPY.shared.mediaFrom(MEDIA_MIN_AGE));

/**
 * What an entry's save posts unseen, drawn here rather than by the browser: the record's kind and ids, the evidence it
 * was served, an evidence the record holds none of posting nothing, and the labels of the words its box shows.
 */
function saved(
  record: { readonly kind: Entry["kind"] } & Readonly<Record<string, string>>,
  evidence: FLEinwilligungState,
  labels: { readonly scope: string; readonly media: string },
): Pick<Entry, "kind" | "carry"> {
  return {
    kind: record.kind,
    carry: {
      ...record,
      ...(evidence.scope === null ? {} : { "evidence_state.scope": evidence.scope }),
      ...(evidence.media === null ? {} : { "evidence_state.media": evidence.media }),
      "text_versions.scope": labels.scope,
      "text_versions.media": labels.media,
    },
  };
}

/** Every record the person holds, one box each, in the order a person reads their own: themselves, then their seats. */
function entriesOf({ spieler, schiedsrichter, registrierungen, seats, bewerbungen }: FLAccountEinwilligungenResponse): Entry[] {
  const pupil: Entry[] =
    spieler === null
      ? []
      : [
          {
            id: `spieler-${spieler.spieler_id}`,
            // By the person's role, as the referee's box is: „Kader“ would name the whole squad.
            title: COPY.shared.spieler,
            description: WORDS.description.own,
            facts: [fact(COPY.shared.name, kaderName(spieler)), birthday(spieler.birth_date)],
            ...saved({ kind: "spieler" }, spieler.evidence_state, SPIELER_TEXT_VERSIONS),
            scope: spieler.einwilligung.scope,
            media: spieler.einwilligung.media,
            givable: true,
            mediaFrom: mediaFrom(spieler.media_offered),
          },
        ];
  const referee = schiedsrichter.map((row): Entry => ({
    id: `schiedsrichter-${row.schiedsrichter_id}`,
    title: COPY.shared.schiedsrichter,
    description: WORDS.description.own,
    facts: [
      fact(COPY.shared.name, row.name),
      birthday(row.birth_date),
      fact(COPY.shared.facts.school, row.schule),
      fact(COPY.shared.emailAddress, row.kontakt.email),
      fact(COPY.shared.facts.phone, row.kontakt.phone),
      fact(COPY.shared.payment, formatEuro(row.default_payment)),
    ],
    ...saved({ kind: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id }, row.evidence_state, SCHIEDSRICHTER_TEXT_VERSIONS),
    scope: row.einwilligung.scope,
    media: row.einwilligung.media,
    givable: row.givable,
    mediaFrom: mediaFrom(row.media_offered),
  }));
  const registered = registrierungen.map((row): Entry => ({
    id: `registrierung-${row.registrierung_id}`,
    title: COPY.page.registrierung,
    description: WORDS.description.own,
    facts: [
      fact(COPY.shared.name, kaderName(row)),
      birthday(row.birth_date),
      // The team's season, or the season alone where the team no longer stands.
      fact(
        COPY.shared.facts.team,
        row.team_name === null
          ? COPY.shared.saisonName(row.saison_id)
          : WORDS.teamSeason({ record: row.team_name }, COPY.shared.saisonName(row.saison_id)),
      ),
    ],
    ...saved({ kind: "registrierung", registrierung_id: row.registrierung_id }, row.evidence_state, SPIELER_TEXT_VERSIONS),
    scope: row.scope,
    media: row.media,
    // Withdraw-only: a grant on a pending registration waits on its team's admission.
    givable: false,
    mediaFrom: null,
  }));
  const seated = seats.map((seat): Entry => ({
    id: `seat-${seat.team_id}-${seat.saison_id}`,
    title: { record: seat.team_name },
    description: WORDS.description.seat,
    facts: seatFacts(
      seat.persons,
      fact(COPY.shared.facts.team, WORDS.teamSeason({ record: seat.team_name }, COPY.shared.saisonName(seat.saison_id))),
      seat.seats,
    ),
    ...saved({ kind: "seat", team_id: seat.team_id, saison_id: seat.saison_id }, seat.evidence_state, SEAT_TEXT_VERSIONS),
    scope: seat.scope,
    media: seat.media,
    givable: seat.givable,
    mediaFrom: mediaFrom(seat.media_offered),
  }));
  const applied = bewerbungen.map((bewerbung): Entry => ({
    id: `bewerbung-${bewerbung.bewerbung_id}`,
    // An application stands for no team yet: titled as its page is, by the season it applies for.
    title: COPY.page.bewerbung(bewerbung.saison_id),
    description: WORDS.description.bewerbung,
    // No school: the read serves none, as a new school's name would be the form's sender's text. The title names the
    // season.
    facts: seatFacts(bewerbung.persons, null, bewerbung.seats),
    ...saved({ kind: "bewerbung", bewerbung_id: bewerbung.bewerbung_id }, bewerbung.evidence_state, SEAT_TEXT_VERSIONS),
    scope: bewerbung.scope,
    media: bewerbung.media,
    // Withdraw-only: a grant on a pending application is its confirmation page's alone.
    givable: false,
    mediaFrom: null,
  }));
  return [...pupil, ...registered, ...referee, ...seated, ...applied];
}

async function EntriesContent() {
  const { subject } = await requireAccountSession(ROUTES.accountEntries.path());
  const entries = entriesOf(await getAccountEinwilligungen());
  return entries.length === 0 ? (
    <EmptyBox
      kind="none"
      plural={WORDS.plural}
      glyph="entries"
    />
  ) : (
    <EntriesBoxes
      entries={entries}
      holder={subject.email}
    />
  );
}

/** Deine Einträge: each record of the person's own, with its consents. */
export default function AccountEntriesPage() {
  return (
    <AccountPage route="accountEntries">
      <EntriesContent />
    </AccountPage>
  );
}
