import { cardSurface } from "./cardStyles";
import { SpielGroup } from "./SpielGroup";
import { spielColumns, spielSubgrid } from "./SpielRow";

import type { Copy } from "@/core/copy";
import type { SpielRowProps } from "./SpielRow";

/** A group's own box, handing the list's columns on to its match; a container would stop them (`SpielCards`). */
const SPIEL_CARD_CLASSES = cardSurface({ class: `overflow-hidden ${spielSubgrid()}` });

/**
 * A club's matches one under another at every width, each in its own box under its matchday's head, as a team's list
 * draws them and a pupil's own page under its „Spiele“. The list holds the matches' columns (`spielColumns`), so every
 * group's score and sides stand at one x down the list, as a table's rows do, and it is the container whose width picks
 * the rows' form: the one line where the content is wide enough, the card a phone shows below it. The boxes cannot be
 * the containers: a container establishes an independent formatting context, and a grid that does is no subgrid, so the
 * box would drop the columns it hands on.
 */
export function SpielCards({
  groups,
  level = 2,
}: {
  groups: ReadonlyArray<{ head: Copy; spiel: SpielRowProps & { id: string } }>;
  /**
   * Each matchday's head's rung: on a list page it stands directly under the page's title, with no section between;
   * under a read page's group title it takes the rung under that title's.
   */
  level?: 2 | 3;
}) {
  return (
    <div className={spielColumns({ class: "@container gap-y-3" })}>
      {groups.map((group) => (
        <div
          key={group.spiel.id}
          className={SPIEL_CARD_CLASSES}>
          <SpielGroup
            head={group.head}
            spiele={[group.spiel]}
            columns="outer"
            level={level}
          />
        </div>
      ))}
    </div>
  );
}
