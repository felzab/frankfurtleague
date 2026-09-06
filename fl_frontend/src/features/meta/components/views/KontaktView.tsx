import Link from "next/link";

import { Envelope } from "@gravity-ui/icons";

import { BrandHero } from "@/shared/components/ui/BrandHero";
import { card } from "@/shared/components/ui/card";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { CARDS_CASCADE, PAGE_RISE } from "@/shared/components/ui/motion";

import { KONTAKT_CHANNELS } from "../../constants";
import { MetaSection } from "../ui/MetaSection";

import type { ReactNode } from "react";
import type { KontaktChannelId } from "../../types";

const TILE = "bg-brand-solid text-brand-solid-foreground flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm";

const MASK = "bg-brand-solid-foreground inline-block size-6 mask-contain mask-center mask-no-repeat";

// A record rather than a chain: `KontaktChannelId` is a closed set, so a fourth channel fails to
// compile here rather than rendering an empty tile nothing reports.
const GLYPH: Record<KontaktChannelId, ReactNode> = {
  email: (
    <Envelope
      aria-hidden="true"
      className="size-6"
    />
  ),
  instagram: (
    <span
      aria-hidden="true"
      title="Instagram by Pixel Icons"
      className={`${MASK} mask-[url('/icons/footer/instagram/instagram_logo_black.svg')]`}
    />
  ),
  threads: (
    <span
      aria-hidden="true"
      className={`${MASK} mask-[url('/icons/footer/threads/threads_logo_black.svg')]`}
    />
  ),
};

/**
 * `bewerbungSlot` is injected rather than read here: the band's read needs a request scope and its
 * own `<Suspense>`, both of which belong to the page. Empty for most of the year and costing no gap
 * then — a boundary resolving to `null` renders no box.
 */
export function KontaktView({ bewerbungSlot }: { bewerbungSlot?: ReactNode }) {
  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-y-8 sm:gap-y-12`}>
      <BrandHero
        title="Kontakt"
        lead="Wir haben immer ein offenes Ohr für Dein Anliegen. Fragen oder Anregungen zur Liga? Schreib uns. Wir melden uns schnellstmöglich bei Dir."
      />

      {/* No wrapper and no margin of its own: it takes the column's `gap-y` like every block here, so
          the rhythm holds whether it renders or not. */}
      {bewerbungSlot}

      <MetaSection
        eyebrow="So erreichst Du uns"
        title="Kanäle">
        <div
          role="list"
          className={`${CARDS_CASCADE} grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3`}>
          {KONTAKT_CHANNELS.map((channel) => (
            <div
              role="listitem"
              key={channel.id}
              className={`${card()} flex flex-col justify-between gap-y-5 p-5 sm:p-6`}>
              <div className="flex flex-col gap-y-4">
                <div className="flex flex-row items-center gap-x-3">
                  <span
                    aria-hidden="true"
                    className={TILE}>
                    {GLYPH[channel.id]}
                  </span>
                  <span className="fluid-base text-foreground font-bold">{channel.name}</span>
                </div>

                <span className="fluid-sm text-foreground font-semibold break-words">{channel.value}</span>
              </div>

              <Link
                href={channel.action}
                // Never onto the `mailto:`: the mail client opens and an empty tab stays behind it.
                {...(channel.action.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                className={`${ctaButton({ intent: "outline", size: "sm", hover: "css" })} w-full`}>
                {channel.cta}
              </Link>
            </div>
          ))}
        </div>
      </MetaSection>
    </div>
  );
}
