import { Suspense } from "react";
import { connection } from "next/server";

import { Book, ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { Accordion, Card } from "@heroui/react";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { getTeams } from "@/features/teams/queries";

import { QA_QUESTIONS } from "../../constants";

export default function AboutView() {
  return (
    <div className="relative flex w-full flex-col items-center gap-y-12 text-left">
      {/** Headline */}
      <div className="flex flex-col items-center text-center">
        <h2 className="text-fluid-2xl lg:text-fluid-3xl text-field-fg font-black tracking-tight uppercase drop-shadow-md">
          About Frankfurt-League
        </h2>
        <p className="text-fluid-sm text-field-fg/80 mt-2 font-medium">Alles auf dem Platz – von Schülern, für Schüler.</p>
      </div>

      {/** Section 1: Unser Ziel */}
      <section className="max-w-meta flex w-full flex-col gap-y-4">
        <div className="text-field-fg flex flex-row items-center gap-x-3">
          <StarFill className="size-6 drop-shadow lg:size-7" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Unser Ziel</h3>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-6 shadow-xl lg:p-8">
          <p className="text-fluid-sm text-field-fg/95 leading-relaxed font-medium text-pretty">
            Unser Ziel ist simpel: Die Finanzierung unserer Abschlussfeiern und Abibälle. Anstatt Geld über herkömmliche, wenig lukrative Wege
            zu sammeln, organisieren wir einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe
            direkte Einnahmen für den ausrichtenden Jahrgang. Alles wird auf dem Platz geklärt – von Schülern, für Schüler.
          </p>
        </div>
      </section>

      {/** Section 2: Das Regelwerk */}
      <section className="max-w-meta flex w-full flex-col gap-y-4">
        <div className="text-field-fg flex flex-row items-center gap-x-3">
          <Book className="size-6 drop-shadow lg:size-7" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Das Regelwerk (FAQ)</h3>
        </div>

        {/** Q/A */}
        <Accordion className="flex flex-col gap-y-3">
          {QA_QUESTIONS.map((item) => (
            <Accordion.Item
              key={item.id}
              className="soccer-field-card-bg soccer-field-card-border overflow-hidden rounded-2xl border shadow-xl">
              <Accordion.Heading>
                <Accordion.Trigger className="text-fluid-base text-field-fg hover:bg-field-fg/5 flex w-full items-center justify-between gap-x-4 p-6 font-bold transition-colors outline-none">
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

      {/** Section 3: Active schools */}
      <section className="max-w-meta w-full">
        <Card className="soccer-field-card-bg soccer-field-card-border rounded-2xl border shadow-xl">
          <Card.Header className="flex items-center px-6 pt-6 pb-2">
            <Card.Title className="text-fluid-base text-field-fg font-extrabold tracking-widest uppercase">
              Aktive Schulen der Saison
            </Card.Title>
          </Card.Header>
          <Card.Content className="p-6">
            <Suspense fallback={<span className="text-fluid-sm text-field-fg/70">Teams laden...</span>}>
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
            className={`text-fluid-xxs sm:text-fluid-xs text-field-fg hover:scale-hover inline-flex items-center rounded-xl border px-3.5 py-1.5 font-bold tracking-wide uppercase shadow-sm transition-all duration-200 active:scale-95 ${
              teamData.is_disqualified
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
