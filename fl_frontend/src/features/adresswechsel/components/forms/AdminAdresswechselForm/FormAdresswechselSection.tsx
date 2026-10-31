"use client";

import { useRef, useState } from "react";

import Magnifier from "@gravity-ui/icons/Magnifier";
import Pencil from "@gravity-ui/icons/Pencil";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { readAdresswechselAnsichtAction } from "@/features/adresswechsel/actions";
import { AdresswechselBeantragen, LEERER_ENTWURF } from "@/features/adresswechsel/components/forms/AdresswechselBeantragen";
import { AdresswechselWartet } from "@/features/adresswechsel/components/forms/AdresswechselWartet";
import { isVerwaltungAnsichtRefusal } from "@/features/adresswechsel/refusals";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  FIELD_ERROR_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { skeletonBlock } from "@/shared/components/ui/skeleton";
import { TextField } from "@/shared/components/ui/TextField";
import { KontaktEmailSchema } from "@/shared/schemas";
import { unansweredRead } from "@/shared/utils/actionError";
import { focusSection } from "@/shared/utils/focusAfterWrite";

import type { FLAddressChangeVerwaltungHoldings, FLAddressChangeVerwaltungViewPayload } from "@/core/generated/client/types";
import type { AdresswechselEntwurf } from "@/features/adresswechsel/components/forms/AdresswechselBeantragen";
import type { VerwaltungAnsichtGelesen } from "@/features/adresswechsel/queries";

const ANZEIGEN = "Anzeigen";
const NEUE_ADRESSE_EINTRAGEN = "Neue Adresse eintragen";

/** What the last read left the panel holding. */
type Gelesen = VerwaltungAnsichtGelesen | { status: "reading" };

const ZEILE_CLASSES = "fluid-xxs leading-normal font-medium text-foreground";

/** Each count as a line, the singular and the plural spelled whole: a reader checks the person by these alone. */
const ZAEHLER: readonly (readonly [keyof Omit<FLAddressChangeVerwaltungHoldings, "grant">, string, string])[] = [
  ["spieler", "Ein Eintrag als Spielerin oder Spieler", "Einträge als Spielerin oder Spieler"],
  [
    "schiedsrichter",
    "Ein bestätigter Eintrag als Schiedsrichterin oder Schiedsrichter",
    "bestätigte Einträge als Schiedsrichterin oder Schiedsrichter",
  ],
  ["seats", "Ein bestätigter Kontakt eines Teams", "bestätigte Kontakte von Teams"],
  ["bewerbung_seats", "Ein bestätigter Kontakt in einer Bewerbung", "bestätigte Kontakte in Bewerbungen"],
  ["registrierungen", "Eine Registrierung", "Registrierungen"],
];

function bestandZeilen({ grant: berechtigung, ...anzahl }: FLAddressChangeVerwaltungHoldings): string[] {
  const zeilen = ZAEHLER.filter(([feld]) => anzahl[feld] > 0).map(([feld, eins, viele]) =>
    anzahl[feld] === 1 ? eins : `${String(anzahl[feld])} ${viele}`,
  );
  if (berechtigung !== null) {
    zeilen.push(berechtigung === "owner" ? "Zugang zur Verwaltung als Inhaberin oder Inhaber" : "Zugang zur Verwaltung");
  }
  return zeilen;
}

/**
 * The address tool: what an address holds and the change standing at it, read by the address the person writes from
 * or the id a link names, never browsed. In no `<form>`: Enter in either box would submit it.
 */
export function FormAdresswechselSection({ anfang }: { anfang: VerwaltungAnsichtGelesen | null }) {
  const [adresse, setAdresse] = useState(anfang?.status === "read" ? anfang.ansicht.adresse : "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [gelesen, setGelesen] = useState<Gelesen | null>(anfang);
  // Above every read, so a read answering after a write keeps the way and the reason the start box holds.
  const [entwurf, setEntwurf] = useState<AdresswechselEntwurf | null>(null);
  const [perDruck, setPerDruck] = useState(false);
  // Only the latest read answers: Next sends one client's actions one at a time, so an earlier read's answer lands
  // while the latest waits. React's "ignore stale responses" (https://react.dev/learn/you-might-not-need-an-effect#fetching-data).
  const letzteLesung = useRef(0);
  const panel = formPanel();

  const lies = async (schluessel: FLAddressChangeVerwaltungViewPayload) => {
    const lesung = ++letzteLesung.current;
    setGelesen({ status: "reading" });

    // Settled, never awaited bare: a rejected action would leave the placeholder up for good.
    const [settled] = await Promise.allSettled([readAdresswechselAnsichtAction(schluessel)]);
    if (lesung !== letzteLesung.current) return;
    const res = settled.status === "rejected" ? unansweredRead() : settled.value;

    if (res.success) {
      // The box shows the address the read was made for, so a change opened by its id names its address too.
      setAdresse(res.ansicht.adresse);
      setGelesen({ status: "read", ansicht: res.ansicht });
      return;
    }

    const satz = res.unplacedError ?? res.error;
    setGelesen({
      status: "refused",
      reason: isVerwaltungAnsichtRefusal(satz) ? satz : `Die Übersicht konnte nicht geladen werden. ${satz}`,
    });
  };

  const zeige = () => {
    const geprueft = KontaktEmailSchema.safeParse(adresse);
    setFehler(geprueft.success ? null : (geprueft.error.issues[0]?.message ?? null));
    if (!geprueft.success) return;
    void lies({ adresse: adresse.trim() });
  };

  const ansicht = gelesen?.status === "read" ? gelesen.ansicht : null;
  // After a write the address's present is read again, the box's typing kept.
  const nachSchreiben = () => {
    if (ansicht !== null) void lies({ adresse: ansicht.adresse });
  };

  return (
    // Where a write that takes the change's own panel away lands: the tool's heading, which stays.
    <section
      className={panel.root()}
      {...focusSection("adresse")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Adresse ändern"
        />
      </div>

      <div className={panel.body()}>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
          <TextField
            type="email"
            name="adresse"
            value={adresse}
            onChange={(next) => {
              setAdresse(next);
              setFehler(null);
              // What was read speaks of the address the box held before.
              letzteLesung.current += 1;
              setGelesen(null);
              setEntwurf(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              zeige();
            }}
            isInvalid={fehler !== null ? true : undefined}
            className="w-full sm:max-w-md">
            <Label className={FIELD_LABEL_CLASSES}>Bisherige E-Mail-Adresse</Label>
            {/* Off, so a person's address is never kept in the browser's autofill store. */}
            <Input
              autoComplete="off"
              placeholder="z.B. name@beispiel.de"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES}>{fehler}</FieldError>
            <Hint
              mode="field"
              text="Die Adresse, unter der die Person bei uns steht und mit der sie sich nach eigener Angabe nicht mehr anmelden kann."
            />
          </TextField>
          <Button
            type="button"
            isPending={gelesen?.status === "reading"}
            onPress={zeige}
            className={`${formButton({ intent: "nav" })} gap-x-2 sm:mt-6`}>
            <Magnifier
              className="size-4"
              aria-hidden="true"
            />
            <span>{ANZEIGEN}</span>
          </Button>
        </div>

        {gelesen?.status === "reading" && (
          // The app's one „not yet here“ treatment: what arrives is a list, so what stands in for it is shaped like one.
          <div
            aria-hidden="true"
            className="flex w-full flex-col gap-y-2">
            <span className={`${skeletonBlock()} h-3 w-40 rounded-md`} />
            <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
          </div>
        )}

        {gelesen?.status === "refused" && <p className={ZEILE_CLASSES}>{gelesen.reason}</p>}

        {ansicht !== null && (
          <div className="flex w-full flex-col gap-y-1">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>Was unter der Adresse steht</h3>
            {bestandZeilen(ansicht.holdings).length === 0 ? (
              <p className={ZEILE_CLASSES}>Unter dieser Adresse steht nichts, dessen Adresse sich hier ändern lässt.</p>
            ) : (
              <ul className={`${ZEILE_CLASSES} flex list-disc flex-col gap-y-1 pl-5`}>
                {bestandZeilen(ansicht.holdings).map((zeile) => (
                  <li key={zeile}>{zeile}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {ansicht !== null && ansicht.open !== null && (
          <AdresswechselWartet
            offen={ansicht.open}
            onGeschrieben={nachSchreiben}
          />
        )}

        {ansicht?.possible === true && (
          <FocusSlot name="adresse-aendern">
            {entwurf !== null ? (
              <AdresswechselBeantragen
                adresse={ansicht.adresse}
                entwurf={entwurf}
                ersetztOffen={ansicht.open !== null}
                fokussieren={perDruck}
                onEntwurfChange={setEntwurf}
                onGeschrieben={() => {
                  setEntwurf(null);
                  nachSchreiben();
                }}
                onAbbrechen={() => setEntwurf(null)}
              />
            ) : (
              <div className="flex w-full flex-wrap items-start gap-2">
                <Button
                  type="button"
                  onPress={() => {
                    setPerDruck(true);
                    setEntwurf(LEERER_ENTWURF);
                  }}
                  className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                  <Pencil
                    className="size-3.5"
                    aria-hidden="true"
                  />
                  <span>{NEUE_ADRESSE_EINTRAGEN}</span>
                </Button>
              </div>
            )}
          </FocusSlot>
        )}
      </div>
    </section>
  );
}
