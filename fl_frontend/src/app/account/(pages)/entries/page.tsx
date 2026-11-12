import { AccountBoxPlaceholder } from "@/kit/AccountBox";
import { AccountEmpty, AccountPage } from "@/kit/AccountPage";
import { CheckboxPlaceholder } from "@/kit/Checkbox";
import { ConsentLinePlaceholder } from "@/kit/ConsentLine";
import { FactsPlaceholder } from "@/kit/Facts";
import { RadioGroupPlaceholder } from "@/kit/RadioGroup";

import { MEDIA_MIN_AGE } from "@/core/bounds";
import { SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import { dayOf, formatDate, formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { getAccountEinwilligungen } from "@/features/account/queries";
import { kaderName } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import { EntriesBoxes } from "./EntriesBoxes";

import type { Copy } from "@/core/copy";
import type { FLAccountEinwilligungenResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { Metadata, ResolvingMetadata } from "next";
import type { Entry } from "./EntriesBoxes";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountEntries, ROUTES.accountEntries.path());
}

const { entries: WORDS } = COPY.account;

/** A fact of the record, a dash where it holds none. */
const fact = (label: Copy, value: string | null): Fact => ({
  label,
  value: value === null || value === "" ? COPY.shared.noValue : { record: value },
});

/** A birthdate as a list writes a day. */
const birthday = (date: string | null): Fact => fact(COPY.shared.facts.birthday, date === null ? null : formatDate(dayOf(date)));

/** Why the media choice may not be given, where the record is short of its floor and the choice is not held. */
const mediaFrom = (offered: boolean): Copy | null => (offered ? null : WORDS.mediaFrom(MEDIA_MIN_AGE));

/** Every record the person holds, one box each, in the order a person reads their own: themselves, then their seats. */
function entriesOf({ spieler, schiedsrichter, registrierungen, seats, bewerbungen }: FLAccountEinwilligungenResponse): Entry[] {
  const pupil: Entry[] =
    spieler === null
      ? []
      : [
          {
            id: `spieler-${spieler.spieler_id}`,
            title: COPY.shared.kader,
            description: WORDS.description.spieler,
            facts: [fact(COPY.shared.name, kaderName(spieler)), birthday(spieler.birth_date)],
            save: { kind: "spieler" },
            scope: spieler.einwilligung.scope,
            media: spieler.einwilligung.media,
            evidence: spieler.evidence_state,
            givable: true,
            mediaFrom: mediaFrom(spieler.media_offered),
          },
        ];
  const referee = schiedsrichter.map((row): Entry => ({
    id: `schiedsrichter-${row.schiedsrichter_id}`,
    title: COPY.shared.schiedsrichter,
    description: WORDS.description.schiedsrichter,
    facts: [
      fact(COPY.shared.name, row.name),
      birthday(row.birth_date),
      fact(COPY.shared.facts.school, row.schule),
      fact(COPY.signIn.address, row.kontakt.email),
      fact(COPY.shared.facts.phone, row.kontakt.phone),
      fact(COPY.admin.payment, formatEuro(row.default_payment)),
    ],
    save: { kind: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id },
    scope: row.einwilligung.scope,
    media: row.einwilligung.media,
    evidence: row.evidence_state,
    givable: row.givable,
    mediaFrom: mediaFrom(row.media_offered),
  }));
  const registered = registrierungen.map((row): Entry => ({
    id: `registrierung-${row.registrierung_id}`,
    title: COPY.page.registrierung,
    description: WORDS.description.registrierung,
    facts: [
      fact(COPY.shared.name, `${row.first_name} ${row.last_name}`),
      birthday(row.birth_date),
      // The team's season, or the season alone where the team no longer stands.
      fact(
        COPY.shared.facts.team,
        row.team_name === null
          ? COPY.shared.saisonName(row.saison_id)
          : WORDS.teamSeason({ record: row.team_name }, COPY.shared.saisonName(row.saison_id)),
      ),
    ],
    save: { kind: "registrierung", registrierung_id: row.registrierung_id },
    scope: row.scope,
    media: row.media,
    evidence: row.evidence_state,
    // Withdraw-only: a grant on a pending registration waits on its team's admission.
    givable: false,
    mediaFrom: null,
  }));
  const seated = seats.map((seat): Entry => ({
    id: `seat-${seat.team_id}-${seat.saison_id}`,
    title: { record: seat.team_name },
    description: WORDS.description.seat(seat.rollen),
    facts: [fact(COPY.shared.facts.team, WORDS.teamSeason({ record: seat.team_name }, COPY.shared.saisonName(seat.saison_id)))],
    save: { kind: "seat", team_id: seat.team_id, saison_id: seat.saison_id },
    scope: seat.scope,
    media: seat.media,
    evidence: seat.evidence_state,
    givable: seat.givable,
    mediaFrom: mediaFrom(seat.media_offered),
  }));
  const applied = bewerbungen.map((bewerbung): Entry => ({
    id: `bewerbung-${bewerbung.bewerbung_id}`,
    // An application stands for no team yet: titled as its page is, by the season it applies for.
    title: COPY.page.bewerbung(bewerbung.saison_id),
    description: WORDS.description.seat(bewerbung.rollen),
    facts: [fact(COPY.shared.facts.school, bewerbung.schule)],
    save: { kind: "bewerbung", bewerbung_id: bewerbung.bewerbung_id },
    scope: bewerbung.scope,
    media: bewerbung.media,
    evidence: bewerbung.evidence_state,
    // Withdraw-only: a grant on a pending application is its confirmation page's alone.
    givable: false,
    mediaFrom: null,
  }));
  return [...pupil, ...registered, ...referee, ...seated, ...applied];
}

/** The person's records, read for the session the page is drawn for. */
async function EntriesContent() {
  const { subject } = await requireAccountSession(ROUTES.accountEntries.path());
  const entries = entriesOf(await getAccountEinwilligungen());
  return entries.length === 0 ? (
    <AccountEmpty
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

/**
 * Deine Einträge: each record of the person's own, with its consents. It waits in one box of the commonest kind, a
 * pupil's, in that kind's own words: which records stand is what the read decides.
 */
export default function AccountEntriesPage() {
  return (
    <AccountPage
      route="accountEntries"
      wait={
        <AccountBoxPlaceholder
          description={WORDS.description.spieler}
          foot={COPY.shared.verb.save}>
          <FactsPlaceholder
            pairs={2}
            look="free"
          />
          <RadioGroupPlaceholder
            label={SPIELER_WORDINGS.scope.question}
            choices={Object.values(SPIELER_WORDINGS.scope.options)}
          />
          <ConsentLinePlaceholder line={SPIELER_WORDINGS.scope.line} />
          {/* The floor is the record's; any two figures stand as wide. */}
          <CheckboxPlaceholder
            label={SPIELER_WORDINGS.media.label}
            description={WORDS.mediaFrom(MEDIA_MIN_AGE)}
          />
          <ConsentLinePlaceholder line={SPIELER_WORDINGS.media.line} />
        </AccountBoxPlaceholder>
      }>
      <EntriesContent />
    </AccountPage>
  );
}
