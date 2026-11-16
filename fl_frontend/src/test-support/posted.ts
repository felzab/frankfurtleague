/** A form as the browser posts it, one value under each name, as every action reads them. */
export function posted(entries: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}
