export const typedObjectEntries = <T extends object>(obj: T) => {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
};
