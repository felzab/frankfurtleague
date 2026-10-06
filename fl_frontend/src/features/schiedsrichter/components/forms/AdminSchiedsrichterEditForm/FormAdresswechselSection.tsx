"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { einladeAdresswechselAction, verwirfAdresswechselAction } from "@/features/schiedsrichter/actions";
import { KeinTag } from "@/features/spieler/components/ui/Nachweis";
import { Angabe } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import { LinkAbgelaufen } from "./FormBestaetigungSection";

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas";

export const ADRESSWECHSEL_WARTET = "Neue Adresse wartet auf Bestätigung";
/**
 * The re-send's accessible name, its link named as the contacts editor names each seat's: the consent
 * panel on the same page holds a „Link erneut senden“ of its own, for another link.
 */
export const ADRESSWECHSEL_ERNEUT = benannt("Link erneut senden", "Neue E-Mail-Adresse");
export const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";

/**
 * Shown only while a confirmed referee's new address waits on its mailbox. **The address above is
 * still in force**, which this panel says beside the two controls ending the wait.
 */
export function FormAdresswechselSection({
  schiedsrichterId,
  adresswechsel,
  istAbgelaufen,
  isDirty,
}: {
  schiedsrichterId: string;
  adresswechsel: FLSchiedsrichterAdresswechsel;
  /** The read's judgement of the deadline: a lapsed change stands until it is removed, so the date alone reads as running. */
  istAbgelaufen: boolean;
  /** The editor's unsaved typing, which either write re-keys the editor over. */
  isDirty: boolean;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<"senden" | "verwerfen" | null>(null);
  const stepUp = useStepUp();
  const panel = formPanel();

  const zustellung = adresswechsel.zustellung === null ? null : ZUSTELLUNG_CHIP[adresswechsel.zustellung.stand];

  // Both writes mint or void a link to an address.
  const schreibe = async (art: "senden" | "verwerfen") => {
    const landing = focusAfterWrite();
    const res = await pressLinkWrite({
      isDirty,
      stepUp,
      router,
      pending: (running) => setLaeuft(running ? art : null),
      write: () => (art === "senden" ? einladeAdresswechselAction : verwirfAdresswechselAction)({ id: schiedsrichterId }),
    });
    if (res === null) return;

    if (!res.success) {
      appToast.failure(art === "senden" ? "Link nicht gesendet" : "Änderung nicht verworfen", res);
      return;
    }

    landing.landed();
    appToast.success(art === "senden" ? "Link gesendet" : "Änderung verworfen", { description: res.message });
  };

  return (
    <section
      className={panel.root()}
      {...focusSection("adresswechsel")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Neue E-Mail-Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur neuen E-Mail-Adresse"
            body={{
              lead: "Die neue Adresse gilt erst, wenn ihre Inhaberin oder ihr Inhaber sie über den Link bestätigt. Bis dahin bleibt die Adresse oben in Kraft.",
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The lapse is the mark beside the deadline alone, as the consent link's panel says it. */}
        <p className="muted-hint">{ADRESSWECHSEL_WARTET}</p>

        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Neue Adresse">{adresswechsel.email}</Angabe>
          <Angabe label="Link gesendet am">{formatSpielDatum(adresswechsel.verschickt_am)}</Angabe>
          <Angabe label="Gültig bis">
            {formatSpielDatum(adresswechsel.frist)}
            {istAbgelaufen && <LinkAbgelaufen />}
          </Angabe>
          <Angabe label="Zustellung">
            {zustellung === null ? (
              <KeinTag>Nichts zu melden</KeinTag>
            ) : (
              <span className={`${labelBadge(zustellung.tone)} h-7 shrink-0`}>{zustellung.label}</span>
            )}
          </Angabe>
        </dl>

        <div className="flex w-full flex-wrap items-start gap-2">
          <FocusSlot name="adresswechsel-einladen">
            <Button
              type="button"
              isPending={laeuft === "senden"}
              isDisabled={laeuft !== null}
              aria-label={ADRESSWECHSEL_ERNEUT}
              onPress={() => void schreibe("senden")}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <PaperPlane
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{laeuft === "senden" ? stepUp.running("Sendet...") : "Link erneut senden"}</span>
            </Button>
          </FocusSlot>
          <FocusSlot name="adresswechsel-verwerfen">
            <Button
              type="button"
              isPending={laeuft === "verwerfen"}
              isDisabled={laeuft !== null}
              onPress={() => void schreibe("verwerfen")}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <TrashBin
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{laeuft === "verwerfen" ? stepUp.running("Verwirft...") : ADRESSWECHSEL_VERWERFEN}</span>
            </Button>
          </FocusSlot>
        </div>
        <StepUpRefused refused={stepUp.refused} />
      </div>
    </section>
  );
}
