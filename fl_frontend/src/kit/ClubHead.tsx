import { cardSurface } from "./cardStyles";
import { CutText } from "./CutText";
import { ExpandableText } from "./ExpandableText";
import { Link } from "./Link";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TeamPlaque } from "./TeamPlaque";

import type { Copy, RecordText } from "@/core/copy";

const box = cardSurface({ class: "grid gap-3 p-4" });

/**
 * A club's head while the club is read: its own box, the plaque and the name's line, and the school's and the
 * address's lines, as bars. It draws no description, which a club holds only where someone wrote one.
 */
export function ClubHeadPlaceholder() {
  return (
    <div className={box}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={placeholderBar("h-6 w-10")} />
        <PlaceholderLine
          textClass="flex-1 text-base font-semibold"
          widthClass="w-48 max-w-full"
        />
      </div>
      <div className="grid gap-0.5 text-sm">
        <PlaceholderLine
          textClass="text-sm"
          widthClass="w-2/3"
        />
        <PlaceholderLine
          textClass="text-sm"
          widthClass="w-1/2"
        />
      </div>
    </div>
  );
}

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
    <div className={box}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlaque plaque={plaque} />
        <CutText
          text={name.record}
          className="min-w-0 truncate text-base font-semibold">
          {website === null ? (
            name.record
          ) : (
            <Link
              href={website}
              placement="standalone"
              label={name}
            />
          )}
        </CutText>
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
