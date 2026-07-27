import { Suspense } from "react";
import { connection } from "next/server";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { getTeams } from "@/features/teams/queries";
import { Book, ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { Accordion, Card } from "@heroui/react";

import { QA_QUESTIONS } from "../../constants";

export default function AboutView() {
  return (
    <div className="relative flex w-full flex-col items-center gap-y-12 text-left">
      {/** Headline */}
      <div className="flex flex-col items-center text-center">
        <h2 className="text-fluid-2xl lg:text-fluid-3xl font-black tracking-tight text-white uppercase drop-shadow-md">
          About Frankfurt-League
        </h2>
        <p className="text-fluid-sm mt-2 font-medium text-white/80">Alles auf dem Platz – von Schülern, für Schüler.</p>
      </div>

      {/** Section 1: Unser Ziel */}
      <section className="flex w-full max-w-[1100px] flex-col gap-y-4">
        <div className="flex flex-row items-center gap-x-3 text-white">
          <StarFill className="size-6 drop-shadow lg:size-7" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Unser Ziel</h3>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-6 shadow-xl backdrop-blur-sm lg:p-8">
          <p className="text-fluid-sm leading-relaxed font-medium text-pretty text-white/95">
            Unser Ziel ist simpel: Die Finanzierung unserer Abschlussfeiern und Abibälle. Anstatt Geld über herkömmliche, wenig lukrative Wege
            zu sammeln, organisieren wir einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe
            direkte Einnahmen für den ausrichtenden Jahrgang. Alles wird auf dem Platz geklärt – von Schülern, für Schüler.
          </p>
        </div>
      </section>

      {/** Section 2: Das Regelwerk */}
      <section className="flex w-full max-w-[1100px] flex-col gap-y-4">
        <div className="flex flex-row items-center gap-x-3 text-white">
          <Book className="size-6 drop-shadow lg:size-7" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Das Regelwerk (FAQ)</h3>
        </div>

        {/** Q/A */}
        <Accordion className="flex flex-col gap-y-3">
          {QA_QUESTIONS.map((item) => (
            <Accordion.Item
              key={item.id}
              className="soccer-field-card-bg soccer-field-card-border overflow-hidden rounded-2xl border shadow-lg backdrop-blur-sm">
              <Accordion.Heading>
                <Accordion.Trigger className="text-fluid-base flex w-full items-center justify-between gap-x-4 p-6 font-bold text-white transition-colors outline-none hover:bg-white/5">
                  <span>{item.q}</span>

                  <Accordion.Indicator className="text-white/60 transition-transform duration-200">
                    <ChevronsDownWide
                      width={20}
                      height={20}
                    />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel className="border-t border-white/10">
                <Accordion.Body className="p-6 leading-relaxed font-medium text-white/90">{item.a}</Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>

      {/** Section 3: Active schools */}
      <section className="w-full max-w-[1100px]">
        <Card className="soccer-field-card-bg soccer-field-card-border rounded-2xl border shadow-2xl backdrop-blur-sm">
          <Card.Header className="flex items-center px-6 pt-6 pb-2">
            <Card.Title className="text-fluid-base font-extrabold tracking-widest text-white uppercase">Aktive Schulen der Saison</Card.Title>
          </Card.Header>
          <Card.Content className="p-6">
            <Suspense fallback={<span className="text-fluid-sm text-white/70">Teams laden...</span>}>
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
  const teamsRes = await getTeams({ compact: true });

  if (teamsRes.format !== "compact") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {teamsRes.teams.map((teamData) => (
        <TeamPopoverMenu
          key={teamData.id}
          teamName={teamData.name}
          teamId={teamData.id}
          teamShorthand={teamData.shorthand}
          teamIsDisqualified={teamData.is_disqualified}>
          <span
            className={`text-fluid-xxs sm:text-fluid-xs inline-flex items-center rounded-xl border px-3.5 py-1.5 font-bold tracking-wide text-white uppercase shadow-sm transition-all duration-200 hover:scale-105 active:scale-95 ${
              teamData.is_disqualified
                ? "bg-danger/80 border-danger/40"
                : "border-white/25 bg-white/10 backdrop-blur-md hover:border-white/50 hover:bg-white/20"
            }`}>
            {teamData.name}
          </span>
        </TeamPopoverMenu>
      ))}
    </div>
  );
}
