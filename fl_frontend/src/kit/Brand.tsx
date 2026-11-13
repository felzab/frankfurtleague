import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { FLLogo } from "./FLLogo";
import { hoverLook } from "./hoverStyles";
import { tv } from "./tv";
import { NavigationLink } from "./WholePage";

const brand = tv({
  slots: {
    // It sets no colour of its own, so the layer is 12 % of the words of the ground it stands on, the band's or the page's.
    root: `flex min-w-0 items-center gap-3 rounded-lg ${hoverLook({ host: "link" })}`,
    mark: "h-8 w-auto shrink-0",
    wordmark: "font-heading text-xl tracking-caps whitespace-nowrap uppercase",
  },
  variants: {
    ground: {
      // The dark-green band at the top of every frame: the mark in the accent green, the only place it goes.
      // The wordmark gives way to the mark alone where the band runs short, as at 200 % text, and in the
      // rail collapsed to its glyphs, where the mark takes a 24-px box so the rail head's 24-px inset
      // centres it in the 72-px rail; `lg:`, since the same band heads a phone's frame. On a touch screen the link is
      // the kit's 40-px control at least, the mark alone centred in it.
      band: {
        root: "justify-center pointer-coarse:h-10 pointer-coarse:min-w-10",
        mark: "text-brand-accent lg:group-data-collapsed:w-6",
        wordmark: "text-on-brand lg:group-data-collapsed:hidden @max-[22rem]:hidden",
      },
      // The page's own ground, as in the footer: the dark green on light, the brand green on dark.
      page: { mark: "text-brand-solid dark:text-brand", wordmark: "text-fg" },
    },
  },
});

/** The league's mark and wordmark, leading to the landing; its name is the league's whether the wordmark shows or not. */
export function Brand({ ground }: { ground: "band" | "page" }) {
  const { root, mark, wordmark } = brand({ ground });
  return (
    <NavigationLink
      href={ROUTES.home.path()}
      aria-label={COPY.brand.name}
      data-kit-focus="ring"
      className={root()}>
      <FLLogo className={mark()} />
      <span
        aria-hidden
        className={wordmark()}>
        {COPY.brand.name}
      </span>
    </NavigationLink>
  );
}
