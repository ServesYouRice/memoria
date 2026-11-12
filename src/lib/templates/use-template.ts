import type { PrismaClient } from "@/generated/prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  createCanvasWithRows,
  resolvePlan,
} from "@/lib/canvas-formats/import-canvas";
import { findBuiltInTemplate, templatePlan } from "./built-in";

/**
 * A new canvas of the person's own, holding a built-in template's items
 * (IMP-098). One transaction, within the canvas limit.
 */
export async function createCanvasFromTemplate(
  prisma: PrismaClient,
  input: {
    userId: string;
    templateId: string;
    name?: string;
    workspaceId?: string;
  },
) {
  const template = findBuiltInTemplate(input.templateId);
  if (!template) throw new NotFoundError("Template not found.");
  if (input.workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: input.workspaceId, userId: input.userId },
      select: { id: true },
    });
    if (!workspace)
      throw new ValidationError("The selected workspace does not exist.");
  }
  const { rows } = resolvePlan(templatePlan(template));
  const canvas = await createCanvasWithRows(prisma, {
    userId: input.userId,
    name: input.name?.trim() || template.name,
    rows,
    workspaceId: input.workspaceId,
  });
  return {
    id: canvas.id,
    name: canvas.name,
    templateId: template.id,
    itemCount: rows.length,
  };
}
