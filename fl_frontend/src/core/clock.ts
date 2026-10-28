/** The frontend's one read of the current time; every other module asks here rather than calling `Date`. */
export const now = (): Date => new Date();
