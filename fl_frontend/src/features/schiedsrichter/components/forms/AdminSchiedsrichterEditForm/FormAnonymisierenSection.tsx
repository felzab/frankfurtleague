"use client";

import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { anonymiseSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";

import type { FLKontakt } from "@/shared/schemas";

/** What an empty field reads as in the armed readout — absent here, and possibly still in the log. */
const NOT_RECORDED = "Nicht hinterlegt";

/**
 * The referee's anonymisation, on `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`. **A
 * confirmation step and no undo**: one press nulls the name on the row and every match, clears the
 * school and both contact fields, stamps the day, and empties every log row's pre-image.
 */
export function FormAnonymisierenSection({
  schiedsrichterId,
  name,
  schule,
  kontakt,
  onBeforeAnonymise,
}: {
  schiedsrichterId: string;
  name: string;
  /** The STORED school, for `kontakt`'s reason: the readout names what this press clears, not what is typed. */
  schule: string | null;
  /**
   * The STORED contact record, never the draft: this write clears what is saved. Read for the
   * readout alone — an emptied field is not an empty log, so an empty record still has work to do.
   */
  kontakt: FLKontakt;
  /** Runs before the write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeAnonymise: () => boolean;
}) {
  const router = useRouter();
  const { isConfirming, isPending: isAnonymising, press, cancel } = useTwoPressConfirm(onBeforeAnonymise);

  const panel = formPanel({ tone: "danger" });

  const handleAnonymise = () => {
    press(async () => {
      const res = await anonymiseSchiedsrichterAction({ id: schiedsrichterId });

      if (!res.success) {
        appToast.danger("Schiedsrichterdaten nicht gelöscht", { description: res.error });
        return;
      }

      appToast.success("Schiedsrichterdaten gelöscht", { description: res.message });
      // Load-bearing, not cosmetic: the page keys the view on the stored record, so this is what
      // remounts the form onto the cleared one. Without it the boxes keep the deleted values, the
      // draft reads as clean, and the next save of any field writes them back.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Daten löschen">
          {/* What is deleted and what survives it is the panel's own body below, and the danger panel
              with its two-press control is what says the press is final. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Löschen der Daten"
            body={{
              lead: "Der Weg, Namen, Schule und Kontaktdaten ganz aus der Verwaltung zu entfernen.",
              points: [{ term: "Die Felder oben zu leeren", text: "ist etwas anderes: Die alten Angaben bleiben im Änderungsprotokoll." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <p className="muted-hint">
          Das Löschen entfernt Namen, Schule, E-Mail und Telefonnummer von <strong>{name}</strong>. In der Verwaltung und auf jedem gespielten
          Spiel steht dann nur noch „{SCHIEDSRICHTER_ANONYM_LABEL}“. Im Änderungsprotokoll wird dazu der gesicherte Stand jeder Zeile gelöscht,
          die diese Person betrifft. Gelöscht wird damit auch alles andere, was dort noch von dieser Person steht. Was wann geschehen ist,
          bleibt lesbar. Der Eintrag selbst bleibt bestehen, damit die Spiele auflösbar sind; er wird aber stillgelegt und für neue Spiele nicht
          mehr angeboten, und bearbeiten lässt er sich danach nicht mehr.
        </p>

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                {/* The name is emptied like the two below it, and the row says what a reader is shown
                    afterwards: a bare „wird gelöscht“ would read as the referee losing their row. */}
                <ConfirmReadoutRow
                  label="Name"
                  value={`${name}, danach nur „${SCHIEDSRICHTER_ANONYM_LABEL}“`}
                />
                {/* The school goes with the name: beside a fixture list that never expires it narrows the
                    person to the few referees one school ever sent. */}
                <ConfirmReadoutRow
                  label="Schule / Verein"
                  value={schule ?? NOT_RECORDED}
                />
                <ConfirmReadoutRow
                  label="E-Mail"
                  value={kontakt.email ?? NOT_RECORDED}
                />
                <ConfirmReadoutRow
                  label="Telefon"
                  value={kontakt.telefon ?? NOT_RECORDED}
                />
                {/* The log's own words for the pre-image it stores, so the readout names what the row
                    loses rather than a subset of it: the redaction clears the WHOLE stand. */}
                <ConfirmReadoutRow
                  label="Änderungsprotokoll"
                  value="Gesicherter Stand wird gelöscht"
                />
              </dl>
            </div>

            {/* No restore is named on purpose: nothing in the system holds the old values once the
                row and the log have both been cleared. What goes is the readout directly above. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Zurückholen lässt sich das nicht. Der Eintrag bleibt mit allen Spielen bestehen, und bearbeiten lässt er sich danach nicht mehr.
            </p>

            {/* The one consequence the readout above cannot show: a match still to be played comes out of
                the press with nobody assigned to it. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Spiele ohne Ergebnis verlieren die Zuteilung und brauchen einen neuen Schiedsrichter.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isAnonymising}
          onCancel={cancel}>
          <Button
            type="button"
            variant="primary"
            isDisabled={isAnonymising}
            onPress={handleAnonymise}
            className={confirmButton(isConfirming)}>
            {!isConfirming && (
              <TrashBin
                aria-hidden="true"
                width={18}
                height={18}
              />
            )}
            {/* The object stays in the label: on a danger panel under a trash icon, a bare „Ja, endgültig
                löschen“ reads as the referee going — the one thing this control does not do. */}
            {isAnonymising ? "Löscht..." : isConfirming ? "Ja, Daten endgültig löschen" : "Daten löschen"}
          </Button>
        </ConfirmActionRow>
      </div>
    </section>
  );
}
