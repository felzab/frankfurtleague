import { cardSurface } from "./cardStyles";
import { ExpandableText } from "./ExpandableText";
import { Link } from "./Link";
import { TeamPlaque } from "./TeamPlaque";

import type { Copy, RecordText } from "@/core/copy";

const box = cardSurface({ class: "grid gap-3 p-4" });

/**
 * A club's head over its read page: its plaque and its name, a link to its own website where it has one, wrapping
 * where it is long as the team area's head does, since what a cut name hides no touch can reach; the school's full
 * name; its address, a link to the map; and its description, three lines until it is opened. The name is no heading:
 * the page's own title names the club.
 * It is a module of its own, which only the club's page imports, so a read page with no club head ships none of
 * the description's client code.
 */
export function TeamProfileHead({
  plaque,
  name,
  website,
  school,
  address,
  map,
  description,
}: {
  plaque: RecordText;
  name: RecordText;
  website: `https://${string}` | null;
  school: RecordText;
  address: Copy;
  map: `https://${string}`;
  description: RecordText;
}) {
  return (
    <div className={box}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlaque plaque={plaque} />
        <span className="min-w-0 text-base font-semibold break-words">
          {website === null ? (
            name.record
          ) : (
            <Link
              href={website}
              placement="standalone"
              label={name}
            />
          )}
        </span>
      </div>
      <div className="grid gap-0.5 text-sm">
        <span>{school.record}</span>
        <span>
          <Link
            href={map}
            placement="detail"
            label={address}
          />
        </span>
      </div>
      {description.record !== "" && <ExpandableText text={description} />}
    </div>
  );
}
