import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ClassicPage, PageHead } from "@/kit/ClassicPage";
import { SectionStack } from "@/kit/LandingPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { OrganisersSection, PillarsSection, SeasonSection } from "../LeagueSections";

export const metadata = pageMetadata(ROUTES.about, { description: SERVER_COPY.description.about });

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
        lead={SERVER_COPY.landing.paragraphs}
      />
      <SectionStack>
        <PillarsSection />
        <SeasonSection />
        <OrganisersSection />
      </SectionStack>
    </ClassicPage>
  );
}
