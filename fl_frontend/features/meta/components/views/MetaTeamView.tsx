"use client";

import { Card, Separator } from "@heroui/react";
import { Person, Persons } from "@gravity-ui/icons";
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
    <div className="relative flex flex-col items-center gap-y-10 py-30 lg:py-44 text-left">
      <h2 className="text-fluid-xl xl:text-fluid-3xl tracking-tighter font-extrabold uppercase">Frankfurt-League Team</h2>

      <Separator className="soccer-field-separator w-[90%] lg:w-[80%]" />

      <section className="flex flex-col items-left gap-y-4 w-[90%] lg:w-[80%]">
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <Persons className="w-[22px] h-[22px] lg:w-[30px] lg:h-[30px]" />
          <h3 className="text-fluid-lg tracking-wide font-extrabold uppercase">Behind the scenes</h3>
        </div>

        <p className="w-full px-6 py-4 lg:p-6 rounded-2xl text-fluid-md whitespace-normal font-medium soccer-field-card-bg shadow-xl">
          Das Team hinter der Frankfurt-League. Hier lernst du die Personen kennen, die die Frankfurt-League am laufen halten und erfährst, wer
          für was zuständig ist.
        </p>
      </section>

      <Separator className="soccer-field-separator w-[90%] lg:w-[80%]" />

      <div className="flex flex-col items-center gap-y-16 w-full px-4 lg:px-10">
        {Object.entries(GROUPED_MEMBERS).map(([tag, members]) => (
          <section
            key={tag}
            className="w-full max-w-[1600px] flex flex-col gap-y-6">
            <h3 className="text-fluid-xl font-black uppercase  pl-2 border-l-4 border-text-black dark:border-text-white whitespace-normal">
              {TAG_TITLES[tag] || tag}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
              {members.map((member) => (
                <Card
                  key={member.id}
                  className="min-w-[280px] md:min-w-[300px] lg:min-w-[320px] 2xl:min-w-[380px] p-6 soccer-field-card-bg backdrop-blur border soccer-field-card-border">
                  <Card.Header className="flex flex-col items-start gap-1 pb-4 px-0">
                    <div className="p-3 bg-emerald-500/80 dark:bg-emerald-500/20 rounded-xl text-emerald-300">
                      <Person />
                    </div>
                    <Card.Title className="text-fluid-lg font-black mt-2">{member.name}</Card.Title>
                    <Card.Description className="text-emerald-600 dark:text-emerald-300 text-fluid-xs font-bold uppercase tracking-widest">
                      {member.role}
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="text-fluid-sm text-left px-0 py-0">{member.desc}</Card.Content>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
