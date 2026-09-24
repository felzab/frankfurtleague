import { BrandHero } from "@/shared/components/ui/BrandHero";
import { BRAND_TILE_CLASSES } from "@/shared/components/ui/brandTile";
import { card } from "@/shared/components/ui/card";
import { CardGrid } from "@/shared/components/ui/CardGrid";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { CARDS_CASCADE_CLASSES, PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { typedObjectEntries } from "@/shared/utils/type";

import { GROUPED_MEMBERS, TAG_EYEBROWS, TAG_TITLES } from "../../constants";
import { MetaSection } from "../ui/MetaSection";

// Each step is n columns of 10.75rem plus the gaps between them: 10.75rem is the narrowest member card, at a
// quarter-rem step, holding every word of its role and its line unbroken at its largest type.
const COLUMNS_CLASSES = "@min-[23rem]:grid-cols-2 @min-[35.25rem]:grid-cols-3";

export function MetaOrganisationView() {
  return (
    <div className={`${PAGE_RISE_CLASSES} flex w-full flex-col gap-y-8 sm:gap-y-12`}>
      <BrandHero
        title="Organisation"
        lead="Alle hier sind Schülerinnen, Schüler und Helfer, die die Liga ehrenamtlich am Laufen halten."
      />

      {/* `typedObjectEntries` keeps `tag` a literal union, so neither map needs a fallback. */}
      {typedObjectEntries(GROUPED_MEMBERS).map(([tag, members]) => (
        <MetaSection
          key={tag}
          eyebrow={TAG_EYEBROWS[tag]}
          title={TAG_TITLES[tag]}>
          <CardGrid
            columns={COLUMNS_CLASSES}
            role="list"
            className={CARDS_CASCADE_CLASSES}>
            {members.map((member) => (
              <div
                role="listitem"
                key={member.id}
                className={`${card()} flex flex-col gap-y-3 p-5 sm:p-6`}>
                <span
                  aria-hidden="true"
                  className={`${BRAND_TILE_CLASSES} ${DISPLAY_HEADING_CLASSES} fluid-xl`}>
                  {member.name.charAt(0)}
                </span>

                <div className="flex flex-col gap-y-1">
                  <span className="fluid-base text-foreground font-bold">{member.name}</span>
                  <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">{member.role}</span>
                </div>

                <p className="muted-meta">{member.desc}</p>
              </div>
            ))}
          </CardGrid>
        </MetaSection>
      ))}
    </div>
  );
}
