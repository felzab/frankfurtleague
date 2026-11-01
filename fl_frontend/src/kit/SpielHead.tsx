import { Suspense } from "react";

import { COPY } from "@/core/copy";
import { ERGEBNIS_SEPARATOR } from "@/core/format";

import { Callout } from "./Callout";
import { RouteDialog } from "./Dialog";
import { Facts } from "./Facts";
import { Link } from "./Link";
import { figures, look, NONE, sideMarks } from "./SpielRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { Fact } from "./Facts";
import type { Figures, SpielRowProps, SpielSide } from "./SpielRow";

/**
 * A side as the head names it: the club's name a link to its page once the club is known, and under it a
 * muted line saying where the club stands, such as its place in its group, a link to that place.
 */
type SpielHeadSide = SpielSide & {
  href?: Route;
  /**
   * Its words, such as „3. Platz · Gruppe A“ or a knockout round's name, and its target, a fragment such as
   * `…/tabelle#<anchor>`, which the browser scrolls into view and marks as the document's target, the row then
   * drawing its highlight (`kit-target`, `:target`). The browser sets that target only on a document
   * navigation, never on the history entry a client navigation pushes, so the line loads its page whole.
   */
  standing?: { text: string; href: Route };
};

export type SpielHeadProps = {
  /** The line above the pairing, as a competition's round stands over a scoreboard: the matchday. */
  eyebrow: string;
  home: SpielHeadSide;
  away: SpielHeadSide;
  /** Absent until a result is entered, so an unplayed match never reads 0:0. */
  result?: SpielRowProps["result"];
};

const head = tv({
  extend: sideMarks,
  slots: {
    root: "grid justify-items-center gap-4 bg-bg-surface p-6",
    eyebrow: "text-xs font-medium text-fg-muted",
    side: "grid min-w-0 justify-items-center gap-2 text-center",
    name: "min-w-0 text-sm [overflow-wrap:anywhere]",
    standing: "min-w-0 text-xs [overflow-wrap:anywhere]",
  },
  variants: {
    placement: {
      // The band: the lighter surface run edge to edge across the dialog's top, the padding the box declares
      // taken back around it, so the pairing is framed as the old pop-up framed the teams, on a surface of
      // its own. Its top corners are the box's: a box whose overflow is not visible clips its content to its
      // rounded padding edge (CSS Backgrounds 3, corner clipping).
      dialog: { root: "-mx-(--dialog-padding) -mt-(--dialog-padding)" },
      // A match's own page: the same surface as a box of the column, with the card corners and the hairline.
      page: { root: "rounded-lg border border-border" },
    },
  },
});

function Goals({ score, part }: { score: Figures; part: "home" | "away" }) {
  return <span className={head(look(score, part)).goals()}>{score === null ? NONE : score[part]}</span>;
}

/** A side as the centred look sets it: the plaque over the name, and under it where the club stands. */
function Side({ side, score, part }: { side: SpielHeadSide; score: Figures; part: "home" | "away" }) {
  const style = head(look(score, part));
  return (
    <span className={style.side()}>
      <TeamPlaque {...side.plaque} />
      <span className={style.name()}>
        {side.href === undefined ? (
          side.name
        ) : (
          <Link
            href={side.href}
            placement="standalone"
            text={side.name}
          />
        )}
      </span>
      {side.standing !== undefined && (
        <span className={style.standing()}>
          <Link
            href={side.standing.href}
            placement="detail"
            fullPage
            text={side.standing.text}
          />
        </span>
      )}
    </span>
  );
}

/**
 * The match head over the pop-up's facts and over a match page's: the matchday, and under it the two sides as
 * a pairing with their plaques over their names and the score large between them, „n. E.“ under a
 * shoot-out's score, on a surface of its own, the band across the dialog's top or a box of the page. The one
 * block that names a match by its two sides.
 */
export function SpielHead({ eyebrow, home, away, result, placement = "dialog" }: SpielHeadProps & { placement?: "dialog" | "page" }) {
  const score = figures(result);
  const shootOut = score?.shootOut === true ? COPY.shared.afterElfmeterschiessen : null;
  const style = head({ placement });
  return (
    <div className={style.root()}>
      <span className={style.eyebrow()}>{eyebrow}</span>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        <Side
          side={home}
          score={score}
          part="home"
        />
        <span className="grid justify-items-center pt-0.5">
          <span className="text-3xl leading-none">
            <Goals
              score={score}
              part="home"
            />
            <span className={score === null ? "text-fg-muted" : undefined}>{ERGEBNIS_SEPARATOR}</span>
            <Goals
              score={score}
              part="away"
            />
          </span>
          {/* Placed under the score, and read straight after it; the line keeps its height so the sides stand still. */}
          <span className="h-4 text-xs text-fg-muted">{shootOut}</span>
        </span>
        <Side
          side={away}
          score={score}
          part="away"
        />
      </div>
    </div>
  );
}

/** The match pop-up's body, once the match is read. */
export type SpielPopupContent = {
  /** The dialog's name, read rather than drawn: the head names the match by its two sides. */
  title: Copy;
  /** The page the pop-up opens over, reached instead of Back where the tab's history holds nothing before it. */
  beneath: Route;
  /** The way to the match's own page, the kit's `Link` drawn as the primary button. */
  act: ReactElement;
  head: SpielHeadProps;
  facts: ReadonlyArray<Fact>;
  sonderereignis: { title: Copy; text: Copy } | null;
};

async function PopupBody({ popup }: { popup: Promise<SpielPopupContent> }) {
  const { title, beneath, act, head: pairing, facts, sonderereignis } = await popup;
  return (
    <RouteDialog
      title={title}
      beneath={beneath}
      act={act}>
      <SpielHead {...pairing} />
      {facts.length > 0 && (
        <Facts
          look="free"
          facts={facts}
        />
      )}
      {sonderereignis !== null && (
        <Callout
          tone="danger"
          title={sonderereignis.title}
          text={sonderereignis.text}
        />
      )}
    </RouteDialog>
  );
}

/**
 * The match pop-up: the matchday and the pairing on the band across its top, the facts under them, what befell
 * the match where something did, and the way to the match's page as the dialog's act. It waits for its match
 * in its one boundary and opens once the match is read, drawing nothing before.
 */
export function SpielPopup({ popup }: { popup: Promise<SpielPopupContent> }) {
  return (
    <Suspense fallback={null}>
      <PopupBody popup={popup} />
    </Suspense>
  );
}
