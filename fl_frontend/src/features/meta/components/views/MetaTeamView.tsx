"use client";

import { Person, Persons } from "@gravity-ui/icons";

import { Card } from "@heroui/react";

import { typedObjectEntries } from "@/shared/utils/type";

import { GROUPED_MEMBERS, TAG_TITLES } from "../../constants";

export default function MetaTeamView() {
  return (
    <div className="flex w-full max-w-meta flex-col items-center gap-y-4 text-left sm:gap-y-8">
      {/** Headline */}
      <div className="flex flex-col items-center px-2 text-center">
        <h2 className="text-fluid-2xl sm:text-fluid-2xl lg:text-fluid-3xl font-black tracking-tight text-field-fg uppercase drop-shadow-md">
          Frankfurt-League Team
        </h2>
        <p className="text-fluid-sm sm:text-fluid-sm mt-2 font-medium text-field-fg/80">Wer das Event möglich macht.</p>
      </div>

      <div className="soccer-field-separator w-full" />

      {/** Section 1: Intro */}
      <section className="flex w-full flex-col gap-y-3 sm:gap-y-4">
        <div className="flex flex-row items-center gap-x-2 text-field-fg sm:gap-x-3">
          <Persons className="size-5 drop-shadow sm:size-6" />
          <h3 className="text-fluid-base sm:text-fluid-lg font-extrabold tracking-wide uppercase">Behind the scenes</h3>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-4 shadow-xl sm:p-6 lg:p-8">
          <p className="text-fluid-xs sm:text-fluid-sm leading-relaxed font-medium text-pretty text-field-fg/95">
            Das Team hinter der Frankfurt-League. Hier lernst du die Personen kennen, die die Frankfurt-League am Laufen halten und erfährst,
            wer für was zuständig ist.
          </p>
        </div>
      </section>

      <div className="soccer-field-separator w-full" />

      {/** Section 2: Grouped Members */}
      <div className="flex w-full flex-col items-center gap-y-12">
        {/* typedObjectEntries keeps `tag` as the literal union, so TAG_TITLES is a checked lookup
            and needs no `|| tag` fallback. */}
        {typedObjectEntries(GROUPED_MEMBERS).map(([tag, members]) => (
          <section
            key={tag}
            className="flex w-full flex-col gap-y-5">
            <h3 className="text-fluid-base sm:text-fluid-lg border-l-4 border-field-fg pl-3 font-black tracking-wide text-field-fg uppercase">
              {TAG_TITLES[tag]}
            </h3>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {members.map((member) => (
                <Card
                  key={member.id}
                  className="soccer-field-card-bg soccer-field-card-border flex flex-col justify-between rounded-2xl border p-5 shadow-xl backdrop-blur-md sm:p-6">
                  <div>
                    <Card.Header className="flex flex-col items-start gap-1 p-0 pb-4">
                      <div className="flex size-11 items-center justify-center rounded-xl bg-field-fg/10 text-field-fg shadow-inner">
                        <Person
                          width={22}
                          height={22}
                        />
                      </div>
                      <Card.Title className="text-fluid-base sm:text-fluid-lg mt-3 font-black text-field-fg">{member.name}</Card.Title>
                      {/* text-emerald-200 was the one field colour with no token equivalent: a muted
                          label on the green card. Expressed as the field foreground at 80%. */}
                      <Card.Description className="text-fluid-xxs sm:text-fluid-xs text-field-fg/80 font-bold tracking-widest uppercase">
                        {member.role}
                      </Card.Description>
                    </Card.Header>

                    <div className="soccer-field-separator my-3" />

                    <Card.Content className="text-fluid-xs p-0 leading-relaxed font-medium text-field-fg/90">{member.desc}</Card.Content>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
