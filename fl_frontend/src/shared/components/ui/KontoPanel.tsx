// Redesign: goes with its last importer; `kit/KontoBox` replaces it.

import { focusSection } from "@/shared/utils/focusAfterWrite";

import { Angabe } from "./Angabe";
import { formPanel } from "./formPanel";
import { PanelHeading } from "./PanelHeading";

import type { ReactNode } from "react";

/**
 * The account page's body. It takes everything as props: `shared` may not import a feature slice
 * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`), so the page reads the holder and hands the
 * feature sections in.
 */
export function KontoPanel({
  email,
  adresswechsel,
  sicherheit,
  einwilligung,
  loeschung,
}: {
  email: string;
  /** The address control beside the address it would change, empty where the address holds nothing it moves. */
  adresswechsel: ReactNode;
  sicherheit: ReactNode;
  einwilligung: ReactNode;
  loeschung: ReactNode;
}) {
  const panel = formPanel();

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {/* `h2` panels under the bar's `h1`, which reads „Konto“: a page carries no second `h1`. „Zugang“
            is the administration grant's word, so the address a person signs in with is not headed by it. */}
        {/* A section, so a write that takes the address control away lands on this heading. */}
        <section
          className={panel.root()}
          {...focusSection("anmeldung")}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Anmeldung"
            />
          </div>
          <div className={panel.body()}>
            <dl>
              <Angabe label="E-Mail-Adresse">
                {/* Broken anywhere, as every page showing the sign-in address breaks it. */}
                <span className="break-all">{email}</span>
              </Angabe>
            </dl>
            {adresswechsel}
          </div>
        </section>

        {sicherheit}

        {einwilligung}

        {/* Last and set apart: the one control on the page that ends the account rather than changing it. */}
        {loeschung}
      </div>
    </div>
  );
}
