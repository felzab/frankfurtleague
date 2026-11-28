import { orMissing } from "@/core/errors";
import { schiedsrichterGetSchiedsrichter, schiedsrichterGetSchiedsrichterById, schiedsrichterGetSelfSpiele } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLSchiedsrichterListResponse,
  FLSchiedsrichterSingleResponse,
  FLSchiedsrichterSpieleResponse,
} from "@/core/generated/client/types";

/** Admin-tier: a referee is a pupil, and the fee is money. Every referee, retired ones included. */
export async function getSchiedsrichter(): Promise<FLSchiedsrichterListResponse> {
  return runAdminRead(() => schiedsrichterGetSchiedsrichter());
}

/** Whatever state the referee is in; an erased one has no row to answer with. */
export async function getSchiedsrichterById(schiedsrichterId: string): Promise<FLSchiedsrichterSingleResponse | null> {
  return runAdminRead(() => orMissing(schiedsrichterGetSchiedsrichterById(schiedsrichterId)));
}

/** Open work first. */
export async function getOwnSpiele(saisonId: string): Promise<FLSchiedsrichterSpieleResponse> {
  return runPersonRead(() => schiedsrichterGetSelfSpiele(saisonId));
}
