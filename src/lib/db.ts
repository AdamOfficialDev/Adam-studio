import Dexie, { type Table } from 'dexie';
import { loadConversations } from '@/lib/storage';
import type { Conversation } from '@/types/chat';

const MIGRATION_FLAG_KEY = 'adam-studio-idb-migrated-v1';

class AdamStudioDB extends Dexie {
  conversations!: Table<Conversation, string>;

  constructor() {
    super('adam-studio-db');
    this.version(1).stores({
      conversations: 'id, updatedAt, pinned',
    });
  }
}

export const db = new AdamStudioDB();

// Cache referensi terakhir agar hanya sesi yang benar-benar berubah yang ditulis ke IndexedDB
const lastSyncedRefs = new Map<string, Conversation>();

export async function hydrateConversationsWithMigration(): Promise<Conversation[]> {
  try {
    const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
    const existingInIdb = await db.conversations.orderBy('updatedAt').reverse().toArray();

    if (!alreadyMigrated) {
      const legacy = loadConversations();
      if (legacy.length > 0 && existingInIdb.length === 0) {
        await db.conversations.bulkPut(legacy);
      }
      localStorage.setItem(MIGRATION_FLAG_KEY, '1');
      // Bebaskan kuota 5MB localStorage setelah aman masuk ke IndexedDB
      try {
        localStorage.removeItem('hydrogen-chat-conversations-v3');
        localStorage.removeItem('hydrogen-chat-conversations-v2');
        localStorage.removeItem('hydrogen-chat-conversations-v1');
      } catch {
        // Abaikan
      }
    }

    const finalList = await db.conversations.orderBy('updatedAt').reverse().toArray();
    lastSyncedRefs.clear();
    for (const conv of finalList) {
      lastSyncedRefs.set(conv.id, conv);
    }
    return finalList;
  } catch {
    // Fallback aman ke localStorage jika browser memblokir IndexedDB (mis. private mode ketat)
    return loadConversations();
  }
}

export async function syncConversationsToIdb(conversations: Conversation[]): Promise<void> {
  try {
    const currentIds = new Set<string>();
    const toPut: Conversation[] = [];

    for (const conv of conversations) {
      currentIds.add(conv.id);
      if (lastSyncedRefs.get(conv.id) !== conv) {
        toPut.push(conv);
      }
    }

    const toDelete: string[] = [];
    for (const prevId of lastSyncedRefs.keys()) {
      if (!currentIds.has(prevId)) {
        toDelete.push(prevId);
      }
    }

    if (toPut.length === 0 && toDelete.length === 0) return;

    await db.transaction('rw', db.conversations, async () => {
      if (toPut.length > 0) {
        await db.conversations.bulkPut(toPut);
      }
      if (toDelete.length > 0) {
        await db.conversations.bulkDelete(toDelete);
      }
    });

    for (const conv of toPut) lastSyncedRefs.set(conv.id, conv);
    for (const delId of toDelete) lastSyncedRefs.delete(delId);
  } catch {
    // Abaikan jika transaksi terganggu
  }
}

export async function getIndexedDbStats(): Promise<{
  count: number;
  usedLabel: string;
}> {
  try {
    const count = await db.conversations.count();
    let usedLabel = 'IndexedDB Aktif';
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number') {
        const mb = est.usage / (1024 * 1024);
        usedLabel = mb < 1 ? `${Math.max(1, Math.round(est.usage / 1024))} KB` : `${mb.toFixed(1)} MB`;
      }
    }
    return { count, usedLabel };
  } catch {
    return { count: 0, usedLabel: 'Unavailable' };
  }
}

export async function exportAllConversationsBackup(): Promise<string> {
  const all = await db.conversations.orderBy('updatedAt').reverse().toArray();
  return JSON.stringify(
    {
      app: 'adam-studio',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations: all,
    },
    null,
    2
  );
}

export async function restoreConversationsBackup(rawJson: string): Promise<Conversation[]> {
  const parsed = JSON.parse(rawJson) as { conversations?: unknown };
  if (!parsed || !Array.isArray(parsed.conversations)) {
    throw new Error('Format file backup tidak valid (tidak ditemukan array conversations).');
  }
  const valid = parsed.conversations.filter(
    (c): c is Conversation =>
      Boolean(c && typeof c === 'object' && typeof (c as Conversation).id === 'string' && Array.isArray((c as Conversation).messages))
  );
  if (valid.length === 0) {
    throw new Error('File backup tidak berisi percakapan valid.');
  }
  await db.conversations.bulkPut(valid);
  const merged = await db.conversations.orderBy('updatedAt').reverse().toArray();
  lastSyncedRefs.clear();
  for (const conv of merged) lastSyncedRefs.set(conv.id, conv);
  return merged;
}
