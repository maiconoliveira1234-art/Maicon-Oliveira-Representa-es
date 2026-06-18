import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'salesforce_pro_db';
const DB_VERSION = 1;

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
