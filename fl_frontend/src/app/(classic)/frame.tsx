import { connection } from "next/server";

import { ClassicFrame } from "@/kit/ClassicFrame";

import { INSTAGRAM_URL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES, SAISON_PAGES } from "@/core/routes";
import { SPONSORS } from "@/features/meta/constants";
import { getSaisonFrame } from "@/features/saisons/queries";

import type { HeaderLink } from "@/kit/HeaderLinks";
import type { ReactNode } from "react";

/** The league's own pages: the header's two and the footer's „Liga“ group, and the footer's legal pages. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };
const CONTACT = { label: COPY.page.contact, href: ROUTES.contact.path() };
const LEGAL_NOTICE = { label: COPY.page.legalNotice, href: ROUTES.legalNotice.path() };
const PRIVACY_NOTICE = { label: COPY.page.privacyNotice, href: ROUTES.privacyNotice.path() };

/**
 * The season the site is on, read from the frame, the season pages' one source for it, on a request, so the
 * frame's prerendered shell holds none: the image's build reaches no backend.
 */
async function readActiveSaison(): Promise<string | null> {
  await connection();
  const { active_saison_id: active } = await getSaisonFrame();
  return active;
}

/**
 * The classic public frame around a page, as its layout places it and as the root's not-found page, which
 * renders under the root layout alone, places it again. The season the site is on is read once, for the
 * header's first entry, its name leading to its Spielplan, and for the footer's „Saison“ group of its pages.
 */
export function Classic({ children }: { children: ReactNode }) {
  const active = readActiveSaison();
  return (
    <ClassicFrame
      season={active.then((saison): HeaderLink | null =>
        saison === null ? null : { label: COPY.shared.saisonName(saison), href: ROUTES.spielplan.path(saison) },
      )}
      links={[ABOUT, CONTACT]}
      signIn={ROUTES.signIn.path()}
      seasonPages={active.then((saison) =>
        saison === null ? null : SAISON_PAGES.map((page) => ({ label: ROUTES[page].title, href: ROUTES[page].path(saison) })),
      )}
      liga={[ABOUT, CONTACT]}
      legal={[LEGAL_NOTICE, PRIVACY_NOTICE]}
      social={{ instagram: INSTAGRAM_URL, threads: THREADS_URL }}
      sponsors={SPONSORS}>
      {children}
    </ClassicFrame>
  );
}
