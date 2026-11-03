/** The frontend's one read of the current time; every other module asks here rather than calling `Date`. */
export const now = (): Date => new Date();

/**
 * The current time as a log line records it, off the performance timer rather than `Date`: a crash inside a
 * prerender is logged while the prerender still runs, where Next refuses `new Date()` as an unstable value and
 * prints its error beside the line, and the timer is what Next's documentation names for telemetry's absolute
 * time. The timer counts on from the process's start, so a step the system clock takes after that is not in it.
 */
export const loggedAt = (): Date => new Date(performance.timeOrigin + performance.now());
