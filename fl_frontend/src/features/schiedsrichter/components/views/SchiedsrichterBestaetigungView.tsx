"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { CircleCheck } from "@gravity-ui/icons";
import { parseDate } from "@internationalized/date";

import { Button, FieldError, Form, Input, Label, Switch, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { KONTAKT_EMAIL } from "@/core/brand";
import { SCHIEDSRICHTER_EINWILLIGUNG } from "@/core/einwilligung";
import {
  ABSATZ,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FrageStellen,
  Gefuellt,
  GespeicherteAngaben,
  Wert,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import {
  SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
  SCHIEDSRICHTER_UMFANG_FRAGE,
  SCHIEDSRICHTER_UMFANG_OPTIONS,
} from "@/features/schiedsrichter/constants";
import { buildSchiedsrichterBestaetigungPayloadSchema } from "@/features/schiedsrichter/schemas";
import { Callout } from "@/shared/components/ui/Callout";
import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING, TOGGLE_GROUP_ALIGN } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { OPTION_CHIP } from "@/shared/components/ui/optionChip";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";
import { ANTWORT_UNKLAR, postPublicForm } from "@/shared/utils/publicSubmit";

import type { Slots } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import type { FLSchiedsrichterBestaetigungPayload, FLSchiedsrichterUmfang } from "@/features/schiedsrichter/schemas";
import type { SchiedsrichterAnsichtGeoeffnet, SchiedsrichterLinkZustand } from "@/features/schiedsrichter/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { Key } from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names nobody, and a dead link handed onward identifies nobody either.
 */
export type SchiedsrichterBestaetigungStart =
  { zustand: "gueltig"; ansicht: SchiedsrichterAnsichtGeoeffnet; token: string } | { zustand: SchiedsrichterLinkZustand | "unlesbar" };

type Gespeichert = { vorname: string; geburtsdatum: string; umfang: FLSchiedsrichterUmfang; medien: boolean };

type Stand = SchiedsrichterBestaetigungStart | ({ zustand: "erfolg" } & Gespeichert);

/** One heading per state, in the contact page's own words: one workflow's two ends read alike. */
const TITEL: Record<Stand["zustand"], string> = {
  gueltig: "Eintrag bestätigen",
  erfolg: "Eintrag bestätigt",
  bestaetigt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

/** The contact confirmation's own column, so the league's two consent pages are one page wide. */
const SEITE = "max-w-meta flex w-full flex-col gap-6 px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8";

const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";

const NICHT_GESPEICHERT = "Deine Antwort wurde nicht gespeichert. Versuche es erneut.";

/** This page's own word for the failure: „Änderung nicht gespeichert“ names a change nobody here made. */
const ANTWORT_NICHT_GESPEICHERT = "Antwort nicht gespeichert";

/** The slots a record fills from the person who opened the link (`BestaetigungPanels.tsx :: Gefuellt`). */
const EIGENE_SLOTS = new Set(["vorname"]);

/** The words every reader's copy fills alike; the rest come off the record the page was opened with. */
const KONSTANTEN = { kontakt: KONTAKT_EMAIL, loeschung: "Konto löschen" } as const;

// Read off the stamped version rather than off the paragraph object beside it: the words this page
// renders and the label its press stores are then one source, which a rewording cannot part.
type Schluessel = keyof typeof SCHIEDSRICHTER_EINWILLIGUNG.absaetzeNachSchluessel;

/** A stamped sentence, filled as `BestaetigungPanels.tsx :: Gefuellt` fills one. */
function Absatz({ schluessel, werte }: { schluessel: Schluessel; werte: Slots }) {
  return (
    <Gefuellt
      text={SCHIEDSRICHTER_EINWILLIGUNG.absaetzeNachSchluessel[schluessel]}
      werte={werte}
      eigene={EIGENE_SLOTS}
    />
  );
}

/** A stamped paragraph in the page's body grade, which every standing sentence here takes. */
function StandAbsatz({ schluessel, werte }: { schluessel: Schluessel; werte: Slots }) {
  return (
    <p className={ABSATZ}>
      <Absatz
        schluessel={schluessel}
        werte={werte}
      />
    </p>
  );
}

/**
 * Rendered in the order a reader meets it rather than the legal draft's order: the media paragraph
 * sits at its switch and the four points at the button. **One column**, as the contact page keeps.
 */
function SchiedsrichterHinweise({ werte }: { werte: Slots }) {
  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Worum es geht</h3>
        <StandAbsatz
          schluessel="worum"
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was gespeichert ist und wozu</h3>
        <StandAbsatz
          schluessel="gespeichert"
          werte={werte}
        />
        <StandAbsatz
          schluessel="geburtsdatum"
          werte={werte}
        />
        <StandAbsatz
          schluessel="rechtsgrundlage"
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was nicht veröffentlicht wird</h3>
        <StandAbsatz
          schluessel="wer"
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wie lange Dein Eintrag bleibt</h3>
        <StandAbsatz
          schluessel="frist"
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wenn Du etwas zurücknehmen willst</h3>
        <StandAbsatz
          schluessel="widerruf"
          werte={werte}
        />
        <StandAbsatz
          schluessel="art21"
          werte={werte}
        />
      </section>
    </BestaetigungAbschnitt>
  );
}

/**
 * **The one wording of the five points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader met the same promise twice.
 */
function KlickBestaetigung({ id, werte }: { id: string; werte: Slots }) {
  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING}>Was Du mit dem Klick bestätigst</h3>
      <ul className={LISTE}>
        {(["klickIdentitaet", "klickEintrag", "klickAlter", "klickEinwilligung", "klickHinweise"] as const).map((schluessel) => (
          <li key={schluessel}>
            <Absatz
              schluessel={schluessel}
              werte={werte}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// The DRAFT's shape rather than the payload's: `umfang` stands unanswered until it is picked, and
// a draft that could not hold "unanswered" would send a choice nobody made.
/** The date mid-entry is a string, `""` being the empty picker; the judged shape is the payload's. */
type Entwurf = { geburtsdatum: string; umfang: FLSchiedsrichterUmfang | null; medien: boolean };

const LEERER_ENTWURF: Entwurf = { geburtsdatum: "", umfang: null, medien: false };

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * What the press sends. `text_version` is the label this page rendered, which the handler admits only
 * where it is still the one it serves.
 */
function antwortPayload(token: string, entwurf: Entwurf, medienAngeboten: boolean): FLSchiedsrichterBestaetigungPayload {
  return {
    token: token,
    geburtsdatum: entwurf.geburtsdatum,
    // The schema refuses a null, which is the refusal an unanswered question owes: the submit reports
    // it at the chips rather than sending a scope this person never picked.
    umfang: entwurf.umfang as FLSchiedsrichterUmfang,
    // Never the draft's own `true` where no switch stands: one given before the date moved below the
    // media age would send a consent this page withheld.
    medien: medienAngeboten && entwurf.medien,
    text_version: SCHIEDSRICHTER_EINWILLIGUNG.textVersion,
  };
}

type BestaetigungAntwort =
  ({ success: true } & Omit<Gespeichert, "vorname">) | (PublicEnvelope & { success: false; zustand?: SchiedsrichterLinkZustand });

/**
 * **The acknowledgement is the press, not a switch**: the five points above the button say what the
 * press records, and a required „gelesen“ switch would be a second act recording the same thing.
 */
function SchiedsrichterFormPanel({
  token,
  vorname,
  mindestalter,
  medienMindestalter,
  onAbschluss,
}: {
  token: string;
  vorname: string;
  /** The floor the link's own read answered; a constant here would be a number the endpoint never judges by. */
  mindestalter: number;
  /** The media age the link's own read answered, for `mindestalter`'s reason. */
  medienMindestalter: number;
  onAbschluss: (stand: Stand) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);

  const panel = formPanel();
  const geburtsdatumHinweisId = useId();
  const klickPunkteId = useId();

  const werte = { ...KONSTANTEN, minAlter: String(mindestalter), medienMinAlter: String(medienMindestalter), vorname: vorname };

  // Built from the floor the link answered, never a module constant: a schema on a floor of its own
  // would let the press through at a number the endpoint refuses.
  const antwortSchema = useMemo(() => buildSchiedsrichterBestaetigungPayloadSchema(mindestalter), [mindestalter]);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { bestaetigung: antwortSchema },
    failureTitle: ANTWORT_NICHT_GESPEICHERT,
  });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

  // Off the date the age check reads, at the served media age: with no date yet the age is unknown,
  // and a switch offered then would be one the write refuses for anybody under it.
  const medienAngeboten =
    entwurf.geburtsdatum !== "" && entwurf.geburtsdatum <= geburtsdatumSpanne(getGermanTodayStr(), medienMindestalter).spaeteste;

  useForgiveFixed({ bestaetigung: antwortPayload(token, entwurf, medienAngeboten) });

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // telling a 190-year-old what the age rule costs them is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const sende = async (payload: FLSchiedsrichterBestaetigungPayload): Promise<void> => {
    const gesendet = await postPublicForm<BestaetigungAntwort>("/api/bestaetigung/schiedsrichter", payload);

    if (!gesendet.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : "Unklar, ob es bei uns angekommen ist", {
        description: gesendet.error,
      });
      return;
    }

    const antwort = gesendet.body;

    if (!antwort.success) {
      // Titled as an unread answer is, the confirmation having perhaps landed: the envelope's own
      // sentence is an administrator's repair, and a reload of this page has lost its token.
      if (antwort.outcome === "unknown") {
        appToast.danger("Unklar, ob es bei uns angekommen ist", { description: ANTWORT_UNKLAR });
        return;
      }

      // The link died between the open and the press: the answer is the panel, never a toast.
      if (antwort.zustand !== undefined) {
        onAbschluss({ zustand: antwort.zustand });
        return;
      }

      // The hook owns the press's one toast: none where a field shows the refusal.
      reportSubmitFailure(
        { success: false, error: antwort.error ?? NICHT_GESPEICHERT, fieldErrors: antwort.fieldErrors, unplacedError: antwort.unplacedError },
        { bestaetigung: payload },
        { raise: (shown) => appToast.failure(ANTWORT_NICHT_GESPEICHERT, shown) },
      );
      return;
    }

    setSubmitFieldErrors({}, {});
    onAbschluss({ zustand: "erfolg", vorname: vorname, geburtsdatum: payload.geburtsdatum, umfang: antwort.umfang, medien: antwort.medien });
  };

  const handleSubmit = () => {
    const payload = antwortPayload(token, entwurf, medienAngeboten);
    guardSubmit({ bestaetigung: payload }, () => {
      startTransition(async () => {
        await sende(payload);
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
      onSubmit={runOnSubmit(handleSubmit)}>
      <SchiedsrichterHinweise werte={werte} />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Dein Geburtsdatum</h3>
          {/* The form's own field grid, so one box on a wide page stands in a column rather than
              stretching the segments across it. */}
          <div className={FIELD_PAIR}>
            <div className="flex flex-col gap-y-2">
              <AppDatePicker
                isRequired
                name="geburtsdatum"
                label={<Label className={FIELD_LABEL}>Dein Geburtsdatum</Label>}
                calendarLabel="Geburtsdatum auswählen"
                value={toCalendarDate(entwurf.geburtsdatum)}
                onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
                onBlur={() => validatePaths("bestaetigung", antwortPayload(token, entwurf, medienAngeboten), ["geburtsdatum"])}
                aria-describedby={geburtsdatumHinweisId}
                minValue={parseDate(frueheste)}
                maxValue={parseDate(spaeteste)}
              />
              <Hint
                mode="inline"
                describes={geburtsdatumHinweisId}
                text={`Spiele leiten kann nur, wer mindestens ${String(mindestalter)} Jahre alt ist. Das Datum wird mit Deinem Eintrag gespeichert.`}
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Auf der Website</h3>
          {/* Two chips and no default, as the pupil's page and the application form ask a required
              choice: a control resting on an answer records one this person did not give. */}
          <TextField
            isRequired
            name="umfang"
            value={entwurf.umfang ?? ""}
            className="w-full">
            <Label className={FIELD_LABEL}>{SCHIEDSRICHTER_UMFANG_FRAGE}</Label>
            <ToggleButtonGroup
              aria-label={SCHIEDSRICHTER_UMFANG_FRAGE}
              size="sm"
              isDetached
              selectionMode="single"
              // Never on a choice still unanswered: a pressed chip on first paint is a consent the
              // reader did not give.
              disallowEmptySelection={entwurf.umfang !== null}
              selectedKeys={entwurf.umfang === null ? [] : [entwurf.umfang]}
              onSelectionChange={(keys: Set<Key>) => {
                const [picked] = [...keys].map(String);
                const option = SCHIEDSRICHTER_UMFANG_OPTIONS.find((candidate) => candidate.value === picked);
                if (option !== undefined) setEntwurf({ ...entwurf, umfang: option.value });
              }}
              className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
              {SCHIEDSRICHTER_UMFANG_OPTIONS.map((option) => (
                <ToggleButton
                  key={option.value}
                  id={option.value}
                  className={OPTION_CHIP}>
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* The field's own value carries the pick, so the refusal lands here rather than beside a
                group that renders no message of its own. */}
            <Input className="hidden" />
            <FieldError className={FIELD_ERROR} />
          </TextField>
          <StandAbsatz
            schluessel="veroeffentlichung"
            werte={werte}
          />
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Freiwillig</h3>
          {/* The paragraph below stands for every age and the switch alone goes: the record's label then
              reproduces the screen whichever of the two its person was shown. */}
          {medienAngeboten && (
            // Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing.
            <Switch
              className="flex w-full flex-col gap-y-1"
              name="medien"
              isSelected={entwurf.medien}
              onChange={(medien) => setEntwurf({ ...entwurf, medien: medien })}>
              <Switch.Content className={panel.switchContent()}>
                {SCHIEDSRICHTER_EINWILLIGUNG.schalter}
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          )}
          <StandAbsatz
            schluessel="medien"
            werte={werte}
          />
        </section>

        <KlickBestaetigung
          id={klickPunkteId}
          werte={werte}
        />

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du noch nicht pfeifen.">
            Schiedsrichterinnen und Schiedsrichter müssen mindestens {String(mindestalter)} Jahre alt sein. Dein Eintrag bleibt bestehen; melde
            Dich bei der Verwaltung, wenn das Datum nicht stimmt.
          </Callout>
        )}

        <div className="flex w-full flex-col items-stretch sm:flex-row sm:justify-end">
          <Button
            type="submit"
            isPending={isPending}
            aria-describedby={klickPunkteId}
            className={formButton({ intent: "submit", stacks: true })}>
            <CircleCheck
              className="size-4.5"
              aria-hidden="true"
            />
            {isPending ? "Sendet..." : "Eintrag bestätigen"}
          </Button>
        </div>
      </BestaetigungAbschnitt>
    </Form>
  );
}

/**
 * One page for every state a link can be in, framed by the site's own navbar and footer: a referee
 * opening the link on a phone lands on the site the email named.
 */
export function SchiedsrichterBestaetigungView({ start }: { start: SchiedsrichterBestaetigungStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const [hatGeantwortet, setHatGeantwortet] = useState(false);
  const ergebnisRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no
    // token. Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (stand.zustand === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [stand.zustand]);

  // The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
  // announced; the panel takes it, and `role="status"` reads it out.
  useEffect(() => {
    if (hatGeantwortet) ergebnisRef.current?.focus();
  }, [hatGeantwortet]);

  return (
    <section className={SEITE}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING} fluid-3xl`}>{TITEL[stand.zustand]}</h1>
      </header>

      {stand.zustand === "gueltig" && (
        <SchiedsrichterFormPanel
          token={stand.token}
          vorname={stand.ansicht.vorname}
          mindestalter={stand.ansicht.mindestalter}
          medienMindestalter={stand.ansicht.medien_mindestalter}
          onAbschluss={(naechster) => {
            setHatGeantwortet(true);
            setStand(naechster);
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>
            Danke, <Wert>{stand.vorname}</Wert>. Dein Eintrag als Schiedsrichterin oder Schiedsrichter ist bestätigt.
          </p>
          {/* What the press stored and nothing the reader already knows: the three answers they just
              gave, in the words the panels above asked them in. */}
          <GespeicherteAngaben
            zeilen={[
              { label: "Geburtsdatum", wert: formatSpielDatum(stand.geburtsdatum) },
              { label: "Name im Spielplan", wert: stand.umfang === "kader_oeffentlich" ? "wird angezeigt" : "anonym" },
              { label: "Fotos, Videos und Interviews", wert: stand.medien ? "erlaubt" : "nicht erlaubt" },
            ]}
          />
          <p className={ABSATZ}>
            Du musst nichts weiter tun. Sobald die Verwaltung Dich zu einem Spiel einteilt, erreichen wir Dich unter der Adresse, an die dieser
            Link ging.
          </p>
          <p className={ABSATZ}>Fragen, Änderungen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name from here on: a consumed or dead link may have been forwarded, and a dead link
          identifies nobody. */}
      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>Dieser Eintrag ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ}>Fragen, Änderungen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both: a replaced link and an expired one cannot be told apart after the
          fact, and telling them apart would tell a guessed link that a record once existed. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ}>
            Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage, und ein neuer ersetzt
            jeden früheren.
          </p>
          <p className={ABSATZ}>Dein Eintrag bleibt bestehen. Die Verwaltung schickt Dir auf Wunsch einen neuen Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* Says that it does not know, and nothing else: folded into the dead-link panel, this arm
          would call a live link void on a day the backend was merely unreachable. */}
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
