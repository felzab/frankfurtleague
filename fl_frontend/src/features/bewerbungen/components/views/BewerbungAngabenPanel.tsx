import Link from "next/link";

import { VonOderGesperrt } from "@/features/berechtigungen/components/ui/VonOderGesperrt";
import { BEWERBUNG_HERKUNFT_LABELS } from "@/features/bewerbungen/constants";
import { bewerbungHerkunft } from "@/features/bewerbungen/utils";
import { Beleg } from "@/features/spieler/components/ui/Nachweis";
import { EINWILLIGUNG_MEDIEN_FRAGE, EINWILLIGUNG_MEDIEN_LABELS } from "@/features/spieler/constants";
import { bestaetigungOf, medienBestaetigungOf } from "@/features/spieler/nachweis";
import {
  KONTAKT_WHATSAPP_FRAGE,
  KONTAKT_WHATSAPP_LABELS,
  kontaktGeburtsdatumLeer,
  schulformLabel,
  trikotFarbeHex,
  trikotFarbeLabel,
} from "@/features/teams/constants";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { NewTabLink } from "@/shared/components/ui/NewTabLink";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";
import { ExternalUrlSchema } from "@/shared/schemas";
import { formatAddressFull, formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { FLBewerbung } from "@/core/generated/client/types";
import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand";
import type { MedienFragen } from "@/features/spieler/nachweis";
import type { ReactNode } from "react";

/**
 * Validated before it becomes an `href`: the API serves this value unchecked, so a `javascript:`
 * string is a stored-XSS sink (`fl_frontend/src/shared/schemas.ts :: ExternalUrlSchema`). One that
 * fails stands as text.
 */
function Website({ url }: { url: string | null }) {
  // `FLBewerbungSchuleSchema` reads this field unchecked, so an empty string reaches here as readily
  // as the `null` the write path produces, and both mean the school named no website.
  if (url === null || url.trim() === "") return <Leer />;

  const safe = ExternalUrlSchema.safeParse(url);

  return safe.success ? (
    <NewTabLink
      href={safe.data}
      className={textLink()}>
      {url}
    </NewTabLink>
  ) : (
    <span className="text-foreground-muted">{url}</span>
  );
}

/** The panel shell every block below takes, so no two of them drift apart. */
function Panel({ title, hinweis, children }: { title: string; hinweis?: ReactNode; children: ReactNode }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={title}>
          {hinweis}
        </PanelHeading>
      </div>
      <div className={panel.body()}>{children}</div>
    </section>
  );
}

/** The one grid every block's facts stand in. */
const ANGABEN_GRID_CLASSES = "grid w-full grid-cols-1 gap-4 sm:grid-cols-2";

/**
 * Everything one school submitted, read-only. **Nothing here is editable**: an application is the
 * form three people filled in, and a decision moves `status`, `entscheidung` and `team_id` alone.
 */
export function BewerbungAngabenPanel({
  bewerbung,
  teamName,
  staende,
  medienFragen,
}: {
  bewerbung: FLBewerbung;
  teamName: string | null;
  /** Each seat's state, as `bestaetigungsStand` reads it. */
  staende: readonly SitzBestaetigung[];
  /** Whether each seat's confirmation page asked the media choice, read by the page off the registry. */
  medienFragen: MedienFragen;
}) {
  const { schule, kontakte, trikot, kader, wunschgegner, decision: entscheidung } = bewerbung;
  const herkunft = bewerbungHerkunft(bewerbung);

  return (
    <>
      {/* Neither arm's name where the application names neither: that row is the one acceptance refuses,
          and a title claiming a club would send the administrator looking for one. */}
      <Panel title={herkunft === null ? "Schule oder Team" : BEWERBUNG_HERKUNFT_LABELS[herkunft]}>
        <dl className={ANGABEN_GRID_CLASSES}>
          <Angabe label="Team">
            {teamName === null ? (
              <Leer />
            ) : bewerbung.team_id === null ? (
              teamName
            ) : (
              // Guarded on the id and never on the arm below: a new school's application carries a
              // name before it carries a club (`docs/glossary.md :: Bewerbung`). The season is the
              // application's own, this page's URL carrying none.
              <Link
                href={withSaisonId(`/bereich/admin/teams/${bewerbung.team_id}`, bewerbung.saison_id)}
                className={textLink()}>
                {teamName}
              </Link>
            )}
          </Angabe>
          <Angabe label="Saison">{bewerbung.saison_id}</Angabe>
          <Angabe label="Eingereicht am">{formatSpielDatum(bewerbung.submitted_at)}</Angabe>
          <Angabe label="Größe der Stufe">{String(bewerbung.stufengroesse)}</Angabe>

          {herkunft === null ? (
            <Angabe label="Angaben zum Team">Die Bewerbung nennt weder eine neue Schule noch ein bestehendes Team.</Angabe>
          ) : schule === null ? (
            // The club already exists, so its own page carries everything else about it. Nothing is
            // restated here that a rename there would leave standing wrong.
            <Angabe label="Angaben zum Team">Das Team ist schon angelegt und wird bei einer Zusage nur aufgenommen.</Angabe>
          ) : (
            <>
              <Angabe label="Vollständiger Name">{schule.full_name}</Angabe>
              <Angabe label="Kürzel">{schule.shorthand}</Angabe>
              <Angabe label="Schulform">{schule.schulform === null ? <Leer /> : schulformLabel(schule.schulform)}</Angabe>
              <Angabe label="Adresse">{formatAddressFull(schule.address)}</Angabe>
              <Angabe label="Website">
                <Website url={schule.website_url} />
              </Angabe>
            </>
          )}
        </dl>
      </Panel>

      <Panel title="Kontaktpersonen">
        <div className="flex w-full flex-col gap-y-6">
          {/* `staende` holds every seat in the label table's order (`fl_frontend/src/features/bewerbungen/bestaetigungStand.ts ::
              bestaetigungsStand`), so each seat is read with its state and none without. */}
          {staende.map((stand) => {
            const { rolle: value, label } = stand;
            const person = kontakte[value];

            return (
              <div
                key={value}
                className="flex w-full flex-col gap-y-2">
                <div className="flex flex-row flex-wrap items-center gap-2">
                  {/* Named rather than muted, as the strip tints the same seat: a grey chip reads as
                      a disabled one (my rule, 2026-09-04). */}
                  <span className={labelBadge("info")}>{label}</span>
                  {/* Stored rather than derived by comparing the two blocks: what the school
                      asserted is not the same claim as what happens to match. */}
                  {kontakte.trainer_is_also === value && <span className={labelBadge("info")}>Zugleich Trainer</span>}
                </div>

                {person === null ? (
                  <p className="muted-hint">Für diese Rolle steht niemand mehr in der Bewerbung.</p>
                ) : (
                  <dl className={ANGABEN_GRID_CLASSES}>
                    <Angabe label="Name">{`${person.vorname} ${person.nachname}`}</Angabe>
                    {/* The person's own to enter when they confirm, so the contacts editor's words: whose step
                        it is until then, a field held empty after. */}
                    <Angabe label="Geburtsdatum">
                      {person.geburtsdatum === null ? (
                        <Leer>{kontaktGeburtsdatumLeer(person.einwilligung.confirmed_at)}</Leer>
                      ) : (
                        formatSpielDatum(person.geburtsdatum)
                      )}
                    </Angabe>
                    {/* The scheme is a literal prefix here, so neither stored value can steer the href
                        the way `Website`'s can, and neither needs that field's validator. */}
                    {/* Both rows guard the TRIMMED value: `PHONE_REGEX` admits the space character, the read
                        model checks neither field, and a link whose text is blank is a tab stop with no
                        accessible name. */}
                    <Angabe label="E-Mail">
                      {person.email.trim() === "" ? (
                        <Leer />
                      ) : (
                        <a
                          href={`mailto:${person.email}`}
                          className={textLink()}>
                          {person.email}
                        </a>
                      )}
                    </Angabe>
                    {/* Off the STORED number rather than the normalised one: normalising exists to
                        compare two seats, and a dialler takes the spaces and punctuation a school typed. */}
                    <Angabe label="Telefon">
                      {person.telefon.trim() === "" ? (
                        <Leer />
                      ) : (
                        <a
                          href={`tel:${person.telefon.replace(/\s/g, "")}`}
                          className={textLink()}>
                          {person.telefon}
                        </a>
                      )}
                    </Angabe>
                    <Angabe label="Bestätigung">
                      {/* A step not taken stands where the confirmation's day would, so it takes the empty
                          grade; a confirmation or a Widerspruch is the fact itself. */}
                      {stand.stand.art === "confirmed" || stand.stand.art === "declined" ? stand.satz : <Leer>{stand.satz}</Leer>}
                      {/* Over a confirmation that has been given and no other: the version an
                          outstanding seat stores is the wording the SUBMITTER acknowledged, which
                          naming here would file against the person who has not answered yet. */}
                      {stand.stand.art === "confirmed" &&
                        person.einwilligung.text_version !== "" &&
                        ` (Fassung ${person.einwilligung.text_version})`}
                    </Angabe>
                    {/* While pending alone: the person withdraws either choice on the account page then, and a
                        decided application's copy is frozen, the seats' choices living on the team's row. */}
                    {bewerbung.status === "submitted" && (
                      <>
                        <Angabe label={KONTAKT_WHATSAPP_FRAGE}>
                          {KONTAKT_WHATSAPP_LABELS[person.einwilligung.umfang]}
                          <Beleg
                            nachweis={person.einwilligung.nachweis.umfang}
                            bestaetigung={bestaetigungOf(person.einwilligung)}
                          />
                        </Angabe>
                        <Angabe label={EINWILLIGUNG_MEDIEN_FRAGE}>
                          {person.einwilligung.medien ? EINWILLIGUNG_MEDIEN_LABELS.erteilt : EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt}
                          <Beleg
                            nachweis={person.einwilligung.nachweis.medien}
                            bestaetigung={medienBestaetigungOf(person.einwilligung, medienFragen)}
                          />
                        </Angabe>
                      </>
                    )}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Trikot, Kader und Wunschgegner"
        hinweis={
          <Hint
            mode="reveal"
            label="Hinweis zu Trikot, Kader und Wunschgegner"
            body={{
              lead: "Was die Schule sich wünscht und welche Zahlen sie schätzt.",
              points: [
                { term: "Die Wunschfarbe", text: "bindet Dich zu nichts: Die Trikotfarbe des Teams legst Du bei der Zusage fest." },
                { term: "Der Wunschgegner", text: "ist frei eingetragen und muss keine Schule sein, die die Liga führt." },
              ],
            }}
          />
        }>
        <dl className={ANGABEN_GRID_CLASSES}>
          <Angabe label="Vorhandene Trikotsätze">{trikot.existing_satz === "" ? <Leer /> : trikot.existing_satz}</Angabe>
          <Angabe label="Wunschfarbe">
            <span className="flex flex-row items-center gap-x-2">
              {/* A ring rather than a filled disc, so Weiß reads as a colour instead of as a gap.
                  The fill is the palette's hex, which no theme token tracks. */}
              <span
                aria-hidden="true"
                style={{ backgroundColor: trikotFarbeHex(trikot.wunschfarbe) }}
                className="size-4 shrink-0 rounded-full border border-border shadow-sm"
              />
              {trikotFarbeLabel(trikot.wunschfarbe)}
            </span>
          </Angabe>
          <Angabe label="Voraussichtliche Kadergröße">{String(kader.expected_size)}</Angabe>
          <Angabe label="Davon im Verein aktiv (mind. Verbandsliga)">
            {kader.good_spieler === null ? <Leer /> : String(kader.good_spieler)}
          </Angabe>
          {/* The school's own words, rendered as TEXT and resolved against no club: it may name a
              school the league does not hold, and an applicant-controlled value is never markup. An
              empty string reaches here as readily as the `null` the write path produces. */}
          <Angabe label="Wunschgegner">{wunschgegner === null || wunschgegner.trim() === "" ? <Leer /> : wunschgegner}</Angabe>
        </dl>
      </Panel>

      {entscheidung !== null && (
        <Panel title="Entscheidung">
          <dl className={ANGABEN_GRID_CLASSES}>
            <Angabe label="Getroffen am">{formatSpielDatum(entscheidung.made_at)}</Angabe>
            <Angabe label="Von">
              {entscheidung.von === "" ? (
                "System"
              ) : (
                <VonOderGesperrt
                  von={entscheidung.von}
                  gesperrt={entscheidung.by_barred}
                />
              )}
            </Angabe>
            {/* Absent on an acceptance rather than filled in with „angenommen“: what an acceptance
                did is the club and the season entry it wrote. */}
            {entscheidung.grund !== null && <Angabe label="Grund">{entscheidung.grund}</Angabe>}
          </dl>
        </Panel>
      )}
    </>
  );
}
