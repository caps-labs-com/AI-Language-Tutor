export type GrammarFormationBlock =
  | { type: "paragraph"; text: string }
  | {
    type: "conjugation";
    verb: string;
    translation: string;
    rows: Array<{ subject: string; form: string }>;
  };

const listItemPattern = /^[-–—•]\s*(.+)$/;
const emphasizedHeadingPattern = /^\*\*([^*]+)\*\*\s*(?:\(([^)]+)\))?\s*:?$/;
const uppercaseHeadingPattern = /^([\p{Lu}À-ÖØ-Þ][\p{Lu}À-ÖØ-Þ' -]+)\s*(?:\(([^)]+)\))?\s*:?$/u;

function parseHeading(line: string) {
  const match = line.match(emphasizedHeadingPattern) || line.match(uppercaseHeadingPattern);
  if (!match) return null;
  return { verb: match[1].trim(), translation: (match[2] || "").trim() };
}

function parseConjugationRow(line: string) {
  const item = line.match(listItemPattern)?.[1]?.trim();
  if (!item) return null;
  const explicitSeparator = item.match(/^(.+?)\s*(?::|→|—)\s*(.+)$/);
  if (explicitSeparator) {
    return { subject: explicitSeparator[1].trim(), form: explicitSeparator[2].trim() };
  }
  const [subject, ...form] = item.split(/\s+/);
  if (!subject || form.length === 0) return null;
  return { subject, form: form.join(" ") };
}

export function parseGrammarFormation(value: string): GrammarFormationBlock[] {
  const lines = value.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: GrammarFormationBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const heading = parseHeading(lines[index]);
    if (heading) {
      const rows: Array<{ subject: string; form: string }> = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const row = parseConjugationRow(lines[cursor]);
        if (!row) break;
        rows.push(row);
        cursor += 1;
      }
      if (rows.length >= 2) {
        blocks.push({ type: "conjugation", ...heading, rows });
        index = cursor;
        continue;
      }
    }
    blocks.push({ type: "paragraph", text: lines[index].replace(/\*\*/g, "") });
    index += 1;
  }
  return blocks;
}
