type UiElement = {
  id?: number;
  role?: string;
  name?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  line: string;
};

export function findElementInTree(
  tree: string,
  keywords: string[],
): UiElement[] {
  const results: UiElement[] = [];
  const lines = tree.split(/\r?\n/);

  const normalize = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, " ").trim();

  const targets = keywords.map(normalize).filter(Boolean);

  if (targets.length === 0) return results;

  for (const line of lines) {
    const match = line.match(/^\s*#(\d+)\s+\[([^\]]+)\]\s*(.*)$/);

    if (!match) continue;

    const [, id, role, remaining] = match;

    const boundsMatch = remaining.match(
      /\(bounds:\s*\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]/,
    );

    const name = remaining
      .replace(/\s*\(bounds:\s*\[[^\]]+\](?:,\s*[^)]*)?\)/g, "")
      .replace(/,\s*(?:disabled|focusable|focused|selected|offscreen)\b/g, "")
      .trim();

    const normalizedName = normalize(name);

    // Match if ANY keyword occurs in the element name.
    if (!targets.some((target) => normalizedName.includes(target))) {
      continue;
    }

    results.push({
      line: line.trim(),
    });
  }

  return results;
}
