/**
 * IndexedDB Manager for ContextBridge
 * Database: "contextbridge_db", version 1
 * Object store: "content_records" (keyPath: "id")
 * Indexes: url (unique), domain, indexedAt, contentType
 *
 * All operations are async and designed to run in the MV3 background service worker.
 */

const DB_NAME = 'contextbridge_db';
const DB_VERSION = 1;
const STORE_NAME = 'content_records';

let dbInstance = null;

/**
 * Opens (or creates) the IndexedDB database.
 * Returns the database instance, reusing a cached connection if available.
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('url', 'url', { unique: true });
        store.createIndex('domain', 'domain', { unique: false });
        store.createIndex('indexedAt', 'indexedAt', { unique: false });
        store.createIndex('contentType', 'contentType', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message || 'unknown error'}`));
    };
  });
}

/**
 * Upserts a Content_Record by id.
 * Sets `updatedAt` to the current ISO timestamp.
 * If the record has no `indexedAt`, sets it to the current timestamp as well.
 */
export async function putRecord(record) {
  const db = await openDB();
  const now = new Date().toISOString();

  const recordToStore = {
    ...record,
    updatedAt: now,
    indexedAt: record.indexedAt || now,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(recordToStore);

    request.onsuccess = () => resolve(recordToStore);
    request.onerror = (event) => reject(new Error(`putRecord failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Retrieves a single Content_Record by id.
 * Returns the record or undefined if not found.
 */
export async function getRecord(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(new Error(`getRecord failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Returns all Content_Records from the store.
 */
export async function getAllRecords() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(new Error(`getAllRecords failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Removes a single Content_Record by id.
 */
export async function deleteRecord(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(new Error(`deleteRecord failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Deletes all Content_Records from the store.
 */
export async function clearAllRecords() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(new Error(`clearAllRecords failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Returns the count of records in the store.
 */
export async function getRecordCount() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(new Error(`getRecordCount failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Retrieves a Content_Record by URL using the url index.
 * Returns the record or null if not found.
 */
export async function getRecordByUrl(url) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('url');
    const request = index.get(url);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (event) => reject(new Error(`getRecordByUrl failed: ${event.target.error?.message || 'unknown error'}`));
  });
}

/**
 * Returns storage estimate using navigator.storage.estimate().
 * Returns { count, sizeBytes } where count is the number of records
 * and sizeBytes is the estimated storage usage.
 */
export async function getStorageEstimate() {
  const count = await getRecordCount();

  let sizeBytes = 0;
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    sizeBytes = estimate.usage || 0;
  }

  return { count, sizeBytes };
}
