"use client";

import { useId, useMemo, useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import { parseDate } from "@internationalized/date";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ABSATZ_CLASSES, FESTE_WERTE, Gefuellt, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AdresseGesperrt,
  ANTWORT_NICHT_GESPEICHERT,
  ANTWORT_NICHT_GESPEICHERT_SATZ,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FrageStellen,
  GespeicherteAngaben,
  LINK_UNLESBAR_TITEL,
  LinkUnlesbar,
  useLinkSeite,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import {
  SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
  SCHIEDSRICHTER_UMFANG_FRAGE,
  SCHIEDSRICHTER_UMFANG_WERTE,
} from "@/features/schiedsrichter/constants";
import { buildSchiedsrichterBestaetigungPayloadSchema } from "@/features/schiedsrichter/schemas";
import { Callout } from "@/shared/components/ui/Callout";
import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  FIELD_ERROR_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_PAIR_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
  TOGGLE_GROUP_ALIGN_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { OPTION_CHIP_CLASSES } from "@/shared/components/ui/optionChip";
import { Switch } from "@/shared/components/ui/Switch";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { GekeyteFassung, SchiedsrichterAbsatzSchluessel } from "@/core/einwilligungSeiten";
import type { FLSchiedsrichterBestaetigungPayload, FLSchiedsrichterUmfang } from "@/features/schiedsrichter/schemas";
import type { SchiedsrichterAnsichtGeoeffnet, SchiedsrichterLinkZustand } from "@/features/schiedsrichter/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { Slots } from "@/shared/utils/stampedSlots";
import type { Key } from "@heroui/react/rac";
import type { CalendarDate } from "@internationalized/date";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names nobody, and a dead link handed onward identifies nobody either.
 */
export type SchiedsrichterBestaetigungStart =
  | { zustand: "gueltig"; ansicht: SchiedsrichterAnsichtGeoeffnet; token: string; fassung: SchiedsrichterFassung }
  | { zustand: SchiedsrichterLinkZustand | "unlesbar" };

/**
 * The referee page's words under the label its answer stamps, handed in by the page: a component
 * reaching for the running words would render a text no stored record cites.
 */
type SchiedsrichterFassung = GekeyteFassung<SchiedsrichterAbsatzSchluessel, FLSchiedsrichterUmfang>;

type Absaetze = SchiedsrichterFassung["absaetze"];

type Gespeichert = { vorname: string; geburtsdatum: string; umfang: FLSchiedsrichterUmfang; medien: boolean };

type Stand = SchiedsrichterBestaetigungStart | ({ zustand: "erfolg" } & Gespeichert);

/** One heading per state, in the contact page's own words: one workflow's two ends read alike. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Eintrag bestätigen",
  erfolg: "Eintrag bestätigt",
  bestaetigt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

const LISTE_CLASSES = `${ABSATZ_CLASSES} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT_CLASSES = "flex flex-col gap-y-2";

/**
 * The slots a record fills from the person who opened the link
 * (`fl_frontend/src/features/bewerbungen/components/ui/Gefuellt.tsx :: Gefuellt`).
 */
const EIGENE_SLOTS = new Set(["vorname"]);

/** A stamped sentence, filled as `:: Gefuellt` fills one. */
function Absatz({ text, werte }: { text: string; werte: Slots }) {
  return (
    <Gefuellt
      text={text}
      werte={werte}
      eigene={EIGENE_SLOTS}
    />
  );
}

/** A stamped paragraph in the page's body grade, which every standing sentence here takes. */
function StandAbsatz({ text, werte }: { text: string; werte: Slots }) {
  return (
    <p className={ABSATZ_CLASSES}>
      <Absatz
        text={text}
        werte={werte}
      />
    </p>
  );
}

/**
 * Rendered in the order a reader meets it rather than the legal draft's order: the media paragraph
 * sits at its switch and the points at the button. **One column**, as the contact page keeps.
 */
function SchiedsrichterHinweise({ absaetze, werte }: { absaetze: Absaetze; werte: Slots }) {
  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Worum es geht</h3>
        <StandAbsatz
          text={absaetze.worum}
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was gespeichert ist und wozu</h3>
        <StandAbsatz
          text={absaetze.gespeichert}
          werte={werte}
        />
        <StandAbsatz
          text={absaetze.geburtsdatum}
          werte={werte}
        />
        <StandAbsatz
          text={absaetze.rechtsgrundlage}
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was nicht veröffentlicht wird</h3>
        <StandAbsatz
          text={absaetze.wer}
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wie lange Dein Eintrag bleibt</h3>
        <StandAbsatz
          text={absaetze.frist}
          werte={werte}
        />
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wenn Du etwas zurücknehmen willst</h3>
        <StandAbsatz
          text={absaetze.widerruf}
          werte={werte}
        />
        <StandAbsatz
          text={absaetze.art21}
          werte={werte}
        />
      </section>
    </BestaetigungAbschnitt>
  );
}

/**
 * **The one wording of the points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader met the same promise twice.
 */
function KlickBestaetigung({ absaetze, id, werte }: { absaetze: Absaetze; id: string; werte: Slots }) {
  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING_CLASSES}>Was Du mit dem Klick bestätigst</h3>
      <ul className={LISTE_CLASSES}>
        {(["klickIdentitaet", "klickEintrag", "klickAlter", "klickEinwilligung", "klickHinweise"] as const).map((schluessel) => (
          <li key={schluessel}>
            <Absatz
              text={absaetze[schluessel]}
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
function antwortPayload(token: string, textVersion: string, entwurf: Entwurf, medienAngeboten: boolean): FLSchiedsrichterBestaetigungPayload {
  return {
    token: token,
    geburtsdatum: entwurf.geburtsdatum,
    // The schema refuses a null, which is the refusal an unanswered question owes: the submit reports
    // it at the chips rather than sending a scope this person never picked.
    umfang: entwurf.umfang as FLSchiedsrichterUmfang,
    // Never the draft's own `true` where no switch stands: one given before the date moved below the
    // media age would send a consent this page withheld.
    medien: medienAngeboten && entwurf.medien,
    text_version: textVersion,
  };
}

type BestaetigungAntwort =
  ({ success: true } & Omit<Gespeichert, "vorname">) | (PublicEnvelope & { success: false; zustand?: SchiedsrichterLinkZustand });

/**
 * **The acknowledgement is the press, not a switch**: the points above the button say what the
 * press records, and a required „gelesen“ switch would be a second act recording the same thing.
 */
function SchiedsrichterFormPanel({
  fassung,
  token,
  vorname,
  mindestalter,
  medienMindestalter,
  onAbschluss,
}: {
  fassung: SchiedsrichterFassung;
  token: string;
  vorname: string;
  /** The floor the link's own read answered; a constant here would be a number the endpoint never judges by. */
  mindestalter: number;
  /** The media age the link's own read answered, for `mindestalter`'s reason. */
  medienMindestalter: number;
  onAbschluss: (stand: Stand) => void;
}) {
  const [isPending, startSending] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);

  const panel = formPanel();
  const klickPunkteId = useId();

  const werte = { ...FESTE_WERTE, minAlter: String(mindestalter), medienMinAlter: String(medienMindestalter), vorname: vorname };

  // Built from the floor the link answered, never a module constant: a schema on a floor of its own
  // would let the press through at a number the endpoint refuses.
  const antwortSchema = useMemo(() => buildSchiedsrichterBestaetigungPayloadSchema(mindestalter), [mindestalter]);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } =
    useDraftFieldErrors({
      schemas: { bestaetigung: antwortSchema },
      failureTitle: ANTWORT_NICHT_GESPEICHERT,
    });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

  // Off the date the age check reads, at the served media age: with no date yet the age is unknown,
  // and a switch offered then would be one the write refuses for anybody under it.
  const medienAngeboten =
    entwurf.geburtsdatum !== "" && entwurf.geburtsdatum <= geburtsdatumSpanne(getGermanTodayStr(), medienMindestalter).spaeteste;

  useForgiveFixed({ bestaetigung: antwortPayload(token, fassung.textVersion, entwurf, medienAngeboten) });

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // telling a 190-year-old what the age rule costs them is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const sende = async (payload: FLSchiedsrichterBestaetigungPayload): Promise<void> => {
    const gesendet = await postPublicForm<BestaetigungAntwort>("/api/bestaetigung/schiedsrichter", payload);

    if (!gesendet.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, {
        description: gesendet.error,
      });
      return;
    }

    const antwort = gesendet.body;

    // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
    // so bare it commits before the pending state lifts.
    startSending(() => {
      if (!antwort.success) {
        reportRefusedConfirmation(antwort, {
          onZustand: (zustand) => onAbschluss({ zustand }),
          // The hook owns the press's one toast: none where a field shows the refusal.
          onRefusal: () =>
            reportSubmitFailure(
              {
                success: false,
                error: antwort.error ?? ANTWORT_NICHT_GESPEICHERT_SATZ,
                fieldErrors: antwort.fieldErrors,
                unplacedError: antwort.unplacedError,
              },
              { bestaetigung: payload },
              { raise: (shown) => appToast.failure(ANTWORT_NICHT_GESPEICHERT, shown) },
            ),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      onAbschluss({ zustand: "erfolg", vorname: vorname, geburtsdatum: payload.geburtsdatum, umfang: antwort.umfang, medien: antwort.medien });
    });
  };

  const handleSubmit = () => {
    const payload = antwortPayload(token, fassung.textVersion, entwurf, medienAngeboten);
    guardSubmit({ bestaetigung: payload }, () => {
      startSending(async () => {
        await sende(payload);
      });
    });
  };

  return (
    <Form
      wiring={formWiring}
      data-required-marks="on"
      className="flex w-full flex-col gap-6"
      onSubmit={handleSubmit}>
      <SchiedsrichterHinweise
        absaetze={fassung.absaetze}
        werte={werte}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Dein Geburtsdatum</h3>
          {/* The form's own field grid, so one box on a wide page stands in a column rather than
              stretching the segments across it. */}
          <div className={FIELD_PAIR_CLASSES}>
            <AppDatePicker
              name="geburtsdatum"
              label={<Label className={FIELD_LABEL_CLASSES}>Dein Geburtsdatum</Label>}
              calendarLabel="Geburtsdatum auswählen"
              value={toCalendarDate(entwurf.geburtsdatum)}
              onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
              onBlur={() =>
                validatePaths("bestaetigung", antwortPayload(token, fassung.textVersion, entwurf, medienAngeboten), ["geburtsdatum"])
              }
              hint={`Spiele leiten kann nur, wer mindestens ${String(mindestalter)} Jahre alt ist. Das Datum wird mit Deinem Eintrag gespeichert.`}
              minValue={parseDate(frueheste)}
              maxValue={parseDate(spaeteste)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Auf der Website</h3>
          {/* Two chips and no default, as the pupil's page and the application form ask a required
              choice: a control resting on an answer records one this person did not give. */}
          <TextField
            name="umfang"
            value={entwurf.umfang ?? ""}
            className="w-full">
            <Label className={FIELD_LABEL_CLASSES}>{SCHIEDSRICHTER_UMFANG_FRAGE}</Label>
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
                const umfang = SCHIEDSRICHTER_UMFANG_WERTE.find((candidate) => candidate === picked);
                if (umfang !== undefined) setEntwurf({ ...entwurf, umfang: umfang });
              }}
              className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
              {/* The chips' words are the stamped label's, so a record reproduces the question beside its answer. */}
              {SCHIEDSRICHTER_UMFANG_WERTE.map((umfang) => (
                <ToggleButton
                  key={umfang}
                  id={umfang}
                  className={OPTION_CHIP_CLASSES}>
                  {fassung.bedienelemente[umfang]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* The field's own value carries the pick, so the refusal lands here rather than beside a
                group that renders no message of its own. */}
            <Input className="hidden" />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>
          <StandAbsatz
            text={fassung.absaetze.veroeffentlichung}
            werte={werte}
          />
        </section>

        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Freiwillig</h3>
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
                {fassung.schalter}
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          )}
          <StandAbsatz
            text={fassung.absaetze.medien}
            werte={werte}
          />
        </section>

        <KlickBestaetigung
          absaetze={fassung.absaetze}
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
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>
      </header>

      {stand.zustand === "gueltig" && (
        <SchiedsrichterFormPanel
          fassung={stand.fassung}
          token={stand.token}
          vorname={stand.ansicht.vorname}
          mindestalter={stand.ansicht.mindestalter}
          medienMindestalter={stand.ansicht.medien_mindestalter}
          onAbschluss={(naechster) => {
            beantwortet();
            setStand(naechster);
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
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
          <p className={ABSATZ_CLASSES}>
            Du musst nichts weiter tun. Sobald die Verwaltung Dich zu einem Spiel einteilt, erreichen wir Dich unter der Adresse, an die dieser
            Link ging.
          </p>
          <p className={ABSATZ_CLASSES}>Fragen, Änderungen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name from here on: a consumed or dead link may have been forwarded, and a dead link
          identifies nobody. */}
      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Dieser Eintrag ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ_CLASSES}>Fragen, Änderungen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both: a replaced link and an expired one cannot be told apart after the
          fact, and telling them apart would tell a guessed link that a record once existed. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage, und ein neuer ersetzt
            jeden früheren.
          </p>
          <p className={ABSATZ_CLASSES}>Dein Eintrag bleibt bestehen. Die Verwaltung schickt Dir auf Wunsch einen neuen Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
