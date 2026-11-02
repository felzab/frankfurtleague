import { connection } from "next/server";

import { ClassicFrame } from "@/kit/ClassicFrame";

import { INSTAGRAM_URL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SPONSORS } from "@/features/meta/constants";
import { getActiveSaisonOrNull } from "@/features/saisons/queries";

import type { HeaderLink } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/** The league's own pages: the header's two, and the footer's group with the legal pages. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };
const CONTACT = { label: COPY.page.contact, href: ROUTES.contact.path() };
const LEGAL_NOTICE = { label: COPY.page.legalNotice, href: ROUTES.legalNotice.path() };
const PRIVACY_NOTICE = { label: COPY.page.privacyNotice, href: ROUTES.privacyNotice.path() };

/**
 * The season the site is on, as the header's first entry: its name, leading to its Spielplan. Read on a request,
 * so the frame's prerendered shell holds none: the image's build reaches no backend.
 */
async function readSeasonEntry(): Promise<HeaderLink | null> {
  await connection();
  const active = await getActiveSaisonOrNull();
  if (active === null) return null;
  return { label: COPY.shared.saisonName(active.saison.id), href: ROUTES.spielplan.path(active.saison.id) };
}

/**
 * The classic public frame around a page, as its layout places it and as the root's not-found page, which
 * renders under the root layout alone, places it again.
 */
export function Classic({ children }: { children: ReactNode }) {
  return (
    <ClassicFrame
      season={readSeasonEntry()}
      links={[ABOUT, CONTACT]}
      signIn={ROUTES.signIn.path()}
      groups={[]}
      liga={[ABOUT, CONTACT, LEGAL_NOTICE, PRIVACY_NOTICE]}
      social={{ instagram: INSTAGRAM_URL, threads: THREADS_URL }}
      sponsors={SPONSORS}>
      {children}
    </ClassicFrame>
  );
}
