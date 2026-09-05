import { BrandHero } from "@/shared/components/ui/BrandHero";
import { card } from "@/shared/components/ui/card";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { CARDS_CASCADE, PAGE_RISE } from "@/shared/components/ui/motion";
import { typedObjectEntries } from "@/shared/utils/type";

import { GROUPED_MEMBERS, TAG_EYEBROWS, TAG_TITLES } from "../../constants";
import { MetaSection } from "../ui/MetaSection";

const TILE = "bg-brand-solid text-brand-solid-foreground flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm";

export function MetaTeamView() {
  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-y-8 sm:gap-y-12`}>
      <BrandHero
        title="Hinter den Kulissen"
        lead="Alle hier sind Schülerinnen, Schüler und Helfer, die die Liga ehrenamtlich am Laufen halten."
      />

      {/* `typedObjectEntries` keeps `tag` a literal union, so neither map needs a fallback. */}
      {typedObjectEntries(GROUPED_MEMBERS).map(([tag, members]) => (
        <MetaSection
          key={tag}
          eyebrow={TAG_EYEBROWS[tag]}
          title={TAG_TITLES[tag]}>
          <div
            role="list"
            className={`${CARDS_CASCADE} grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3`}>
            {members.map((member) => (
              <div
                role="listitem"
                key={member.id}
                className={`${card()} flex flex-col gap-y-3 p-5 sm:p-6`}>
                <span
                  aria-hidden="true"
                  className={`${TILE} ${DISPLAY_HEADING} fluid-xl`}>
                  {member.name.charAt(0)}
                </span>

                <div className="flex flex-col gap-y-1">
                  <span className="fluid-base text-foreground font-bold">{member.name}</span>
                  <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">{member.role}</span>
                </div>

                <p className="muted-meta">{member.desc}</p>
              </div>
            ))}
          </div>
        </MetaSection>
      ))}
    </div>
  );
}
