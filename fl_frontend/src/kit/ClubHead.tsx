import { cardSurface } from "./cardStyles";
import { ExpandableText } from "./ExpandableText";
import { Link } from "./Link";
import { TeamPlaque } from "./TeamPlaque";

import type { Copy, RecordText } from "@/core/copy";

/**
 * A club's head over its read page: its plaque and its name, a link to its own website where it has one; the
 * school's full name; its address, a link to the map; and its description, three lines until it is opened.
 * It is a module of its own, which only the club's page imports, so a read page with no club head ships none of
 * the description's client code.
 */
export function ClubHead({
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
    <div className={cardSurface({ class: "grid gap-3 p-4" })}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlaque plaque={plaque} />
        <span
          className="min-w-0 truncate text-base font-semibold"
          title={name.record}>
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
