"use client";

import { useTransition } from "react";

import { Button } from "@heroui/react";

import { deleteSpieltagAction, reactivateSpieltagAction } from "@/features/spieltage/actions";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { appToast } from "@/shared/utils/appToast";

import type { SpieltagBanner } from "./banners";

/**
 * Taking the matchday off the public Spielplan — the editor's danger zone, in the same shape as the
 * squad editor's Austragen panel: last on the page, in the danger tone.
 *
 * **A button rather than a field.** It writes the moment it is pressed and never joins the save bar,
 * because there is no half-entered state for the bar to hold. Reversible either way, which is why it
 * is not a confirmation dialog: the delete is soft and `reactivate` puts the matchday back
 * with its fixtures untouched — they were never touched.
 *
 * **Both refusals are stated before the press rather than explained after it.** `REQ-RETIRE-002`
 * refuses while a fixture here carries a result, and `REQ-RETIRE-005` refuses while the phase would
 * drop below the count its rules imply; each is a fact the page already holds, so the control is
 * disabled with the reason in a banner beside it rather than opening onto a 409. The endpoint stays
 * the authority — a fixture scored in another tab reaches it — so the action still maps both codes.
 */
export function FormStilllegenSection({
  spieltagId,
  label,
  inactiveSince,
  isRetireable,
  banners,
}: {
  spieltagId: string;
  /** The matchday's derived name, so the buttons say which one they act on. */
  label: string;
  inactiveSince: string | null;
  /** Whether the page can see a reason the retirement would be refused. */
  isRetireable: boolean;
  /** The editor's whole Hinweis list; the spot below takes its own entries out of it. */
  banners: readonly SpieltagBanner[];
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();

  const run = (write: () => Promise<{ success: boolean; message?: string; error?: string }>, failureHeading: string) => {
    startWriting(async () => {
      const res = await write();
      if (res.success) appToast.success(res.message ?? "Gespeichert!");
      else appToast.danger(failureHeading, { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Spieltag stilllegen
          <InfoHint label="Hinweis zum Stilllegen">
            <p>Der Weg, einen Spieltag aus dem Spielplan zu nehmen.</p>
            <ul>
              <li>
                Seine Spiele <strong>bleiben erhalten</strong> und sind weiter bearbeitbar.
              </li>
              <li>Sichtbar sind sie erst wieder, wenn Du den Spieltag reaktivierst.</li>
              <li>Reaktivieren geht nur, solange sein Zeitraum in die Saison passt.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <InlineBanners
          banners={banners}
          spot="stilllegen"
        />

        {inactiveSince !== null ? (
          <Button
            type="button"
            variant="primary"
            isDisabled={isPending}
            onPress={() => run(() => reactivateSpieltagAction({ id: spieltagId }), "Reaktivieren fehlgeschlagen")}
            className={`${formButton({ intent: "submit" })} w-fit`}>
            {isPending ? "Speichert..." : `${label} reaktivieren`}
          </Button>
        ) : (
          <>
            <p className="fluid-sm text-foreground-muted font-medium">
              Der Spieltag verschwindet vom öffentlichen Spielplan. Seine Spiele bleiben gespeichert und kehren beim Reaktivieren zurück.
            </p>
            {/* The danger button's own shape, so it does not read as the page's primary action —
                the save bar below owns that. Disabled where the page can already see the refusal;
                the banner above says which of the two it is. */}
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending || !isRetireable}
              onPress={() => run(() => deleteSpieltagAction({ id: spieltagId }), "Stilllegen fehlgeschlagen")}
              className="border-danger/40 bg-surface text-danger data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-sm flex h-10 w-fit items-center rounded-lg border px-4 font-bold shadow-sm transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-40">
              {isPending ? "Speichert..." : `${label} stilllegen`}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
