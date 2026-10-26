"use client";

import { AdresswechselHinweis } from "@/features/adresswechsel/components/ui/AdresswechselHinweis";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { EinsehbarVerwehrt } from "@/features/adresswechsel/einsehbar";

/**
 * The pupil's sign-in address, read here and changed nowhere on this page: the save never carries it, and a change
 * is the person's own on their account page or the address tool's.
 */
export function FormAdresseSection({
  email,
  adresswechselId,
  adresswechselVerwehrt,
}: {
  /** The stored, folded address: every pupil holds one, their registration's. */
  email: string;
  adresswechselId: string | null;
  adresswechselVerwehrt: EinsehbarVerwehrt | null;
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
          <Angabe label="Hinterlegte Adresse">{email}</Angabe>
        </dl>

        <AdresswechselHinweis
          adresswechselId={adresswechselId}
          verwehrt={adresswechselVerwehrt}
        />
      </div>
    </section>
  );
}
