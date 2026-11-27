import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { AcceptFields } from "@/features/bewerbungen/AcceptFields";
import { getBewerbungById } from "@/features/bewerbungen/queries";
import { seatsOf } from "@/features/bewerbungen/seats";
import { STANDING_CHIP, standingOf, TEAM_DOUBLE } from "@/features/bewerbungen/standing";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { SeatActs } from "@/features/teams/SeatActs";
import { seatRow } from "@/features/teams/seatRow";
import { Button } from "@/kit/Button";
import { Link } from "@/kit/Link";
import { ReadPage } from "@/kit/ReadPage";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { AcceptDialog, DeclineDialog } from "./DecisionDialogs";
import { sendBewerbungSeatLink, writeBewerbungSeat } from "./seatActs";

import type { Copy, Words } from "@/core/copy";
import type { FLBewerbung, FLBewerbungSchule, FLBewerbungSingleResponse } from "@/core/generated/client/types";
import type { Standing } from "@/features/bewerbungen/standing";
import type { Fact } from "@/kit/Facts";
import type { ReadRecord } from "@/kit/ReadPage";
import type { SeatRow } from "@/kit/SeatRows";
import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen/[bewerbung]">;

const WORDS = ADMIN_COPY.bewerbung;
const FACTS = COPY.shared.facts;

/** A record's text as a fact's value, or the dash a fact the application left empty keeps its row with. */
const orDash = (value: string | null): Words => (value === null || value === "" ? COPY.shared.noValue : { record: value });

const figure = (label: Copy, value: number): Fact => ({ label, value: { record: formatNumber(value) }, figures: true });

/** The application the address names in the season it names, `null` for anything else. */
async function findBewerbung(params: Props["params"]) {
  const { saison } = await params;
  const id = await adminIdParamOf(params, "bewerbung");
  const read = id === null ? null : await getBewerbungById(id);
  return read !== null && read.bewerbung.saison_id === saison ? read : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findBewerbung(params), ({ bewerbung }) =>
    pageMetadata(ROUTES.adminBewerbung, ROUTES.adminBewerbung.path(bewerbung.saison_id, bewerbung.id), {
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
      { label: COPY.shared.reason, value: orDash(decision.reason) },
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
    { label: COPY.shared.facts.received, value: { record: formatDate(dayOf(bewerbung.submitted_at)) } },
    figure(COPY.team.stufengroesse, bewerbung.stufengroesse),
    figure(COPY.team.expectedKader, bewerbung.kader.expected_size),
    figure(COPY.team.goodSpieler, bewerbung.kader.good_spieler),
    { label: COPY.team.wunschfarbe, value: trikotFarbeLabel(bewerbung.trikot.wunschfarbe) },
    { label: COPY.team.trikotSet, value: orDash(bewerbung.trikot.existing_set) },
    { label: COPY.team.wunschgegner, value: orDash(bewerbung.wunschgegner) },
    ...decisionFacts(read),
  ];
}

/** A new school's third box: what its acceptance makes a club of. */
function schoolFacts({ team_name, full_name, schulform, address, website_url }: FLBewerbungSchule): readonly Fact[] {
  const { streetWithHouseNumber, addressLine } = COPY.shared.address;
  return [
    { label: COPY.team.teamName, value: { record: team_name } },
    { label: COPY.team.fullName, value: { record: full_name } },
    { label: COPY.team.schulform, value: schulform === null ? COPY.shared.noValue : COPY.team.schulformOption[schulform] },
    {
      label: COPY.shared.address.title,
      value: { record: addressLine(streetWithHouseNumber(address.street, address.house_number), address.postcode, address.city) },
    },
    { label: COPY.team.website, value: orDash(website_url) },
  ];
}

/**
 * Why „Annehmen“ cannot run, by the order a repair could reach it: a season no longer planned repairs nothing, since an
 * acceptance enters its club, which the write does in a planned season alone.
 */
function lockedReason(status: FLBewerbungSingleResponse["saison"]["status"], standing: Standing): Copy | undefined {
  // A running season and a finished one alike, as „Team eintragen“ is locked on the Teams page.
  if (status !== "future") return ADMIN_COPY.team.onlyPlanned;
  return standing === "complete" ? undefined : COPY.shared.afterConfirmation;
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
          taken={saison.taken}
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
    />,
  ];
}

/**
 * A person's row: nobody's on an emptied seat, and its acts while the application stands undecided, its season not yet
 * finished, and the seat can take them. A finished season's application takes no seat write and mails no link.
 */
function seatRowsOf(bewerbung: FLBewerbung, finished: boolean, holder: string): SeatRow[] {
  return seatsOf(bewerbung, finished).map(({ seat, seats, person, state, chips, day }) => {
    const row = { id: seat, ...seatRow(seats, person, day), chips };
    if (bewerbung.status !== "submitted" || finished || state === "erased") return row;
    const link = state === "valid" || state === "expired" ? { send: sendBewerbungSeatLink, seat: { bewerbung_id: bewerbung.id, seat } } : null;
    return {
      ...row,
      acts: (
        <SeatActs
          seats={seats}
          person={person}
          rules={boxRulesOf(writeBewerbungSeat)}
          write={writeBewerbungSeat}
          carry={{ id: bewerbung.id, seat, version: String(bewerbung.version) }}
          holder={holder}
          link={link}
        />
      ),
    };
  });
}

async function readRecord(params: Props["params"]): Promise<ReadRecord> {
  const [read, holder] = await Promise.all([findBewerbung(params), getAdminHolder()]);
  if (read === null) notFound();
  const { bewerbung, name } = read;
  const standing = standingOf({ status: bewerbung.status, seats_confirmed: read.seats_confirmed });
  return {
    title: { record: name },
    chip: STANDING_CHIP[standing],
    flag: read.duplicate ? TEAM_DOUBLE : undefined,
    groups: [
      { title: COPY.shared.bewerbung, kind: "facts", facts: applicationFacts(read) },
      // An accepted application's people are its team's, whose page its act leads to: the acceptance emptied its seats.
      ...(bewerbung.status === "accepted"
        ? []
        : [
            {
              title: COPY.team.kontakte,
              kind: "seats" as const,
              label: COPY.team.kontakte,
              rows: seatRowsOf(bewerbung, read.saison.status === "past", holder),
            },
          ]),
      ...(bewerbung.schule === null ? [] : [{ title: FACTS.school, kind: "facts" as const, facts: schoolFacts(bewerbung.schule) }]),
    ],
    acts: actsOf(read, standing),
  };
}

/**
 * One application: what the decision reads, its two verbs under those facts, its seats until its acceptance moves them to
 * its team, each edited in its dialog, and a new school's own details. Nothing here waits on a save bar: each act
 * writes on its own press.
 */
export default function BewerbungPage({ params }: Props) {
  return (
    <ReadPage
      scope="area"
      record={readRecord(params)}
    />
  );
}
