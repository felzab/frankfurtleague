/**
 * The body of every 429 the edge answers itself (`nginx/shared/site.conf :: @edge_refusal`), which Next hands
 * a rejected action as its error's message only under a content type of exactly `text/plain`: so ASCII,
 * sent with no charset.
 */
export const EDGE_REFUSAL_BODY = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann erneut.";

/** An action's rejection that is the edge's own rate refusal: the press reached nothing behind the edge. */
export function isEdgeRefusal(error: unknown): boolean {
  return error instanceof Error && error.message === EDGE_REFUSAL_BODY;
}
