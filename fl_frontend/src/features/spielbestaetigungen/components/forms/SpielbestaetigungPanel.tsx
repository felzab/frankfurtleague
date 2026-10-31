"use client";

import { startTransition, useState } from "react";

import ArrowDownToLine from "@gravity-ui/icons/ArrowDownToLine";
import CircleCheck from "@gravity-ui/icons/CircleCheck";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { zustellungChip } from "@/features/bewerbungen/zustellLage";
import { eintragenSpielbestaetigungAction, verwerfenSpielbestaetigungAction } from "@/features/spielbestaetigungen/actions";
import { ANTWORT_LABELS, SCHIEDSRICHTER_PARTEI, SCHLIESSGRUND_LABELS } from "@/features/spielbestaetigungen/constants";
import { FLSpielbestaetigungEintragenPayloadSchema } from "@/features/spielbestaetigungen/schemas";
import {
  antwortStand,
  beantwortetVon,
  geltendeBestaetigungen,
  grundZumEnde,
  istVorschlagOffen,
  terminText,
} from "@/features/spielbestaetigungen/utils";
import { suppressEnterSubmit } from "@/features/spiele/components/forms/AdminEditSpielDataForm/suppressEnterSubmit";
import { SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH } from "@/features/spiele/constants";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite, focusRow, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSpielbestaetigung, FLSpielbestaetigungAppointment, FLSpielbestaetigungClosedGrund } from "@/core/generated/client/types";
import type { BestaetigungsSpiel } from "@/features/spielbestaetigungen/utils";

/** The lists a party's name is read from: a row may name a side or a referee the fixture fields no more. */
type Partei = { teams: readonly { id: string; name: string }[]; schiedsrichter: readonly { id: string; name: string | null }[] };

type SpielStand = BestaetigungsSpiel & {
  team1: { team_id: string; name: string } | null;
  team2: { team_id: string; name: string } | null;
};

const ES_GIBT_KEINEN_WEG_ZURUECK = "Es gibt in der Verwaltung keinen Weg zurück.";

/** The bound and its wording are the write's own, asked of the field that judges it. */
const begruendungFehler = (begruendung: string): string | null => {
  const geprueft = FLSpielbestaetigungEintragenPayloadSchema.shape.begruendung.safeParse(begruendung);

  return geprueft.success ? null : (geprueft.error.issues[0]?.message ?? null);
};

const parteiName = (zeile: FLSpielbestaetigung, spiel: SpielStand, { teams, schiedsrichter }: Partei): string => {
  const { party: partei } = zeile;
  if (partei.art === "team") {
    const seite = [spiel.team1, spiel.team2].find((eintrag) => eintrag?.team_id === partei.team_id);
    return seite?.name ?? teams.find((team) => team.id === partei.team_id)?.name ?? "Team";
  }
  return schiedsrichter.find((eintrag) => eintrag.id === partei.schiedsrichter_id)?.name ?? SCHIEDSRICHTER_PARTEI;
};

/**
 * This fixture's rows, newest first. **Inside the editor's form** as its sections are, so
 * Enter in its box is held back and no control here carries a name the form's wiring reads.
 */
export function SpielbestaetigungPanel({
  rows: zeilen,
  spiel,
  parteien,
  austritte,
  today,
  onVorschlagUebernehmen,
}: {
  /** `null` where the read failed: the panel says so rather than reading as a fixture nobody was asked about. */
  rows: readonly FLSpielbestaetigung[] | null;
  /** The fixture as STORED, never the draft: a row is about the Ansetzung the league holds. */
  spiel: SpielStand;
  parteien: Partei;
  /** The day each club left the season, by `team_id`, where it has: the pass ends a row of a club gone by its day. */
  austritte: ReadonlyMap<string, string>;
  today: string;
  /** Carries a proposal into the editor's draft, where the rail marks it and Speichern still decides. */
  onVorschlagUebernehmen: (termin: FLSpielbestaetigungAppointment) => void;
}) {
  const panel = formPanel();
  const umstand = { austritte, today };
  const geltend = new Set((zeilen === null ? [] : geltendeBestaetigungen(zeilen, spiel, umstand)).map((zeile) => zeile.id));

  return (
    <section
      className={panel.root()}
      onKeyDownCapture={suppressEnterSubmit}
      {...focusSection("spielbestaetigungen")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Spielbestätigungen">
          <Hint
            mode="reveal"
            label="Hinweis zu den Spielbestätigungen"
            body={{
              lead: "Wer diesem Termin zugesagt, abgelehnt oder noch nicht geantwortet hat.",
              points: [{ term: "Die Begründung", text: "wird am Ende der Saison, die auf diese folgt, gelöscht." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {zeilen === null && <p className="muted-hint">Die Spielbestätigungen ließen sich gerade nicht lesen. Lade die Seite neu.</p>}

        {zeilen !== null && zeilen.length === 0 && <p className="muted-hint">Für dieses Spiel gab es noch keine Anfrage.</p>}

        {zeilen !== null && zeilen.length > 0 && (
          <ul className="flex w-full flex-col gap-y-4">
            {zeilen.map((zeile) => (
              <BestaetigungZeile
                key={zeile.id}
                row={zeile}
                name={parteiName(zeile, spiel, parteien)}
                istGeltend={geltend.has(zeile.id)}
                endet={zeile.closed === null ? grundZumEnde(zeile, spiel, umstand) : null}
                spiel={spiel}
                today={today}
                onVorschlagUebernehmen={onVorschlagUebernehmen}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BestaetigungZeile({
  row: zeile,
  name,
  istGeltend,
  endet,
  spiel,
  today,
  onVorschlagUebernehmen,
}: {
  row: FLSpielbestaetigung;
  name: string;
  /** Still speaking for the fixture as it stands (`geltendeBestaetigungen`): the only row a press here can mean. */
  istGeltend: boolean;
  /** Why the next pass shuts this unclosed row, `null` where it keeps it or it is closed already. */
  endet: FLSpielbestaetigungClosedGrund | null;
  spiel: SpielStand;
  today: string;
  onVorschlagUebernehmen: (termin: FLSpielbestaetigungAppointment) => void;
}) {
  const { antwort, closed: geschlossen, ansetzung } = zeile;
  const stand = antwortStand(zeile, today);

  return (
    <li
      className={`${card()} flex w-full flex-col gap-y-4 p-4`}
      {...focusRow(zeile.id)}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-2">
        <h3 className="fluid-sm font-bold text-foreground">{name}</h3>
        {geschlossen === null && (
          <span className={`${labelBadge(ANTWORT_LABELS[stand].tone)} h-7 shrink-0`}>{ANTWORT_LABELS[stand].label}</span>
        )}
      </div>

      {/* „früheren Termin“ only where the date or the hour moved: a row a new ground or side left keeps the fixture's. */}
      {endet !== null &&
        (ansetzung.datum !== spiel.datum || ansetzung.uhrzeit !== spiel.uhrzeit ? (
          <p className="muted-hint">Betrifft den früheren Termin {terminText({ datum: ansetzung.datum, uhrzeit: ansetzung.uhrzeit })}.</p>
        ) : endet === "ansetzung_changed" ? (
          <p className="muted-hint">Betrifft den Termin mit dem früheren Spielort oder den früheren Teams.</p>
        ) : (
          <p className="muted-hint">Der nächste Lauf schließt diese Anfrage: {SCHLIESSGRUND_LABELS[endet]}.</p>
        ))}

      <dl className={FIELD_PAIR_CLASSES}>
        {/* A closed row may be about any slot the fixture held, and its heading names only the party. */}
        {geschlossen !== null && <Angabe label="Termin">{terminText({ datum: ansetzung.datum, uhrzeit: ansetzung.uhrzeit })}</Angabe>}
        <Angabe label="Antwort">{antwort === null ? <Leer>Noch keine</Leer> : ANTWORT_LABELS[antwort.art].label}</Angabe>
        {antwort !== null && <Angabe label="Von">{beantwortetVon(antwort.von)}</Angabe>}
        {antwort !== null && <Angabe label="Am">{formatSpielDatum(antwort.am)}</Angabe>}
        {antwort?.vorschlag && <Angabe label="Vorschlag">{terminText(antwort.vorschlag)}</Angabe>}
        {/* Unabridged and quoted: it is the record of how the date was agreed, and a cut one says something else. */}
        {antwort?.begruendung && <Angabe label="Begründung">„{antwort.begruendung}“</Angabe>}
        {/* A club's alone: a referee answers until the fixture's day, whatever the row stores
            (`fl_backend/app/api/spielbestaetigungen/services.py :: _past_frist`). */}
        {zeile.party.art === "team" && <Angabe label="Frist">{formatSpielDatum(zeile.frist)}</Angabe>}
        <Angabe label="Angefragt">{zeile.asked_at === null ? <Leer>Nicht verschickt</Leer> : formatSpielDatum(zeile.asked_at)}</Angabe>
        {zeile.reminded_at.length > 0 && (
          <Angabe label="Erinnert am">{zeile.reminded_at.map((tag) => formatSpielDatum(tag)).join(", ")}</Angabe>
        )}
        {geschlossen !== null && (
          <Angabe label="Geschlossen">
            {SCHLIESSGRUND_LABELS[geschlossen.grund]}, {formatSpielDatum(geschlossen.am)}
          </Angabe>
        )}
        {/* Each seat holding a link, in `LinkStandAngaben`'s words: a delivered message, or one under way, is nothing
            to report, and a seat the row minted no link for has no line. */}
        {KONTAKT_ROLLEN.flatMap(({ value, label }) => {
          const sitz = zeile.kontakte?.[value] ?? null;
          if (sitz === null) return [];
          const chip = zustellungChip(sitz.delivery);
          return [
            <Angabe
              key={value}
              label={`Zustellung ${label}`}>
              {chip === null ? <Leer>Nichts zu melden</Leer> : <span className={`${labelBadge(chip.tone)} h-7 shrink-0`}>{chip.label}</span>}
            </Angabe>,
          ];
        })}
      </dl>

      {istGeltend && antwort === null && (
        <EintragenSection
          row={zeile}
          name={name}
        />
      )}
      {istGeltend && istVorschlagOffen(zeile) && antwort?.vorschlag && (
        <VorschlagSection
          row={zeile}
          name={name}
          vorschlag={antwort.vorschlag}
          onVorschlagUebernehmen={onVorschlagUebernehmen}
        />
      )}
    </li>
  );
}

/** The settle: a Zusage on the party's behalf, with the reason the record carries. No undo, so the press is the guard. */
function EintragenSection({ row: zeile, name }: { row: FLSpielbestaetigung; name: string }) {
  const twoPress = useTwoPressConfirm({ stepUp: true });
  const { isConfirming, press, cancel } = twoPress;

  const [begruendung, setBegruendung] = useState("");
  /** The refusal the API answered with, which lands on this box. Cleared on the next keystroke. */
  const [antwortFehler, setAntwortFehler] = useState<string | null>(null);
  /** The bound's verdict, published when the box is left and retracted by a keystroke alone: no typed field is judged between keystrokes. */
  const [laengeFehler, setLaengeFehler] = useState<string | null>(null);

  // The schema trims before it measures, and the trimmed value is what the write carries.
  const getrimmt = begruendung.trim();
  const istLeer = getrimmt === "";
  const fehler = istLeer ? null : begruendungFehler(begruendung);
  const zuLang = getrimmt.length > SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH;
  const closedReason = istLeer
    ? "Schreibe zuerst eine Begründung."
    : fehler === null
      ? null
      : zuLang
        ? "Kürze die Begründung."
        : "Korrigiere zuerst die Begründung.";

  const handleEintragen = () => {
    // The settled row loses both controls, so the next row's press or the panel's heading takes the focus.
    const landing = focusAfterWrite();
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the editor down with it.
      const res = await eintragenSpielbestaetigungAction({ id: zeile.id, begruendung: begruendung }).catch(unansweredAction);

      startTransition(() => {
        if (!res.success) {
          const feldFehler = res.fieldErrors?.begruendung ?? null;
          setAntwortFehler(feldFehler);
          if (feldFehler === null) appToast.failure("Zusage nicht eingetragen", res);
          return;
        }

        landing.landed();
        appToast.success("Zusage eingetragen", { description: res.message });
      });
    });
  };

  return (
    <div className="flex w-full flex-col gap-y-3">
      <TextField
        value={begruendung}
        onChange={(next) => {
          setAntwortFehler(null);
          if (next.trim() === "" || begruendungFehler(next) === null) setLaengeFehler(null);
          setBegruendung(next);
          cancel();
        }}
        onBlur={() => setLaengeFehler(fehler)}
        isInvalid={(antwortFehler ?? laengeFehler) !== null ? true : undefined}>
        {/* The party heard after the visible words, as `benannt` names the presses: two open rows hold a box each. */}
        <Label className={FIELD_LABEL_CLASSES}>
          Begründung für die Zusage<span className="sr-only">: {name}</span>
        </Label>
        <Input
          placeholder="z.B. Die Trainerin hat am Telefon zugesagt."
          className={FIELD_INPUT_CLASSES}
        />
        <FieldError className={FIELD_ERROR_CLASSES}>{antwortFehler ?? laengeFehler}</FieldError>
      </TextField>

      <p className="fluid-xxs font-medium text-foreground-muted">
        {String(getrimmt.length)} von {String(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH)} Zeichen
      </p>

      {isConfirming && !istLeer && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">
            Für {name} steht dann eine Zusage der Verwaltung der Liga mit dieser Begründung: „{getrimmt}“
          </p>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{ES_GIBT_KEINEN_WEG_ZURUECK}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <FocusSlot name="eintragen">
          <ConfirmPressButton
            confirm={twoPress}
            reason={closedReason}
            resting="Auf Zusage setzen"
            restingName={benannt("Auf Zusage setzen", name)}
            armed="Ja, auf Zusage setzen"
            running="Trägt ein..."
            icon={
              <CircleCheck
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handleEintragen}
          />
        </FocusSlot>
      </ConfirmActionRow>
    </div>
  );
}

/**
 * An open decline's proposal: carried into the draft, where Speichern decides, or discarded. The discard closes the
 * club's row and leaves its decline the record; that club is never asked about this Ansetzung again.
 */
function VorschlagSection({
  row: zeile,
  name,
  vorschlag,
  onVorschlagUebernehmen,
}: {
  row: FLSpielbestaetigung;
  name: string;
  vorschlag: FLSpielbestaetigungAppointment;
  onVorschlagUebernehmen: (termin: FLSpielbestaetigungAppointment) => void;
}) {
  const twoPress = useTwoPressConfirm({ stepUp: true });
  const { isConfirming, press } = twoPress;

  const handleVerwerfen = () => {
    const landing = focusAfterWrite();
    press(async () => {
      const res = await verwerfenSpielbestaetigungAction({ id: zeile.id }).catch(unansweredAction);

      startTransition(() => {
        if (!res.success) {
          appToast.failure("Vorschlag nicht verworfen", res);
          return;
        }

        landing.landed();
        appToast.success("Vorschlag verworfen", { description: res.message });
      });
    });
  };

  return (
    <div className="flex w-full flex-col gap-y-3">
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">
            Der Termin bleibt, wie er ist, und {name} wird zu ihm nicht erneut gefragt.
          </p>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{ES_GIBT_KEINEN_WEG_ZURUECK}</p>
        </ConfirmReveal>
      )}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* No write: the draft takes the slot and the rail marks it, so the void preview and Speichern still decide. */}
        <FocusSlot name="vorschlag-uebernehmen">
          <Button
            type="button"
            aria-label={benannt("Vorschlag übernehmen", name)}
            isDisabled={twoPress.isPending}
            onPress={() => onVorschlagUebernehmen(vorschlag)}
            className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
            <ArrowDownToLine
              className="size-3.5"
              aria-hidden="true"
            />
            <span>Vorschlag übernehmen</span>
          </Button>
        </FocusSlot>

        <ConfirmActionRow confirm={twoPress}>
          <FocusSlot name="verwerfen">
            <ConfirmPressButton
              confirm={twoPress}
              reason={null}
              resting="Vorschlag verwerfen"
              restingName={benannt("Vorschlag verwerfen", name)}
              armed="Ja, Vorschlag verwerfen"
              running="Verwirft..."
              icon={
                <TrashBin
                  className="size-4.5"
                  aria-hidden="true"
                />
              }
              onPress={handleVerwerfen}
            />
          </FocusSlot>
        </ConfirmActionRow>
      </div>
    </div>
  );
}
