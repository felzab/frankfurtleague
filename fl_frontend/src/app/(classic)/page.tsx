import { connection } from "next/server";

import { Doors } from "@/kit/Doors";
import { EmptyState } from "@/kit/EmptyState";
import { InfoCards } from "@/kit/InfoCards";
import { OrganizationJsonLd } from "@/kit/JsonLd";
import { LandingPage } from "@/kit/LandingPage";
import { LandingSection } from "@/kit/LandingSection";
import { Organisers } from "@/kit/Organisers";
import { Pillars } from "@/kit/Pillars";
import { SaisonBlock } from "@/kit/SaisonBlock";
import { StatTiles } from "@/kit/StatTiles";
import { Steps } from "@/kit/Steps";
import { StepsLine } from "@/kit/StepsLine";
import { SchoolTiles, SponsorTiles } from "@/kit/TileGrid";

import { INSTAGRAM_URL, KONTAKT_EMAIL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/bewerbungen/constants";
import { ORGANISERS, SPONSORS } from "@/features/meta/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import { formOf, readLanding, stateOf } from "./landing";

import type { CalendarDay } from "@/core/format";
import type { FLBewerbungWindow, FLLandingSaison } from "@/core/generated/client/types";
import type { LandingContent } from "@/kit/LandingPage";
import type { Metadata, ResolvingMetadata, Route } from "next";
import type { ComponentProps, ReactNode } from "react";

const words = SERVER_COPY.landing;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.home, ROUTES.home.path(), { description: SERVER_COPY.description.home });
}

/** The way to the league's own page, which stands where applying would while no window is open. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };

/** The question's door: the league's address and its two networks (D247, D481). */
const QUESTION: ComponentProps<typeof Doors>["question"] = {
  ...words.doors.question,
  email: { label: words.contact.email, href: `mailto:${KONTAKT_EMAIL}` as Route, glyph: "email" },
  instagram: INSTAGRAM_URL as Route,
  threads: THREADS_URL as Route,
};

/** The season's card, or the one sentence that the league has none yet. */
function asideOf(saison: FLLandingSaison | null, window: FLBewerbungWindow | null): ReactNode {
  if (saison === null) {
    return window === null ? (
      <EmptyState
        kind="none"
        plural={COPY.shared.saison}
      />
    ) : (
      <SaisonBlock
        title={COPY.shared.saisonName(window.saison_id)}
        state={{ kind: "window", until: window.bis as CalendarDay, apply: formOf(window) }}
      />
    );
  }
  return (
    <SaisonBlock
      title={COPY.shared.saisonName(saison.id)}
      more={{ label: words.saison.toSpielplan, href: ROUTES.spielplan.path(saison.id) }}
      state={stateOf(saison)}
    />
  );
}

/** The sections under the hero; the season's figures and schools only while the league has a season. */
function sectionsOf(saison: FLLandingSaison | null, window: FLBewerbungWindow | null): ReactNode {
  return (
    <>
      <LandingSection
        eyebrow={words.pillars.eyebrow}
        title={words.pillars.title}>
        <Pillars
          items={[
            { glyph: "pupils", ...words.about.who },
            { glyph: "play", ...words.about.rules },
            { glyph: "proceeds", ...words.about.purpose },
          ]}
        />
      </LandingSection>
      <LandingSection
        eyebrow={words.join.eyebrow}
        title={words.join.title}>
        <Steps
          items={[
            words.join.apply,
            { title: words.join.confirm.title, text: words.join.confirm.text(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE) },
            words.join.decision,
            words.join.register,
          ]}
          band={
            window === null
              ? { open: false, sentence: words.join.closed, act: ABOUT }
              : {
                  open: true,
                  sentence: words.join.open(window.saison_id, window.bis as CalendarDay),
                  act: { label: words.toBewerbung, href: formOf(window) },
                }
          }
        />
      </LandingSection>
      <LandingSection
        eyebrow={words.season.eyebrow}
        title={words.season.title}>
        <StepsLine
          items={[
            { title: COPY.shared.phase.gruppenphase, text: words.season.gruppenphase },
            { title: COPY.shared.kORunde, text: words.season.kORunde },
            { title: SERVER_COPY.season.thirdPlace, text: words.season.platz3 },
            { title: COPY.shared.phase.finale, text: words.season.finale },
          ]}
        />
        <InfoCards items={[words.about.spielorte, words.about.admission, words.about.safety]} />
      </LandingSection>
      {saison !== null && (
        <LandingSection title={words.figures.title(saison.id)}>
          <StatTiles
            layout="four"
            items={[
              { label: words.figures.schulen, value: { record: formatNumber(saison.teams.length) } },
              { label: words.figures.tore, value: { record: formatNumber(saison.counts.count_tore) } },
              { label: words.figures.spiele, value: { record: formatNumber(saison.counts.count_spiele) } },
              { label: words.figures.spieltage, value: { record: formatNumber(saison.counts.count_spieltage) } },
            ]}
          />
        </LandingSection>
      )}
      <LandingSection
        eyebrow={words.organisers.eyebrow}
        title={words.organisers.title}
        more={ABOUT}>
        <Organisers people={ORGANISERS.map((person) => ({ name: { record: person.name }, role: words.organisers.role[person.role] }))} />
      </LandingSection>
      <LandingSection
        title={COPY.page.sponsors}
        more={{ label: COPY.page.sponsors, href: ROUTES.sponsors.path() }}>
        <SponsorTiles sponsors={SPONSORS} />
      </LandingSection>
      <Doors
        eyebrow={words.doors.eyebrow}
        school={
          window === null
            ? undefined
            : {
                title: words.doors.school.title,
                // The date stands on the join band and the season card, each fact once: the door says only that the window is open.
                text: words.join.opened,
                act: { label: words.toBewerbung, href: formOf(window) },
              }
        }
        question={QUESTION}
      />
      {saison !== null && saison.teams.length > 0 && (
        <LandingSection
          eyebrow={words.schools.eyebrow}
          title={words.schools.title(saison.id)}
          more={{ label: COPY.page.teams, href: ROUTES.teams.path(saison.id) }}>
          <SchoolTiles
            schools={saison.teams.map((team) => ({
              name: { record: team.name },
              plaque: { record: team.shorthand },
              href: ROUTES.team.path(saison.id, team.id),
            }))}
          />
        </LandingSection>
      )}
    </>
  );
}

/** What the landing reads, on a request: the countdown seeds from the server's clock, and the build reaches no backend. */
async function contentOf(): Promise<LandingContent> {
  await connection();
  const { saison, bewerbung_window: window } = await readLanding();
  return {
    secondary: window === null ? ABOUT : { label: words.toBewerbung, href: formOf(window) },
    aside: asideOf(saison, window),
    sections: sectionsOf(saison, window),
  };
}

/** The landing: the league in one screen, then how it works, who runs it and the ways in (D207, D226 to D231, D247). */
export default function HomePage() {
  return (
    <>
      <OrganizationJsonLd />
      <LandingPage
        title={words.tagline}
        lead={words.paragraph}
        primary={{ label: COPY.page.spielplan, href: ROUTES.saisons.path() }}
        content={contentOf()}
      />
    </>
  );
}
