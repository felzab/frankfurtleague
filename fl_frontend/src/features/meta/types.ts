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
