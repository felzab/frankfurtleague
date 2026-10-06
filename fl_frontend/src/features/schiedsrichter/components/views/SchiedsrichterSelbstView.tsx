import Link from "next/link";

import { KONTO_HREF } from "@/core/kontoHref";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";

import { SchiedsrichterAngaben } from "../ui/SchiedsrichterAngaben";

import type { FLSchiedsrichterSelbst } from "../../schemas";

/**
 * A referee's own data, read-only, one panel per referee row the address holds: whether the name stands
 * in the Spielplan is changed on the account page, so this page links there rather than offering a
 * second control.
 */
export function SchiedsrichterSelbstView({ schiedsrichter }: { schiedsrichter: readonly FLSchiedsrichterSelbst[] }) {
  const panel = formPanel();

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {schiedsrichter.map((eintrag) => (
          <section
            key={eintrag.schiedsrichter_id}
            className={panel.root()}>
            <div className={panel.header()}>
              <PanelHeading
                className={panel.heading()}
                title="Deine Angaben"
              />
            </div>
            <div className={panel.body()}>
              <SchiedsrichterAngaben eintrag={eintrag} />

              <p className="fluid-sm font-medium text-foreground">
                Was von Dir im Spielplan und auf der Website stehen darf, änderst Du unter{" "}
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
        ))}
      </div>
    </div>
  );
}
