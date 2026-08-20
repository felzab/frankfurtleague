import { Suspense } from "react";
import { connection } from "next/server";

import { Book, ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { Accordion, Card } from "@heroui/react";

import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { getTeams } from "@/features/teams/queries";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

import { QA_QUESTIONS } from "../../constants";

/**
 * School names of plausible lengths, varied so the row does not read as a barcode. `tone="field"`
 * and not the default grey: on the green pitch card `bg-muted` reads as a hole punched in it.
 */
const TEAM_CHIP_SKELETON_WIDTHS = ["w-32", "w-24", "w-40", "w-28", "w-36", "w-24", "w-32", "w-28"];

export function AboutView() {
  return (
    <div className={`${PAGE_RISE} relative flex w-full flex-col items-center gap-y-4 text-left sm:gap-y-8`}>
      <div className="flex flex-col items-center text-center">
        <h1 className="fluid-2xl lg:fluid-3xl text-field-fg font-black tracking-tight uppercase drop-shadow-md">About Frankfurt-League</h1>
        <p className="fluid-sm text-field-fg/80 mt-2 font-medium">Alles auf dem Platz. Von Schülern, für Schüler.</p>
      </div>

      <section className="max-w-meta flex w-full flex-col gap-y-4">
        <div className="text-field-fg flex flex-row items-center gap-x-3">
          <StarFill className="size-6 drop-shadow lg:size-7" />
          <h2 className="fluid-lg font-extrabold tracking-wide uppercase">Unser Ziel</h2>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-6 shadow-xl lg:p-8">
          <p className="fluid-sm text-field-fg/95 leading-relaxed font-medium text-pretty">
            Unser Ziel ist simpel: Die Finanzierung unserer Abschlussfeiern und Abibälle. Anstatt Geld über herkömmliche, wenig lukrative Wege
            zu sammeln, organisieren wir einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe
            direkte Einnahmen für den ausrichtenden Jahrgang. Alles wird auf dem Platz geklärt. Von Schülern, für Schüler.
          </p>
        </div>
      </section>

      <section className="max-w-meta flex w-full flex-col gap-y-4">
        <div className="text-field-fg flex flex-row items-center gap-x-3">
          <Book className="size-6 drop-shadow lg:size-7" />
          <h2 className="fluid-lg font-extrabold tracking-wide uppercase">Das Regelwerk (FAQ)</h2>
        </div>

        {/* Each item is its own bordered card, so the separator would draw a hairline along every
            card's bottom edge instead of dividing the rows of one continuous list. */}
        <Accordion
          hideSeparator
          className="flex flex-col gap-y-3">
          {QA_QUESTIONS.map((item) => (
            <Accordion.Item
              key={item.id}
              className="soccer-field-card-bg soccer-field-card-border overflow-hidden rounded-2xl border shadow-xl">
              <Accordion.Heading>
                {/* No focus classes: `.accordion__trigger` already carries HeroUI's ring in
                    `var(--focus)`, and an `outline-none` over it suppresses the outline for nothing. */}
                <Accordion.Trigger className="fluid-base text-field-fg data-hovered:bg-hover-field flex w-full items-center justify-between gap-x-4 p-6 font-bold transition-colors">
                  <span>{item.q}</span>

                  <Accordion.Indicator className="text-field-fg/60 transition-transform duration-200">
                    <ChevronsDownWide
                      width={20}
                      height={20}
                    />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel className="border-field-fg/10 border-t">
                <Accordion.Body className="text-field-fg/90 p-6 leading-relaxed font-medium">{item.a}</Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>

      <section className="max-w-meta w-full">
        <Card className="soccer-field-card-bg soccer-field-card-border rounded-2xl border shadow-xl">
          <Card.Header className="flex items-center px-6 pt-6 pb-2">
            <Card.Title className="fluid-base text-field-fg font-extrabold tracking-widest uppercase">Aktive Schulen der Saison</Card.Title>
          </Card.Header>
          <Card.Content className="p-6">
            {/* A placeholder chip row and not a line of text, which the card grew past when the real
                names landed. */}
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label="Teams werden geladen"
                  className="flex flex-wrap justify-center gap-2">
                  {TEAM_CHIP_SKELETON_WIDTHS.map((width, i) => (
                    // The real chip's type sizes, padding and border, so a placeholder is exactly one
                    // chip tall at every breakpoint.
                    <span
                      key={i}
                      className={`${skeletonBlock({ tone: "field" })} fluid-xxs sm:fluid-xs border-field-fg/25 inline-block rounded-xl border px-3.5 py-1.5 ${width}`}>
                      &nbsp;
                    </span>
                  ))}
                </div>
              }>
              <ParticipatingTeamsDisplay />
            </Suspense>
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

async function ParticipatingTeamsDisplay() {
  await connection();
  const teamsRes = await getTeams();

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}".`);
  }

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {teamsRes.teams.map((teamData) => (
        <TeamPopoverMenu
          key={teamData.id}
          teamName={teamData.name}
          teamId={teamData.id}
          teamAustritt={teamData.austritt?.type ?? null}>
          <span
            className={`fluid-xxs sm:fluid-xs text-field-fg inline-flex items-center rounded-xl border px-3.5 py-1.5 font-bold tracking-wide uppercase shadow-sm transition-[scale,background-color,border-color] duration-200 active:scale-95 ${
              teamData.austritt !== null
                ? "bg-danger/80 border-danger/40"
                : "border-field-fg/25 bg-field-fg/10 hover:border-field-fg/50 hover:bg-field-fg/20 backdrop-blur-md"
            }`}>
            {teamData.name}
          </span>
        </TeamPopoverMenu>
      ))}
    </div>
  );
}
