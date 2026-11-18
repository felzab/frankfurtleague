import { orMissing } from "@/core/errors";
import { schiedsrichterGetSchiedsrichter, schiedsrichterGetSchiedsrichterById, schiedsrichterGetSelfSpiele } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLSchiedsrichterListResponse,
  FLSchiedsrichterSingleResponse,
  FLSchiedsrichterSpieleResponse,
  SchiedsrichterGetSchiedsrichterParams,
} from "@/core/generated/client/types";

/** Admin-tier: a referee is a pupil, and the fee is money. */
export async function getSchiedsrichter(filters: SchiedsrichterGetSchiedsrichterParams = {}): Promise<FLSchiedsrichterListResponse> {
  return runAdminRead(() => schiedsrichterGetSchiedsrichter(filters));
}

/** Whatever state the referee is in, where the list is narrowed; an erased one has no row to answer with. */
export async function getSchiedsrichterById(schiedsrichterId: string): Promise<FLSchiedsrichterSingleResponse | null> {
  return runAdminRead(() =>
    // `null` for "no such referee", which the editor page turns into `notFound()`. Every other
    // status still throws.
    orMissing(schiedsrichterGetSchiedsrichterById(schiedsrichterId)),
  );
}

/** Open work first. */
export async function getOwnSpiele(saisonId: string): Promise<FLSchiedsrichterSpieleResponse> {
  return runPersonRead(() => schiedsrichterGetSelfSpiele(saisonId));
}
