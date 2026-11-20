import { Callout } from "./Callout";
import { EmptyBox } from "./EmptyState";
import { Facts } from "./Facts";
import { formColumn, RailPage } from "./RailFrame";
import { SeatRows } from "./SeatRows";
import { SectionTitle } from "./Section";
import { SpielCards } from "./SpielCards";
import { SpielHead } from "./SpielHead";
import { StatTiles } from "./StatTiles";
import { Timeline } from "./Timeline";
import { tv } from "./tv";

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
  /** Matches each in a card of its own under its head, such as a club's matches under their matchdays. */
  | { kind: "spiele"; spiele: ReadonlyArray<{ head: Copy; spiel: SpielRowProps & { id: string } }>; empty: EmptyStateProps }
  /** A record's seats, each its person and the page's acts on them. */
  | { kind: "seats"; label: Copy; rows: ReadonlyArray<SeatRow> }
  /**
   * Tables each folded behind its card's head, such as a match's line-ups: `ReadFolds` over the cards, which the
   * page places, so a read page folding nothing ships none of the fold's client code.
   */
  | { kind: "folds"; folds: ReactElement };

/**
 * One group of a read page, under its title; a group whose content names itself, its tiles or its folded card's head,
 * may stand without one.
 */
type ReadGroup = { title?: Copy } & GroupContent;

export type ReadRecord = {
  /** The record names the page. */
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
   * A club's head over the groups, `TeamProfileHead`, which the club's page places as `folds` holds `ReadFolds`; and, where
   * the club has left the season, its route and day over the reason as it was stored.
   */
  team?: { head: ReactElement; austritt: { title: Copy; text: RecordText } | null };
  /** The first group goes without a title where it is the page's only one: the page's own title names it. */
  groups: readonly [ReadGroup, ...ReadGroup[]];
  /** The decision's acts, the kit's buttons and the dialogs they open, under the first group. */
  acts?: ReadonlyArray<ReactElement>;
};

/** What a page naming itself before its read reads: the record without the title, which the page holds already. */
export type ReadContent = Omit<ReadRecord, "title">;

/** Who names the page: the record, or the page itself before the read, such as a person's own Übersicht. */
type Named = { title?: never; record: Promise<ReadRecord> } | { title: PageTitle; record: Promise<ReadContent> };

async function titled(named: Named): Promise<{ title: PageTitle; read: ReadContent }> {
  if (named.title !== undefined) return { title: named.title, read: await named.record };
  const read = await named.record;
  return { title: read.title, read };
}

const readActs = tv({ base: "grid gap-3 lg:flex lg:flex-wrap lg:items-center" });

const column = tv({
  variants: { width: { form: formColumn(), content: "grid w-full gap-6" } },
  defaultVariants: { width: "form" },
});

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
      return group.spiele.length === 0 ? (
        <EmptyBox {...group.empty} />
      ) : (
        // Each matchday's head stands under the group's own title, a rung below it.
        <SpielCards
          groups={group.spiele}
          level={3}
        />
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

async function ReadBody({ scope, width, named }: { scope: "saison" | "area"; width: ReadWidth | undefined; named: Named }) {
  const { title, read } = await titled(named);
  const { chip, flag, spiel, team, groups, acts } = read;
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
        {team !== undefined && (
          <div className="grid gap-3">
            {team.head}
            {team.austritt !== null && (
              <Callout
                tone="danger"
                title={team.austritt.title}
                text={team.austritt.text}
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
 * The read page: a record shown without editing, its groups one under another in the editor's column, no save bar; a
 * match's page heads them with the head
 * its pop-up shows and what befell the match, a club's page with the club's head and its exit from the season
 * where it left one. The first group holds the facts its decision reads, and
 * the decision's acts stand directly under it; the next groups follow the reader's next question. The two parts holding client code, the folded cards
 * and the club's head, are modules of their own the page places, so the template imports neither.
 *
 * The record names the page; a page whose title no read decides, such as a person's own Übersicht, hands it as
 * `title`. `width: "content"` sets the blocks across the content rather than in the column.
 */
export function ReadPage({ scope, width, ...named }: { scope: "saison" | "area"; width?: ReadWidth } & Named) {
  return (
    <ReadBody
      scope={scope}
      width={width}
      named={named}
    />
  );
}
