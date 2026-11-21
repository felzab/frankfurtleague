import { ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD, HOLDER_WAIT } from "@/core/addressChange";
import {
  ACTION_LOG_RETENTION_YEARS,
  ADDRESS_CHANGE_RETENTION_DAYS,
  BAN_DURATION_SAISONS,
  CONFIRMATION_DEADLINE_DAYS,
  DELIVERY_DEADLINE_DAYS,
  MAILBOX_ANCHOR_RETENTION_HOURS,
  MEDIA_MIN_AGE,
  OUTBOX_RETENTION_DAYS,
  SCHIEDSRICHTER_MIN_AGE,
} from "@/core/bounds";
import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { COPY } from "@/core/copy/shared";
import { SENDER_ADDRESSES } from "@/core/mail";
import { MAILED_LINK_HOURS } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ADMIN_IDLE_HOURS, ADMIN_WINDOW_HOURS, PERSON_IDLE_DAYS, PERSON_WINDOW_DAYS, SESSION_EXPIRES_IN_DAYS } from "@/core/sessionLifetimes";
import { CODE_FAILURE_WINDOW_HOURS, CODE_MAIL_WINDOW_HOURS, CODE_VALIDITY_MINUTES } from "@/core/signInCode";
import { BEWERBUNG_MIN_AGE, SIGNATORY_MIN_AGE } from "@/features/bewerbungen/constants";
import { DATENSCHUTZ_AS_OF } from "@/features/meta/constants";
import { REGISTRIERUNG_MIN_AGE } from "@/features/registrierungen/constants";
import { ReadingPage } from "@/kit/Prose";
import { Table } from "@/kit/Table";
import { pageMetadata } from "@/shared/utils/metadata";

import type { ProseBlock, ProseSection, ProseText } from "@/kit/Prose";

const words = SERVER_COPY.legal.privacyNotice;

const MAIL = { href: KONTAKT_MAILTO, label: { record: KONTAKT_EMAIL } } as const;

const paragraph = (...text: ProseText): ProseBlock => ({ kind: "paragraph", text });

export const metadata = pageMetadata(ROUTES.privacyNotice, { description: SERVER_COPY.description.privacyNotice });

/**
 * The privacy notice: under its head, which names the day its words took effect, its first layer as a plain list, then
 * each processing in its section, the retention table, and the rights with the objection set apart.
 * Every figure the code holds is read from it, the frontend's and the ones the backend publishes, so the notice states
 * the bound the code keeps.
 */
export default function PrivacyNoticePage() {
  const { firstLayer, administration, erasure, retention, rights } = words;
  const sections: ReadonlyArray<ProseSection> = [
    {
      heading: firstLayer.heading,
      blocks: [{ kind: "list", items: [...firstLayer.items.map((item) => [item]), firstLayer.contact(MAIL)] }],
    },
    { heading: words.basis.heading, blocks: [paragraph(words.basis.text)] },
    {
      heading: words.website.heading,
      blocks: [
        paragraph(words.website.requests),
        paragraph(words.website.browser(CODE_VALIDITY_MINUTES, MAILED_LINK_HOURS)),
        paragraph(words.website.turnstile),
      ],
    },
    {
      heading: words.bewerbung.heading,
      blocks: [
        paragraph(words.bewerbung.form),
        paragraph(words.bewerbung.confirmation(CONFIRMATION_DEADLINE_DAYS, BEWERBUNG_MIN_AGE, SIGNATORY_MIN_AGE)),
        paragraph(words.bewerbung.visibility),
        paragraph(words.bewerbung.outcome),
      ],
    },
    { heading: words.kader.heading, blocks: [paragraph(words.kader.text(REGISTRIERUNG_MIN_AGE, CONFIRMATION_DEADLINE_DAYS))] },
    {
      heading: words.schiedsrichter.heading,
      blocks: [paragraph(words.schiedsrichter.text(CONFIRMATION_DEADLINE_DAYS, SCHIEDSRICHTER_MIN_AGE))],
    },
    { heading: words.spiele.heading, blocks: [paragraph(words.spiele.text)] },
    {
      heading: words.account.heading,
      blocks: [
        paragraph(words.account.signIn(CODE_VALIDITY_MINUTES)),
        paragraph(words.account.sessions(PERSON_IDLE_DAYS, PERSON_WINDOW_DAYS, SESSION_EXPIRES_IN_DAYS)),
        paragraph(words.account.changes(ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD.days)),
        paragraph(words.account.erasure),
        paragraph(words.account.ban),
      ],
    },
    // Its own section, so the contents fold lists it: what holds only for administrators, the passkey among it.
    {
      heading: administration.heading,
      blocks: [
        paragraph(administration.signIn(ADMIN_IDLE_HOURS, ADMIN_WINDOW_HOURS)),
        paragraph(administration.passkey.lead),
        { kind: "list", items: administration.passkey.items.map((item) => [item]) },
        paragraph(administration.passkey.never),
        paragraph(administration.address(HOLDER_WAIT.administration, HOLDER_WAIT.owner)),
        paragraph(administration.grants(HOLDER_WAIT.administration, HOLDER_WAIT.owner)),
        paragraph(administration.undo),
        paragraph(administration.erasure),
      ],
    },
    {
      heading: words.mail.heading,
      blocks: [
        paragraph(words.mail.senders(SENDER_ADDRESSES.signIn, SENDER_ADDRESSES.league)),
        paragraph(words.mail.forwarding),
        paragraph(words.mail.whatsapp),
      ],
    },
    {
      heading: words.published.heading,
      blocks: [
        paragraph(words.published.record),
        paragraph(words.published.names),
        paragraph(words.published.organisers),
        paragraph(words.published.media(MEDIA_MIN_AGE)),
        paragraph(words.published.never),
      ],
    },
    {
      heading: words.recipients.heading,
      blocks: [
        paragraph(words.recipients.lead),
        { kind: "list", items: words.recipients.items.map((item) => [item]) },
        paragraph(words.recipients.transfers),
      ],
    },
    {
      heading: retention.heading,
      blocks: [
        {
          kind: "table",
          table: (
            <Table
              label={retention.heading}
              nameLabel={retention.nameLabel}
              columns={[
                { key: "content", label: retention.content },
                { key: "period", label: retention.period },
              ]}
              rows={retention.rows.map((row) => ({
                id: row.name,
                name: row.name,
                cells: {
                  content: row.content,
                  period:
                    typeof row.period === "string"
                      ? row.period
                      : row.period({
                          bewerbungDays: CONFIRMATION_DEADLINE_DAYS,
                          registrierungDays: CONFIRMATION_DEADLINE_DAYS,
                          declinedDays: CONFIRMATION_DEADLINE_DAYS,
                          schiedsrichterDays: CONFIRMATION_DEADLINE_DAYS,
                          addressChangeLinkHours: ADDRESS_CHANGE_VALID_HOURS,
                          code: { minutes: CODE_VALIDITY_MINUTES, mailHours: CODE_MAIL_WINDOW_HOURS, failureHours: CODE_FAILURE_WINDOW_HOURS },
                          sessionDays: SESSION_EXPIRES_IN_DAYS,
                          banSaisons: BAN_DURATION_SAISONS,
                          addressChangeRetentionDays: ADDRESS_CHANGE_RETENTION_DAYS,
                          actionLogYears: ACTION_LOG_RETENTION_YEARS,
                          outboxRetentionDays: OUTBOX_RETENTION_DAYS,
                        }),
                },
              }))}
              // Its rows are fixed, so this state never shows; every table names one.
              empty={{ kind: "none", plural: retention.nameLabel }}
              prose
            />
          ),
        },
      ],
    },
    {
      heading: erasure.heading,
      blocks: [
        paragraph(erasure.text),
        paragraph(erasure.remainsLead),
        {
          kind: "list",
          items: erasure.remains(DELIVERY_DEADLINE_DAYS, MAILBOX_ANCHOR_RETENTION_HOURS, OUTBOX_RETENTION_DAYS).map((item) => [item]),
        },
        paragraph(erasure.notices),
        paragraph(erasure.log(ACTION_LOG_RETENTION_YEARS)),
      ],
    },
    {
      heading: rights.heading,
      blocks: [
        paragraph(...rights.text(MAIL)),
        { kind: "callout", callout: { tone: "info", title: rights.objection.title, text: rights.objection.text } },
        paragraph(rights.closing),
      ],
    },
  ];
  return (
    <ReadingPage
      title={COPY.page.privacyNotice}
      date={words.asOf(DATENSCHUTZ_AS_OF)}
      sections={sections}
    />
  );
}
