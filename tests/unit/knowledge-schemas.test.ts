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
