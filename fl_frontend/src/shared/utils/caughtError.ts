/**
 * What an error boundary caught, as the `Error` and digest its panel reads. Next types the value
 * `unknown` in `error.tsx` and in a `catchError` fallback alike: a Server Component's error arrives
 * as an `Error`, while a Client Component's throw is passed on as it was thrown.
 */
export function asCaughtError(thrown: unknown): Error & { digest?: string } {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}
