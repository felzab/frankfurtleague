"use client";

// Redesign: goes with its last importer; `kit/RailFrame` replaces it.
import { usePathname } from "next/navigation";

import { FOCUS_HEADING } from "../../../utils/focusAfterWrite";
import { InfoHint } from "../../ui/InfoHint";
import { KONTO_SECTION } from "./kontoSection";
import { useLinkPrefix } from "./linkPrefix";

import type { SidemenuHint, SidemenuStructure } from "@/shared/types/types";
import type { LinkPrefix } from "./linkPrefix";

type ShellSection = { label: string; hint: SidemenuHint };

/**
 * **This is the page's `h1` and a view under it must not carry a second.** `SidemenuStructure` is the one declaration
 * of a route's name, read by both the nav item and this title, so the two cannot disagree.
 */
export function ShellTitle({ label, hint }: { label: string; hint?: SidemenuHint }) {
  return (
    <>
      {/* The glyph beside the h1 and not inside it, or a screen reader names the page with the hint's label. Both
          inline in one block, whose size reaches `InfoHint`'s 1em icon on the title's line box. */}
      <h1
        {...FOCUS_HEADING}
        className="inline font-semibold tracking-wide text-foreground">
        {label}
      </h1>
      {/* `InfoHint` rather than `IconTooltip`: react-aria's tooltip never opens on tap, so a phone could not reach it. */}
      {hint && (
        <InfoHint label={`Was auf „${label}“ zu finden ist`}>
          <p>
            <strong>{label}</strong>
          </p>
          <p>{hint.lead}</p>
          {hint.points && (
            <ul>
              {hint.points.map((point) => (
                <li key={point.term}>
                  <strong>{point.term}</strong>: {point.detail}
                </li>
              ))}
            </ul>
          )}
          {hint.note && <p className="text-foreground-muted">{hint.note}</p>}
        </InfoHint>
      )}
    </>
  );
}

export type ShellHeadingProps = {
  structure: SidemenuStructure<string>;
  linkPrefix: LinkPrefix;
  /**
   * Sections with a route and no nav entry, by first segment. Such a page carries its own `h2` naming its subject, so
   * the bar names the section and the page names the record.
   */
  unlistedSections?: Readonly<Record<string, ShellSection>>;
  /**
   * What the bar reads on an address no entry and no unlisted section claims. Its hint is required for
   * `SidemenuStructureSubOption.hint`'s reason: a glyph absent on one route reads as "this page has nothing to explain".
   */
  fallback: ShellSection;
  kontoHref: string | null;
};

/** **Under a Suspense boundary only**, for `useLinkPrefix`'s reason, which `usePathname()` shares. */
export function ShellHeading({ structure, linkPrefix, unlistedSections = {}, fallback, kontoHref }: ShellHeadingProps) {
  const pathname = usePathname();
  const prefix = useLinkPrefix(linkPrefix);

  // Matched on the first segment after the prefix, so a detail route resolves to its section's entry
  // and still gets a title and a hint.
  const baseSegment = pathname.replace(`${prefix}/`, "").split("/")[0];
  const activeOption = structure.flatMap((group) => group.sub_options).find((option) => option.id === baseSegment);
  // `hasOwn`, never `in` or a bare index: the segment is whatever the address bar holds, and `/bereich/admin/constructor`
  // would otherwise select a prototype member and head the page with nothing at all.
  const unlistedSection = baseSegment !== undefined && Object.hasOwn(unlistedSections, baseSegment) ? unlistedSections[baseSegment] : undefined;
  // Matched whole and ahead of the first segment, so the one address is headed alike in whichever shell
  // declares it, and no shell lists it as an entry of its own.
  const section: ShellSection = kontoHref !== null && pathname === kontoHref ? KONTO_SECTION : (activeOption ?? unlistedSection ?? fallback);

  return (
    <ShellTitle
      label={section.label}
      hint={section.hint}
    />
  );
}
