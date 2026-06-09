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
}

export interface QA_QUESTION {
  id: string;
  q: string;
  a: string;
}
