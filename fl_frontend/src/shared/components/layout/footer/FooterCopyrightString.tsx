import { connection } from "next/server";

// A Server Component reading the clock at REQUEST time. Under cacheComponents a
// `new Date()` in a client component's build-time SSR corrupts the route's resumable
// state and every public request then 500s. `await connection()` legalises the Date.
export async function FooterCopyrightString() {
  await connection();
  return <p className="fluid-xxs text-foreground-muted">{`© ${new Date().getFullYear()} Frankfurt-League. Alle Rechte vorbehalten.`}</p>;
}
