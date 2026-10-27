export function filterUiTree(tree: string): string {
  const lines = tree.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*[-#]\s*\[(\w+)\](?:\s+(.+?))?\s*$/);

    if (!match) continue;

    const role = match[1];
    const name = (match[2] ?? "").trim();

    // Skip elements without a name.
    if (!name) continue;

    result.push(`${role}|${name}`);
  }

  return result.join("\n");
}
