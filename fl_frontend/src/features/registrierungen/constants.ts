import type { FLMediaMinAgeYears, FLRegistrierungMinAgeYears } from "@/core/generated/client/types";

// For the published notice, which states the floor with no answer to read it off; checked against
// `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_AGE_YEARS`, so the backend moving it
// fails the type check here. The form still takes the served `mindestalter`: a page judging a date
// against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_ALTER = 16 satisfies FLRegistrierungMinAgeYears;

// For the published notice as well, which states the media floor for pupils and referees alike;
// checked against `fl_backend/app/shared/schemas/bounds.py :: MEDIA_MIN_AGE_YEARS` as the floor above
// is, and the pages take the served `medien_mindestalter` for the reason given above.
export const MEDIEN_MIN_ALTER = 18 satisfies FLMediaMinAgeYears;
