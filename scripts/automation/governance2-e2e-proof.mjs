export function uniqueTaskIds(values) {
  if (!Array.isArray(values)) throw new TypeError("Task IDs must be an array of strings");
  const ids = new Set();
  for (const value of values) {
    if (typeof value !== "string") throw new TypeError("Task ID must be a string");
    const id = value.trim();
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) throw new TypeError("Invalid task ID");
    ids.add(id);
  }
  return [...ids].sort();
}
