import { connection } from "next/server";

import { ClassicFrame } from "@/kit/ClassicFrame";

import { INSTAGRAM_URL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { JOIN_SECTION, LEGAL_PAGES, LIGA_PAGES, ROUTES, SAISONLESS_PAGES } from "@/core/routes";
import { SPONSORS } from "@/features/meta/constants";
import { getSaisonFrame } from "@/features/saisons/queries";

import type { HeaderLink } from "@/kit/HeaderLinks";
import type { ReactNode } from "react";

/** The header's two pages of the league's own. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };
const CONTACT = { label: COPY.page.contact, href: ROUTES.contact.path() };

/** The footer's „Saison“ group, at the addresses that read the season on arrival. */
const SAISON_LINKS: ReadonlyArray<HeaderLink> = SAISONLESS_PAGES.map(({ route }) => ({
  label: ROUTES[route].title,
  href: ROUTES[route].path(),
}));

/** The footer's „Liga“ group and the sitemap page's, with the way to applying, which the landing's section words for every state of the window. */
export const LIGA_LINKS: ReadonlyArray<HeaderLink> = [
  ...LIGA_PAGES.map((page) => ({ label: ROUTES[page].title, href: ROUTES[page].path() })),
  { label: COPY.template.bewerbung, href: `${ROUTES.home.path()}#${JOIN_SECTION}` },
  { label: COPY.template.account, href: ROUTES.signIn.path() },
];

/** The legal pages, in the sitemap page's group and, with the sitemap page itself, in the footer's. */
export const LEGAL_LINKS: ReadonlyArray<HeaderLink> = LEGAL_PAGES.map((page) => ({ label: ROUTES[page].title, href: ROUTES[page].path() }));

/**
 * The season the site is on, the header's first entry, read from the frame, the season pages' one source for it, on
 * a request, so the frame's prerendered shell holds none: the image's build reaches no backend.
 */
async function readActiveSaison(): Promise<string | null> {
  await connection();
  const { active_saison_id: active } = await getSaisonFrame();
  return active;
}

/** The classic public frame around a page, as its layout places it. */
export function Classic({ children }: { children: ReactNode }) {
  return (
    <ClassicFrame
      season={readActiveSaison().then((saison): HeaderLink | null =>
        saison === null ? null : { label: COPY.shared.saisonName(saison), href: ROUTES.spielplan.path(saison) },
      )}
      links={[ABOUT, CONTACT]}
      signIn={ROUTES.signIn.path()}
      saison={SAISON_LINKS}
      liga={LIGA_LINKS}
      legal={[...LEGAL_LINKS, { label: ROUTES.sitemap.title, href: ROUTES.sitemap.path() }]}
      social={{ instagram: INSTAGRAM_URL, threads: THREADS_URL }}
      sponsors={SPONSORS}>
      {children}
    </ClassicFrame>
  );
}
