import { cardSurface } from "./cardStyles";
import { ExpandableText } from "./ExpandableText";
import { Link } from "./Link";
import { TeamPlaque } from "./TeamPlaque";

/**
 * A club's head over its read page: its plaque and its name, a link to its own website where it has one; the
 * school's full name; its address, a link to the map; and its description, three lines until it is opened.
 * It is a module of its own, which only the club's page imports, so a read page with no club head ships none of
 * the description's client code.
 */
export function ClubHead({
  kuerzel,
  name,
  website,
  school,
  address,
  map,
  description,
}: {
  kuerzel: string;
  name: string;
  website: `https://${string}` | null;
  school: string;
  address: string;
  map: `https://${string}`;
  description: string;
}) {
  return (
    <div className={cardSurface({ class: "grid gap-3 p-4" })}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlaque kuerzel={kuerzel} />
        <span
          className="min-w-0 truncate text-base font-semibold"
          title={name}>
          {website === null ? (
            name
          ) : (
            <Link
              href={website}
              placement="standalone"
              text={name}
            />
          )}
        </span>
      </div>
      <div className="grid gap-0.5 text-sm">
        <span>{school}</span>
        <span>
          <Link
            href={map}
            placement="detail"
            text={address}
          />
        </span>
      </div>
      {description !== "" && <ExpandableText>{description}</ExpandableText>}
    </div>
  );
}
