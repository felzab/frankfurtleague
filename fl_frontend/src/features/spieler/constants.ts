import { FLSpielerStufe } from "@/core/generated/client/types";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Words } from "@/core/copy";

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

/**
 * A pupil as a read serves their names, or „anonym“ where it serves none: an erasure took the record, or the public
 * read withholds a name the consent does not publish.
 */
export function spielerName({ first_name, last_name }: { first_name: string | null; last_name: string | null }): Words {
  return first_name === null ? SERVER_COPY.season.spiel.anonymous : { record: kaderName({ first_name, last_name }) };
}
