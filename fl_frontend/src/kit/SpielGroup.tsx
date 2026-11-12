import { stacked } from "./cardStyles";
import { GroupHead, GroupHeadPlaceholder } from "./GroupHead";
import { SpielList, SpielListPlaceholder, spielSubgrid } from "./SpielRow";

import type { Copy } from "@/core/copy";
import type { SpielRowProps } from "./SpielRow";

/** Where a group's match takes its columns: its own row's, or, `outer`, the list of groups' (`spielColumns`). */
type Columns = "own" | "outer";

/** The group's box: a part handing on the list of groups' columns, its head across them, where it takes them. */
const groupBox = (columns: Columns) => (columns === "outer" ? spielSubgrid({ class: `${stacked()} *:col-span-full` }) : stacked());

/**
 * Matches under one head inside a box, such as the season card's last and next matches or a club's match under its
 * matchday: the head set as a column head, never part of the rows' date lines, over the matches' rows, a hairline
 * parting it from the group above. The box and the order of the groups are the caller's; a list of groups whose
 * matches line up holds the columns and hands each group `columns: "outer"`.
 */
export function SpielGroup({
  head,
  spiele,
  columns = "own",
}: {
  head: Copy;
  spiele: ReadonlyArray<SpielRowProps & { id: string }>;
  columns?: Columns;
}) {
  return (
    <section className={groupBox(columns)}>
      <GroupHead
        text={head}
        inset="rows"
      />
      <SpielList
        matches={spiele}
        bare
        columns={columns}
      />
    </section>
  );
}

/** Matches under their head while they are read: the head's line and `count` rows as bars, at the group's own size. */
export function SpielGroupPlaceholder({ count = 1, columns = "own" }: { count?: number; columns?: Columns }) {
  return (
    <div className={groupBox(columns)}>
      <GroupHeadPlaceholder inset="rows" />
      <SpielListPlaceholder
        count={count}
        bare
        columns={columns}
      />
    </div>
  );
}
