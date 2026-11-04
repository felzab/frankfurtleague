import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { LinkRows } from "@/kit/LinkRows";

import { INSTAGRAM_HANDLE, INSTAGRAM_URL, KONTAKT_EMAIL, KONTAKT_MAILTO, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/** The league's profile on Threads, which carries the same name as on Instagram. */
const THREADS_HANDLE = INSTAGRAM_HANDLE;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.contact, ROUTES.contact.path(), { description: SERVER_COPY.description.contact });
}

/** Kontakt: three rows, each a link, the address cut with „…“ where a phone is too narrow for it. */
export default function KontaktPage() {
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.contact} />
      <LinkRows
        rows={[
          {
            glyph: "email",
            label: SERVER_COPY.landing.contact.email,
            value: { record: KONTAKT_EMAIL },
            href: KONTAKT_MAILTO,
          },
          { glyph: "instagram", label: COPY.template.instagram, value: { record: INSTAGRAM_HANDLE }, href: INSTAGRAM_URL },
          { glyph: "threads", label: COPY.template.threads, value: { record: THREADS_HANDLE }, href: THREADS_URL },
        ]}
      />
    </ClassicPage>
  );
}
