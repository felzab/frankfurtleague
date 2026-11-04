import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { Prose } from "@/kit/Prose";

import { ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_TAGE } from "@/core/adresswechsel";
import { CODE_VALIDITY_MINUTES } from "@/core/authEmail";
import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ADMIN_IDLE_HOURS, ADMIN_WINDOW_HOURS, PERSON_LIFETIME, PERSON_WINDOW_DAYS } from "@/core/sessionLifetimes";
import { CODE_FAILURE_WINDOW_HOURS, CODE_MAIL_WINDOW_HOURS } from "@/core/signInCode";
import { DAY_MS } from "@/core/timeUnits";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { DATENSCHUTZ_STAND } from "@/features/meta/constants";
import { MEDIEN_MIN_ALTER, REGISTRIERUNG_MIN_ALTER } from "@/features/registrierungen/constants";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE } from "@/features/schiedsrichter/constants";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Copy } from "@/core/copy";
import type { ProseBlock, ProseText } from "@/kit/Prose";
import type { Metadata, ResolvingMetadata } from "next";

const words = SERVER_COPY.legal.privacyNotice;

/** The league's address as a link inside a sentence. */
const MAIL: ProseText[number] = { href: KONTAKT_MAILTO, label: { record: KONTAKT_EMAIL } };

const heading = (text: Copy): ProseBlock => ({ kind: "heading", text });
const paragraph = (...text: ProseText): ProseBlock => ({ kind: "paragraph", text });

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.privacyNotice, ROUTES.privacyNotice.path(), { description: SERVER_COPY.description.privacyNotice });
}

/**
 * The privacy notice: its first layer as a plain list under the title, then each processing in its section, the
 * retention table, the rights with the objection set apart, and the day its words took effect as its last line.
 * Every figure the frontend's code holds is read from it, so the notice states the bound the code keeps.
 */
export default function PrivacyNoticePage() {
  const { firstLayer, retention, rights } = words;
  const blocks: ReadonlyArray<ProseBlock> = [
    heading(firstLayer.heading),
    { kind: "list", items: [...firstLayer.items.map((item) => [item]), [firstLayer.contact.before, MAIL, firstLayer.contact.after]] },
    heading(words.basis.heading),
    paragraph(words.basis.text),
    heading(words.website.heading),
    paragraph(words.website.requests),
    paragraph(words.website.browser),
    heading(words.bewerbung.heading),
    paragraph(words.bewerbung.form(KONTAKT_ROLLEN.length)),
    paragraph(words.bewerbung.confirmation(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER)),
    heading(words.kader.heading),
    paragraph(words.kader.text(REGISTRIERUNG_MIN_ALTER)),
    heading(words.schiedsrichter.heading),
    paragraph(words.schiedsrichter.text(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)),
    heading(words.spiele.heading),
    paragraph(words.spiele.text),
    heading(words.account.heading),
    paragraph(
      words.account.signIn(
        { minutes: CODE_VALIDITY_MINUTES },
        { idleDays: PERSON_LIFETIME.idle / DAY_MS, days: PERSON_WINDOW_DAYS },
        { idleHours: ADMIN_IDLE_HOURS, hours: ADMIN_WINDOW_HOURS },
      ),
    ),
    paragraph(words.account.changes(ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_TAGE)),
    heading(words.mail.heading),
    paragraph(words.mail.senders),
    paragraph(words.mail.forwarding),
    paragraph(words.mail.whatsapp),
    heading(words.published.heading),
    paragraph(words.published.record),
    paragraph(words.published.names),
    paragraph(words.published.consented(MEDIEN_MIN_ALTER)),
    paragraph(words.published.never),
    heading(words.recipients.heading),
    paragraph(words.recipients.lead),
    { kind: "list", items: words.recipients.items.map((item) => [item]) },
    paragraph(words.recipients.transfers),
    heading(retention.heading),
    {
      kind: "table",
      table: {
        label: retention.heading,
        nameLabel: retention.nameLabel,
        columns: [
          { key: "content", label: retention.content },
          { key: "period", label: retention.period },
        ],
        rows: retention.rows.map((row) => ({
          id: row.name,
          name: row.name,
          cells: {
            content: row.content,
            period:
              typeof row.period === "string"
                ? row.period
                : row.period({
                    bewerbungDays: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
                    schiedsrichterDays: SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
                    addressChangeLinkHours: ADRESSWECHSEL_GUELTIG_STUNDEN,
                    code: { minutes: CODE_VALIDITY_MINUTES, mailHours: CODE_MAIL_WINDOW_HOURS, failureHours: CODE_FAILURE_WINDOW_HOURS },
                    person: { idleDays: PERSON_LIFETIME.idle / DAY_MS, days: PERSON_WINDOW_DAYS },
                    admin: { idleHours: ADMIN_IDLE_HOURS, hours: ADMIN_WINDOW_HOURS },
                  }),
          },
        })),
        // Its rows are fixed, so this state never shows; every table names one.
        empty: { kind: "none", plural: retention.nameLabel },
        prose: true,
      },
    },
    heading(words.erasure.heading),
    paragraph(words.erasure.text),
    paragraph(words.erasure.log),
    heading(rights.heading),
    paragraph(rights.text.before, MAIL, rights.text.after),
    { kind: "callout", callout: { tone: "info", title: rights.objection.title, text: rights.objection.text } },
    paragraph(rights.closing),
    paragraph(words.stand(DATENSCHUTZ_STAND)),
  ];
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.privacyNotice} />
      <Prose blocks={blocks} />
    </ClassicPage>
  );
}
