import { INSTAGRAM_HANDLE, INSTAGRAM_URL, KONTAKT_EMAIL, KONTAKT_MAILTO, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ClassicPage, PageHead } from "@/kit/ClassicPage";
import { LinkRows } from "@/kit/LinkRows";
import { pageMetadata } from "@/shared/utils/metadata";

/** The league's profile on Threads, which carries the same name as on Instagram. */
const THREADS_HANDLE = INSTAGRAM_HANDLE;

export const metadata = pageMetadata(ROUTES.contact, { description: SERVER_COPY.description.contact });

/** Kontakt: three rows, each a link, the address cut with „…“ where a phone is too narrow for it. */
export default function KontaktPage() {
  return (
    <ClassicPage width="form">
      <PageHead title={COPY.page.contact} />
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
