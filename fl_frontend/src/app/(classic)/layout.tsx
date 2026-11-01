import { ClassicFrame } from "@/kit/ClassicFrame";

import { INSTAGRAM_URL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

/** The league's pages every classic page links to: the header's two, and the footer's group with the legal pages. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };
const KONTAKT = { label: COPY.page.kontakt, href: ROUTES.contact.path() };
const IMPRESSUM = { label: COPY.page.impressum, href: ROUTES.legalNotice.path() };
const DATENSCHUTZ = { label: COPY.page.datenschutz, href: ROUTES.privacyNotice.path() };

/**
 * The classic public frame around the pages it holds: the sign-in today. No sponsor is listed yet, so the
 * footer shows none of their logos.
 */
export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClassicFrame
      links={[ABOUT, KONTAKT]}
      signIn={ROUTES.signIn.path()}
      groups={[]}
      liga={[ABOUT, KONTAKT, IMPRESSUM, DATENSCHUTZ]}
      social={{ instagram: INSTAGRAM_URL, threads: THREADS_URL }}
      sponsors={[]}>
      {children}
    </ClassicFrame>
  );
}
