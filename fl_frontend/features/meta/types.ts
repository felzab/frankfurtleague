import type { BaseAPIResponse } from "@/core/api";

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

type FlSaisonStatus = "past" | "active" | "future";

export interface FlSaisonRules {
  win_points: number;
  draw_points: number;
}

export interface FlSaison {
  id: string;

  start_date: string;
  end_date: string;
  status: FlSaisonStatus;
  rules: FlSaisonRules;
}

export interface getCurrentSaisonMetadataReturn extends BaseAPIResponse {
  saison_metadata: FlSaison;
}
