/**
 * IMP-088 / DEC-016: the app calls a user's space a "canvas", never a
 * "board". Scans every string literal and JSX text under src/ (comments,
 * imports and code identifiers are not on-screen text) and fails if "board"
 * returns.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "src");
const SKIP_DIRS = new Set(["generated"]);
const BOARD = /\bboards?\b/i;
/** Fixed phrases where "board" is not the user's space. */
const ALLOWED_PHRASES = [
  /\bmood ?boards?\b/gi,
  // Words people may type to Ask, dropped from search terms (ask-schema).
  /\bboard boards canvas canvases\b/g,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return SKIP_DIRS.has(name) ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

/** A string with no spaces is a key, path, id or class name, not prose. */
function isProse(text: string) {
  return /\s/.test(text.trim());
}

function isModuleSpecifier(node: ts.Node) {
  const parent = node.parent;
  return (
    parent !== undefined &&
    (ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      (ts.isCallExpression(parent) &&
        (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(parent.expression) &&
            ["require", "mock"].includes(parent.expression.text)))) ||
      ts.isExternalModuleReference(parent))
  );
}

export function findBoardWording(file: string, source: string) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = isModuleSpecifier(node) ? null : node.text;
    } else if (ts.isJsxText(node)) {
      text = node.text;
    }
    if (text && isProse(text)) {
      const cleaned = ALLOWED_PHRASES.reduce(
        (value, phrase) => value.replace(phrase, ""),
        text,
      );
      if (BOARD.test(cleaned)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        );
        hits.push(
          `${path.relative(process.cwd(), file)}:${line + 1}: ${text.trim()}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

describe("one name for the user's space", () => {
  it("never says 'board' in on-screen, email or notification text", () => {
    const hits = sourceFiles(ROOT).flatMap((file) =>
      findBoardWording(file, readFileSync(file, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("ignores code identifiers, paths and allowed words", () => {
    expect(
      findBoardWording(
        "x.tsx",
        `import a from "@/lib/agents/home-board";
         const id = "home-board-suggestion";
         const ok = "Open the dashboard and copy to the clipboard";
         const mood = "Mood Board template";
         // a comment about a board
         const el = <p data-testid="board-name">Use the keyboard</p>;`,
      ),
    ).toEqual([]);
    expect(
      findBoardWording("x.tsx", `const s = <p>Ask your boards</p>;`),
    ).toHaveLength(1);
  });
});
