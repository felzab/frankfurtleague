"use client";

import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { FESTE_WERTE } from "@/features/bewerbungen/components/ui/Gefuellt";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { fordereKontoLoeschungAnAction } from "../../actions";

/**
 * The account page's „Konto löschen“, which every stamped page's `{loeschung}` names: the press mails a
 * link, and the deletion waits on the interstitial that link opens (`docs/frontend/spec.md :: I_NEW_S9-AUTH_4`).
 */
export function KontoLoeschenSection() {
  const router = useRouter();
  const twoPress = useTwoPressConfirm();
  const panel = formPanel({ tone: "danger" });

  const fordereAn = () => {
    twoPress.press(async () => {
      // A rejected action may still have mailed, and uncaught here it takes the page down with it.
      const res = await fordereKontoLoeschungAnAction().catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Link nicht verschickt", res);
        return;
      }

      appToast.success("Link verschickt", { description: res.message });
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={FESTE_WERTE.loeschung}
        />
      </div>

      <div className={panel.body()}>
        <p className="muted-hint">
          Wir schicken Dir einen Link an Deine E-Mail-Adresse. Erst wenn Du ihn öffnest und dort bestätigst, löschen wir Dein Konto und alle
          Angaben, die wir unter Deiner Adresse gespeichert haben.
        </p>

        {twoPress.isConfirming && (
          <ConfirmReveal>
            <p className="fluid-xxs leading-normal font-medium text-foreground">
              Der Link geht an die Adresse, mit der Du angemeldet bist. Kommt keine E-Mail an, fordere ihn erneut an.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow confirm={twoPress}>
          <ConfirmPressButton
            confirm={twoPress}
            reason={null}
            resting={FESTE_WERTE.loeschung}
            armed="Ja, Link zum Löschen schicken"
            running="Schickt den Link..."
            icon={
              <TrashBin
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={fordereAn}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
