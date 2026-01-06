/**
 * Y.js Document Provider
 * Manages Y.js documents for real-time collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 */


import * as Y from 'yjs';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { invalidateCanvasCache } from '@/lib/cache/canvas-cache';

const logger = createLogger('yjs-provider');

interface DocumentStore {
  doc: Y.Doc;
  lastAccessed: number;
  persistenceTimeout?: NodeJS.Timeout;
  loadedFromDb: boolean;
  dirtyItemIds: Set<string>;
  deletedItemIds: Set<string>;
}

/**
 * In-memory store for Y.js documents
 * Maps canvasId to Y.Doc
 */
const documents = new Map<string, DocumentStore>();

/**
 * How long to keep documents in memory after last access (5 minutes)
 */
const DOCUMENT_TIMEOUT = 5 * 60 * 1000;

/**
 * How often to persist documents to database (30 seconds)
 */
const PERSISTENCE_INTERVAL = 30 * 1000;

/**
 * Get or create a Y.js document for a canvas
 */
export async function getDocument(canvasId: string): Promise<Y.Doc> {
  let store = documents.get(canvasId);

  if (!store) {
    // Create new Y.js document
    const doc = new Y.Doc();

    // Load persisted state from database if it exists
    const loadedFromDb = await loadDocumentState(canvasId, doc);

    const dirtyItemIds = new Set<string>();
    const deletedItemIds = new Set<string>();

    const yItems = doc.getMap('items');
    yItems.observeDeep((events, transaction) => {
      if (transaction.origin === 'persist') {
        return;
      }

      events.forEach((event) => {
        if (event.target === yItems) {
          event.changes.keys.forEach((change, key) => {
            const itemId = String(key);
            if (change.action === 'delete') {
              deletedItemIds.add(itemId);
              dirtyItemIds.delete(itemId);
            } else {
              deletedItemIds.delete(itemId);
              dirtyItemIds.add(itemId);
            }
          });
          return;
        }

        const itemId = event.path[0];
        if (typeof itemId === 'string') {
          deletedItemIds.delete(itemId);
          dirtyItemIds.add(itemId);
        }
      });
    });

    store = {
      doc,
      lastAccessed: Date.now(),
      loadedFromDb,
      dirtyItemIds,
      deletedItemIds,
    };

    documents.set(canvasId, store);

    // Schedule periodic persistence
    schedulePersistence(canvasId);
  }

  // Update last accessed time
  store.lastAccessed = Date.now();

  return store.doc;
}

/**
 * Load document state from database
 */
async function loadDocumentState(canvasId: string, doc: Y.Doc): Promise<boolean> {
  try {
    // Fetch all canvas items from database
    const items = await prisma.canvasItem.findMany({
      where: {
        canvasId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Initialize Y.js shared type with canvas items
    const yItems = doc.getMap('items');

    items.forEach((item) => {
      const yItem = new Y.Map();
      yItem.set('id', item.id);
      yItem.set('type', item.type);
      yItem.set('positionX', item.positionX);
      yItem.set('positionY', item.positionY);
      yItem.set('width', item.width);
      yItem.set('height', item.height);
      yItem.set('zIndex', item.zIndex);
      yItem.set('content', item.content);
      yItem.set('tags', item.tags);
      yItem.set('version', item.version);
      yItem.set('createdById', item.createdById);
      yItem.set('updatedById', item.updatedById);

      yItems.set(item.id, yItem);
    });

    return true;
  } catch (error) {
    logger.error({ error, canvasId }, 'Failed to load document state');
    return false;
  }
}

/**
 * Schedule periodic persistence of document to database
 */
function schedulePersistence(canvasId: string): void {
  const store = documents.get(canvasId);
  if (!store) return;

  // Clear existing timeout
  if (store.persistenceTimeout) {
    clearTimeout(store.persistenceTimeout);
  }

  // Schedule next persistence
  store.persistenceTimeout = setTimeout(async () => {
    await persistDocument(canvasId);

    // Check if document should be removed from memory
    const timeSinceLastAccess = Date.now() - store.lastAccessed;
    if (timeSinceLastAccess > DOCUMENT_TIMEOUT) {
      // Remove from memory
      documents.delete(canvasId);
      logger.info({ canvasId }, 'Removed canvas from memory (inactive)');
    } else {
      // Schedule next persistence
      schedulePersistence(canvasId);
    }
  }, PERSISTENCE_INTERVAL);
}

/**
 * Persist document state to database
 */
async function persistDocument(canvasId: string): Promise<void> {
  const store = documents.get(canvasId);
  if (!store) return;

  try {
    const yItems = store.doc.getMap('items');

    const dirtyIds = Array.from(store.dirtyItemIds);
    const deletedIds = Array.from(store.deletedItemIds);

    if (dirtyIds.length === 0 && deletedIds.length === 0) {
      return;
    }

    const items: Array<{
      id: string;
      type: ItemType;
      positionX: number;
      positionY: number;
      width: number;
      height: number;
      zIndex: number;
      content: Prisma.InputJsonValue;
      tags: string[];
      version: number;
      createdById?: string | null;
      updatedById?: string | null;
    }> = [];

    dirtyIds.forEach((itemId) => {
      const yItem = yItems.get(itemId);
      if (!(yItem instanceof Y.Map)) return;

      const typeValue = yItem.get('type');
      if (!Object.values(ItemType).includes(typeValue)) return;

      const content = yItem.get('content');
      const normalizedContent =
        content instanceof Y.Map || content instanceof Y.Array ? content.toJSON() : content ?? Prisma.JsonNull;

      const tagsValue = yItem.get('tags');
      const normalizedTags = Array.isArray(tagsValue) ? tagsValue : [];

      items.push({
        id: String(itemId),
        type: typeValue,
        positionX: Number(yItem.get('positionX') ?? 0),
        positionY: Number(yItem.get('positionY') ?? 0),
        width: Number(yItem.get('width') ?? 0),
        height: Number(yItem.get('height') ?? 0),
        zIndex: Number(yItem.get('zIndex') ?? 0),
        content: normalizedContent as Prisma.InputJsonValue,
        tags: normalizedTags,
        version: Number(yItem.get('version') ?? 1),
        createdById: (yItem.get('createdById') as string) || null,
        updatedById: (yItem.get('updatedById') as string) || null,
      });
    });

    const idsToCheck = Array.from(new Set([...dirtyIds, ...deletedIds]));
    const existingItems = idsToCheck.length
      ? await prisma.canvasItem.findMany({
          where: { id: { in: idsToCheck } },
          select: { id: true, deletedAt: true, version: true },
        })
      : [];

    const existingById = new Map(existingItems.map((item) => [item.id, item.deletedAt]));

    const toCreate = items.filter((item) => !existingById.has(item.id));
    const toUpdate = items.filter((item) => existingById.has(item.id));

    const toDeleteIds = deletedIds.filter((id) => existingById.has(id) && !existingById.get(id));

    let defaultUserId: string | null = null;
    if (toCreate.length > 0) {
      const canvas = await prisma.canvas.findUnique({
        where: { id: canvasId },
        select: { userId: true },
      });
      defaultUserId = canvas?.userId ?? null;
    }

    const createData = toCreate
      .map((item) => {
        const creatorId = item.createdById || item.updatedById || defaultUserId;
        if (!creatorId) return null;

        return {
          id: item.id,
          canvasId,
          type: item.type,
          positionX: item.positionX,
          positionY: item.positionY,
          width: item.width,
          height: item.height,
          zIndex: item.zIndex,
          content: item.content,
          tags: item.tags,
          version: item.version || 1,
          createdById: creatorId,
          updatedById: item.updatedById || creatorId,
          deletedAt: null,
          deletedById: null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const updateOps = toUpdate.map((item) => {
      const wasDeleted = existingById.get(item.id);
      const updateData: Prisma.CanvasItemUpdateInput = {
        type: item.type,
        positionX: item.positionX,
        positionY: item.positionY,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex,
        content: item.content,
        tags: item.tags,
        version: { increment: 1 },
        ...(item.updatedById ? { updatedById: item.updatedById } : {}),
        ...(wasDeleted ? { deletedAt: null, deletedById: null } : {}),
      };

      return prisma.canvasItem.update({
        where: { id: item.id },
        data: updateData,
      });
    });

    const txOps: Prisma.PrismaPromise<unknown>[] = [];

    if (createData.length > 0) {
      txOps.push(prisma.canvasItem.createMany({ data: createData }));
    }
    if (updateOps.length > 0) {
      txOps.push(...updateOps);
    }
    if (toDeleteIds.length > 0) {
      txOps.push(
        prisma.canvasItem.updateMany({
          where: { id: { in: toDeleteIds } },
          data: { deletedAt: new Date(), deletedById: null, version: { increment: 1 } },
        })
      );
    }

    if (txOps.length > 0) {
      await prisma.$transaction(txOps);
      await invalidateCanvasCache(canvasId);
    }

    if (toCreate.length > 0 || toUpdate.length > 0) {
      const refreshed = await prisma.canvasItem.findMany({
        where: { id: { in: [...toCreate.map((item) => item.id), ...toUpdate.map((item) => item.id)] } },
        select: { id: true, version: true },
      });

      store.doc.transact(() => {
        refreshed.forEach((item) => {
          const yItem = yItems.get(item.id);
          if (yItem instanceof Y.Map) {
            yItem.set('version', item.version);
          }
        });
      }, 'persist');
    }

    dirtyIds.forEach((id) => store.dirtyItemIds.delete(id));
    deletedIds.forEach((id) => store.deletedItemIds.delete(id));

    logger.debug(
      {
        canvasId,
        dirtyCount: dirtyIds.length,
        deletedCount: deletedIds.length,
        created: createData.length,
        deleted: toDeleteIds.length,
      },
      'Persisted items for canvas'
    );
  } catch (error) {
    logger.error({ error, canvasId }, 'Failed to persist document for canvas');
  }
}

/**
 * Force persist a document immediately
 */
export async function flushDocument(canvasId: string): Promise<void> {
  await persistDocument(canvasId);
}

/**
 * Remove document from memory and persist
 */
export async function closeDocument(canvasId: string): Promise<void> {
  await persistDocument(canvasId);
  const store = documents.get(canvasId);
  if (store?.persistenceTimeout) {
    clearTimeout(store.persistenceTimeout);
  }
  documents.delete(canvasId);
}

/**
 * Get active document count (for monitoring)
 */
export function getActiveDocumentCount(): number {
  return documents.size;
}
