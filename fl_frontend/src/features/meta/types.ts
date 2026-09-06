export type KontaktChannelId = "email" | "instagram" | "threads";

export interface KontaktChannel {
  id: KontaktChannelId;
  name: string;
  value: string;
  action: string;
  /** The verb on the card's control, per channel: opening a profile is not contacting. */
  cta: string;
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
