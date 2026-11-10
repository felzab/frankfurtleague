import { COPY } from "@/core/copy";
import { FLSpielerStufe } from "@/core/generated/client/types";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Words } from "@/core/copy";
import type { FLSpielerRolle } from "@/core/generated/client/types";
import type { RoleMarkProps } from "@/kit/RoleMark";

/**
 * **A form offers a SEASON's `rules.allowed_stufen`, not this.** This is the vocabulary, and the
 * ordering authority a season's list is sorted against so no two seasons order alike.
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

/** The captain's or the Co-Kapitän's boxed mark after a pupil's name, where their squad row holds either role. */
export function roleMarkOf(rolle: FLSpielerRolle | null): RoleMarkProps | undefined {
  return rolle === null ? undefined : { letters: COPY.shared.rolleMark[rolle], label: COPY.admin.spieler.rolleOption[rolle] };
}

/**
 * A stored shirt number as a figure, `null` where the row wears none or holds one that is not digits alone, as a
 * hand-edited row may: the order the line-up's read sorts its squad by (`$convert` with `onError: null` in
 * `fl_backend/app/api/aufstellungen/services.py :: build_aufstellung_kader_pipeline`), so every list orders one squad alike.
 */
export const shirtNumber = (nummer: string | null): number | null => (nummer !== null && /^\d+$/.test(nummer) ? Number(nummer) : null);

/** Two squad rows in shirt-number order, a row wearing no number after every numbered one, the read's order kept between equals. */
export function byShirtNumber(one: { nummer: string | null }, other: { nummer: string | null }): number {
  const [first, second] = [shirtNumber(one.nummer), shirtNumber(other.nummer)];
  if (first === second) return 0;
  return first === null ? 1 : second === null ? -1 : first - second;
}

/**
 * A pupil as a read serves their names, or „anonym“ where it serves none: an erasure took the record, or the public
 * read withholds a name the consent does not publish.
 */
export function spielerName({ first_name, last_name }: { first_name: string | null; last_name: string | null }): Words {
  return first_name === null ? SERVER_COPY.season.spiel.anonymous : { record: kaderName({ first_name, last_name }) };
}
