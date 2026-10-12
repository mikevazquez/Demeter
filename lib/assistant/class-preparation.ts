/** Read only explicit equipment/clothing lines from the studio's active prompt.
 * Operational prices, schedules and policies remain owned by their tools. */
export function preparationFromStudioPrompt(
  prompt: string,
  disciplines: { name: string }[],
): string | null {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  let current: string | null = null;
  const found: string[] = [];
  for (const raw of prompt.replace(/\\n/g, "\n").replace(/\\t/g, "\t").split("\n")) {
    const line = raw.trim().replace(/^#+\s*/, "");
    if (!line) continue;
    const heading = disciplines.find(({ name }) => {
      const tail = normalize(line).slice(normalize(name).length);
      return normalize(line).startsWith(normalize(name)) && /^(?:\s*[—–:(-]|\s*$)/.test(tail);
    });
    if (heading) {
      current = heading.name;
      continue;
    }
    const match = /^(?:[•*-]\s*)?Qu[eé] llevar:\s*(.+)$/i.exec(line);
    if (current && match) found.push(`${current}: ${match[1]}`);
    // A new prose/numbered section ends the discipline block.
    if (!match && !/^[•*-]/.test(line)) current = null;
  }
  return found.length ? found.join("\n") : null;
}
