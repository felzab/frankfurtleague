import type { BaseApiReturn } from "../api";

export interface CheckIsLiveReturn extends BaseApiReturn {
  status: string;
}

export interface CheckIsReadyReturn extends BaseApiReturn {
  status: string;
}
export interface GetSystemInfoReturn extends BaseApiReturn {
  api_version: number;
}
