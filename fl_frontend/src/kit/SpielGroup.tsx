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
 * One match under its head inside a box, such as the season card's last and next match or a club's match under its
 * matchday: the head set as a column head, never part of the row's date line, over the match's row, a hairline
 * parting it from the group above. The box and the order of the groups are the caller's; a list of groups whose
 * matches line up holds the columns and hands each group `columns: "outer"`.
 */
export function SpielGroup({ head, spiel, columns = "own" }: { head: Copy; spiel: SpielRowProps & { id: string }; columns?: Columns }) {
  return (
    <section className={groupBox(columns)}>
      <GroupHead
        text={head}
        inset="rows"
      />
      <SpielList
        matches={[spiel]}
        bare
        columns={columns}
      />
    </section>
  );
}

/** One match under its head while it is read: the head's line and the match's row as bars, at the group's own size. */
export function SpielGroupPlaceholder({ columns = "own" }: { columns?: Columns }) {
  return (
    <div className={groupBox(columns)}>
      <GroupHeadPlaceholder inset="rows" />
      <SpielListPlaceholder
        count={1}
        bare
        columns={columns}
      />
    </div>
  );
}
