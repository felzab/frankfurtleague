import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { ORGANISERS } from "@/features/meta/constants";
import { InfoCards } from "@/kit/InfoCards";
import { LandingSection } from "@/kit/LandingSection";
import { Organisers } from "@/kit/Organisers";
import { Pillars } from "@/kit/Pillars";
import { StepsLine } from "@/kit/StepsLine";

import type { ComponentProps } from "react";

const words = SERVER_COPY.landing;

/** What the league is for: who plays, by which rules, and what its proceeds go to. */
export function PillarsSection() {
  return (
    <LandingSection
      eyebrow={words.pillars.eyebrow}
      title={words.pillars.title}>
      <Pillars
        items={[
          { glyph: "pupils", ...words.about.who },
          { glyph: "play", ...words.about.rules },
          { glyph: "proceeds", ...words.about.purpose },
        ]}
      />
    </LandingSection>
  );
}

/** How a season runs, its stages along one line, then its practical facts. */
export function SeasonSection() {
  return (
    <LandingSection
      eyebrow={words.season.eyebrow}
      title={words.season.title}>
      <StepsLine
        items={[
          { title: COPY.shared.phase.gruppenphase, text: words.season.gruppenphase },
          { title: COPY.shared.kORunde, text: words.season.kORunde },
          { title: SERVER_COPY.season.thirdPlace, text: words.season.platz3 },
          { title: COPY.shared.phase.finale, text: words.season.finale },
        ]}
      />
      <InfoCards items={[words.about.spielorte, words.about.admission, words.about.safety]} />
    </LandingSection>
  );
}

/** The people who run the league, and a link on to the page telling more where the page placing them is not it. */
export function OrganisersSection({ more }: Pick<ComponentProps<typeof LandingSection>, "more">) {
  return (
    <LandingSection
      eyebrow={words.organisers.eyebrow}
      title={words.organisers.title}
      more={more}>
      <Organisers people={ORGANISERS.map((person) => ({ name: { record: person.name }, role: words.organisers.role[person.role] }))} />
    </LandingSection>
  );
}
