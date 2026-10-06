/**
 * A control's name where its words alone would not say which one it is: the words first, which speech input says
 * (WCAG 2.5.3), then what a screen reader tells the control apart by.
 */
export const benannt = (worte: string, wofuer: string): string => `${worte}: ${wofuer}`;
