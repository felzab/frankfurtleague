"use client";

import { AdresswechselHinweis } from "@/features/adresswechsel/components/ui/AdresswechselHinweis";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

/**
 * The pupil's sign-in address, read here and changed nowhere on this page: the save never carries it, and a change
 * is the person's own on their account page or the address tool's.
 */
export function FormAdresseSection({
  email,
  adresswechselId,
}: {
  /** The stored, folded address, `null` for a pupil holding none, who takes no change. */
  email: string | null;
  adresswechselId: string | null;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="E-Mail-Adresse"
        />
      </div>

      <div className={panel.body()}>
        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Hinterlegte Adresse">{email ?? <Leer />}</Angabe>
        </dl>

        {email === null ? (
          // The missing control in the same breath, as the consent panel beside it says its own: a reader
          // meeting an empty value among editable panels goes looking for the way to enter one.
          <p className="muted-hint">Eine Adresse kommt mit der Registrierung über den Link des Teams.</p>
        ) : (
          <AdresswechselHinweis adresswechselId={adresswechselId} />
        )}
      </div>
    </section>
  );
}
