/**
 * META · static content types
 *
 * Shapes for the hand-maintained content in `constants.ts`. Nothing here crosses a trust boundary, so
 * there are no schemas to match — these types exist to keep the content arrays consistent, not to
 * validate anything.
 */

export interface KontaktChannel {
  id: string;
  name: string;
  value: string;
  action: string;
}

export interface TeamMember {
  id: number;
  name: string;
  role: string;
  desc: string;
  tag: "orga" | "web" | "vorstand";
}

export interface QaQuestion {
  id: string;
  q: string;
  a: string;
}
