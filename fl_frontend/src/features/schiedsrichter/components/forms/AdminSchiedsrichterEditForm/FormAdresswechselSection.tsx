"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { einladeAdresswechselAction, verwirfAdresswechselAction } from "@/features/schiedsrichter/actions";
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
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR, rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { DRAFT_DISCARDED, guardAgainstDraft } from "@/shared/utils/draftGuard";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas";

/** The consent link's panel spells these the same way, so one state is one word across the two. */
const ABGELAUFEN_LABEL = "abgelaufen";
export const ADRESSWECHSEL_WARTET = "Neue Adresse wartet auf Bestätigung";
export const ADRESSWECHSEL_ABGELAUFEN = "Die Bestätigungsfrist ist abgelaufen.";
export const ADRESSWECHSEL_ERNEUT = "Link erneut senden";
export const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";

/**
 * Shown only while a confirmed referee's new address waits on its mailbox. **The address above is
 * still in force**, which this panel says beside the two controls ending the wait.
 */
export function FormAdresswechselSection({
  schiedsrichterId,
  adresswechsel,
  isDirty,
}: {
  schiedsrichterId: string;
  adresswechsel: FLSchiedsrichterAdresswechsel;
  /** The editor's unsaved typing, which either write re-keys the editor over. */
  isDirty: boolean;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<"senden" | "verwerfen" | null>(null);
  const stepUp = useStepUp();
  const panel = formPanel();

  const zustellung = adresswechsel.zustellung === null ? null : ZUSTELLUNG_CHIP[adresswechsel.zustellung.stand];
  // No clock removes a lapsed change, so the date alone would read as a deadline still running.
  const istAbgelaufen = adresswechsel.frist < getGermanTodayStr();

  // Both writes mint or void a link to an address, so both step up (`docs/frontend/spec.md :: I432`).
  const schreibe = async (art: "senden" | "verwerfen") => {
    if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return;

    const landing = focusAfterWrite();
    setLaeuft(art);
    if (!(await stepUp.confirm(true))) {
      setLaeuft(null);
      return;
    }

    // Awaited outside a transition, for the consent link's re-send's reason.
    const res = await (art === "senden" ? einladeAdresswechselAction : verwirfAdresswechselAction)({ id: schiedsrichterId }).catch(
      rejectedWrite(router, LINK_ERNEUT_OHNE_ANTWORT),
    );
    setLaeuft(null);

    if (!res.success) {
      if (art === "senden") appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      else appToast.failure("Änderung nicht verworfen", res);
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
        <p className="muted-hint">{istAbgelaufen ? ADRESSWECHSEL_ABGELAUFEN : ADRESSWECHSEL_WARTET}</p>

        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Neue Adresse">{adresswechsel.email}</Angabe>
          <Angabe label="Link gesendet am">{formatSpielDatum(adresswechsel.verschickt_am)}</Angabe>
          <Angabe label="Gültig bis">
            {formatSpielDatum(adresswechsel.frist)}
            {istAbgelaufen && <span className={`${labelBadge("warning")} ms-2 h-7 shrink-0`}>{ABGELAUFEN_LABEL}</span>}
          </Angabe>
          <Angabe label="Zustellung">
            {zustellung === null ? (
              <span className="text-foreground-muted italic">Nichts zu melden</span>
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
