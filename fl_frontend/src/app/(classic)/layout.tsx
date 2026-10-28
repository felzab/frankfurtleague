import { ClassicFrame } from "@/kit/ClassicFrame";

import { INSTAGRAM_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

/** The league's pages every classic page links to: the header's two, and the footer's group with the legal pages. */
const ABOUT = { label: COPY.seite.about, href: ROUTES.about.pfad() };
const KONTAKT = { label: COPY.seite.kontakt, href: ROUTES.kontakt.pfad() };
const IMPRESSUM = { label: COPY.seite.impressum, href: ROUTES.impressum.pfad() };
const DATENSCHUTZ = { label: COPY.seite.datenschutz, href: ROUTES.datenschutz.pfad() };

/** The league's Threads profile, as today's footer links it. */
const THREADS_URL = "https://www.threads.com/@frankfurt.league";

/**
 * The classic public frame around the pages it holds: the sign-in today. No sponsor is listed yet, so the
 * footer shows none of their logos.
 */
export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClassicFrame
      links={[ABOUT, KONTAKT]}
      anmelden="/signin"
      groups={[]}
      liga={[ABOUT, KONTAKT, IMPRESSUM, DATENSCHUTZ]}
      social={{ instagram: INSTAGRAM_URL, threads: THREADS_URL }}
      sponsors={[]}>
      {children}
    </ClassicFrame>
  );
}
