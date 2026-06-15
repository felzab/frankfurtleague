import type { BaseAPIResponse } from "@/core/api";

export interface CheckIsLiveReturn extends BaseAPIResponse {
  status: string;
}

export interface CheckIsReadyReturn extends BaseAPIResponse {
  status: string;
}
export interface GetSystemInfoReturn extends BaseAPIResponse {
  api_version: number;
}
