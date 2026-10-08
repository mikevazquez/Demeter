import "server-only";

export function nameFromExplicitReply(
  turns: Array<{ role: string; content: string }>,
): string | null {
  const last = turns.slice(-2);
  if (last.length !== 2 || last[0].role !== "assistant" || last[1].role !== "user") {
    return null;
  }
  if (!/nombre completo/i.test(last[0].content)) return null;
  const name = last[1].content
    .trim()
    .replace(/^(?:mi nombre es|me llamo|soy)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
  if (name.length < 5 || name.length > 140) return null;
  if (!/^[\p{L}]+(?:[ '-][\p{L}]+){1,5}$/u.test(name)) return null;
  return name;
}
