import type { FLSchiedsrichterConfirmationFristDays } from "@/core/generated/client/types";

/**
 * The days a referee's link answers, so the dead-link panel and the privacy notice state the day the endpoint refuses
 * on; checked against
 * `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_CONFIRMATION_FRIST_DAYS`, so the backend moving it fails
 * the type check here. Fourteen rather than the registration's seven: this link waits on an adult with no second
 * route in.
 */
export const SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE = 14 satisfies FLSchiedsrichterConfirmationFristDays;
