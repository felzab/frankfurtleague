import { connection } from "next/server";

// A Server Component that reads the clock at REQUEST time, not a client component that reads it at
// build time. The distinction is load-bearing under cacheComponents: `new Date()` inside a client
// component's build-time SSR corrupts the route's resumable state, and every request to the four
// public routes then logged "Couldn't find all resumable slots by key/index during replaying" as a
// 500 and threw the prerendered shell away — root-caused by bisection.
// `await connection()` is what makes the Date legal: it marks everything after it as request-time.
// The caller wraps this in <Suspense>, so the year is a streamed hole in the static shell.
export async function FooterCopyrightString() {
  await connection();
  return <p className="text-fluid-xxs text-foreground-muted">{`© ${new Date().getFullYear()} Frankfurt-League. Alle Rechte vorbehalten.`}</p>;
}
