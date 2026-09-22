"use client";

import { Fragment, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { CircleCheck } from "@gravity-ui/icons";
import { parseDate } from "@internationalized/date";

import { Button, FieldError, Form, Input, Label, Switch, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { KONTAKT_EMAIL } from "@/core/brand";
import {
  ABSATZ,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FaktenBanner,
  FrageStellen,
  GespeicherteAngaben,
  Wert,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { Callout } from "@/shared/components/ui/Callout";
import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING, TOGGLE_GROUP_ALIGN } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { OPTION_CHIP } from "@/shared/components/ui/optionChip";
import { textLink } from "@/shared/components/ui/textLink";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";
import { postPublicForm } from "@/shared/utils/publicSubmit";

import { EINWILLIGUNG_UMFANG_OPTIONS } from "../../constants";
import { buildRegistrierungBestaetigungPayloadSchema } from "../../schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { Key } from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";
import type { FLEinwilligungUmfang } from "../../schemas";
import type {
  SpielerAbsatzSchluessel,
  SpielerBestaetigungDraft,
  SpielerBestaetigungGeoeffnet,
  SpielerBestaetigungStart,
  SpielerFassung,
  SpielerLinkZustand,
} from "../../types";

type Stand = SpielerBestaetigungStart | { zustand: "erfolg"; ansicht: SpielerBestaetigungGeoeffnet; gespeichert: SpielerBestaetigungDraft };

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. */
const TITEL: Record<Stand["zustand"], string> = {
  gueltig: "Registrierung bestätigen",
  erfolg: "Registrierung bestätigt",
  bestaetigt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

/** The application page's own column, so both ends of every public workflow are one page wide. */
const SEITE = "max-w-meta flex w-full flex-col gap-6 px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8";

const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";

const NICHT_GESPEICHERT = "Deine Antwort wurde nicht gespeichert. Versuche es erneut.";

/** The `{datenschutz}` slot's value, so the stored sentence and the rendered one read the same. */
const DATENSCHUTZ_TEXT = "Datenschutzerklärung";
const DATENSCHUTZ_SLOT = "datenschutz";

/** Split on the slots themselves, so the capture group keeps each one as a piece of its own. */
const SLOT_TEILER = /(\{\w+\})/;

/**
 * The slots a record fills from the person who opened the link. **Emphasis is presentation**, so it
 * is decided here rather than in the stored sentence, whose words and digest do not move for it.
 */
const EIGENE_SLOTS = new Set(["vorname", "team", "schule", "saison"]);

/**
 * What each publication scope offers, in the order the copy reads them in.
 *
 * The words are the stamped label's, so a record reproduces the question beside the answer it holds;
 * the order is this page's, which no record cites.
 */
const umfangOptionen = (fassung: SpielerFassung): readonly { value: FLEinwilligungUmfang; label: string }[] =>
  EINWILLIGUNG_UMFANG_OPTIONS.map((value) => ({ value: value, label: fassung.bedienelemente[value] }));

const UMFANG_FRAGE = "Was darf von Deinem Namen auf der Website stehen?";

type Slots = Readonly<Record<string, string>>;

function DatenschutzLink() {
  return (
    <Link
      href="/datenschutz"
      prefetch={false}
      className={textLink()}>
      {DATENSCHUTZ_TEXT}
    </Link>
  );
}

/** One piece of a split sentence: a slot in whatever its kind earns, or the words as they stand. */
function stueckInhalt(stueck: string, werte: Slots): ReactNode {
  const name = /^\{(\w+)\}$/.exec(stueck)?.[1];

  if (name === undefined) return stueck;
  // Ahead of the record, which holds no value for it: this slot's words are the page's own link.
  if (name === DATENSCHUTZ_SLOT) return <DatenschutzLink />;

  const wert = werte[name];

  // A slot no record filled stands as written, which is `fl_frontend/src/core/einwilligung.ts ::
  // fuelleFassung`'s rule at the string end.
  if (wert === undefined) return stueck;

  return EIGENE_SLOTS.has(name) ? <Wert>{wert}</Wert> : wert;
}

/**
 * A stamped sentence with its slots filled here rather than by `fuelleFassung`, which answers a
 * string: a string cannot carry the mark a reader's own name has to wear, nor the privacy link.
 */
function Gefuellt({ text, werte }: { text: string; werte: Slots }) {
  return (
    <>
      {text.split(SLOT_TEILER).map((stueck, index) => (
        <Fragment key={`${String(index)}-${stueck}`}>{stueckInhalt(stueck, werte)}</Fragment>
      ))}
    </>
  );
}

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * The standing text, in the order a reader meets it rather than the legal draft's: the media
 * paragraph sits at its switch and the four points at the button.
 */
function SpielerHinweise({ absaetze, werte }: { absaetze: SpielerFassung["absaetze"]; werte: Slots }) {
  const absatz = (schluessel: SpielerAbsatzSchluessel) => (
    <Gefuellt
      text={absaetze[schluessel]}
      werte={werte}
    />
  );

  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Worum es geht</h3>
        <p className={ABSATZ}>{absatz("worum")}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ}>{absatz("gespeichert")}</p>
        <p className={ABSATZ}>{absatz("geburtsdatum")}</p>
        <p className={ABSATZ}>{absatz("rechtsgrundlage")}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wer was sieht</h3>
        <p className={ABSATZ}>{absatz("wer")}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wie lange wir Deine Angaben behalten</h3>
        <p className={ABSATZ}>{absatz("frist")}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Deine Rechte</h3>
        <p className={ABSATZ}>{absatz("widerruf")}</p>
      </section>
    </BestaetigungAbschnitt>
  );
}

/**
 * **The one wording of the four points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader meets the same promise twice.
 */
function KlickBestaetigung({ id, absaetze, werte }: { id: string; absaetze: SpielerFassung["absaetze"]; werte: Slots }) {
  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING}>Was Du mit dem Klick bestätigst</h3>
      <ul className={LISTE}>
        {(["klickIdentitaet", "klickAlter", "klickEinwilligung", "klickHinweise"] as const).map((schluessel) => (
          <li key={schluessel}>
            <Gefuellt
              text={absaetze[schluessel]}
              werte={werte}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

type Antwort =
  | { success: true; ergebnis: "bestaetigt"; geburtsdatum: string; umfang: FLEinwilligungUmfang; medien: boolean }
  | { success: false; error?: string; fieldErrors?: FieldErrors; zustand?: SpielerLinkZustand };

/**
 * The pupil's own confirmation.
 *
 * `fassung` is handed in rather than imported: the label freezes exactly what a reader saw, and a
 * component reaching for the current words would render a text no stored record cites.
 */
export function SpielerBestaetigungView({ start, fassung }: { start: SpielerBestaetigungStart; fassung: SpielerFassung }) {
  const [stand, setStand] = useState<Stand>(start);
  const [hatGeantwortet, setHatGeantwortet] = useState(false);
  const ergebnisRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no token.
    // Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (stand.zustand === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [stand.zustand]);

  // The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
  // announced; the panel takes it, and `role="status"` reads it out.
  useEffect(() => {
    if (hatGeantwortet) ergebnisRef.current?.focus();
  }, [hatGeantwortet]);

  // Off the CURRENT state and never the one the page opened on: a link the write found dead is
  // answered by a panel that names nobody, and the banner beside it would name the team anyway.
  const ansicht = stand.zustand === "gueltig" || stand.zustand === "erfolg" ? stand.ansicht : null;

  return (
    <section className={SEITE}>
      <header className="flex w-full flex-col gap-3">
        {ansicht !== null && <SaisonChip isLaufend={false}>Saison {ansicht.saison_id}</SaisonChip>}
        <h1 className={`${DISPLAY_HEADING} fluid-3xl`}>{TITEL[stand.zustand]}</h1>

        {stand.zustand === "gueltig" && (
          <FaktenBanner
            zeilen={[
              { label: "Team", wert: stand.ansicht.team },
              { label: "Schule", wert: stand.ansicht.schule, unbegrenzt: true },
              { label: "Saison", wert: stand.ansicht.saison_id },
            ]}
          />
        )}
      </header>

      {stand.zustand === "gueltig" && (
        <SpielerBestaetigungForm
          token={stand.token}
          ansicht={stand.ansicht}
          fassung={fassung}
          onAbschluss={(abschluss) => {
            setHatGeantwortet(true);
            setStand(
              abschluss.zustand === "erfolg"
                ? { zustand: "erfolg", ansicht: stand.ansicht, gespeichert: abschluss.gespeichert }
                : { zustand: abschluss.zustand },
            );
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>
            Danke, <Wert>{stand.ansicht.vorname}</Wert>. Deine Registrierung für <Wert>{stand.ansicht.team}</Wert> ist bestätigt.
          </p>
          <GespeicherteAngaben
            zeilen={[
              { label: "Geburtsdatum", wert: formatSpielDatum(stand.gespeichert.geburtsdatum) },
              { label: "Auf der Website", wert: fassung.bedienelemente[stand.gespeichert.umfang] },
              { label: "Fotos und Videos", wert: stand.gespeichert.medien ? "erlaubt" : "nicht erlaubt" },
            ]}
          />
          <p className={ABSATZ}>
            Dein Team entscheidet jetzt über die Aufnahme in den Kader. Du musst nichts weiter tun und bekommst Bescheid.
          </p>
          <p className={ABSATZ}>Fragen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name and no team from here on: a consumed or dead link may have been forwarded, and a
          dead link identifies nobody. */}
      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>Diese Registrierung ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ}>Fragen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both: after the deletion the record is gone and the two cannot be told
          apart, and telling them apart would tell a guessed link that a record once existed. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ}>Dieser Link ist ungültig oder abgelaufen, und die Registrierung dazu haben wir gelöscht.</p>
          <p className={ABSATZ}>Du kannst Dich über den Link Deines Teams einfach noch einmal registrieren.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}
    </section>
  );
}

type Abschluss = { zustand: "erfolg"; gespeichert: SpielerBestaetigungDraft } | { zustand: SpielerLinkZustand };

/**
 * The three answers and the press.
 *
 * The controls stand in the order the copy reads them in — the date, the publication choice, the
 * media switch — because a reader meets each paragraph and then the control it is about.
 */
function SpielerBestaetigungForm({
  token,
  ansicht,
  fassung,
  onAbschluss,
}: {
  token: string;
  ansicht: SpielerBestaetigungGeoeffnet;
  fassung: SpielerFassung;
  onAbschluss: (abschluss: Abschluss) => void;
}) {
  const [isPending, startTransition] = useTransition();
  // The stored answers for a returning pupil and nothing preselected for a new one: a media switch
  // that opened on and a scope already picked are consents nobody gave.
  const [entwurf, setEntwurf] = useState<{ geburtsdatum: string; umfang: FLEinwilligungUmfang | null; medien: boolean }>({
    geburtsdatum: ansicht.geburtsdatum ?? "",
    umfang: ansicht.umfang,
    medien: ansicht.medien ?? false,
  });

  const geburtsdatumHinweisId = useId();
  const klickPunkteId = useId();
  const panel = formPanel();

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    // Built from the floor the link answered, never the module's own: the endpoint judges this
    // person, so a schema on a constant would let the press through at the wrong number.
    schemas: { bestaetigung: buildRegistrierungBestaetigungPayloadSchema(ansicht.mindestalter) },
    failureTitle: "Antwort nicht gespeichert",
  });

  // The DRAFT's shape rather than the payload's: `umfang` stands unanswered until it is picked, and
  // the schema is what turns that into a field error rather than this builder into a cast.
  const payload = () => ({
    token: token,
    geburtsdatum: entwurf.geburtsdatum,
    umfang: entwurf.umfang,
    medien: entwurf.medien,
    text_version: fassung.textVersion,
  });

  useForgiveFixed({ bestaetigung: payload() });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), ansicht.mindestalter);

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // telling a 190-year-old to ask their team for a place is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const werte: Slots = {
    vorname: ansicht.vorname,
    team: ansicht.team,
    schule: ansicht.schule,
    saison: ansicht.saison_id,
    minAlter: String(ansicht.mindestalter),
    kontakt: KONTAKT_EMAIL,
    // Filled rather than left standing: `fuelleFassung` leaves an unfilled slot as written, so the
    // consent text would spell its own placeholder on the live page.
    loeschung: "Konto löschen",
  };

  const sende = () => {
    const body = payload();

    startTransition(async () => {
      const gesendet = await postPublicForm<Antwort>("/api/bestaetigung/spieler", body);

      if (!gesendet.answered) {
        appToast.danger(gesendet.wroteNothing ? "Antwort nicht gespeichert" : "Unklar, ob es bei uns angekommen ist", {
          description: gesendet.error,
        });
        return;
      }

      const antwort = gesendet.body;

      if (!antwort.success) {
        // The link died between the open and the press: the answer is the panel, never a toast.
        if (antwort.zustand !== undefined) {
          onAbschluss({ zustand: antwort.zustand });
          return;
        }

        setSubmitFieldErrors(antwort.fieldErrors ?? {}, { bestaetigung: body });

        if (!hasFieldErrors(antwort.fieldErrors)) {
          appToast.danger("Antwort nicht gespeichert", { description: antwort.error ?? NICHT_GESPEICHERT });
        }
        return;
      }

      setSubmitFieldErrors({}, {});
      onAbschluss({
        zustand: "erfolg",
        gespeichert: { geburtsdatum: antwort.geburtsdatum, umfang: antwort.umfang, medien: antwort.medien },
      });
    });
  };

  return (
    <Form
      ref={formRef}
      // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
      validationBehavior="aria"
      data-required-marks="on"
      validationErrors={fieldErrors}
      className="flex w-full flex-col gap-6"
      onSubmit={runOnSubmit(() => {
        guardSubmit({ bestaetigung: payload() }, sende);
      })}>
      <SpielerHinweise
        absaetze={fassung.absaetze}
        werte={werte}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Dein Geburtsdatum</h3>

          {ansicht.geburtsdatum === null ? (
            <div className={FIELD_PAIR}>
              <div className="flex flex-col gap-y-2">
                <AppDatePicker
                  isRequired
                  name="geburtsdatum"
                  label={<Label className={FIELD_LABEL}>Dein Geburtsdatum</Label>}
                  calendarLabel="Geburtsdatum auswählen"
                  value={toCalendarDate(entwurf.geburtsdatum)}
                  onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
                  onBlur={() => validatePaths("bestaetigung", payload(), ["geburtsdatum"])}
                  aria-describedby={geburtsdatumHinweisId}
                  minValue={parseDate(frueheste)}
                  maxValue={parseDate(spaeteste)}
                />
                <Hint
                  mode="inline"
                  describes={geburtsdatumHinweisId}
                  text={`Daran prüfen wir, ob Du mindestens ${String(ansicht.mindestalter)} Jahre alt bist. Das Datum wird mit Deiner Registrierung gespeichert.`}
                />
              </div>
            </div>
          ) : (
            // Shown rather than asked: the league already holds this person's date, and asking again
            // invites a second answer to a question that was settled once.
            <GespeicherteAngaben zeilen={[{ label: "Gespeichert", wert: formatSpielDatum(ansicht.geburtsdatum) }]} />
          )}
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Auf der Website</h3>
          {/* `ToggleButtonGroup` takes no `name`, so this proxy field is what names it: it is the
              control a refusal on the path reaches, and the hidden `Input` is what puts the name in
              `form.elements`. */}
          <TextField
            isRequired
            name="umfang"
            value={entwurf.umfang ?? ""}
            onChange={() => undefined}
            className="flex w-full flex-col gap-y-1">
            <Label className={FIELD_LABEL}>{UMFANG_FRAGE}</Label>
            <ToggleButtonGroup
              aria-label={UMFANG_FRAGE}
              size="sm"
              isDetached
              selectionMode="single"
              // Never on a choice still unanswered: a pressed chip on first paint is a consent the
              // reader did not give.
              disallowEmptySelection={entwurf.umfang !== null}
              selectedKeys={entwurf.umfang === null ? [] : [entwurf.umfang]}
              onSelectionChange={(keys: Set<Key>) => {
                const [picked] = [...keys].map(String);
                const option = umfangOptionen(fassung).find((candidate) => candidate.value === picked);
                if (option !== undefined) setEntwurf({ ...entwurf, umfang: option.value });
              }}
              className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
              {umfangOptionen(fassung).map((option) => (
                <ToggleButton
                  key={option.value}
                  id={option.value}
                  className={OPTION_CHIP}>
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Input className="hidden" />
            <FieldError className={FIELD_ERROR} />
          </TextField>
          <p className={ABSATZ}>
            <Gefuellt
              text={fassung.absaetze.veroeffentlichung}
              werte={werte}
            />
          </p>
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Freiwillig</h3>
          <Switch
            className="flex w-full flex-col gap-y-1"
            name="medien"
            isSelected={entwurf.medien}
            onChange={(medien) => setEntwurf({ ...entwurf, medien: medien })}>
            <Switch.Content className={panel.switchContent()}>
              {fassung.schalter}
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          <p className={ABSATZ}>
            <Gefuellt
              text={fassung.absaetze.medien}
              werte={werte}
            />
          </p>
        </section>

        <KlickBestaetigung
          id={klickPunkteId}
          absaetze={fassung.absaetze}
          werte={werte}
        />

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du noch nicht mitspielen.">
            Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es, kannst Du in dieser Saison leider nicht mitspielen; wir löschen Deine
            Registrierung von selbst.
          </Callout>
        )}

        <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            isPending={isPending}
            aria-describedby={klickPunkteId}
            className={formButton({ intent: "submit", fullWidth: true })}>
            <CircleCheck
              className="size-4.5"
              aria-hidden="true"
            />
            {isPending ? "Sendet..." : "Registrierung bestätigen"}
          </Button>
        </div>
      </BestaetigungAbschnitt>
    </Form>
  );
}
