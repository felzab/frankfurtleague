import { einwilligungHerkunftLabel, KONTAKT_ROLLEN, schulformLabel, trikotFarbeHex, trikotFarbeLabel } from "@/features/teams/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { formPanel } from "@/shared/components/ui/formPanel";
import { ExternalUrlSchema } from "@/shared/schemas";
import { formatAddressFull, formatSpielDatum } from "@/shared/utils/format";

import type { FLBewerbung } from "@/features/bewerbungen/schemas";
import type { ReactNode } from "react";

/** What an unanswered field reads as — the school left it empty, which is not the same as a zero. */
const NOT_RECORDED = "Nicht angegeben";

/** One stored fact. A `<dl>` is its only valid parent: the pair is what makes the value a fact about the label. */
function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-sm text-foreground min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/** A value the school did not fill in, in the one grade every empty field here takes. */
function Leer() {
  return <span className="text-foreground-muted/50 italic">{NOT_RECORDED}</span>;
}

/**
 * Validated before it becomes an `href`: the API serves this value unchecked, so a `javascript:`
 * string is a stored-XSS sink (`fl_frontend/src/shared/schemas.ts :: ExternalUrlSchema`). One that
 * fails stands as text.
 */
function Website({ url }: { url: string }) {
  if (url.trim() === "") return <Leer />;

  const safe = ExternalUrlSchema.safeParse(url);

  return safe.success ? (
    <a
      href={safe.data}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline underline-offset-2">
      {url}
    </a>
  ) : (
    <span className="text-foreground-muted">{url}</span>
  );
}

/** The panel shell every block below takes, so no two of them drift apart. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
        <h2 className={panel.heading()}>{title}</h2>
      </div>
      <div className={panel.body()}>{children}</div>
    </section>
  );
}

/** The one grid every block's facts stand in. */
const ANGABEN_GRID = "grid w-full grid-cols-1 gap-4 sm:grid-cols-2";

/**
 * Everything one school submitted, read-only. **Nothing here is editable**: an application is the
 * form three people filled in, and a decision moves `status`, `entscheidung` and `team_id` alone.
 */
export function BewerbungAngabenPanel({ bewerbung, teamName }: { bewerbung: FLBewerbung; teamName: string | null }) {
  const { schule, kontakte, trikot, kader, entscheidung } = bewerbung;

  return (
    <>
      <Panel title={schule === null ? "Bestehendes Team" : "Neue Schule"}>
        <dl className={ANGABEN_GRID}>
          <Angabe label="Team">{teamName ?? <Leer />}</Angabe>
          <Angabe label="Saison">{bewerbung.saison_id}</Angabe>
          <Angabe label="Eingereicht am">{formatSpielDatum(bewerbung.eingereicht_am)}</Angabe>

          {schule === null ? (
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
        <div className="flex w-full flex-col gap-y-5">
          {KONTAKT_ROLLEN.map(({ value, label }) => {
            const person = kontakte[value];

            return (
              <div
                key={value}
                className="flex w-full flex-col gap-y-2">
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>{label}</span>
                  {/* Stored rather than derived by comparing the two blocks: what the school
                      asserted is not the same claim as what happens to match. */}
                  {value === "ansprechperson" && kontakte.trainer_ist_ansprechperson && (
                    <span className={`${LABEL_BADGE} bg-brand/10 text-brand-solid`}>Zugleich Trainer</span>
                  )}
                </div>

                {person === null ? (
                  <p className="muted-hint">Für diese Rolle steht niemand mehr in der Bewerbung.</p>
                ) : (
                  <dl className={ANGABEN_GRID}>
                    <Angabe label="Name">{`${person.vorname} ${person.nachname}`}</Angabe>
                    <Angabe label="Geburtsdatum">{formatSpielDatum(person.geburtsdatum)}</Angabe>
                    <Angabe label="E-Mail">{person.email === "" ? <Leer /> : person.email}</Angabe>
                    <Angabe label="Telefon">{person.telefon === "" ? <Leer /> : person.telefon}</Angabe>
                    <Angabe label="Einwilligung">
                      {`${einwilligungHerkunftLabel(person.einwilligung.erteilt_von)}, ${formatSpielDatum(person.einwilligung.datum)}`}
                    </Angabe>
                    <Angabe label="Fassung">{person.einwilligung.text_version === "" ? <Leer /> : person.einwilligung.text_version}</Angabe>
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Trikot und Kader">
        <dl className={ANGABEN_GRID}>
          <Angabe label="Vorhandener Trikotsatz">{trikot.vorhandener_satz === "" ? <Leer /> : trikot.vorhandener_satz}</Angabe>
          <Angabe label="Wunschfarbe">
            {trikot.wunschfarbe === null ? (
              <Leer />
            ) : (
              <span className="flex flex-row items-center gap-x-2">
                {/* A ring rather than a filled disc, so Weiß reads as a colour instead of as a gap.
                    The fill is the league's CI hex, which no theme token tracks. */}
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: trikotFarbeHex(trikot.wunschfarbe) }}
                  className="border-border size-4 shrink-0 rounded-full border shadow-sm"
                />
                {trikotFarbeLabel(trikot.wunschfarbe)}
              </span>
            )}
          </Angabe>
          <Angabe label="Voraussichtliche Kadergröße">{String(kader.voraussichtliche_groesse)}</Angabe>
          <Angabe label="Davon starke Spieler">{kader.gute_spieler === null ? <Leer /> : String(kader.gute_spieler)}</Angabe>
        </dl>

        {/* The wish is not the assignment, and the estimate is not a squad: both are what the school
            expected, and nothing checks either against what it fields. */}
        <p className="muted-hint">
          Die Wunschfarbe ist ein Wunsch. Die Trikotfarbe des Teams legst Du bei der Zusage fest, und die Kaderzahlen sind die Schätzung der
          Schule.
        </p>
      </Panel>

      {entscheidung !== null && (
        <Panel title="Entscheidung">
          <dl className={ANGABEN_GRID}>
            <Angabe label="Getroffen am">{formatSpielDatum(entscheidung.getroffen_am)}</Angabe>
            <Angabe label="Von">{entscheidung.von === "" ? "System" : entscheidung.von}</Angabe>
            {/* Null on an acceptance: what an acceptance did is the club and the season entry it
                wrote, and a reason field filled in with „angenommen“ would be a weaker record of it. */}
            {entscheidung.grund !== null && <Angabe label="Grund">{entscheidung.grund}</Angabe>}
          </dl>
        </Panel>
      )}
    </>
  );
}
