import { ClassicPage, ClassicSections, PageHead } from "@/kit/ClassicPage";
import { InfoCards } from "@/kit/InfoCards";
import { LandingSection } from "@/kit/LandingSection";
import { Organisers } from "@/kit/Organisers";
import { Pillars } from "@/kit/Pillars";
import { StepsLine } from "@/kit/StepsLine";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ORGANISERS } from "@/features/meta/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

const words = SERVER_COPY.landing;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.about, ROUTES.about.path(), { description: SERVER_COPY.description.about });
}

/**
 * About: the league's two paragraphs as the head's lead, then three of the landing's own sections in its words, what the
 * league is for, how a season runs with its practical facts, and who runs it. Linear's and Vercel's About pages are
 * built from their landing's blocks so.
 */
export default function AboutPage() {
  return (
    <ClassicPage width="form">
      <PageHead
        title={COPY.page.about}
        lead={words.paragraphs}
      />
      <ClassicSections>
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
        <LandingSection
          eyebrow={words.organisers.eyebrow}
          title={words.organisers.title}>
          <Organisers people={ORGANISERS.map((person) => ({ name: { record: person.name }, role: words.organisers.role[person.role] }))} />
        </LandingSection>
      </ClassicSections>
    </ClassicPage>
  );
}
