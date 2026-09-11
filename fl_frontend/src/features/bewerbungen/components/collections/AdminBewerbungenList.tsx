"use client";

import { memo } from "react";

import { ArrowRightFromSquare, GraduationCap } from "@gravity-ui/icons";

import { bestaetigungsStand, endstand, istOffen } from "@/features/bewerbungen/bestaetigungStand";
import { BEWERBUNG_STATUS_TINT, bewerbungStatusLabel } from "@/features/bewerbungen/constants";
import { BEWERBUNG_DUBLETTE_LABEL, BEWERBUNG_DUBLETTE_TINT } from "@/features/bewerbungen/duplicates";
import { hatUnerreichbarenSitz, ZUSTELLUNG_QUEUE_LABEL, ZUSTELLUNG_QUEUE_TINT } from "@/features/bewerbungen/zustellung";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import {
  IDENTITY_HEAD,
  IDENTITY_LINE,
  IDENTITY_NAME,
  IDENTITY_NAME_BOX,
  IDENTITY_ROW,
  IDENTITY_STACK,
} from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";

import type { BewerbungDublette } from "@/features/bewerbungen/duplicates";
import type { AdminBewerbungRow } from "@/features/bewerbungen/types";
import type { KontaktRolle } from "@/features/teams/constants";
import type { FLKontaktperson } from "@/features/teams/schemas";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { ReactNode } from "react";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Bewerbungen für diese Suche.",
  filtered: "Keine Bewerbungen für diese Filter.",
  none: "Es sind noch keine Bewerbungen eingegangen.",
};

/** What an application naming no team at all reads as — the one `REQ-BEWERBUNG-002` refuses to accept. */
const NO_TEAM = "Kein Team benannt";

/** What an application predating the confirmation flow reads as, in the register the admin uses for an absent value. */
const KEINE_BESTAETIGUNG = "Keine Bestätigungen angefragt";

/** The eyebrow over each fact, one cell of the card's grid. */
const ANGABE_LABEL = "fluid-xxs text-foreground-muted font-extrabold tracking-widest uppercase";

const KONTAKT_LABEL = Object.fromEntries(KONTAKT_ROLLEN.map(({ value, label }) => [value, label])) as Record<KontaktRolle, string>;

/** Which seat the queue shows, with the label naming it: the `null` seat is one nobody is left in. */
type Kontaktangabe = { rolle: KontaktRolle; person: FLKontaktperson | null };

/**
 * The Ansprechperson is who the league writes to first, and the Trainer stands in where that seat is
 * empty. An application whose seats are all gone keeps the Ansprechperson's label, that being the
 * seat it lost.
 */
function kontaktangabe({ kontakte }: AdminBewerbungRow): Kontaktangabe {
  if (kontakte.ansprechperson !== null) return { rolle: "ansprechperson", person: kontakte.ansprechperson };

  return kontakte.trainer === null ? { rolle: "ansprechperson", person: null } : { rolle: "trainer", person: kontakte.trainer };
}

/**
 * **A card per application at every width, never a table** (`docs/frontend/spec.md` §1.19): an
 * identity column's share of `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts :: STEP`
 * clips the contact address the league writes to. Memoised per `AdminCrudView`'s collection-identity
 * note.
 */
export const AdminBewerbungenList = memo(function AdminBewerbungenList({
  filteredBewerbungen,
  dubletten,
  emptiness,
}: {
  filteredBewerbungen: AdminBewerbungRow[];
  /** Which open applications share a club or a Kürzel, by id — answered over the whole queue, never over this list. */
  dubletten: ReadonlyMap<string, BewerbungDublette>;
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  const saisonHref = useSaisonHref();

  const renderName = (bewerbung: AdminBewerbungRow) =>
    bewerbung.teamName === null ? (
      <span className={`${IDENTITY_NAME_BOX} text-foreground-muted italic`}>{NO_TEAM}</span>
    ) : (
      <span className={IDENTITY_NAME}>{bewerbung.teamName}</span>
    );

  const renderStatus = (bewerbung: AdminBewerbungRow) => (
    <span className={labelBadge(BEWERBUNG_STATUS_TINT[bewerbung.status])}>{bewerbungStatusLabel(bewerbung.status)}</span>
  );

  // A new school and an existing club are decided differently — the first one gets created — so the
  // row says which it is before it is opened.

  // One tone for both: a Herkunft is a kind and not a standing, so the word tells the two apart.
  const renderHerkunft = (bewerbung: AdminBewerbungRow) =>
    bewerbung.schule !== null ? (
      <span className={labelBadge("info")}>Neue Schule</span>
    ) : (
      <span className={labelBadge("info")}>Bestehendes Team</span>
    );

  // Beside the Herkunft badge: a second application for one club is a fact about where the row came
  // from, and the administrator decides it by declining whichever is not real.
  const renderDublette = (bewerbung: AdminBewerbungRow) => {
    const art = dubletten.get(bewerbung.id);

    if (art === undefined) return null;

    return <span className={labelBadge(BEWERBUNG_DUBLETTE_TINT)}>{BEWERBUNG_DUBLETTE_LABEL[art]}</span>;
  };

  // Beside the duplicate mark, and `danger` where that one is `warning`: a colliding pair is waited
  // out by declining one of them, and an address the provider refuses for good is not.
  const renderUnerreichbar = (bewerbung: AdminBewerbungRow) =>
    hatUnerreichbarenSitz(bewerbung) ? <span className={labelBadge(ZUSTELLUNG_QUEUE_TINT)}>{ZUSTELLUNG_QUEUE_LABEL}</span> : null;

  /** The eyebrow names the fact at the fact, so no heading over the list can disagree with the block under it. */
  const renderAngabe = (label: string, wert: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={ANGABE_LABEL}>{label}</span>
      {wert}
    </div>
  );

  const renderEingereicht = (bewerbung: AdminBewerbungRow) => (
    // `font-numeric tabular-nums` is what makes a fixed-format date a fixed WIDTH under a proportional
    // page face. Never truncate: a clipped year is a different date.
    <span className="font-numeric fluid-sm text-foreground tabular-nums">{formatSpielDatum(bewerbung.eingereicht_am)}</span>
  );

  // The count and never a fourth `status` value: an application waits on its contacts inside
  // `eingereicht`, and a filter over this would partition the queue on something no decision moves.
  const renderBestaetigung = (bewerbung: AdminBewerbungRow) => {
    const staende = bestaetigungsStand(bewerbung);

    // An application submitted before the workflow has no per-seat state, and a badge reading „0 von
    // 3“ over one would send an administrator hunting for links that were never sent.
    if (staende === null) return <span className="fluid-sm text-foreground-muted italic">{KEINE_BESTAETIGUNG}</span>;

    // Ahead of the count, which would read „2 von 3“ over a row no answer can complete and send an
    // administrator waiting for a third that is never coming.
    const endgueltig = endstand(staende);

    if (endgueltig !== null) {
      return <span className={labelBadge("danger")}>{endgueltig}</span>;
    }

    const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;

    return (
      <span className={labelBadge(bestaetigt === staende.length ? "success" : "warning")}>
        {String(bestaetigt)} von {String(staende.length)} bestätigt
      </span>
    );
  };

  const renderKontakt = (bewerbung: AdminBewerbungRow) => {
    const { rolle, person } = kontaktangabe(bewerbung);

    // The box and its ink at the call site, never `IDENTITY_LINE` under an override: two ink
    // utilities in one string are decided by the stylesheet's order, there being no `twMerge` in
    // the path.
    return renderAngabe(
      KONTAKT_LABEL[rolle],
      <div className="flex min-w-0 flex-col gap-0.5">
        {person === null ? (
          <span className={`${IDENTITY_NAME_BOX} text-foreground-muted italic`}>Keine Kontaktperson</span>
        ) : (
          <span className={IDENTITY_NAME}>{`${person.vorname} ${person.nachname}`}</span>
        )}
        {person === null || person.email === "" ? (
          <span className={`${IDENTITY_LINE} italic`}>Keine E-Mail</span>
        ) : (
          <span className={IDENTITY_LINE}>{person.email}</span>
        )}
      </div>,
    );
  };

  /** The status pill leads because a row's standing reads before its kind, and a row cannot know which facet is on. */
  const renderIdentity = (bewerbung: AdminBewerbungRow) => (
    <div className={IDENTITY_ROW}>
      <GraduationCap
        aria-hidden="true"
        className="text-brand shrink-0"
        width={18}
        height={18}
      />
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          {renderName(bewerbung)}
          {renderStatus(bewerbung)}
          {renderHerkunft(bewerbung)}
          {renderDublette(bewerbung)}
          {renderUnerreichbar(bewerbung)}
          {/* Words rather than a pill: the season is the ordinary case, which the date in the grid
              below already states in the same register. */}
          <span className="fluid-xs text-foreground-muted">
            Saison <span className="font-numeric tabular-nums">{bewerbung.saison_id}</span>
          </span>
        </div>
        {bewerbung.schule !== null && <span className={IDENTITY_LINE}>{bewerbung.schule.full_name}</span>}
      </div>
    </div>
  );

  const renderActions = (bewerbung: AdminBewerbungRow) => (
    <RowActions>
      {/* A link and not a press: the decision is taken on a page of its own, where the whole
          application stands. */}
      <RowActionLink
        href={saisonHref(`/admin/bewerbungen/${bewerbung.id}`)}
        label="Bewerbung öffnen"
        ariaLabel={`Bewerbung von ${bewerbung.teamName ?? NO_TEAM} öffnen`}>
        <ArrowRightFromSquare
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
    </RowActions>
  );

  if (filteredBewerbungen.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, and „Liste“ rather than the „Tabelle“ every
       table collection says: these are cards. */
    <ul
      aria-label="Liste aller Bewerbungen"
      className="flex w-full flex-col gap-3">
      {filteredBewerbungen.map((bewerbung) => (
        <li
          key={bewerbung.id}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          <div className="flex w-full flex-row items-center gap-3">
            <div className="min-w-0 flex-1">{renderIdentity(bewerbung)}</div>
            {/* One of the two placements is hidden at any width, so the pair is one tab stop. */}
            <div className="hidden shrink-0 md:block">{renderActions(bewerbung)}</div>
          </div>

          {/* Four tracks and the contact over two of them: the two graded facts read at a glance and
              the address does not, so an even split would clip the one fact nobody can guess. */}
          <div className="border-border/50 grid grid-cols-1 gap-3 border-t pt-3 md:grid-cols-4 md:gap-x-4">
            {renderAngabe("Eingereicht", renderEingereicht(bewerbung))}
            {renderAngabe("Bestätigungen", <div className="flex flex-row flex-wrap items-center gap-2">{renderBestaetigung(bewerbung)}</div>)}
            <div className="md:col-span-2">{renderKontakt(bewerbung)}</div>
          </div>

          <div className="border-border/50 -mx-1 border-t pt-2 md:hidden">{renderActions(bewerbung)}</div>
        </li>
      ))}
    </ul>
  );
});
