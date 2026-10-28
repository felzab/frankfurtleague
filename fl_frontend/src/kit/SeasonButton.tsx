"use client";

import { useParams, usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { counterpart, useFrameSeason } from "./FrameNav";
import { Icon } from "./Icon";
import { Menu } from "./Menu";

const trigger = tv({
  slots: {
    place: "",
    root: "inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) pointer-coarse:h-11",
    arrow: "flex",
  },
  variants: {
    // In the rail on the page's ground, or on the phone's dark-green band.
    placement: {
      rail: { place: "px-3 pt-3 pb-1", root: "w-full border-border-control bg-bg text-fg data-hovered:bg-bg-muted", arrow: "text-fg-muted" },
      band: { place: "ms-auto shrink-0", root: "border-on-brand/45 bg-transparent text-on-brand", arrow: "text-on-brand/80" },
    },
    // With one season there is nowhere to switch to, yet it stays a menu: its arrow is dimmed.
    single: {
      true: { arrow: "opacity-45" },
    },
  },
});

/**
 * Switching season, at the top of the rail or in the phone's top band: always a menu, even with one
 * season, and nothing where the frame holds no season. Each entry is the page shown, in that season, read
 * from the address on the client, so the layout placing the frame need not know the page beneath it.
 */
export function SeasonButton({ placement }: { placement: "rail" | "band" }) {
  const season = useFrameSeason();
  const path = usePathname();
  const params = useParams();
  if (season === null) return null;

  const { place, root, arrow } = trigger({ placement, single: season.ids.length < 2 });
  return (
    <div className={place()}>
      <Menu
        label={COPY.shared.saison}
        placement="below"
        groups={[
          season.ids.map((id) => ({
            kind: "link" as const,
            label: COPY.shared.saisonName(id),
            href: counterpart({ path, params, to: id, home: season.home, pages: season.pages }),
            isCurrent: id === season.active,
            // The browser's Back skips a season switch, returning to the page before the season's pages.
            routerOptions: { replace: true },
          })),
        ]}
        trigger={
          <AriaButton
            data-kit-focus="ring"
            className={root()}>
            {COPY.shared.saisonName(season.active)}
            <span className={arrow()}>
              <Icon
                glyph="aufklappen"
                size={16}
              />
            </span>
          </AriaButton>
        }
      />
    </div>
  );
}
