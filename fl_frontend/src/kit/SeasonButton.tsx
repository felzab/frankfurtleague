"use client";

import { useParams, usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";

import { counterpart, useFrameSeason } from "./FrameNav";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { railFade } from "./railStyles";
import { tv } from "./tv";

const trigger = tv({
  slots: {
    place: "",
    root: "inline-flex items-center justify-between gap-2 rounded-lg border text-sm whitespace-nowrap transition-colors duration-(--motion-state)",
    lines: "grid min-w-0 gap-1 text-start",
    name: "truncate",
    span: "font-numeric text-xs font-normal text-fg-muted",
    arrow: "flex",
    glyph: "",
  },
  variants: {
    // In the rail on the page's ground: outlined, no fill, two lines (the name over the season's span), 58 px
    // tall with 16 px at the sides, 8 above and below and 4 between the lines (design board 6, `saison` B).
    // Collapsed, the lines and the arrow fade, clipped by the box, and the season glyph fades in over the
    // box's 16-px inset, where the place's 12 px and that inset centre a 16-px glyph in the 72-px rail.
    // On the phone's dark-green band: one line, as tall as a touch target, since the span does not fit beside
    // the wordmark.
    placement: {
      rail: {
        place: "px-3 pt-3 pb-1",
        root: "relative min-h-14 w-full overflow-hidden border-border bg-transparent px-4 py-2 font-semibold text-fg data-hovered:bg-bg-muted data-pressed:bg-bg-muted",
        lines: railFade(),
        arrow: railFade({ class: "text-fg-muted" }),
        glyph:
          "absolute inset-y-0 left-4 flex items-center text-fg-muted opacity-0 transition-opacity duration-(--motion-in) group-data-collapsed:opacity-100",
      },
      band: {
        place: "ms-auto shrink-0",
        root: "h-9 border-on-brand/45 bg-transparent px-3 font-medium text-on-brand pointer-coarse:h-11",
        arrow: "text-on-brand/80",
      },
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

  const { place, root, lines, name, span, arrow, glyph } = trigger({ placement, single: season.entries.length < 2 });
  const active = season.entries.find((entry) => entry.id === season.active);
  return (
    <div className={place()}>
      <Menu
        label={COPY.shared.saison}
        placement="below"
        // In the rail the list is as wide as the button it opens from; on the band, as wide as its entries.
        width={placement === "rail" ? "trigger" : "content"}
        groups={[
          season.entries.map(({ id }) => ({
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
            {placement === "rail" ? (
              <>
                <span className={glyph()}>
                  <Icon
                    glyph="saison"
                    size={16}
                  />
                </span>
                <span className={lines()}>
                  <span className={name()}>{COPY.shared.saisonName(season.active)}</span>
                  <span className={span()}>{active?.span}</span>
                </span>
              </>
            ) : (
              COPY.shared.saisonName(season.active)
            )}
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
