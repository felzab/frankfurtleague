import { formPanel } from "./formPanel";
import { PanelHeading } from "./PanelHeading";

import type { ReactNode } from "react";

/**
 * The account page's body. It takes everything as props: `shared` may not import a feature slice
 * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`), so the page reads the holder and hands the
 * feature sections in.
 */
export function KontoPanel({ email, sicherheit }: { email: string; sicherheit: ReactNode }) {
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
            <div className="flex flex-col gap-y-0.5">
              <dt className="fluid-xxs font-bold text-foreground-muted">E-Mail-Adresse</dt>
              <dd className="min-w-0 fluid-sm font-medium break-all text-foreground">{email}</dd>
            </div>
          </dl>
        </section>

        {sicherheit}
      </div>
    </div>
  );
}
