"use client";

import { useState, useTransition } from "react";
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
import { SPIELER_TEXT_VERSIONS, SPIELER_WORDINGS } from "@/core/consentWordings";
import { ROUTES } from "@/core/routes";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import { EinwilligungZeile } from "@/features/bewerbungen/components/views/BestaetigungHinweise";
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
  medienZeile,
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

import { EINWILLIGUNG_UMFANG_OPTIONS } from "../../constants";
import { buildRegistrierungBestaetigungPayloadSchema } from "../../schemas";

import type { FLEinwilligungUmfang, FLRegistrierungConfirmationViewResponse } from "@/core/generated/client/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { Key } from "@heroui/react/rac";
import type { CalendarDate } from "@internationalized/date";
import type { SpielerBestaetigungGespeichert, SpielerBestaetigungStart, SpielerLinkZustand, SpielerSeitenFassung } from "../../types";

// The words ride with the two states that show them, so neither can render without them.
type Stand =
  | (Extract<SpielerBestaetigungStart, { zustand: "valid" }> & { wording: SpielerSeitenFassung })
  | Exclude<SpielerBestaetigungStart, { zustand: "valid" }>
  | {
      zustand: "erfolg";
      ansicht: FLRegistrierungConfirmationViewResponse;
      gespeichert: SpielerBestaetigungGespeichert;
      wording: SpielerSeitenFassung;
    };

/** An open link whose words could not be read is a page nobody can answer, which the failed read's panel says. */
function anfang(start: SpielerBestaetigungStart, fassung: SpielerSeitenFassung | null): Stand {
  if (start.zustand !== "valid") return start;

  return fassung === null ? { zustand: "unlesbar" } : { ...start, wording: fassung };
}

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "barred">, string> = {
  valid: "Registrierung bestätigen",
  erfolg: "Registrierung bestätigt",
  confirmed: "Schon erledigt",
  expired: "Link ungültig",
  invalid: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

/**
 * What each publication scope offers, in the order the copy reads them in.
 *
 * The words are the wording's, so a record reproduces the question beside the answer it holds; the
 * order is this page's, which no record cites.
 */
const UMFANG_OPTIONEN: readonly { value: FLEinwilligungUmfang; label: string }[] = EINWILLIGUNG_UMFANG_OPTIONS.map((value) => ({
  value: value,
  label: SPIELER_WORDINGS.umfang.options[value],
}));

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/** The two choices the new pupil's page took, in the words of the wording it showed: its answer panel's readout. */
function wahlZeilen(umfang: FLEinwilligungUmfang | null, media: boolean | null) {
  return [
    ...(umfang === null ? [] : [{ label: "Auf der Website", value: SPIELER_WORDINGS.umfang.options[umfang] }]),
    ...(media === null ? [] : [medienZeile(media)]),
  ];
}

type Antwort =
  | { success: true; ergebnis: "confirmed"; geburtsdatum: string | null; umfang: FLEinwilligungUmfang | null; media: boolean | null }
  | (PublicEnvelope & { success: false; zustand?: SpielerLinkZustand });

/**
 * The pupil's own confirmation.
 *
 * `fassung` is handed in rather than imported: the label freezes exactly what a reader saw, and a
 * component reaching for the current words would render a text no stored record cites.
 */
export function SpielerBestaetigungView({
  start,
  wording: fassung,
}: {
  start: SpielerBestaetigungStart;
  wording: SpielerSeitenFassung | null;
}) {
  const [stand, setStand] = useState<Stand>(() => anfang(start, fassung));
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

  if (stand.zustand === "barred") return <AdresseGesperrt panelRef={ergebnisRef} />;

  // Off the CURRENT state and never the one the page opened on: a link the write found dead is
  // answered by a panel that names nobody, and the banner beside it would name the team anyway.
  const ansicht = stand.zustand === "valid" || stand.zustand === "erfolg" ? stand.ansicht : null;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        {ansicht !== null && <SaisonChip isLaufend={false}>Saison {ansicht.saison_id}</SaisonChip>}
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>

        {stand.zustand === "valid" && (
          <FaktenBanner
            zeilen={[
              { label: "Team", value: stand.ansicht.team },
              { label: "Schule", value: stand.ansicht.schule, unbegrenzt: true },
              { label: "Saison", value: stand.ansicht.saison_id },
            ]}
          />
        )}
      </header>

      {stand.zustand === "valid" && (
        <SpielerBestaetigungForm
          token={stand.token}
          ansicht={stand.ansicht}
          wording={stand.wording}
          onAbschluss={(abschluss) => {
            beantwortet();
            setStand(
              abschluss.zustand === "erfolg"
                ? { zustand: "erfolg", ansicht: stand.ansicht, gespeichert: abschluss.gespeichert, wording: stand.wording }
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
            Danke. Deine Registrierung für <Wert>{stand.ansicht.team}</Wert> ist bestätigt.
          </p>
          {stand.wording.seite === "bestaetigung_spieler" ? (
            <GespeicherteAngaben
              zeilen={[
                ...(stand.gespeichert.geburtsdatum === null
                  ? []
                  : [{ label: "Geburtsdatum", value: formatSpielDatum(stand.gespeichert.geburtsdatum) }]),
                ...wahlZeilen(stand.gespeichert.umfang, stand.gespeichert.media),
              ]}
            />
          ) : (
            <p className={ABSATZ_CLASSES}>Deine gespeicherten Angaben gelten weiter. Du siehst sie in Deinem Konto.</p>
          )}
          <p className={ABSATZ_CLASSES}>
            Dein Team entscheidet jetzt über die Aufnahme in den Kader. Du musst nichts weiter tun und bekommst Bescheid.
          </p>
          <p className={ABSATZ_CLASSES}>Fragen und Löschung jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name and no team from here on: a consumed or dead link may have been forwarded, and a
          dead link identifies nobody. */}
      {stand.zustand === "confirmed" && (
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
      {(stand.zustand === "expired" || stand.zustand === "invalid") && (
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
  wording: fassung,
  onAbschluss,
}: {
  token: string;
  ansicht: FLRegistrierungConfirmationViewResponse;
  wording: SpielerSeitenFassung;
  onAbschluss: (abschluss: Abschluss) => void;
}) {
  const [isPending, startSending] = useTransition();
  // Nothing preselected: a media switch that opened on and a scope already picked are consents nobody
  // gave on this page.
  const [entwurf, setEntwurf] = useState<{ geburtsdatum: string; umfang: FLEinwilligungUmfang | null; media: boolean }>({
    geburtsdatum: "",
    umfang: null,
    media: false,
  });

  const panel = formPanel();

  // Built from the floor the link answered, never the module's own: the endpoint judges this
  // person, so a schema on a constant would let the press through at the wrong number.
  const bestaetigungSchema = buildRegistrierungBestaetigungPayloadSchema(ansicht.minimum_age, fassung.seite);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } =
    useDraftFieldErrors({
      schemas: { bestaetigung: bestaetigungSchema },
      failureTitle: ANTWORT_NICHT_GESPEICHERT,
    });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), ansicht.minimum_age);

  const fragtWahlen = fassung.seite === "bestaetigung_spieler";

  // Off the date the age check reads, at the served media age: with no date yet the age is unknown,
  // and a switch offered then would be one the write refuses for anybody under it.
  const medienAngeboten =
    fragtWahlen &&
    entwurf.geburtsdatum !== "" &&
    entwurf.geburtsdatum <= geburtsdatumSpanne(getGermanTodayStr(), ansicht.media_minimum_age).spaeteste;

  // The DRAFT's shape rather than the payload's: `umfang` stands unanswered until it is picked, and
  // the schema is what turns that into a field error rather than this builder into a cast.
  const payload = () => ({
    token: token,
    // None from the returning page: the press takes the stored person's (`registrierung_choices_unsuitable` refuses one sent).
    geburtsdatum: fragtWahlen ? entwurf.geburtsdatum : null,
    // Both choices null from the returning page, which asks neither (`registrierung_choices_unsuitable` refuses any other).
    umfang: fragtWahlen ? entwurf.umfang : null,
    // Never the draft's own `true` where no switch stands: one given before the date moved below the
    // media age would send a consent this page withheld.
    media: fragtWahlen ? medienAngeboten && entwurf.media : null,
    text_versions: fragtWahlen ? SPIELER_TEXT_VERSIONS : null,
  });

  useForgiveFixed({ bestaetigung: payload() });

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // telling a 190-year-old to ask their team for a place is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

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
            onState: (zustand) => onAbschluss({ zustand }),
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
          gespeichert: { geburtsdatum: antwort.geburtsdatum, umfang: antwort.umfang, media: antwort.media },
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
      <BestaetigungAbschnitt titel="Deine Antwort">
        <section className="flex flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Dein Geburtsdatum</h3>

          {fragtWahlen ? (
            <div className={FIELD_PAIR_CLASSES}>
              <AppDatePicker
                name="geburtsdatum"
                label={<Label className={FIELD_LABEL_CLASSES}>Dein Geburtsdatum</Label>}
                calendarLabel="Geburtsdatum auswählen"
                value={toCalendarDate(entwurf.geburtsdatum)}
                onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
                onBlur={() => validatePaths("bestaetigung", payload(), ["geburtsdatum"])}
                hint={`Daran prüfen wir, ob Du mindestens ${String(ansicht.minimum_age)} Jahre alt bist. Das Datum wird mit Deiner Registrierung gespeichert.`}
                minValue={parseDate(frueheste)}
                maxValue={parseDate(spaeteste)}
              />
            </div>
          ) : (
            // Neither asked nor shown: asking again invites a second answer to a question settled once,
            // and whoever holds the link is not yet known to be the person whose date it is.
            <p className={ABSATZ_CLASSES}>Dein Geburtsdatum ist bei uns schon gespeichert. Du siehst es in Deinem Konto.</p>
          )}
        </section>

        {fassung.seite === "bestaetigung_spieler" ? (
          <WahlenAbschnitte
            umfang={entwurf.umfang}
            media={entwurf.media}
            medienAngeboten={medienAngeboten}
            onUmfang={(umfang) => setEntwurf({ ...entwurf, umfang: umfang })}
            onMedien={(media) => setEntwurf({ ...entwurf, media: media })}
            switchContentClassName={panel.switchContent()}
            switchControlClassName={panel.switchControl()}
          />
        ) : (
          <section className="flex flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>Deine Einwilligung</h3>
            <p className={ABSATZ_CLASSES}>
              <Link
                href={ROUTES.account.path()}
                prefetch={false}
                className={textLink()}>
                Zum Konto
              </Link>
            </p>
          </section>
        )}

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du noch nicht mitspielen.">
            Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es, kannst Du in dieser Saison leider nicht mitspielen. Wir löschen Deine
            Registrierung von selbst.
          </Callout>
        )}

        <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            isPending={isPending}
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
  umfang,
  media,
  medienAngeboten,
  onUmfang,
  onMedien,
  switchContentClassName,
  switchControlClassName,
}: {
  umfang: FLEinwilligungUmfang | null;
  media: boolean;
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
          <Label className={FIELD_LABEL_CLASSES}>{SPIELER_WORDINGS.umfang.question}</Label>
          <ToggleButtonGroup
            aria-label={SPIELER_WORDINGS.umfang.question}
            size="sm"
            isDetached
            selectionMode="single"
            // Never on a choice still unanswered: a pressed chip on first paint is a consent the
            // reader did not give.
            disallowEmptySelection={umfang !== null}
            selectedKeys={umfang === null ? [] : [umfang]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              const option = UMFANG_OPTIONEN.find((candidate) => candidate.value === picked);
              if (option !== undefined) onUmfang(option.value);
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {UMFANG_OPTIONEN.map((option) => (
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
        <EinwilligungZeile line={SPIELER_WORDINGS.umfang.line} />
      </section>

      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Freiwillig</h3>
        {/* The switch and its line from the served age, as the contact page offers them. */}
        {medienAngeboten && (
          <Switch
            className="flex w-full flex-col gap-y-1"
            name="medien"
            isSelected={media}
            onChange={onMedien}>
            <Switch.Content className={switchContentClassName}>
              {SPIELER_WORDINGS.media.label}
              <Switch.Control className={switchControlClassName}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        )}
        {medienAngeboten && <EinwilligungZeile line={SPIELER_WORDINGS.media.line} />}
      </section>
    </>
  );
}
