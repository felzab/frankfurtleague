import Link from "next/link";

import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/core/brand";
import { band } from "@/features/bewerbungen/components/ui/BewerbungOffenBand";
import { textLink } from "@/shared/components/ui/textLink";

/**
 * One component so one wording serves both sites. The season strip's shell rather than a `Callout`,
 * whose `info` tint is the app's feedback colour: a feedback box on a public page reads as a system
 * message.
 */
export function BewerbungInstagramBand() {
  const styles = band();

  return (
    <div className={styles.root()}>
      {/* `items-start` and `Callout`'s gap, never the sibling band's centred row: that row carries one
          line beside a button, and centring a mark against four wrapped lines floats it mid-block. */}
      <div className="flex w-full flex-row items-start gap-x-3">
        {/* `bg-foreground`, the footer's spelling for this mark, at `Callout`'s size for an icon beside a
            paragraph: a brand-red logo under a header already carrying five brand accents reads as an ad. */}
        <span
          aria-hidden="true"
          className="bg-foreground mt-0.5 inline-block size-5 shrink-0 mask-[url('/icons/footer/instagram/instagram_logo_black.svg')] mask-contain mask-center mask-no-repeat"
        />

        {/* The page's own paragraph grade, which the lead and the closed-state panels wear. Not bold:
            no file here sets a multi-line paragraph bold, and `band`'s `text` slot is built for a
            one-line strapline beside a button. */}
        <p className="muted-hint">
          {/* Wording I dictated, and the one place the reader is „ihr“ rather than „Du“: the invitation
              is to a team, not to one reader. `docs/frontend/spec.md` §1.12's first rule carries it. */}
          Ihr wollt eure Chancen auf eine Zusage verbessern? Ladet einen Beitrag auf Instagram hoch, am besten ein Video, in dem ihr erzählt,
          warum ihr in die Liga wollt, und markiert{" "}
          {/* The strip's one accent, and its only tap target: a strip that is itself a link takes a
              half-filled form off the screen on a stray press. */}
          <Link
            href={INSTAGRAM_URL}
            prefetch={false}
            target="_blank"
            rel="noopener noreferrer"
            className={textLink()}>
            {INSTAGRAM_HANDLE}
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
