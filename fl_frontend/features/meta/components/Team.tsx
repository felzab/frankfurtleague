"use client";

import { Card, Separator } from "@heroui/react";
import { Person, Persons } from "@gravity-ui/icons";
import { TEAM_MEMBERS } from "../constants";

export default function Team() {
  return (
    <div className="relative flex flex-col items-center gap-y-10 py-30 lg:py-44 text-left">
      <h2 className="text-fluid-xl xl:text-fluid-3xl tracking-tighter font-extrabold uppercase">Frankfurt-League Team</h2>

      <Separator className="soccer-field-separator" />

      {/** Section 1: Unser Team */}
      <section className="flex flex-col items-left gap-y-4 w-[90%] lg:w-[80%] ">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <Persons className="w-[22px] h-[22px] lg:w-[30px] lg:h-[30px]" />
          <h3 className="text-fluid-lg tracking-wide font-extrabold uppercase">Behind the scenes</h3>
        </div>

        <p className="w-full px-6 py-4 lg:p-6 rounded-2xl text-fluid-md whitespace-normal font-medium soccer-field-card-bg shadow-xl">
          Das Team hinter der Frankfurt-League. Hier lernst du die Personen kennen, die die Frankfurt-League am laufen halten und erfährst, wer
          für was zuständig ist.
        </p>
      </section>

      <Separator className="soccer-field-separator" />

      {/* Team Raster */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6 p-4">
        {TEAM_MEMBERS.map((member, i) => (
          <Card
            key={i}
            className="min-w-[280px] md:min-w-[300px] lg:min-w-[320px] 2xl:min-w-[380px] p-6 soccer-field-card-bg backdrop-blur border soccer-field-card-border">
            <Card.Header className="flex flex-col items-start gap-1 pb-4">
              <div className="p-3 bg-emerald-500/80  dark:bg-emerald-500/20 rounded-xl text-emerald-300">
                <Person />
              </div>
              <h3 className="text-fluid-lg font-black mt-2">{member.name}</h3>
              <p className="text-emerald-600 dark:text-emerald-300 text-fluid-xs font-bold uppercase tracking-widest">{member.role}</p>
            </Card.Header>
            <Card.Content className=" text-fluid-sm text-left">{member.desc}</Card.Content>
          </Card>
        ))}
      </div>
    </div>
  );
}
