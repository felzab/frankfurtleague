import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/core/auth/library";

export const { GET, POST } = toNextJsHandler(auth);
