import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_ENTITY_SUGGESTION_KIND,
  KNOWLEDGE_RELATION_SUGGESTION_KIND,
  knowledgeEntitySuggestionPayloadSchema,
  knowledgeRelationSuggestionPayloadSchema,
  parseKnowledgeMutation,
} from "@/lib/agents/knowledge-schemas";

describe("Knowledge schemas", () => {
  it("parses entity mutations with entity defaults", () => {
    const parsed = parseKnowledgeMutation({
      itemId: "ckz7q0xqf0000l908f3h4d6r6",
      entityType: "topic",
      title: "Roadmap",
    });

    expect(parsed.kind).toBe("entity");
    expect(parsed.action).toBe("propose");
    expect(parsed.title).toBe("Roadmap");
  });

  it("parses relation mutations separately from entity writes", () => {
    const parsed = parseKnowledgeMutation({
      kind: "relation",
      action: "create",
      sourceEntityId: "ckz7q0xqf0000l908f3h4d6r6",
      targetEntityId: "ckz7q0xqf0001l908f3h4d6r7",
      relationType: "depends_on",
      confidence: 0.8,
    });

    expect(parsed.kind).toBe("relation");
    expect(parsed.action).toBe("create");
    expect(parsed.relationType).toBe("depends_on");
  });

  it("validates entity suggestion payloads", () => {
    const parsed = knowledgeEntitySuggestionPayloadSchema.parse({
      kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
      itemId: "ckz7q0xqf0000l908f3h4d6r6",
      entityType: "topic",
      title: "Roadmap",
      sourceConfidence: 0.6,
    });

    expect(parsed.kind).toBe(KNOWLEDGE_ENTITY_SUGGESTION_KIND);
    expect(parsed.sourceConfidence).toBe(0.6);
  });

  it("validates relation suggestion payloads", () => {
    const parsed = knowledgeRelationSuggestionPayloadSchema.parse({
      kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
      sourceEntityId: "ckz7q0xqf0000l908f3h4d6r6",
      targetEntityId: "ckz7q0xqf0001l908f3h4d6r7",
      relationType: "supports",
      confidence: 0.9,
    });

    expect(parsed.kind).toBe(KNOWLEDGE_RELATION_SUGGESTION_KIND);
    expect(parsed.confidence).toBe(0.9);
  });
});

describe("Knowledge attribute bounds", () => {
  const entity = (attributes: unknown) => ({
    itemId: "ckz7q0xqf0000l908f3h4d6r6",
    entityType: "topic",
    title: "Roadmap",
    attributes,
  });
  const relation = (attributes: unknown) => ({
    kind: "relation",
    sourceEntityId: "ckz7q0xqf0000l908f3h4d6r6",
    targetEntityId: "ckz7q0xqf0001l908f3h4d6r7",
    relationType: "depends_on",
    attributes,
  });
  const nested = (depth: number) => {
    let value: Record<string, unknown> = { leaf: 1 };
    for (let i = 1; i < depth; i += 1) value = { child: value };
    return value;
  };

  it("keeps small attribute objects unchanged", () => {
    const attributes = { owner: "Ada", tags: ["a", "b"], meta: { score: 3 } };
    expect(parseKnowledgeMutation(entity(attributes)).attributes).toEqual(
      attributes,
    );
    expect(nested(5)).toBeDefined();
    expect(() => parseKnowledgeMutation(entity(nested(5)))).not.toThrow();
  });

  it.each([
    [
      "too many keys",
      Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])),
    ],
    ["a long key", { ["k".repeat(121)]: 1 }],
    ["deep nesting", nested(6)],
    ["a long string value", { note: "x".repeat(2001) }],
    [
      "an oversized blob",
      Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`k${i}`, "x".repeat(1000)]),
      ),
    ],
  ])("rejects %s on mutations and suggestion payloads", (_case, attributes) => {
    expect(() => parseKnowledgeMutation(entity(attributes))).toThrow();
    expect(() => parseKnowledgeMutation(relation(attributes))).toThrow();
    expect(() =>
      knowledgeEntitySuggestionPayloadSchema.parse({
        ...entity(attributes),
        kind: KNOWLEDGE_ENTITY_SUGGESTION_KIND,
      }),
    ).toThrow();
    expect(() =>
      knowledgeRelationSuggestionPayloadSchema.parse({
        ...relation(attributes),
        kind: KNOWLEDGE_RELATION_SUGGESTION_KIND,
      }),
    ).toThrow();
  });

  it("rejects hostile nesting without overflowing the stack", () => {
    expect(() => parseKnowledgeMutation(entity(nested(100_000)))).toThrow(
      /depth/,
    );
  });
});
