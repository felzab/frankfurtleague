import "server-only";

import { z } from "zod";

import { blankIsNull } from "@/core/action";
import {
  SpielberichtePutSpielberichtBerichtBody,
  spielberichtePutSpielberichtBerichtBodyBerichtCardsMax,
  spielberichtePutSpielberichtBerichtBodyBerichtScorersMax,
} from "@/core/generated/zod/inputs";

import { UNKNOWN_PLAYER } from "./berichtValues";

const { scorers, cards } = SpielberichtePutSpielberichtBerichtBody.shape.bericht.shape;
const scorer = scorers.element.shape;
const card = cards.element.shape;
const [namedScorer] = scorer.spieler_id.options;
const [namedCarded] = card.spieler_id.options;

/**
 * A goal's row as the form sends it, each box held to the write's rule. Its player is a choice to make: „Anonym“
 * stands for the null player the write takes as a scorer nobody named, so a row's own `null` is no choice yet.
 */
export const Goal = z.object({
  side: blankIsNull(scorer.side),
  spieler_id: blankIsNull(z.union([namedScorer, z.literal(UNKNOWN_PLAYER)])),
  minute: scorer.minute,
  eigentor: scorer.eigentor,
});

/** A card's row as the form sends it, each box held to the write's rule; its player is chosen as a goal's is. */
export const Card = z.object({
  side: blankIsNull(card.side),
  spieler_id: blankIsNull(z.union([namedCarded, z.literal(UNKNOWN_PLAYER)])),
  minute: card.minute,
  colour: blankIsNull(card.colour),
});

// Read-only, as the form's lists are: a list arrives whole and is never changed in place.
export const Goals = z.array(Goal).max(spielberichtePutSpielberichtBerichtBodyBerichtScorersMax).readonly();
export const Cards = z.array(Card).max(spielberichtePutSpielberichtBerichtBodyBerichtCardsMax).readonly();
