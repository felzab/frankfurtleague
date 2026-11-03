import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { Organisers } from "@/kit/Organisers";
import { Pillars } from "@/kit/Pillars";
import { Prose } from "@/kit/Prose";

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
 * About: the one paragraph, the three sections the landing's pillars show as cards, the
 * practical ones as short prose, and the organisers' row, which holds what the old Organisation page held.
 */
export default function AboutPage() {
  const sections = [words.about.spielorte, words.about.admission, words.about.safety];
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.about} />
      <Prose blocks={[{ kind: "paragraph", text: [words.paragraph] }]} />
      <Pillars
        items={[
          { glyph: "pupils", ...words.about.who },
          { glyph: "play", ...words.about.rules },
          { glyph: "proceeds", ...words.about.purpose },
        ]}
      />
      <Prose
        blocks={[
          ...sections.flatMap((section) => [
            { kind: "heading" as const, text: section.title },
            { kind: "paragraph" as const, text: [section.text] },
          ]),
          { kind: "heading", text: words.organisers.title },
        ]}
      />
      <Organisers people={ORGANISERS.map((person) => ({ name: { record: person.name }, role: words.organisers.role[person.role] }))} />
    </ClassicPage>
  );
}
