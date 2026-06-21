"use client";

import { Person, Persons } from "@gravity-ui/icons";

import { Card, Separator } from "@heroui/react";

import { TEAM_MEMBERS } from "../../constants";

const TAG_TITLES: Record<string, string> = {
  vorstand: "Vorstand",
  orga: "Organisation",
  web: "Web, Design & Kommunikation",
};

const GROUPED_MEMBERS = TEAM_MEMBERS.reduce(
  (acc, member) => {
    if (!acc[member.tag]) acc[member.tag] = [];
    acc[member.tag].push(member);
    return acc;
  },
  {} as Record<string, (typeof TEAM_MEMBERS)[0][]>,
);

export default function MetaTeamView() {
  return (
    <div className="relative flex flex-col items-center gap-y-10 py-30 text-left lg:py-44">
      <h2 className="text-fluid-xl xl:text-fluid-3xl font-extrabold tracking-tighter uppercase">Frankfurt-League Team</h2>

      <Separator className="soccer-field-separator w-[90%] lg:w-[80%]" />

      <section className="items-left flex w-[90%] flex-col gap-y-4 lg:w-[80%]">
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <Persons className="h-[22px] w-[22px] lg:h-[30px] lg:w-[30px]" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Behind the scenes</h3>
        </div>

        <p className="text-fluid-md soccer-field-card-bg w-full rounded-2xl px-6 py-4 font-medium whitespace-normal shadow-xl lg:p-6">
          Das Team hinter der Frankfurt-League. Hier lernst du die Personen kennen, die die Frankfurt-League am laufen halten und erfährst, wer
          für was zuständig ist.
        </p>
      </section>

      <Separator className="soccer-field-separator w-[90%] lg:w-[80%]" />

      <div className="flex w-full flex-col items-center gap-y-16 px-4 lg:px-10">
        {Object.entries(GROUPED_MEMBERS).map(([tag, members]) => (
          <section
            key={tag}
            className="flex w-full max-w-[1600px] flex-col gap-y-6">
            <h3 className="text-fluid-xl border-text-black dark:border-text-white border-l-4 pl-2 font-black whitespace-normal uppercase">
              {TAG_TITLES[tag] || tag}
            </h3>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {members.map((member) => (
                <Card
                  key={member.id}
                  className="soccer-field-card-bg soccer-field-card-border min-w-[280px] border p-6 backdrop-blur md:min-w-[300px] lg:min-w-[320px] 2xl:min-w-[380px]">
                  <Card.Header className="flex flex-col items-start gap-1 px-0 pb-4">
                    <div className="rounded-xl bg-emerald-500/80 p-3 text-emerald-300 dark:bg-emerald-500/20">
                      <Person />
                    </div>
                    <Card.Title className="text-fluid-lg mt-2 font-black">{member.name}</Card.Title>
                    <Card.Description className="text-fluid-xs font-bold tracking-widest text-emerald-600 uppercase dark:text-emerald-300">
                      {member.role}
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="text-fluid-sm px-0 py-0 text-left">{member.desc}</Card.Content>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
