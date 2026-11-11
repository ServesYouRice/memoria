import { z } from "zod";

export const KNOWLEDGE_ENTITY_SUGGESTION_KIND = "knowledge-entity-create";
export const KNOWLEDGE_RELATION_SUGGESTION_KIND = "knowledge-relation-create";

const knowledgeActionSchema = z.enum(["propose", "create"]);

/** Bounds on the free-form attributes blob, which is copied into the entity or
 * relation, its ChangeRecord and (when proposed) the suggestion payload. */
export const KNOWLEDGE_ATTRIBUTE_LIMITS = {
  maxKeys: 50,
  maxKeyLength: 120,
  maxDepth: 5,
  maxStringLength: 2000,
  maxSerializedLength: 16_384,
} as const;

/**
 * Returns why attributes exceed the limits, or null. The walk is iterative
 * and stops at the depth limit, so hostile nesting cannot overflow the stack.
 */
export function knowledgeAttributesProblem(
  attributes: Record<string, unknown>,
): string | null {
  const limits = KNOWLEDGE_ATTRIBUTE_LIMITS;
  if (Object.keys(attributes).length > limits.maxKeys) {
    return `attributes may have at most ${limits.maxKeys} keys`;
  }
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: attributes, depth: 1 },
  ];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (typeof value === "string") {
      if (value.length > limits.maxStringLength) {
        return `attribute strings may be at most ${limits.maxStringLength} characters`;
      }
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (depth > limits.maxDepth) {
      return `attributes may nest at most ${limits.maxDepth} levels (depth)`;
    }
    const entries = Array.isArray(value)
      ? value.map((child) => ["", child] as const)
      : Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (key.length > limits.maxKeyLength) {
        return `attribute keys may be at most ${limits.maxKeyLength} characters`;
      }
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  if (JSON.stringify(attributes).length > limits.maxSerializedLength) {
    return `attributes may serialize to at most ${limits.maxSerializedLength} characters`;
  }
  return null;
}

const knowledgeAttributesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((attributes, ctx) => {
    const problem = knowledgeAttributesProblem(attributes);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const knowledgeEntityFields = {
  itemId: z.string().cuid(),
  entityType: z.string().min(1).max(120),
  title: z.string().min(1).max(255),
  summary: z.string().max(2000).optional(),
  attributes: knowledgeAttributesSchema.optional(),
  sourceConfidence: z.number().min(0).max(1).optional(),
} as const;

const knowledgeRelationFields = {
  sourceEntityId: z.string().cuid(),
  targetEntityId: z.string().cuid(),
  relationType: z.string().min(1).max(120),
  summary: z.string().max(2000).optional(),
  attributes: knowledgeAttributesSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
} as const;

export const knowledgeEntityMutationSchema = z.object({
  kind: z.literal("entity").default("entity"),
  action: knowledgeActionSchema.default("propose"),
  ...knowledgeEntityFields,
});

export const knowledgeRelationMutationSchema = z.object({
  kind: z.literal("relation"),
  action: knowledgeActionSchema.default("propose"),
  ...knowledgeRelationFields,
});

export type KnowledgeEntityMutationInput = z.infer<
  typeof knowledgeEntityMutationSchema
>;
export type KnowledgeRelationMutationInput = z.infer<
  typeof knowledgeRelationMutationSchema
>;

export function parseKnowledgeMutation(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).kind === "relation"
  ) {
    return knowledgeRelationMutationSchema.parse(input);
  }

  return knowledgeEntityMutationSchema.parse(input);
}

export const knowledgeEntitySuggestionPayloadSchema = z.object({
  kind: z.literal(KNOWLEDGE_ENTITY_SUGGESTION_KIND),
  ...knowledgeEntityFields,
});

export const knowledgeRelationSuggestionPayloadSchema = z.object({
  kind: z.literal(KNOWLEDGE_RELATION_SUGGESTION_KIND),
  ...knowledgeRelationFields,
});
