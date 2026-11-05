import type { FLSpielJoined, FLSpielSchiedsrichterField, FLSpielSchiedsrichterFieldPublic } from "@/core/generated/client/types";

/**
 * A fixture of either tier, as every reader taking one types it: the referee's `name_is_public` is the base tier's
 * alone and `schiedsrichter_id` the admin tier's, so each is optional here where its own read serves it.
 */
export type FLSpiel = Omit<FLSpielJoined, "schiedsrichter"> & {
  schiedsrichter:
    | (Pick<FLSpielSchiedsrichterFieldPublic, "name"> &
        Partial<Pick<FLSpielSchiedsrichterFieldPublic, "name_is_public"> & Pick<FLSpielSchiedsrichterField, "schiedsrichter_id">>)
    | null;
};
