import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'salesforce_pro_db';
const DB_VERSION = 2;
const CACHE_STORE = 'app_cache';

interface CacheRecord<T = any> {
  key: string;
  value: T;
  updatedAt: number;
}

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('clientes')) {
        db.createObjectStore('clientes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('produtos')) {
        db.createObjectStore('produtos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pedidos_pendentes')) {
        db.createObjectStore('pedidos_pendentes', { keyPath: 'tempId', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('estoque_local')) {
        db.createObjectStore('estoque_local', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    },
  });
}

export async function saveToLocal(storeName: string, data: any) {
  const db = await initDB();
  return db.put(storeName, data);
}

export async function getFromLocal(storeName: string, id: string) {
  const db = await initDB();
  return db.get(storeName, id);
}

export async function getAllFromLocal(storeName: string) {
  const db = await initDB();
  return db.getAll(storeName);
}

export async function setCacheValue<T>(key: string, value: T) {
  const db = await initDB();
  const record: CacheRecord<T> = {
    key,
    value,
    updatedAt: Date.now()
  };
  await db.put(CACHE_STORE, record);
}

export async function setCacheValues(values: Record<string, any>) {
  const db = await initDB();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  const now = Date.now();

  await Promise.all(
    Object.entries(values).map(([key, value]) =>
      tx.store.put({ key, value, updatedAt: now } satisfies CacheRecord)
    )
  );

  await tx.done;
}

export async function getCacheValue<T>(key: string, fallback: T): Promise<T> {
  const db = await initDB();
  const record = await db.get(CACHE_STORE, key) as CacheRecord<T> | undefined;
  return record ? record.value : fallback;
}

export async function getCacheValues<T extends Record<string, any>>(fallbacks: T): Promise<T> {
  const db = await initDB();
  const tx = db.transaction(CACHE_STORE, 'readonly');
  const entries = await Promise.all(
    Object.keys(fallbacks).map(async (key) => {
      const record = await tx.store.get(key) as CacheRecord | undefined;
      return [key, record ? record.value : fallbacks[key]];
    })
  );

  await tx.done;
  return Object.fromEntries(entries) as T;
}
