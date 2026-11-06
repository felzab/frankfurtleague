import { notFound } from "next/navigation";

import { Button } from "@/kit/Button";
import { Link } from "@/kit/Link";
import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { ACCEPT_RULES, DECLINE_RULES, SEAT_RULES } from "@/features/bewerbungen/fieldRules";
import { getBewerbungById } from "@/features/bewerbungen/queries";
import { seatsOf } from "@/features/bewerbungen/seats";
import { STANDING_CHIP, standingOf } from "@/features/bewerbungen/standing";
import { SeatActs } from "@/features/teams/components/forms/SeatActs";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import { AcceptFields } from "./AcceptFields";
import { AcceptDialog, DeclineDialog } from "./DecisionDialogs";
import { sendSeatLink, writeSeat } from "./writeSeat";

import type { Copy, Words } from "@/core/copy";
import type { FLBewerbung, FLBewerbungSchule, FLBewerbungSingleResponse } from "@/core/generated/client/types";
import type { Standing } from "@/features/bewerbungen/standing";
import type { Fact } from "@/kit/Facts";
import type { ReadRecord } from "@/kit/ReadPage";
import type { SeatRow } from "@/kit/SeatRows";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen/[bewerbung]">;

const WORDS = COPY.admin.bewerbung;
const FACTS = COPY.account.entries.facts;

/** A record's text as a fact's value, or the dash a fact the application left empty keeps its row with. */
const orDash = (value: string | null): Words => (value === null || value === "" ? COPY.shared.noValue : { record: value });

const figure = (label: Copy, value: number): Fact => ({ label, value: { record: formatNumber(value) }, figures: true });

/** The application the address names in the season it names, `null` for anything else. */
async function findBewerbung(params: Props["params"]) {
  const { saison } = await params;
  const id = await objectIdParamOf(params, "bewerbung");
  const read = id === null ? null : await getBewerbungById(id);
  return read !== null && read.bewerbung.saison_id === saison ? read : null;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findBewerbung(params), ({ bewerbung }) =>
    pageMetadata(parent, ROUTES.adminBewerbung, ROUTES.adminBewerbung.path(bewerbung.saison_id, bewerbung.id), {
      title: COPY.page.bewerbung(bewerbung.saison_id),
    }),
  );
}

/** The decision's facts: an accepted club's place in the season, a declined application's reason. */
function decisionFacts({ bewerbung: { status, decision }, entry }: FLBewerbungSingleResponse): readonly Fact[] {
  if (decision === null) return [];
  const day = { record: formatDate(dayOf(decision.made_at)) };
  if (status === "declined") {
    return [
      { label: WORDS.declinedOn, value: day },
      { label: COPY.admin.spiel.reason, value: orDash(decision.reason) },
    ];
  }
  const farbe = entry?.trikot_farbe ?? null;
  return [
    { label: WORDS.acceptedOn, value: day },
    { label: COPY.team.gruppe, value: entry === null ? COPY.shared.noValue : COPY.shared.season.gruppe(entry.gruppe) },
    { label: COPY.team.trikotFarbe, value: orDash(farbe === null ? null : trikotFarbeLabel(farbe)) },
  ];
}

/** The group the decision reads, first as a read page's first group is. */
function applicationFacts(read: FLBewerbungSingleResponse): readonly Fact[] {
  const { bewerbung, name } = read;
  return [
    { label: FACTS.school, value: { record: bewerbung.schule?.full_name ?? name } },
    { label: WORDS.received, value: { record: formatDate(dayOf(bewerbung.submitted_at)) } },
    figure(COPY.team.stufengroesse, bewerbung.stufengroesse),
    figure(COPY.team.expectedKader, bewerbung.kader.expected_size),
    figure(COPY.team.goodSpieler, bewerbung.kader.good_spieler),
    { label: COPY.team.wunschfarbe, value: { record: trikotFarbeLabel(bewerbung.trikot.wunschfarbe) } },
    { label: COPY.team.trikotSatz, value: orDash(bewerbung.trikot.existing_satz) },
    { label: COPY.team.wunschgegner, value: orDash(bewerbung.wunschgegner) },
    ...decisionFacts(read),
  ];
}

/** A new school's third box: what its acceptance makes a club of. */
function schoolFacts({ team_name, full_name, schulform, address, website_url }: FLBewerbungSchule): readonly Fact[] {
  const { strasseWithHausnummer, addressLine } = COPY.admin.spielort;
  return [
    { label: COPY.bewerbung.teamName, value: { record: team_name } },
    { label: COPY.team.fullName, value: { record: full_name } },
    { label: COPY.team.schulform, value: schulform === null ? COPY.shared.noValue : COPY.team.schulformOption[schulform] },
    {
      label: COPY.admin.spielort.address,
      value: { record: addressLine(strasseWithHausnummer(address.strasse, address.hausnummer), address.plz, address.stadt) },
    },
    { label: COPY.team.website, value: orDash(website_url) },
  ];
}

/** Why „Annehmen“ cannot run, by the order a repair could reach it: a season that took its start repairs nothing. */
function lockedReason(status: FLBewerbungSingleResponse["saison"]["status"], standing: Standing): Copy | undefined {
  if (status === "past") return COPY.template.closed;
  if (status === "active") return COPY.admin.saison.lockedSinceStart;
  return standing === "complete" ? undefined : WORDS.awaitsConfirmations;
}

/** The decision's verbs under the facts they decide on, while the application stands undecided, and an accepted one's way to its team. */
function actsOf(read: FLBewerbungSingleResponse, standing: Standing) {
  const { bewerbung, shorthand, saison } = read;
  const { id, version, status, saison_id: saisonId, team_id: teamId } = bewerbung;
  if (status === "accepted" && teamId !== null) {
    return [
      <Link
        key="team"
        href={ROUTES.adminTeam.path(saisonId, teamId)}
        placement="button"
        look="secondary"
        label={COPY.shared.toTeam}
      />,
    ];
  }
  if (status !== "submitted") return [];
  const locked = lockedReason(saison.status, standing);
  return [
    locked === undefined ? (
      <AcceptDialog
        key="accept"
        id={id}
        version={version}>
        <AcceptFields
          subject={{ wish: bewerbung.trikot.wunschfarbe, shorthand }}
          gruppen={saison.gruppen}
          rules={ACCEPT_RULES}
        />
      </AcceptDialog>
    ) : (
      <Button
        key="accept"
        variant="primary"
        label={COPY.shared.verb.accept}
        locked={locked}
        lockedEdge="start"
      />
    ),
    <DeclineDialog
      key="decline"
      id={id}
      version={version}
      required={DECLINE_RULES.required}
      max={DECLINE_RULES.max}
    />,
  ];
}

/** A person's row: nobody's on an emptied seat, and its acts while the application stands undecided and the seat can take them. */
function seatRowsOf(bewerbung: FLBewerbung): SeatRow[] {
  return seatsOf(bewerbung).map(({ seat, rollen, person, state, chips, day }) => ({
    id: seat,
    name: person === null ? COPY.admin.seatEmpty : { record: `${person.first_name} ${person.last_name}` },
    muted: person === null,
    chips,
    line: { record: COPY.admin.seatLine(rollen, person?.email ?? null, day) },
    ...(bewerbung.status === "submitted" && state !== "erased"
      ? {
          acts: (
            <SeatActs
              rollen={rollen}
              person={person}
              rules={SEAT_RULES}
              write={writeSeat}
              carry={{ id: bewerbung.id, seat, version: String(bewerbung.version) }}
              link={state === "open" || state === "expired" ? { send: sendSeatLink, seat: { bewerbung_id: bewerbung.id, seat } } : null}
            />
          ),
        }
      : {}),
  }));
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const read = await findBewerbung(params);
  if (read === null) notFound();
  const { bewerbung, name } = read;
  const standing = standingOf({ status: bewerbung.status, seats_confirmed: read.seats_confirmed });
  return {
    title: { record: name },
    chip: STANDING_CHIP[standing],
    groups: [
      { title: COPY.bewerbung.object, kind: "facts", facts: applicationFacts(read) },
      { title: COPY.team.kontakte, kind: "seats", label: COPY.team.kontakte, rows: seatRowsOf(bewerbung) },
      ...(bewerbung.schule === null ? [] : [{ title: FACTS.school, kind: "facts" as const, facts: schoolFacts(bewerbung.schule) }]),
    ],
    acts: actsOf(read, standing),
  };
}

/**
 * One application: what the decision reads, its two verbs under those facts, its seats, each edited in its dialog, and a
 * new school's own details. Nothing here waits on a save bar: each act writes on its own press.
 */
export default function BewerbungPage({ params }: Props) {
  return (
    <ReadPage
      scope="area"
      wait={{
        groups: [
          { title: COPY.bewerbung.object, kind: "facts", pairs: 8 },
          { title: COPY.team.kontakte, kind: "seats" },
        ],
      }}
      record={readRecord(params)}
    />
  );
}
