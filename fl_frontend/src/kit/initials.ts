/**
 * A person's round mark, „DW“ for „Dana Weber“: the first letter of the first and the last word of the name, upper-cased,
 * one letter where the name is one word. A plain module, so a server component and a client one draw the same mark.
 */
export function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return `${words[0]?.charAt(0) ?? ""}${words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : ""}`.toUpperCase();
}
