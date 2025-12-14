/**
 * Y.js Document Provider
 * Manages Y.js documents for real-time collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 */


import * as Y from 'yjs';
import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('yjs-provider');

interface DocumentStore {
  doc: Y.Doc;
  lastAccessed: number;
  persistenceTimeout?: NodeJS.Timeout;
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
    await loadDocumentState(canvasId, doc);

    store = {
      doc,
      lastAccessed: Date.now(),
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
async function loadDocumentState(canvasId: string, doc: Y.Doc): Promise<void> {
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

      yItems.set(item.id, yItem);
    });
  } catch (error) {
    logger.error({ error, canvasId }, 'Failed to load document state');
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

    // Convert Y.js items to database updates
    const updates: Array<{
      id: string;
      data: any;
    }> = [];

    yItems.forEach((yItem, itemId) => {
      if (yItem instanceof Y.Map) {
        updates.push({
          id: itemId as string,
          data: {
            positionX: yItem.get('positionX'),
            positionY: yItem.get('positionY'),
            width: yItem.get('width'),
            height: yItem.get('height'),
            zIndex: yItem.get('zIndex'),
            content: yItem.get('content'),
            tags: yItem.get('tags'),
          },
        });
      }
    });

    // Batch update items in database using transaction
    await prisma.$transaction(
      updates.map((update) =>
        prisma.canvasItem.updateMany({
          where: {
            id: update.id,
            canvasId,
          },
          data: update.data,
        })
      )
    );

    logger.debug({ canvasId, itemCount: updates.length }, 'Persisted items for canvas');
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
