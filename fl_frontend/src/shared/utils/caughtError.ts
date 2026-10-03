/**
 * What a `catchError` fallback was handed, as the `error.tsx` convention hands it. Next types the
 * caught value `unknown`, a throw being free to be anything, where an area's panel reads an
 * `Error` and the digest a server error carries.
 */
export function asCaughtError(thrown: unknown): Error & { digest?: string } {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}
