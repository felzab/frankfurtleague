import { COPY } from "@/core/copy/shared";
import { FLSpielerStufe } from "@/core/generated/client/types";

import type { Copy, Words } from "@/core/copy";
import type { FLSpielerPublic, FLSpielerRolle } from "@/core/generated/client/types";
import type { RolleMarkProps } from "@/kit/RolleMark";
import type { TableHead, TableRow } from "@/kit/Table";

/**
 * A form offers a season's `rules.allowed_stufen`, not this. This is the vocabulary, and the ordering authority a
 * season's list is sorted against so no two seasons order alike.
 */
const STUFE_OPTIONS: readonly FLSpielerStufe[] = Object.values(FLSpielerStufe);

/** A season's allowed levels in the league's own order, so the picker never reads out of sequence. */
export function orderStufen(allowed: readonly FLSpielerStufe[]): FLSpielerStufe[] {
  return STUFE_OPTIONS.filter((stufe) => allowed.includes(stufe));
}

/**
 * A pupil as everyone but the public reads them: the surname whole, never the public initial, and the
 * first name alone where the record holds no surname.
 */
export function kaderName({ first_name, last_name }: { first_name: string; last_name: string | null }): string {
  return last_name === null ? first_name : `${first_name} ${last_name}`;
}

export function rolleMarkOf(rolle: FLSpielerRolle | null): RolleMarkProps | undefined {
  return rolle === null ? undefined : { label: COPY.shared.rolleMark[rolle], spoken: COPY.kader.rolleOption[rolle] };
}

/**
 * A stored shirt number as a figure, `null` where the row wears none or holds one that is not digits alone, as a
 * hand-edited row may: the order the line-up's read sorts its squad by, its `$convert` failing to `null`, so every list
 * orders one squad alike.
 */
export const shirtNumber = (nummer: string | null): number | null => (nummer !== null && /^\d+$/.test(nummer) ? Number(nummer) : null);

export function byShirtNumber(one: { nummer: string | null }, other: { nummer: string | null }): number {
  const [first, second] = [shirtNumber(one.nummer), shirtNumber(other.nummer)];
  if (first === second) return 0;
  return first === null ? 1 : second === null ? -1 : first - second;
}

/**
 * A pupil as a read serves their names, or „anonym“ where it serves none: no record holds the pupil an entry names, or
 * the public read withholds a name the consent does not publish.
 */
export function spielerName({ first_name, last_name }: { first_name: string | null; last_name: string | null }): Words {
  return first_name === null ? COPY.shared.anonymous : { record: kaderName({ first_name, last_name }) };
}

/**
 * A pupil's row in a public table, a match's line-up or a club's squad: a name the consent publishes, with the captain's
 * or the Co-Kapitän's mark after it, else „anonym“, never with a mark, which would say who the nameless pupil is; then
 * their number and position, each left out while the record holds none.
 */
export function publicPupilRow(
  pupil: Pick<FLSpielerPublic, "first_name" | "last_name" | "nummer" | "position" | "rolle">,
): Pick<TableRow, "name" | "mark" | "cells"> {
  const mark = pupil.first_name === null ? undefined : rolleMarkOf(pupil.rolle);
  return {
    name: spielerName(pupil),
    ...(mark === undefined ? {} : { mark }),
    cells: {
      ...(pupil.nummer === null ? {} : { nummer: { record: pupil.nummer } }),
      ...(pupil.position === null ? {} : { position: { record: pupil.position } }),
    },
  };
}

/**
 * The heads of a public pupils' table: the name, then the number and the position, both also on the row's line, which a
 * phone shows in the columns' place, since the row opens nothing. A client module reads this file, so the page hands in
 * the labels from the server's catalogue.
 */
export function publicPupilHead(column: { name: Copy; nummer: Copy; position: Copy }): Pick<TableHead, "nameLabel" | "columns"> {
  return {
    nameLabel: column.name,
    columns: [
      { key: "nummer", label: column.nummer, figures: true, narrow: true, onLine: "labelled", width: "count" },
      { key: "position", label: column.position, hideOnPhone: true, onLine: "value", width: "word" },
    ],
  };
}
