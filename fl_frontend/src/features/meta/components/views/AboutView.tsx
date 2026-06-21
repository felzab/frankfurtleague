import { Suspense } from "react";
import { connection } from "next/server";

import { getTeams } from "@/features/teams/queries";
import { Book, ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { Accordion, Card, Separator } from "@heroui/react";

import { QA_QUESTIONS } from "../../constants";

export default function AboutView() {
  return (
    <div className="relative flex flex-col items-center gap-y-10 py-30 text-left lg:py-44">
      {/** Headline */}
      <h2 className="text-fluid-xl xl:text-fluid-3xl font-extrabold tracking-tighter uppercase">About Frankfurt-League</h2>

      <Separator className="soccer-field-separator" />

      {/** Section 1: Unser Ziel */}
      <section className="items-left flex w-[90%] flex-col gap-y-4 lg:w-[80%]">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <StarFill className="h-[22px] w-[22px] lg:h-[30px] lg:w-[30px]" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Unser Ziel</h3>
        </div>

        <p className="text-fluid-md soccer-field-card-bg w-full rounded-2xl px-6 py-4 font-medium text-pretty shadow-xl lg:p-6">
          Unser Ziel ist simpel: Die Finanzierung unserer Abschlussfeiern und Abibälle. Anstatt Geld über herkömmliche, wenig lukrative Wege zu
          sammeln, organisieren wir einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe
          direkte Einnahmen für den ausrichtenden Jahrgang. Alles wird auf dem Platz geklärt – von Schülern, für Schüler.
        </p>
      </section>

      <Separator className="soccer-field-separator" />

      {/** Section 2: Das Regelwerk */}
      <section className="items-left flex w-[90%] flex-col gap-y-4 lg:w-[80%]">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <Book className="h-[22px] w-[22px] lg:h-[30px] lg:w-[30px]" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Das Regelwerk (FAQ)</h3>
        </div>

        {/** Q/A */}
        <Accordion className="flex flex-col gap-y-3">
          {QA_QUESTIONS.map((item) => (
            <Accordion.Item
              key={item.id}
              className="soccer-field-card-bg rounded-2xl shadow-lg">
              <Accordion.Heading>
                <Accordion.Trigger className="text-fluid-base flex w-full items-center justify-between gap-x-2 p-6 font-bold whitespace-normal">
                  {item.q}

                  <Accordion.Indicator className="h-[30px] w-[30px] text-emerald-950/40 dark:text-emerald-500/40">
                    <ChevronsDownWide />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel className="border-t-2 border-emerald-700/20 dark:border-emerald-400/20">
                <Accordion.Body className="text-text-black dark:text-text-white px-6 pt-4 font-medium whitespace-normal">
                  {item.a}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>

      {/** Section 3: Active schools */}
      <section className="w-[90%] lg:w-[80%]">
        <Card className="soccer-field-card-bg soccer-field-card-border rounded-2xl border-2 shadow-2xl">
          <Card.Header className="flex items-center pt-2">
            <Card.Title className="text-fluid-base font-extrabold tracking-widest uppercase">Aktive Schulen der Saison</Card.Title>
          </Card.Header>
          <Card.Content className="p-6">
            <Suspense fallback={<span className="text-fluid-sm opacity-80">Teams laden</span>}>
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
    <div className="mb-8 flex flex-wrap justify-center gap-2">
      {teamsRes.teams.map((teamData, i) => {
        return (
          <span
            key={i}
            className="text-fluid-xxs w-full rounded-sm border border-white/10 bg-white/30 px-2 py-1 text-center font-semibold uppercase lg:w-fit dark:bg-white/5">
            {teamData.name}
          </span>
        );
      })}
    </div>
  );
}
