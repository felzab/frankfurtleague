import { Angabe } from "./Angabe";
import { formPanel } from "./formPanel";
import { PanelHeading } from "./PanelHeading";

import type { ReactNode } from "react";

/**
 * The account page's body. It takes everything as props: `shared` may not import a feature slice
 * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`), so the page reads the holder and hands the
 * feature sections in.
 */
export function KontoPanel({ email, sicherheit, einwilligung }: { email: string; sicherheit: ReactNode; einwilligung: ReactNode }) {
  const panel = formPanel();

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {/* `h2` panels under the bar's `h1`, which reads „Konto“: a page carries no second `h1`. „Zugang“
            is the administration grant's word, so the address a person signs in with is not headed by it. */}
        <section className={panel.root()}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Anmeldung"
            />
          </div>
          <dl className={panel.body()}>
            <Angabe label="E-Mail-Adresse">
              {/* Broken anywhere, as every page showing the sign-in address breaks it. */}
              <span className="break-all">{email}</span>
            </Angabe>
          </dl>
        </section>

        {sicherheit}

        {einwilligung}
      </div>
    </div>
  );
}
