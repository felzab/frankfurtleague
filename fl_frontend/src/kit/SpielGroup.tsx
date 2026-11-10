import { stacked } from "./cardStyles";
import { GroupHead, GroupHeadPlaceholder } from "./GroupHead";
import { SpielList, SpielListPlaceholder } from "./SpielRow";

import type { Copy } from "@/core/copy";
import type { SpielRowProps } from "./SpielRow";

/**
 * One match under its head inside a box, such as the season card's last and next match or a club's match under its
 * matchday: the head set as a column head, never part of the row's date line, over the match's row, a hairline
 * parting it from the group above. The box and the order of the groups are the caller's.
 */
export function SpielGroup({ head, spiel }: { head: Copy; spiel: SpielRowProps & { id: string } }) {
  return (
    <section className={stacked()}>
      <GroupHead
        text={head}
        inset="rows"
      />
      <SpielList
        matches={[spiel]}
        bare
      />
    </section>
  );
}

/** One match under its head while it is read: the head's line and the match's row as bars, at the group's own size. */
export function SpielGroupPlaceholder() {
  return (
    <div className={stacked()}>
      <GroupHeadPlaceholder inset="rows" />
      <SpielListPlaceholder
        count={1}
        bare
      />
    </div>
  );
}
