import { Suspense } from "react";
import { connection } from "next/server";

import { ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { Accordion, Chip } from "@heroui/react";

import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { getCurrentSaison } from "@/features/saisons/queries";
import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { getTeams } from "@/features/teams/queries";
import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { BrandHero } from "@/shared/components/ui/BrandHero";
import { card } from "@/shared/components/ui/card";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

import { QA_QUESTIONS } from "../../constants";
import { MetaSection } from "../ui/MetaSection";

const TILE = "bg-brand-solid text-brand-solid-foreground flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm";

const CHIP = `${PILL_RADIUS} fluid-xs border px-3 py-1.5 font-bold uppercase transition-[border-color] duration-(--motion-base)`;
// The border answers the hover and not the text: `TeamPopoverMenu`'s trigger already spells
// `hover:text-brand`, which this chip's own `text-foreground` outranks.
const CHIP_AKTIV = `${CHIP} bg-muted border-border text-foreground hover:border-brand`;
// The tint under its `-strong` text grade, never the solid fill under white: a filled chip in a row
// of outlined ones reads as the row's one button.
const CHIP_AUSGETRETEN = `${CHIP} bg-danger/15 border-danger/40 text-danger-strong`;

/** School names of plausible lengths, varied so the row does not read as a barcode. */
const TEAM_CHIP_SKELETON_WIDTHS = ["w-32", "w-24", "w-40", "w-28", "w-36", "w-24", "w-32", "w-28"];

export function AboutView() {
  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-y-8 sm:gap-y-12`}>
      <BrandHero
        title="Über die Liga"
        lead="Alles auf dem Platz. Von Schülern, für Schüler."
      />

      <MetaSection
        eyebrow="Warum es die Liga gibt"
        title="Unser Ziel">
        <div className={`${card()} grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 p-5 sm:p-6 lg:p-8`}>
          <span
            aria-hidden="true"
            className={TILE}>
            <StarFill className="size-5" />
          </span>
          <p className="fluid-base text-foreground leading-relaxed font-medium text-pretty">
            Die Finanzierung unserer Abschlussfeiern und Abibälle. Wir organisieren dafür einen stadtweiten Ligabetrieb im Großfeldfußball.
            Jedes Spiel bringt durch Ticket- und Cateringverkäufe direkte Einnahmen für den ausrichtenden Jahrgang.
          </p>
        </div>
      </MetaSection>

      <MetaSection
        eyebrow="Das Regelwerk"
        title="Fragen und Antworten"
        lead="Wie gespielt wird, wer mitmachen darf und was ein Spiel einbringt.">
        {/* A trigger's hover fill runs the card's full width, so without the clip it paints square
            over the corners. */}
        <div className={`${card()} overflow-hidden`}>
          <Accordion hideSeparator>
            {QA_QUESTIONS.map((item) => (
              <Accordion.Item
                key={item.id}
                className="border-border border-t first:border-t-0">
                <Accordion.Heading>
                  {/* `ring-inset`: HeroUI's focus ring draws outside the trigger's box, which the
                      clip above then takes, leaving a keyboard user no indicator at all. */}
                  <Accordion.Trigger className="fluid-base text-foreground data-hovered:bg-hover flex w-full items-center justify-between gap-x-4 px-5 py-4 font-bold transition-colors ring-inset sm:px-6">
                    <span>{item.q}</span>

                    <Accordion.Indicator className="text-brand shrink-0">
                      <ChevronsDownWide
                        width={20}
                        height={20}
                      />
                    </Accordion.Indicator>
                  </Accordion.Trigger>
                </Accordion.Heading>

                <Accordion.Panel>
                  <Accordion.Body className="fluid-sm text-foreground px-5 pt-0 pb-5 leading-relaxed font-medium text-pretty sm:px-6">
                    {item.a}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </div>
      </MetaSection>

      <MetaSection
        eyebrow="Wer dabei ist"
        title="Aktive Schulen"
        aside={
          <SaisonChip>
            {/* The fallback holds the label's exact box invisibly, so the year landing moves nothing. */}
            <Suspense fallback={<span className="invisible">Saison 0000</span>}>
              <AktuelleSaison />
            </Suspense>
          </SaisonChip>
        }>
        <div className={`${card()} p-5 sm:p-6 lg:p-8`}>
          <Suspense fallback={<TeamChipSkeleton />}>
            <ParticipatingTeamsDisplay />
          </Suspense>
        </div>
      </MetaSection>
    </div>
  );
}

async function AktuelleSaison() {
  await connection();
  const { saison } = await getCurrentSaison();

  return <>Saison {saison.id}</>;
}

function TeamChipSkeleton() {
  return (
    <div
      role="status"
      aria-label="Teams werden geladen"
      className="flex flex-wrap gap-2">
      {TEAM_CHIP_SKELETON_WIDTHS.map((width, i) => (
        // Built from the real chip's own string, so a placeholder is exactly one chip tall at every
        // breakpoint.
        <Chip
          key={i}
          size="md"
          className={`${skeletonBlock()} ${CHIP} border-transparent ${width}`}>
          &nbsp;
        </Chip>
      ))}
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
    <div className="flex flex-wrap gap-2">
      {teamsRes.teams.map((teamData) => (
        <TeamPopoverMenu
          key={teamData.id}
          teamName={teamData.name}
          teamId={teamData.id}
          teamAustritt={teamData.austritt?.type ?? null}>
          <Chip
            size="md"
            className={teamData.austritt !== null ? CHIP_AUSGETRETEN : CHIP_AKTIV}>
            {teamData.name}
          </Chip>
        </TeamPopoverMenu>
      ))}
    </div>
  );
}
