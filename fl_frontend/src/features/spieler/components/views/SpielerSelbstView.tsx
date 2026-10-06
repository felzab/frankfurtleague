import Link from "next/link";

import { KONTO_HREF } from "@/core/kontoHref";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";

import { SpielerAngaben } from "../ui/SpielerAngaben";

import type { FLSpielerSelbst } from "../../schemas";

/**
 * A pupil's own data, read-only: the consent the record holds is changed on the account page, which
 * the stamped wording names as the place to change it, so this page links there rather than offering
 * a second control.
 */
export function SpielerSelbstView({ spieler }: { spieler: FLSpielerSelbst }) {
  const panel = formPanel();

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <section className={panel.root()}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Deine Angaben"
            />
          </div>
          <div className={panel.body()}>
            <SpielerAngaben
              spieler={spieler}
              kaderEbene="h3"
            />

            <p className="fluid-sm font-medium text-foreground">
              Was von Dir auf der Website stehen darf, änderst Du unter{" "}
              <Link
                href={KONTO_HREF}
                prefetch={false}
                className={textLink()}>
                Konto
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
