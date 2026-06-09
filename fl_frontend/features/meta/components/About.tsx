import { Accordion, Card, Separator } from "@heroui/react";
import { Book, ChevronsDownWide, StarFill } from "@gravity-ui/icons";

import { QA_QUESTIONS } from "../constants";
import { getAllTeams } from "@/features/teams/queries";
import { Suspense } from "react";
import { connection } from "next/server";

export default function About() {
  return (
    <div className="relative flex flex-col items-center gap-y-10 py-30 lg:py-44 text-left">
      {/** Headline */}
      <h2 className="text-fluid-xl xl:text-fluid-3xl tracking-tighter font-extrabold uppercase">About Frankfurt-League</h2>

      <Separator className="soccer-field-separator" />

      {/** Section 1: Unser Ziel */}
      <section className="flex flex-col items-left gap-y-4 w-[90%] lg:w-[80%] ">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <StarFill className="w-[22px] h-[22px] lg:w-[30px] lg:h-[30px]" />
          <h3 className="text-fluid-lg tracking-wide font-extrabold uppercase">Unser Ziel</h3>
        </div>

        <p className="w-full px-6 py-4 lg:p-6 rounded-2xl text-fluid-md text-balance font-medium soccer-field-card-bg shadow-xl">
          Unser Ziel ist simpel: Die Finanzierung unserer Abschlussfeiern und Abibälle. Anstatt Geld über herkömmliche, wenig lukrative Wege zu
          sammeln, organisieren wir einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe
          direkte Einnahmen für den ausrichtenden Jahrgang. Alles wird auf dem Platz geklärt – von Schülern, für Schüler.
        </p>
      </section>

      <Separator className="soccer-field-separator" />

      {/** Section 2: Das Regelwerk */}
      <section className="flex flex-col items-left w-[90%] lg:w-[80%] gap-y-4">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <Book className="w-[22px] h-[22px] lg:w-[30px] lg:h-[30px]" />
          <h3 className="text-fluid-lg tracking-wide font-extrabold uppercase">Das Regelwerk (FAQ)</h3>
        </div>

        {/** Q/A */}
        <Accordion className="flex flex-col gap-y-3">
          {QA_QUESTIONS.map((item) => (
            <Accordion.Item
              key={item.id}
              className="soccer-field-card-bg rounded-2xl shadow-lg">
              <Accordion.Heading>
                <Accordion.Trigger className="flex items-center justify-between gap-x-2 w-full p-6 text-fluid-base font-bold whitespace-normal">
                  {item.q}

                  <Accordion.Indicator className="dark:text-emerald-500/40 text-emerald-950/40 w-[30px] h-[30px]">
                    <ChevronsDownWide />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel className="border-t-2 border-emerald-700/20 dark:border-emerald-400/20">
                <Accordion.Body className="px-6 pt-4 text-text-black dark:text-text-white font-medium whitespace-normal">
                  {item.a}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>

      {/** Section 3: Active schools */}
      <section className="w-[90%] lg:w-[80%]">
        <Card className="soccer-field-card-bg border-2 soccer-field-card-border shadow-2xl rounded-2xl">
          <Card.Header className="pt-2 flex items-center">
            <Card.Title className="text-fluid-base font-extrabold uppercase tracking-widest">Aktive Schulen der Saison</Card.Title>
          </Card.Header>
          <Card.Content className="p-6">
            <Suspense fallback={<span className="text-fluid-sm opacity-80">Teams laden</span>}>
              <ParticipatingTeams />
            </Suspense>
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

async function ParticipatingTeams() {
  await connection();
  const res = await getAllTeams();

  return (
    <div className="flex flex-wrap justify-center gap-2 mb-8">
      {res.teams.map((team, i) => {
        if (team.name === "TBD") return;
        return (
          <span
            key={i}
            className="w-full lg:w-fit px-2 py-1 rounded-sm bg-white/30 dark:bg-white/5 border border-white/10 text-fluid-xxs text-center font-semibold uppercase ">
            {team.name}
          </span>
        );
      })}
    </div>
  );
}
