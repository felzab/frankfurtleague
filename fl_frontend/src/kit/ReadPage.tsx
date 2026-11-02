import { Suspense } from "react";

import { Callout } from "./Callout";
import { CardFold } from "./CardFold";
import { cardSurface } from "./cardStyles";
import { EmptyState } from "./EmptyState";
import { ExpandableText } from "./ExpandableText";
import { Facts } from "./Facts";
import { Link } from "./Link";
import { formColumn, RailPage } from "./RailFrame";
import { SectionTitle } from "./Section";
import { Skeleton } from "./Skeleton";
import { SpielHead } from "./SpielHead";
import { SpielList } from "./SpielRow";
import { StatTiles } from "./StatTiles";
import { Table } from "./Table";
import { TeamPlaque } from "./TeamPlaque";
import { Timeline } from "./Timeline";

import type { Copy } from "@/core/copy";
import type { ComponentProps, ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { Fact } from "./Facts";
import type { PageTitle } from "./RailFrame";
import type { SpielHeadProps } from "./SpielHead";
import type { SpielRowProps } from "./SpielRow";
import type { TableProps } from "./Table";
import type { Checkpoint } from "./Timeline";

type GroupContent =
  | { kind: "facts"; facts: ReadonlyArray<Fact> }
  | { kind: "table"; table: TableProps }
  | { kind: "matches"; matches: ReadonlyArray<SpielRowProps & { id: string }> }
  /** A record's figures at a glance, each in its tile. */
  | { kind: "tiles"; tiles: ComponentProps<typeof StatTiles> }
  /** Things in their order along the dotted line, or why there are none yet. */
  | { kind: "timeline"; label: Copy; items: readonly Checkpoint[]; empty: EmptyStateProps }
  /** Tables each folded behind its card's head, two side by side from `lg`, such as a match's line-ups. */
  | { kind: "folds"; cards: ReadonlyArray<FoldedCard> };

/**
 * One folded card: its title, catalogue text or a record's name such as a club's; how many it holds; and its
 * tables, one, or several each under its head, such as a line-up's starters over its bench.
 */
export type FoldedCard = ({ title: Copy; titleText?: never } | { titleText: string; title?: never }) & {
  count?: number;
  tables: readonly [TableProps] | ReadonlyArray<{ head: Copy; table: TableProps }>;
};

/**
 * One group of a read page, under its 16-px title; a group whose content names itself, its tiles or its folded
 * card's head, may stand without one.
 */
type ReadGroup = { title?: Copy } & GroupContent;

/**
 * A club's head over its page: its plaque and its name, a link to its own website where it has one; the school's
 * full name; its address, a link to the map; and its description, three lines until it is opened.
 */
type ClubHead = {
  kuerzel: string;
  name: string;
  website: `https://${string}` | null;
  school: string;
  address: string;
  map: `https://${string}`;
  description: string;
};

/** A record as its read page shows it, once it is read. */
export type ReadRecord = {
  /** The record names the page, so its title waits with the rest. */
  title: PageTitle;
  chip?: ChipProps;
  /**
   * A match's own head over the groups, the one its pop-up shows: the matchday over the pairing and its
   * score, and what befell the match where something did, which says how it counts.
   */
  spiel?: { head: SpielHeadProps; sonderereignis: { title: Copy; text: Copy } | null };
  /** A club's head over the groups. */
  club?: ClubHead;
  /** The first group goes without a title where it is the page's only one: the page's own title names it. */
  groups: readonly [ReadGroup, ...ReadGroup[]];
  /** The decision's acts, the kit's buttons and the dialogs they open, under the first group. */
  acts?: ReadonlyArray<ReactElement>;
  /** Why an act is closed on the record's present state, under the acts. */
  actsNote?: Copy;
};

function GroupBody({ group }: { group: GroupContent }) {
  switch (group.kind) {
    case "facts":
      return <Facts facts={group.facts} />;
    case "table":
      return <Table {...group.table} />;
    case "matches":
      return <SpielList matches={group.matches} />;
    case "tiles":
      return <StatTiles {...group.tiles} />;
    case "timeline":
      return group.items.length === 0 ? (
        <div className={cardSurface({ class: "overflow-hidden" })}>
          <EmptyState {...group.empty} />
        </div>
      ) : (
        <Timeline
          label={group.label}
          items={group.items}
        />
      );
    case "folds":
      return (
        <div className={group.cards.length > 1 ? "grid content-start gap-3 lg:grid-cols-2" : "grid"}>
          {group.cards.map(({ tables, ...card }) => (
            <CardFold
              key={card.title ?? card.titleText}
              {...card}>
              {tables.map((part) =>
                "head" in part ? (
                  <section
                    key={part.head}
                    className="border-t border-border first:border-t-0">
                    {/* Set as a column head is, small muted capitals, so the card's head stays the one band it carries. */}
                    <h3 className="px-3 pt-3 text-xs font-medium tracking-caps text-fg-muted uppercase">{part.head}</h3>
                    <Table
                      {...part.table}
                      bare
                    />
                  </section>
                ) : (
                  <Table
                    key={part.label}
                    {...part}
                    bare
                  />
                ),
              )}
            </CardFold>
          ))}
        </div>
      );
  }
}

function ClubHeadBox({ club }: { club: ClubHead }) {
  return (
    <div className={cardSurface({ class: "grid gap-3 p-4" })}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlaque kuerzel={club.kuerzel} />
        <span
          className="min-w-0 truncate text-base font-semibold"
          title={club.name}>
          {club.website === null ? (
            club.name
          ) : (
            <Link
              href={club.website}
              placement="standalone"
              text={club.name}
            />
          )}
        </span>
      </div>
      <div className="grid gap-0.5 text-sm">
        <span>{club.school}</span>
        <span>
          <Link
            href={club.map}
            placement="detail"
            text={club.address}
          />
        </span>
      </div>
      {club.description !== "" && <ExpandableText>{club.description}</ExpandableText>}
    </div>
  );
}

/** The page once its record is read, in the boundary's place. */
async function ReadBody({ scope, record }: { scope: "saison" | "area"; record: Promise<ReadRecord> }) {
  const { title, chip, spiel, club, groups, acts, actsNote } = await record;
  const [first, ...rest] = groups;
  return (
    <RailPage
      scope={scope}
      title={title}
      chip={chip}>
      <div className={formColumn()}>
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
        {club !== undefined && <ClubHeadBox club={club} />}
        <section className="grid gap-3">
          {first.title !== undefined && <SectionTitle text={first.title} />}
          <GroupBody group={first} />
          {acts !== undefined && acts.length > 0 && (
            <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
              {acts}
              {actsNote !== undefined && <p className="text-sm text-warn lg:basis-full">{actsNote}</p>}
            </div>
          )}
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
 * its pop-up shows, a club's page with the club's head. The first group holds the facts its decision reads, and the decision's acts stand
 * directly under it, together, with the line saying why an act is closed where one is; the next groups
 * follow the reader's next question.
 *
 * The record names the page, so the whole page waits for it in the template's one boundary: meanwhile the
 * strip holds a bar where the title will stand and the column the skeleton of the facts.
 */
export function ReadPage({ scope, record }: { scope: "saison" | "area"; record: Promise<ReadRecord> }) {
  return (
    <Suspense
      fallback={
        <RailPage
          scope={scope}
          title={null}>
          <div className={formColumn()}>
            <Skeleton shape="facts" />
          </div>
        </RailPage>
      }>
      <ReadBody
        scope={scope}
        record={record}
      />
    </Suspense>
  );
}
