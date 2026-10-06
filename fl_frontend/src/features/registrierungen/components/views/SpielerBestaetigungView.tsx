"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import { parseDate } from "@internationalized/date";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { KONTAKT_EMAIL } from "@/core/brand";
import { KONTO_HREF } from "@/core/kontoHref";
import { ABSATZ_CLASSES, FESTE_WERTE, Gefuellt, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AdresseGesperrt,
  ANTWORT_NICHT_GESPEICHERT,
  ANTWORT_NICHT_GESPEICHERT_SATZ,
  BestaetigungAbschnitt,
  BestaetigungErgebnis,
  FaktenBanner,
  FrageStellen,
  GespeicherteAngaben,
  LINK_UNLESBAR_TITEL,
  LinkUnlesbar,
  useLinkSeite,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
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
import { textLink } from "@/shared/components/ui/textLink";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import { EINWILLIGUNG_UMFANG_OPTIONS, SPIELER_UMFANG_FRAGE } from "../../constants";
import { buildRegistrierungBestaetigungPayloadSchema } from "../../schemas";

import type { SpielerAbsatzSchluessel, SpielerWiederkehrendAbsatzSchluessel } from "@/core/einwilligungSeiten";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { Slots } from "@/shared/utils/stampedSlots";
import type { Key } from "@heroui/react/rac";
import type { CalendarDate } from "@internationalized/date";
import type { FLEinwilligungUmfang } from "../../schemas";
import type {
  SpielerBestaetigungGeoeffnet,
  SpielerBestaetigungGespeichert,
  SpielerBestaetigungStart,
  SpielerFassung,
  SpielerLinkZustand,
  SpielerSeitenFassung,
} from "../../types";

// The words ride with the two states that show them, so neither can render without them.
type Stand =
  | (Extract<SpielerBestaetigungStart, { zustand: "gueltig" }> & { fassung: SpielerSeitenFassung })
  | Exclude<SpielerBestaetigungStart, { zustand: "gueltig" }>
  | { zustand: "erfolg"; ansicht: SpielerBestaetigungGeoeffnet; gespeichert: SpielerBestaetigungGespeichert; fassung: SpielerSeitenFassung };

/** An open link whose words could not be read is a page nobody can answer, which the failed read's panel says. */
function anfang(start: SpielerBestaetigungStart, fassung: SpielerSeitenFassung | null): Stand {
  if (start.zustand !== "gueltig") return start;

  return fassung === null ? { zustand: "unlesbar" } : { ...start, fassung: fassung };
}

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Registrierung bestätigen",
  erfolg: "Registrierung bestätigt",
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
const EIGENE_SLOTS = new Set(["vorname", "team", "schule", "saison"]);

/**
 * What each publication scope offers, in the order the copy reads them in.
 *
 * The words are the stamped label's, so a record reproduces the question beside the answer it holds;
 * the order is this page's, which no record cites.
 */
const umfangOptionen = (fassung: SpielerFassung): readonly { value: FLEinwilligungUmfang; label: string }[] =>
  EINWILLIGUNG_UMFANG_OPTIONS.map((value) => ({ value: value, label: fassung.bedienelemente[value] }));

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/** The paragraphs both pages hold under one key, which the standing text renders on either. */
type HinweisSchluessel = SpielerAbsatzSchluessel & SpielerWiederkehrendAbsatzSchluessel;

/** The two choices that stand, in the words of the label the page showed: the returning page's readout and every answer panel. */
function wahlZeilen(fassung: SpielerSeitenFassung, umfang: FLEinwilligungUmfang | null, medien: boolean | null) {
  return [
    ...(umfang === null ? [] : [{ label: "Auf der Website", wert: fassung.bedienelemente[umfang] }]),
    ...(medien === null ? [] : [{ label: "Fotos, Videos und Interviews", wert: medien ? "erlaubt" : "nicht erlaubt" }]),
  ];
}

/**
 * The standing text, in the order a reader meets it rather than the legal draft's: the media
 * paragraph sits at its switch and the points at the button.
 */
function SpielerHinweise({ absaetze, werte }: { absaetze: Readonly<Record<HinweisSchluessel, string>>; werte: Slots }) {
  const absatz = (schluessel: HinweisSchluessel) => (
    <Gefuellt
      text={absaetze[schluessel]}
      werte={werte}
      eigene={EIGENE_SLOTS}
    />
  );

  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Worum es geht</h3>
        <p className={ABSATZ_CLASSES}>{absatz("worum")}</p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ_CLASSES}>{absatz("gespeichert")}</p>
        <p className={ABSATZ_CLASSES}>{absatz("geburtsdatum")}</p>
        <p className={ABSATZ_CLASSES}>{absatz("rechtsgrundlage")}</p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wer was sieht</h3>
        <p className={ABSATZ_CLASSES}>{absatz("wer")}</p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wie lange wir Deine Angaben behalten</h3>
        <p className={ABSATZ_CLASSES}>{absatz("frist")}</p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Deine Rechte</h3>
        <p className={ABSATZ_CLASSES}>{absatz("widerruf")}</p>
        <p className={ABSATZ_CLASSES}>{absatz("art21")}</p>
      </section>
    </BestaetigungAbschnitt>
  );
}

/**
 * **The one wording of the points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader meets the same promise twice.
 */
function KlickBestaetigung({ id, fassung, werte }: { id: string; fassung: SpielerSeitenFassung; werte: Slots }) {
  // The returning page's points carry no consent: it asks none.
  const punkte =
    fassung.seite === "bestaetigung_spieler"
      ? [fassung.absaetze.klickIdentitaet, fassung.absaetze.klickAlter, fassung.absaetze.klickEinwilligung, fassung.absaetze.klickHinweise]
      : [fassung.absaetze.klickIdentitaet, fassung.absaetze.klickAlter, fassung.absaetze.klickHinweise];

  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING_CLASSES}>Was Du mit dem Klick bestätigst</h3>
      <ul className={LISTE_CLASSES}>
        {punkte.map((punkt) => (
          <li key={punkt}>
            <Gefuellt
              text={punkt}
              werte={werte}
              eigene={EIGENE_SLOTS}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

type Antwort =
  | { success: true; ergebnis: "bestaetigt"; geburtsdatum: string; umfang: FLEinwilligungUmfang | null; medien: boolean | null }
  | (PublicEnvelope & { success: false; zustand?: SpielerLinkZustand });

/**
 * The pupil's own confirmation.
 *
 * `fassung` is handed in rather than imported: the label freezes exactly what a reader saw, and a
 * component reaching for the current words would render a text no stored record cites.
 */
export function SpielerBestaetigungView({ start, fassung }: { start: SpielerBestaetigungStart; fassung: SpielerSeitenFassung | null }) {
  const [stand, setStand] = useState<Stand>(() => anfang(start, fassung));
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  // Off the CURRENT state and never the one the page opened on: a link the write found dead is
  // answered by a panel that names nobody, and the banner beside it would name the team anyway.
  const ansicht = stand.zustand === "gueltig" || stand.zustand === "erfolg" ? stand.ansicht : null;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        {ansicht !== null && <SaisonChip isLaufend={false}>Saison {ansicht.saison_id}</SaisonChip>}
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>

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
          fassung={stand.fassung}
          onAbschluss={(abschluss) => {
            beantwortet();
            setStand(
              abschluss.zustand === "erfolg"
                ? { zustand: "erfolg", ansicht: stand.ansicht, gespeichert: abschluss.gespeichert, fassung: stand.fassung }
                : { zustand: abschluss.zustand },
            );
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke, <Wert>{stand.ansicht.vorname}</Wert>. Deine Registrierung für <Wert>{stand.ansicht.team}</Wert> ist bestätigt.
          </p>
          <GespeicherteAngaben
            zeilen={[
              { label: "Geburtsdatum", wert: formatSpielDatum(stand.gespeichert.geburtsdatum) },
              ...wahlZeilen(stand.fassung, stand.gespeichert.umfang, stand.gespeichert.medien),
            ]}
          />
          <p className={ABSATZ_CLASSES}>
            Dein Team entscheidet jetzt über die Aufnahme in den Kader. Du musst nichts weiter tun und bekommst Bescheid.
          </p>
          <p className={ABSATZ_CLASSES}>Fragen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name and no team from here on: a consumed or dead link may have been forwarded, and a
          dead link identifies nobody. */}
      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Diese Registrierung ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ_CLASSES}>Fragen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both: after the deletion the record is gone and the two cannot be told
          apart, and telling them apart would tell a guessed link that a record once existed. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>Dieser Link ist ungültig oder abgelaufen, und die Registrierung dazu haben wir gelöscht.</p>
          <p className={ABSATZ_CLASSES}>Du kannst Dich über den Link Deines Teams einfach erneut registrieren.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}

type Abschluss = { zustand: "erfolg"; gespeichert: SpielerBestaetigungGespeichert } | { zustand: SpielerLinkZustand };

/**
 * The answers and the press.
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
  fassung: SpielerSeitenFassung;
  onAbschluss: (abschluss: Abschluss) => void;
}) {
  const [isPending, startSending] = useTransition();
  // Nothing preselected, whatever the read served: a media switch that opened on and a scope already
  // picked are consents nobody gave on this page.
  const [entwurf, setEntwurf] = useState<{ geburtsdatum: string; umfang: FLEinwilligungUmfang | null; medien: boolean }>({
    geburtsdatum: ansicht.geburtsdatum ?? "",
    umfang: null,
    medien: false,
  });

  const klickPunkteId = useId();
  const panel = formPanel();

  // Built from the floor the link answered, never the module's own: the endpoint judges this
  // person, so a schema on a constant would let the press through at the wrong number.
  const bestaetigungSchema = buildRegistrierungBestaetigungPayloadSchema(ansicht.mindestalter, fassung.seite);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } =
    useDraftFieldErrors({
      schemas: { bestaetigung: bestaetigungSchema },
      failureTitle: ANTWORT_NICHT_GESPEICHERT,
    });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), ansicht.mindestalter);

  const fragtWahlen = fassung.seite === "bestaetigung_spieler";

  // Off the date the age check reads, at the served media age: with no date yet the age is unknown,
  // and a switch offered then would be one the write refuses for anybody under it.
  const medienAngeboten =
    fragtWahlen &&
    entwurf.geburtsdatum !== "" &&
    entwurf.geburtsdatum <= geburtsdatumSpanne(getGermanTodayStr(), ansicht.medien_mindestalter).spaeteste;

  // The DRAFT's shape rather than the payload's: `umfang` stands unanswered until it is picked, and
  // the schema is what turns that into a field error rather than this builder into a cast.
  const payload = () => ({
    token: token,
    geburtsdatum: entwurf.geburtsdatum,
    // Both choices null from the returning page, which asks neither (`REQ-REGISTRIERUNG-017` refuses any other).
    umfang: fragtWahlen ? entwurf.umfang : null,
    // Never the draft's own `true` where no switch stands: one given before the date moved below the
    // media age would send a consent this page withheld.
    medien: fragtWahlen ? medienAngeboten && entwurf.medien : null,
    text_version: fassung.textVersion,
  });

  useForgiveFixed({ bestaetigung: payload() });

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // telling a 190-year-old to ask their team for a place is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const werte: Slots = {
    vorname: ansicht.vorname,
    team: ansicht.team,
    schule: ansicht.schule,
    saison: ansicht.saison_id,
    minAlter: String(ansicht.mindestalter),
    medienMinAlter: String(ansicht.medien_mindestalter),
    // Filled rather than left standing: `Gefuellt` leaves an unfilled slot as written, so the
    // consent text would spell its own placeholder on the live page.
    ...FESTE_WERTE,
  };

  const sende = () => {
    const body = payload();

    startSending(async () => {
      const gesendet = await postPublicForm<Antwort>("/api/bestaetigung/spieler", body);

      if (!gesendet.answered) {
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
                { bestaetigung: body },
                { raise: (shown) => appToast.failure(ANTWORT_NICHT_GESPEICHERT, shown) },
              ),
          });
          return;
        }

        setSubmitFieldErrors({}, {});
        onAbschluss({
          zustand: "erfolg",
          // The returning page's pair off the read, its answer carrying none: those choices stand.
          gespeichert: fragtWahlen
            ? { geburtsdatum: antwort.geburtsdatum, umfang: antwort.umfang, medien: antwort.medien }
            : { geburtsdatum: antwort.geburtsdatum, umfang: ansicht.umfang, medien: ansicht.medien },
        });
      });
    });
  };

  return (
    <Form
      wiring={formWiring}
      data-required-marks="on"
      className="flex w-full flex-col gap-6"
      onSubmit={() => {
        guardSubmit({ bestaetigung: payload() }, sende);
      }}>
      <SpielerHinweise
        absaetze={fassung.absaetze}
        werte={werte}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Dein Geburtsdatum</h3>

          {ansicht.geburtsdatum === null ? (
            <div className={FIELD_PAIR_CLASSES}>
              <AppDatePicker
                name="geburtsdatum"
                label={<Label className={FIELD_LABEL_CLASSES}>Dein Geburtsdatum</Label>}
                calendarLabel="Geburtsdatum auswählen"
                value={toCalendarDate(entwurf.geburtsdatum)}
                onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
                onBlur={() => validatePaths("bestaetigung", payload(), ["geburtsdatum"])}
                hint={`Daran prüfen wir, ob Du mindestens ${String(ansicht.mindestalter)} Jahre alt bist. Das Datum wird mit Deiner Registrierung gespeichert.`}
                minValue={parseDate(frueheste)}
                maxValue={parseDate(spaeteste)}
              />
            </div>
          ) : (
            // Shown rather than asked: the league already holds this person's date, and asking again
            // invites a second answer to a question that was settled once.
            <GespeicherteAngaben zeilen={[{ label: "Gespeichert", wert: formatSpielDatum(ansicht.geburtsdatum) }]} />
          )}
        </section>

        {fassung.seite === "bestaetigung_spieler" ? (
          <WahlenAbschnitte
            fassung={fassung}
            werte={werte}
            umfang={entwurf.umfang}
            medien={entwurf.medien}
            medienAngeboten={medienAngeboten}
            onUmfang={(umfang) => setEntwurf({ ...entwurf, umfang: umfang })}
            onMedien={(medien) => setEntwurf({ ...entwurf, medien: medien })}
            switchContentClassName={panel.switchContent()}
            switchControlClassName={panel.switchControl()}
          />
        ) : (
          <section className="flex flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>Deine Einwilligung</h3>
            <p className={ABSATZ_CLASSES}>
              <Gefuellt
                text={fassung.absaetze.einwilligungen}
                werte={werte}
                eigene={EIGENE_SLOTS}
              />
            </p>
            <GespeicherteAngaben zeilen={wahlZeilen(fassung, ansicht.umfang, ansicht.medien)} />
            {/* The way there alone: the stamped paragraph above already says what the account page changes. */}
            <p className={ABSATZ_CLASSES}>
              <Link
                href={KONTO_HREF}
                prefetch={false}
                className={textLink()}>
                Zum Konto
              </Link>
            </p>
          </section>
        )}

        <KlickBestaetigung
          id={klickPunkteId}
          fassung={fassung}
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

/** The new pupil's two choices, each below the paragraph it answers. */
function WahlenAbschnitte({
  fassung,
  werte,
  umfang,
  medien,
  medienAngeboten,
  onUmfang,
  onMedien,
  switchContentClassName,
  switchControlClassName,
}: {
  fassung: SpielerFassung;
  werte: Slots;
  umfang: FLEinwilligungUmfang | null;
  medien: boolean;
  medienAngeboten: boolean;
  onUmfang: (umfang: FLEinwilligungUmfang) => void;
  onMedien: (medien: boolean) => void;
  switchContentClassName: string;
  switchControlClassName: string;
}) {
  return (
    <>
      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Auf der Website</h3>
        {/* `ToggleButtonGroup` takes no `name`, so this proxy field is what names it: it is the
              control a refusal on the path reaches, and the hidden `Input` is what puts the name in
              `form.elements`. */}
        <TextField
          name="umfang"
          value={umfang ?? ""}
          onChange={() => undefined}
          className="flex w-full flex-col gap-y-1">
          <Label className={FIELD_LABEL_CLASSES}>{SPIELER_UMFANG_FRAGE}</Label>
          <ToggleButtonGroup
            aria-label={SPIELER_UMFANG_FRAGE}
            size="sm"
            isDetached
            selectionMode="single"
            // Never on a choice still unanswered: a pressed chip on first paint is a consent the
            // reader did not give.
            disallowEmptySelection={umfang !== null}
            selectedKeys={umfang === null ? [] : [umfang]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              const option = umfangOptionen(fassung).find((candidate) => candidate.value === picked);
              if (option !== undefined) onUmfang(option.value);
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {umfangOptionen(fassung).map((option) => (
              <ToggleButton
                key={option.value}
                id={option.value}
                className={OPTION_CHIP_CLASSES}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input className="hidden" />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>
        <p className={ABSATZ_CLASSES}>
          <Gefuellt
            text={fassung.absaetze.veroeffentlichung}
            werte={werte}
            eigene={EIGENE_SLOTS}
          />
        </p>
      </section>

      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Freiwillig</h3>
        {/* The paragraph below stands for every age and the switch alone goes: the record's label
              then reproduces the screen whichever of the two its person was shown. */}
        {medienAngeboten && (
          <Switch
            className="flex w-full flex-col gap-y-1"
            name="medien"
            isSelected={medien}
            onChange={onMedien}>
            <Switch.Content className={switchContentClassName}>
              {fassung.schalter}
              <Switch.Control className={switchControlClassName}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        )}
        <p className={ABSATZ_CLASSES}>
          <Gefuellt
            text={fassung.absaetze.medien}
            werte={werte}
            eigene={EIGENE_SLOTS}
          />
        </p>
      </section>
    </>
  );
}
