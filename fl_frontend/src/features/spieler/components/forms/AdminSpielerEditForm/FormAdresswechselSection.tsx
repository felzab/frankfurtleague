"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { LinkStandAngaben } from "@/features/bewerbungen/components/ui/LinkStandAngaben";
import { einladeSpielerAdresswechselAction, verwirfSpielerAdresswechselAction } from "@/features/spieler/actions";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { FLSpielerAdresswechsel } from "@/features/spieler/schemas";

export const ADRESSWECHSEL_WARTET = "Neue Adresse wartet auf Bestätigung";
export const ADRESSWECHSEL_ERNEUT = "Link erneut senden";
export const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";

/** Unlike a re-send, a second discard of a change already gone is refused, so the page, reloaded, decides. */
const VERWERFEN_OHNE_ANTWORT = "Prüfe die Verbindung und lade die Seite neu. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.";

/**
 * Shown only while a pupil's new address waits on its mailbox, the referee's twin
 * (`fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAdresswechselSection.tsx :: FormAdresswechselSection`).
 * **The address above is still in force**, which this panel says beside the two controls ending the wait.
 */
export function FormAdresswechselSection({
  spielerId,
  adresswechsel,
  istAbgelaufen,
  isDirty,
}: {
  spielerId: string;
  adresswechsel: FLSpielerAdresswechsel;
  /** The read's judgement of the deadline: a lapsed change stands until it is removed, so the date alone reads as running. */
  istAbgelaufen: boolean;
  /** The editor's unsaved typing, which either write re-keys the editor over. */
  isDirty: boolean;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<"senden" | "verwerfen" | null>(null);
  const stepUp = useStepUp();
  const panel = formPanel();

  // Both writes mint or void a link to an address.
  const schreibe = async (art: "senden" | "verwerfen") => {
    const landing = focusAfterWrite();
    const res = await pressLinkWrite({
      isDirty,
      stepUp,
      router,
      pending: (running) => setLaeuft(running ? art : null),
      write: () => (art === "senden" ? einladeSpielerAdresswechselAction : verwirfSpielerAdresswechselAction)({ id: spielerId }),
      repair: art === "senden" ? LINK_ERNEUT_OHNE_ANTWORT : VERWERFEN_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      if (art === "senden") appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      else appToast.failure("Änderung nicht verworfen", res);
      return;
    }

    landing.landed();
    // A warning where the link did not leave, as the request's press grades it: the earlier link is dead either way.
    if ("versandFehlgeschlagen" in res && res.versandFehlgeschlagen === true)
      appToast.warning("Link nicht gesendet", { description: res.message });
    else appToast.success(art === "senden" ? "Link gesendet" : "Änderung verworfen", { description: res.message });
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
          <LinkStandAngaben
            verschicktAm={adresswechsel.verschickt_am}
            frist={adresswechsel.frist}
            istAbgelaufen={istAbgelaufen}
            zustellung={adresswechsel.zustellung}
          />
        </dl>

        <div className="flex w-full flex-wrap items-start gap-2">
          <FocusSlot name="adresswechsel-einladen">
            <Button
              type="button"
              isPending={laeuft === "senden"}
              isDisabled={laeuft !== null}
              onPress={() => void schreibe("senden")}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <PaperPlane
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{laeuft === "senden" ? stepUp.running("Sendet...") : ADRESSWECHSEL_ERNEUT}</span>
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
