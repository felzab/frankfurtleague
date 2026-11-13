import { buttonPlaceholder } from "./buttonStyles";
import { Callout } from "./Callout";
import { EmptyBox } from "./EmptyState";
import { Facts, FactsPlaceholder } from "./Facts";
import { formColumn, RailPage } from "./RailFrame";
import { SeatRows, SeatRowsPlaceholder } from "./SeatRows";
import { SectionTitle } from "./Section";
import { Waiting } from "./Skeleton";
import { SpielGroup, SpielGroupPlaceholder } from "./SpielGroup";
import { SpielHead, SpielHeadPlaceholder } from "./SpielHead";
import { SpielPairList, spielPairs } from "./SpielRow";
import { StatTiles, StatTilesPlaceholder } from "./StatTiles";
import { Timeline, TimelinePlaceholder } from "./Timeline";
import { tv } from "./tv";
import { PageWait } from "./WholePage";

import type { Copy, RecordText } from "@/core/copy";
import type { ComponentProps, ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { Fact } from "./Facts";
import type { PageTitle } from "./RailFrame";
import type { SeatRow } from "./SeatRows";
import type { SpielHeadProps } from "./SpielHead";
import type { SpielRowProps } from "./SpielRow";
import type { Checkpoint } from "./Timeline";

type GroupContent =
  | { kind: "facts"; facts: ReadonlyArray<Fact> }
  /** A record's figures at a glance, each in its tile. */
  | { kind: "tiles"; tiles: ComponentProps<typeof StatTiles> }
  /** Things in their order along the dotted line, or why there are none yet. */
  | { kind: "timeline"; label: Copy; items: readonly Checkpoint[]; empty: EmptyStateProps }
  /**
   * Matches each in a card of its own under its head, such as a club's matches under their matchdays, one under
   * another in a list narrower than 42 rem and two a row from it; or why there are none yet.
   */
  | { kind: "spiele"; spiele: ReadonlyArray<{ head: Copy; spiel: SpielRowProps & { id: string } }>; empty: EmptyStateProps }
  /** A record's seats, each its person and the page's acts on them. */
  | { kind: "seats"; label: Copy; rows: ReadonlyArray<SeatRow> }
  /**
   * Tables each folded behind its card's head, such as a match's line-ups: `ReadFolds` over the cards, which the
   * page places, so a read page folding nothing ships none of the fold's client code.
   */
  | { kind: "folds"; folds: ReactElement };

/**
 * One group of a read page, under its 16-px title; a group whose content names itself, its tiles or its folded
 * card's head, may stand without one.
 */
type ReadGroup = { title?: Copy } & GroupContent;

/** A record as its read page shows it, once it is read. */
export type ReadRecord = {
  /** The record names the page, so its title waits with the rest. */
  title: PageTitle;
  chip?: ChipProps;
  /** What the record's status leaves unsaid and its reader must not miss, after the chip. */
  flag?: ChipProps;
  /**
   * A match's own head over the groups, the one its pop-up shows: the matchday over the pairing and its
   * score, and what befell the match where something did, which says how it counts.
   */
  spiel?: { head: SpielHeadProps; sonderereignis: { title: Copy; text: Copy } | null };
  /**
   * A club's head over the groups, `ClubHead`, which the club's page places as `folds` holds `ReadFolds`; and, where
   * the club has left the season, its route and day over the reason as it was stored.
   */
  club?: { head: ReactElement; austritt: { title: Copy; text: RecordText } | null };
  /** The first group goes without a title where it is the page's only one: the page's own title names it. */
  groups: readonly [ReadGroup, ...ReadGroup[]];
  /** The decision's acts, the kit's buttons and the dialogs they open, under the first group. */
  acts?: ReadonlyArray<ReactElement>;
};

/** What a page naming itself before its read reads: the record without the title, which the page holds already. */
export type ReadContent = Omit<ReadRecord, "title">;

/**
 * Who names the page: the record, whose title waits with the rest, or the page itself before the read, such as a
 * person's own Übersicht, whose strip then stands at once.
 */
type Named = { title?: never; record: Promise<ReadRecord> } | { title: PageTitle; record: Promise<ReadContent> };

/** The page's title and what it reads, once read. */
async function titled(named: Named): Promise<{ title: PageTitle; read: ReadContent }> {
  if (named.title !== undefined) return { title: named.title, read: await named.record };
  const read = await named.record;
  return { title: read.title, read };
}

/** The decision's acts under the first group: one under another on a phone, in a row from `lg`. */
const readActs = tv({ base: "grid gap-3 lg:flex lg:flex-wrap lg:items-center" });

/**
 * The box the page's blocks stand in one under another: the editor's column, or the content's whole width, where a
 * page such as a person's own Übersicht sets its tiles four in a row and its matches two in a row, each from 42 rem.
 */
const column = tv({
  variants: { width: { form: formColumn(), content: "grid w-full gap-6" } },
  defaultVariants: { width: "form" },
});

/** Where a read page's blocks stand: in the editor's column, as a record's page, or across the content. */
type ReadWidth = "form" | "content";

function GroupBody({ group }: { group: GroupContent }) {
  switch (group.kind) {
    case "facts":
      return <Facts facts={group.facts} />;
    case "tiles":
      return <StatTiles {...group.tiles} />;
    case "timeline":
      return group.items.length === 0 ? (
        <EmptyBox {...group.empty} />
      ) : (
        <Timeline
          label={group.label}
          items={group.items}
        />
      );
    case "spiele":
      // As `SpielList`'s cards: one under another in a list narrower than 42 rem, two a row from it.
      return group.spiele.length === 0 ? (
        <EmptyBox {...group.empty} />
      ) : (
        <SpielPairList>
          {group.spiele.map(({ head, spiel }) => (
            <div
              key={spiel.id}
              className={spielPairs().box()}>
              <SpielGroup
                head={head}
                spiele={[spiel]}
                columns="outer"
              />
            </div>
          ))}
        </SpielPairList>
      );
    case "seats":
      return (
        <SeatRows
          label={group.label}
          rows={group.rows}
        />
      );
    case "folds":
      return group.folds;
  }
}

/** The page once its record is read, in the boundary's place. */
async function ReadBody({ scope, width, named }: { scope: "saison" | "area"; width: ReadWidth | undefined; named: Named }) {
  const { title, read } = await titled(named);
  const { chip, flag, spiel, club, groups, acts } = read;
  const [first, ...rest] = groups;
  return (
    <RailPage
      scope={scope}
      title={title}
      chip={chip}
      flag={flag}>
      <div className={column({ width })}>
        {spiel !== undefined && (
          <div className="grid gap-3">
            <SpielHead
              {...spiel.head}
              placement="page"
            />
            {spiel.sonderereignis !== null && (
              <Callout
                tone="danger"
                title={spiel.sonderereignis.title}
                text={spiel.sonderereignis.text}
              />
            )}
          </div>
        )}
        {club !== undefined && (
          <div className="grid gap-3">
            {club.head}
            {club.austritt !== null && (
              <Callout
                tone="danger"
                title={club.austritt.title}
                text={club.austritt.text}
              />
            )}
          </div>
        )}
        <section className="grid gap-3">
          {first.title !== undefined && <SectionTitle text={first.title} />}
          <GroupBody group={first} />
          {acts !== undefined && acts.length > 0 && <div className={readActs()}>{acts}</div>}
        </section>
        {rest.map((group, index) => (
          <section
            key={group.title ?? index}
            className="grid gap-3">
            {group.title !== undefined && <SectionTitle text={group.title} />}
            <GroupBody group={group} />
          </section>
        ))}
      </div>
    </RailPage>
  );
}

/**
 * The read page: a record shown without editing, its groups one under another in the editor's column,
 * at most 760 px centred in the content (`formColumn`), no save bar; a match's page heads them with the head
 * its pop-up shows and what befell the match, a club's page with the club's head and its exit from the season
 * where it left one. The first group holds the facts its decision reads, and
 * the decision's acts stand directly under it; the next groups follow the reader's next question. The two parts holding client code, the folded cards
 * and the club's head, are modules of their own the page places, so the template imports neither.
 *
 * The record names the page, so the whole page waits for it in the template's one boundary: meanwhile the strip
 * holds a bar where the title will stand, and the column the placeholders of the page's own blocks, its head
 * and its groups in their order, as `wait` states them. A page whose title no read decides, such as a person's own Übersicht,
 * hands it as `title`, and its strip stands at once. `width: "content"` sets the blocks across the content, where
 * the tiles stand four in a row and the matches two, rather than in the column.
 */
export function ReadPage({ scope, wait, width, ...named }: { scope: "saison" | "area"; wait: ReadWait; width?: ReadWidth } & Named) {
  return (
    <PageWait
      fallback={
        <RailPage
          scope={scope}
          title={named.title ?? null}>
          <Waiting layoutClass={column({ width })}>
            {wait.spiel === true && <SpielHeadPlaceholder />}
            {wait.club}
            {wait.groups.map((group, index) => (
              <section
                key={index}
                className="grid gap-3">
                {group.title !== undefined && <SectionTitle text={group.title} />}
                <GroupPlaceholder group={group} />
              </section>
            ))}
          </Waiting>
        </RailPage>
      }>
      <ReadBody
        scope={scope}
        width={width}
        named={named}
      />
    </PageWait>
  );
}

/**
 * What a read page is before its record is read: the head it opens with, a match's or a club's, and its groups in
 * their order, each its kind, its title where it carries one, and how many of its parts its placeholder draws. The
 * page states it beside the record it reads, which holds the same groups in the same order. The two parts holding
 * client code, the club's head and the folded cards, the page places as it places them in the record: their
 * placeholders, `ClubHeadPlaceholder` and `ReadFoldsPlaceholder`, from their own modules.
 */
export type ReadWait = {
  /** The match's head, as `ReadRecord`'s `spiel` opens the page. */
  spiel?: true;
  /** The club head's placeholder, as `ReadRecord`'s `club` opens the page with the head. */
  club?: ReactElement;
  groups: ReadonlyArray<
    { title?: Copy } &
      /** `acts`, the words of the decision's acts under the first group. */
      (
        | { kind: "facts"; pairs: number; acts?: ReadonlyArray<Copy> }
        /** `line: false` where none of the tiles carries a line under its value. */
        | { kind: "tiles"; layout: "four" | "five"; line?: false }
        /** `matches` where each checkpoint holds a match's row, as a club's line does. */
        | { kind: "timeline"; count: number; matches?: boolean }
        /** How many match cards the wait draws, each its head and its row. */
        | { kind: "spiele"; count: number }
        | { kind: "seats" }
        | { kind: "folds"; folds: ReactElement }
      )
  >;
};

/** One group's placeholder: the placeholder its block draws. */
function GroupPlaceholder({ group }: { group: ReadWait["groups"][number] }) {
  switch (group.kind) {
    case "facts":
      return (
        <>
          <FactsPlaceholder pairs={group.pairs} />
          {group.acts !== undefined && (
            <div className={readActs()}>
              {group.acts.map((act) => (
                <span
                  key={act}
                  className={buttonPlaceholder()}>
                  {act}
                </span>
              ))}
            </div>
          )}
        </>
      );
    case "tiles":
      return (
        <StatTilesPlaceholder
          layout={group.layout}
          line={group.line !== false}
        />
      );
    case "timeline":
      return (
        <TimelinePlaceholder
          count={group.count}
          matches={group.matches}
        />
      );
    case "spiele":
      return (
        <SpielPairList>
          {Array.from({ length: group.count }, (_, index) => (
            <div
              key={index}
              className={spielPairs().box()}>
              <SpielGroupPlaceholder columns="outer" />
            </div>
          ))}
        </SpielPairList>
      );
    case "seats":
      return <SeatRowsPlaceholder />;
    case "folds":
      return group.folds;
  }
}
