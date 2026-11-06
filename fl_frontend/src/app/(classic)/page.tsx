import { connection } from "next/server";

import { Doors } from "@/kit/Doors";
import { EmptyState } from "@/kit/EmptyState";
import { InfoCards } from "@/kit/InfoCards";
import { OrganizationJsonLd } from "@/kit/JsonLd";
import { LandingPage } from "@/kit/LandingPage";
import { LandingSection, LandingSectionPlaceholder, LandingSectionWait } from "@/kit/LandingSection";
import { Organisers } from "@/kit/Organisers";
import { Pillars } from "@/kit/Pillars";
import { SaisonBlock } from "@/kit/SaisonBlock";
import { StatTiles, StatTilesPlaceholder } from "@/kit/StatTiles";
import { Steps } from "@/kit/Steps";
import { StepsLine } from "@/kit/StepsLine";
import { SchoolTiles, SchoolTilesPlaceholder, SponsorTiles } from "@/kit/TileGrid";

import { INSTAGRAM_URL, KONTAKT_MAILTO, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { dayOf, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/bewerbungen/constants";
import { ORGANISERS, SPONSORS } from "@/features/meta/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import { readLanding, stateOf } from "./landing";

import type { FLBewerbungWindow, FLLandingResponse } from "@/core/generated/client/types";
import type { LandingContent } from "@/kit/LandingPage";
import type { Metadata, ResolvingMetadata } from "next";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { LandingSaison } from "./landing";

const words = SERVER_COPY.landing;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.home, ROUTES.home.path(), { description: SERVER_COPY.description.home });
}

/** The way to the league's own page, which stands where applying would while no window is open. */
const ABOUT = { label: COPY.page.about, href: ROUTES.about.path() };

/** What the doors say in every state, which is all they say while no window is open. */
const DOORS: Pick<ComponentProps<typeof Doors>, "eyebrow" | "more" | "question"> = {
  eyebrow: words.doors.eyebrow,
  more: { label: COPY.page.contact, href: ROUTES.contact.path() },
  // The question's door: the league's address and its two networks.
  question: {
    ...words.doors.question,
    email: { label: words.contact.email, href: KONTAKT_MAILTO },
    instagram: INSTAGRAM_URL,
    threads: THREADS_URL,
  },
};

/** The landing's read, on a request: the countdown seeds from the server's clock, and the build reaches no backend. */
async function readOnRequest(): Promise<FLLandingResponse> {
  await connection();
  return readLanding();
}

/** The season's card, or the one sentence that the league has none yet. */
function asideOf(saison: LandingSaison | null, window: FLBewerbungWindow | null): ReactElement {
  if (saison === null) {
    return window === null ? (
      <EmptyState
        kind="none"
        plural={COPY.shared.saison}
      />
    ) : (
      <SaisonBlock
        title={COPY.shared.saisonName(window.saison_id)}
        state={{ kind: "window", until: dayOf(window.end), apply: ROUTES.bewerbung.path(window.saison_id) }}
      />
    );
  }
  return (
    <SaisonBlock
      title={COPY.shared.saisonName(saison.id)}
      state={stateOf(saison)}
    />
  );
}

/** The hero's two ways on and the season's card. */
async function heroOf(read: Promise<FLLandingResponse>): Promise<LandingContent> {
  const { saison, bewerbung_window: window } = await read;
  return {
    // The season's own Spielplan, the address the header's season entry takes, so the press lands in one hop;
    // `/saisons` only while the league has no season, where it shows the card saying so rather than redirecting.
    primary: { label: COPY.page.spielplan, href: saison === null ? ROUTES.saisons.path() : ROUTES.spielplan.path(saison.id) },
    secondary: window === null ? ABOUT : { label: words.toBewerbung, href: ROUTES.bewerbung.path(window.saison_id) },
    aside: asideOf(saison, window),
  };
}

/** The band under the steps, with the application window's state. */
async function bandOf(read: Promise<FLLandingResponse>): ComponentProps<typeof Steps>["band"] {
  const { bewerbung_window: window } = await read;
  return window === null
    ? { open: false, sentence: words.join.closed, act: ABOUT }
    : {
        open: true,
        sentence: words.saison.windowUntil(dayOf(window.end)),
        act: { label: words.toBewerbung, href: ROUTES.bewerbung.path(window.saison_id) },
      };
}

/** The league's figures, once a season is read by the public. */
async function figuresOf(read: Promise<FLLandingResponse>): Promise<ReactNode> {
  const { counts } = await read;
  if (counts.count_saisons === 0) return null;
  return (
    <LandingSection
      eyebrow={words.figures.eyebrow}
      title={words.figures.title}>
      <StatTiles
        layout="four"
        items={[
          { label: words.figures.saisons, value: { record: formatNumber(counts.count_saisons) } },
          { label: words.figures.schulen, value: { record: formatNumber(counts.count_schulen) } },
          { label: words.figures.spiele, value: { record: formatNumber(counts.count_spiele) } },
          { label: words.figures.tore, value: { record: formatNumber(counts.count_tore) } },
        ]}
      />
    </LandingSection>
  );
}

/** The ways in: the school's door joins the question's while a window is open. */
async function doorsOf(read: Promise<FLLandingResponse>): Promise<ReactNode> {
  const { bewerbung_window: window } = await read;
  return (
    <Doors
      {...DOORS}
      school={
        window === null
          ? undefined
          : {
              title: words.doors.school.title,
              // The date stands on the join band and the season card, each fact once: the door says only that the window is open.
              text: words.join.opened,
              act: { label: words.toBewerbung, href: ROUTES.bewerbung.path(window.saison_id) },
            }
      }
    />
  );
}

/** The schools, while the league has a season on with teams in it. */
async function schoolsOf(read: Promise<FLLandingResponse>): Promise<ReactNode> {
  const { saison } = await read;
  if (saison === null || saison.teams.length === 0) return null;
  return (
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
  );
}

/** The sections under the hero: what the page knows stands at once, and what the read decides waits in its own place. */
function sectionsOf(read: Promise<FLLandingResponse>): ReactNode {
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
          band={bandOf(read)}
          closed={words.join.closed}
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
      <LandingSectionWait
        block={figuresOf(read)}
        fallback={
          <LandingSectionPlaceholder>
            <StatTilesPlaceholder
              layout="four"
              line={false}
            />
          </LandingSectionPlaceholder>
        }
      />
      <LandingSection
        eyebrow={words.organisers.eyebrow}
        title={words.organisers.title}
        more={ABOUT}>
        <Organisers people={ORGANISERS.map((person) => ({ name: { record: person.name }, role: words.organisers.role[person.role] }))} />
      </LandingSection>
      <LandingSection
        eyebrow={words.sponsors.eyebrow}
        title={COPY.page.sponsors}
        more={{ label: COPY.page.sponsors, href: ROUTES.sponsors.path() }}>
        <SponsorTiles sponsors={SPONSORS} />
      </LandingSection>
      <LandingSectionWait
        block={doorsOf(read)}
        fallback={<Doors {...DOORS} />}
      />
      <LandingSectionWait
        block={schoolsOf(read)}
        fallback={
          <LandingSectionPlaceholder more={COPY.page.teams}>
            <SchoolTilesPlaceholder count={8} />
          </LandingSectionPlaceholder>
        }
      />
    </>
  );
}

/** The landing: the league in one screen, then how it works, who runs it and the ways in. */
export default function HomePage() {
  const read = readOnRequest();
  return (
    <>
      <OrganizationJsonLd />
      <LandingPage
        title={words.tagline}
        lead={words.paragraphs}
        content={heroOf(read)}
        sections={sectionsOf(read)}
      />
    </>
  );
}
