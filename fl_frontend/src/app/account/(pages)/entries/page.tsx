import { AccountEmpty, AccountPage } from "@/kit/AccountPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDatum } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/konto/account";
import { getKontoEinwilligungen } from "@/features/konto/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { EintraegeBoxes } from "./EintraegeBoxes";

import type { Copy } from "@/core/copy";
import type { FLAccountEinwilligungenResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { Metadata, ResolvingMetadata } from "next";
import type { Entry } from "./EintraegeBoxes";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountEntries, ROUTES.accountEntries.path());
}

const { entries: WORDS } = COPY.konto;

/** A fact the record holds, left out where it holds none. */
const fact = (label: Copy, value: string | null): Fact[] => (value === null || value === "" ? [] : [{ label, value: { record: value } }]);

/** A birthdate as a list writes a day. */
const birthday = (datum: string | null): Fact[] => fact(WORDS.facts.birthday, datum === null ? null : formatDatum(dayOf(datum)));

/** Why the media choice may not be given, where the record is short of its floor and the choice is not held. */
const mediaFrom = (offered: boolean, floor: number): Copy | null => (offered ? null : WORDS.mediaFrom(floor));

/** Every record the person holds, one box each, in the order a person reads their own: themselves, then their seats. */
function entriesOf({ spieler, schiedsrichter, registrierungen, seats, bewerbungen }: FLAccountEinwilligungenResponse): Entry[] {
  const pupil: Entry[] =
    spieler === null
      ? []
      : [
          {
            id: `spieler-${spieler.spieler_id}`,
            title: WORDS.spieler,
            description: WORDS.description.spieler,
            facts: [...fact(COPY.shared.name, `${spieler.vorname} ${spieler.nachname ?? ""}`.trim()), ...birthday(spieler.geburtsdatum)],
            save: { kind: "spieler" },
            umfang: spieler.einwilligung.umfang,
            medien: spieler.einwilligung.medien,
            nachweis: spieler.nachweis_stand,
            givable: spieler.givable,
            mediaFrom: mediaFrom(spieler.medien_offered, spieler.medien_minimum_age),
          },
        ];
  const referee = schiedsrichter.map((row): Entry => ({
    id: `schiedsrichter-${row.schiedsrichter_id}`,
    title: WORDS.schiedsrichter,
    description: WORDS.description.schiedsrichter,
    facts: [
      ...fact(COPY.shared.name, row.name),
      ...birthday(row.geburtsdatum),
      ...fact(WORDS.facts.school, row.schule),
      ...fact(COPY.signIn.address, row.kontakt.email),
      ...fact(WORDS.facts.phone, row.kontakt.telefon),
    ],
    save: { kind: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id },
    umfang: row.einwilligung.umfang,
    medien: row.einwilligung.medien,
    nachweis: row.nachweis_stand,
    givable: row.givable,
    mediaFrom: mediaFrom(row.medien_offered, row.medien_minimum_age),
  }));
  // A returning pupil's registration asks no choice: their record holds the choices.
  const registered = registrierungen.flatMap((row): Entry[] =>
    row.umfang === null || row.medien === null
      ? []
      : [
          {
            id: `registrierung-${row.registrierung_id}`,
            title: WORDS.spieler,
            description: WORDS.description.spieler,
            facts: [
              ...fact(COPY.shared.name, `${row.vorname} ${row.nachname}`),
              ...birthday(row.geburtsdatum),
              ...fact(
                WORDS.facts.team,
                WORDS.registrierung(row.team_name === null ? null : { record: row.team_name }, COPY.shared.saisonName(row.saison_id)),
              ),
            ],
            save: { kind: "registrierung", registrierung_id: row.registrierung_id },
            umfang: row.umfang,
            medien: row.medien,
            nachweis: row.nachweis_stand,
            // Withdraw-only: a grant on a pending registration waits on its team's admission.
            givable: false,
            mediaFrom: null,
          },
        ],
  );
  const seated = seats.map((seat): Entry => ({
    id: `seat-${seat.team_id}-${seat.saison_id}`,
    title: WORDS.seats(seat.rollen),
    description: WORDS.description.seat,
    facts: fact(WORDS.facts.team, WORDS.teamSeason({ record: seat.team_name }, COPY.shared.saisonName(seat.saison_id))),
    save: { kind: "seat", team_id: seat.team_id, saison_id: seat.saison_id },
    umfang: seat.umfang,
    medien: seat.medien,
    nachweis: seat.nachweis_stand,
    givable: seat.givable,
    mediaFrom: mediaFrom(seat.medien_offered, seat.medien_minimum_age),
  }));
  const applied = bewerbungen.map((bewerbung): Entry => ({
    id: `bewerbung-${bewerbung.bewerbung_id}`,
    title: WORDS.seats(bewerbung.rollen),
    description: WORDS.description.seat,
    facts: [
      ...fact(WORDS.facts.school, bewerbung.schule),
      ...fact(WORDS.facts.team, WORDS.bewerbung(COPY.shared.saisonName(bewerbung.saison_id))),
    ],
    save: { kind: "bewerbung", bewerbung_id: bewerbung.bewerbung_id },
    umfang: bewerbung.umfang,
    medien: bewerbung.medien,
    nachweis: bewerbung.nachweis_stand,
    // Withdraw-only: a grant on a pending application is its confirmation page's alone.
    givable: false,
    mediaFrom: null,
  }));
  return [...pupil, ...registered, ...referee, ...seated, ...applied];
}

/** The person's records, read for the session the page is drawn for. */
async function Eintraege() {
  await requireAccountSession(ROUTES.accountEntries.path());
  const entries = entriesOf(await getKontoEinwilligungen());
  return entries.length === 0 ? (
    <AccountEmpty
      plural={WORDS.plural}
      glyph="entries"
    />
  ) : (
    <EintraegeBoxes entries={entries} />
  );
}

/** Deine Einträge: each record of the person's own, with its consents. */
export default function EintraegePage() {
  return (
    <AccountPage route="accountEntries">
      <Eintraege />
    </AccountPage>
  );
}
