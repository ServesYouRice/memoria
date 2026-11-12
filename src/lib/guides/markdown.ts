/**
 * A small reader for the guides in `docs/` (IMP-092), so the app shows the
 * same steps as the repository without a second copy. It understands only
 * what the guides use: headings, paragraphs, nested lists, tables, fenced
 * code and **bold**, *italic* and `code` text. Nothing becomes HTML; the
 * result is rendered as React elements.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

export interface ListItem {
  content: Inline[];
  children: ListBlock | null;
}
export interface ListBlock {
  kind: "list";
  ordered: boolean;
  items: ListItem[];
}
export type Block =
  | { kind: "paragraph"; content: Inline[] }
  | ListBlock
  | { kind: "code"; text: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

export interface GuideSection {
  level: number;
  title: string;
  blocks: Block[];
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) {
      parts.push({ kind: "text", text: text.slice(last, match.index) });
    }
    if (match[1] !== undefined) parts.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined)
      parts.push({ kind: "code", text: match[2] });
    else parts.push({ kind: "italic", text: match[3]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function parseList(lines: string[], start: number, indent: number) {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const list: ListBlock = {
    kind: "list",
    ordered: /\d/.test(first[2]!),
    items: [],
  };
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") break;
    const match = LIST_ITEM.exec(line);
    const lineIndent = line.length - line.trimStart().length;
    if (match && lineIndent === indent) {
      list.items.push({ content: [], children: null });
      list.items.at(-1)!.content = parseInline(match[3]!);
      index += 1;
    } else if (match && lineIndent > indent && list.items.length > 0) {
      const nested = parseList(lines, index, lineIndent);
      list.items.at(-1)!.children = nested.list;
      index = nested.next;
    } else if (!match && lineIndent > indent && list.items.length > 0) {
      // A wrapped line of the current item.
      const item = list.items.at(-1)!;
      item.content = parseInline(`${inlineText(item.content)} ${line.trim()}`);
      index += 1;
    } else {
      break;
    }
  }
  return { list, next: index };
}

/** Plain text of inline parts, with the markers put back. */
export function inlineText(parts: Inline[]): string {
  return parts
    .map((part) =>
      part.kind === "bold"
        ? `**${part.text}**`
        : part.kind === "italic"
          ? `*${part.text}*`
          : part.kind === "code"
            ? `\`${part.text}\``
            : part.text,
    )
    .join("");
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
}

export function parseGuide(markdown: string): GuideSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: GuideSection[] = [{ level: 0, title: "", blocks: [] }];
  const blocks = () => sections.at(-1)!.blocks;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      index += 1;
    } else if (heading) {
      sections.push({
        level: heading[1]!.length,
        title: heading[2]!.trim(),
        blocks: [],
      });
      index += 1;
    } else if (line.startsWith("```")) {
      const end = lines.findIndex(
        (candidate, at) => at > index && candidate.startsWith("```"),
      );
      const close = end < 0 ? lines.length : end;
      blocks().push({
        kind: "code",
        text: lines.slice(index + 1, close).join("\n"),
      });
      index = close + 1;
    } else if (LIST_ITEM.test(line)) {
      const parsed = parseList(
        lines,
        index,
        line.length - line.trimStart().length,
      );
      blocks().push(parsed.list);
      index = parsed.next;
    } else if (line.trimStart().startsWith("|")) {
      const rows: string[] = [];
      while (
        index < lines.length &&
        lines[index]!.trimStart().startsWith("|")
      ) {
        rows.push(lines[index]!);
        index += 1;
      }
      const [header, , ...body] = rows;
      blocks().push({
        kind: "table",
        header: tableCells(header!),
        rows: body.map(tableCells),
      });
    } else {
      const paragraph: string[] = [];
      while (
        index < lines.length &&
        lines[index]!.trim() !== "" &&
        !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[index]!)
      ) {
        paragraph.push(lines[index]!.trim());
        index += 1;
      }
      blocks().push({
        kind: "paragraph",
        content: parseInline(paragraph.join(" ")),
      });
    }
  }
  return sections.filter(
    (section) => section.level > 0 || section.blocks.length > 0,
  );
}

/** Replace a placeholder everywhere text appears. */
export function replaceInGuide(
  sections: GuideSection[],
  from: string,
  to: string,
): GuideSection[] {
  const swap = (parts: Inline[]): Inline[] =>
    parts.map((part) => ({ ...part, text: part.text.split(from).join(to) }));
  const swapList = (list: ListBlock): ListBlock => ({
    ...list,
    items: list.items.map((item) => ({
      content: swap(item.content),
      children: item.children ? swapList(item.children) : null,
    })),
  });
  const swapBlock = (block: Block): Block => {
    switch (block.kind) {
      case "paragraph":
        return { ...block, content: swap(block.content) };
      case "list":
        return swapList(block);
      case "code":
        return { ...block, text: block.text.split(from).join(to) };
      case "table":
        return {
          ...block,
          header: block.header.map(swap),
          rows: block.rows.map((row) => row.map(swap)),
        };
    }
  };
  return sections.map((section) => ({
    ...section,
    title: section.title.split(from).join(to),
    blocks: section.blocks.map(swapBlock),
  }));
}
