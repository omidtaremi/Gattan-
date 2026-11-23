/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ماژول ذخیره‌سازی نامحدود پایگاه داده در IndexedDB مرورگر
 * جهت جایگزینی با محدودیت ۵ مگابایتی LocalStorage
 */

import { AppDatabase } from '../types';
import { DEFAULT_BRANCH_ID } from '../shared/branches';

const DB_NAME = 'GatanSystemDatabase';
const DB_VERSION = 2;
const STORE_NAME = 'app_state';
export const DAILY_BACKUPS_STORE = 'daily_backups';
export const BACKUP_CONFIG_STORE = 'backup_config';
const RECORD_KEY = 'gatan_system_db';

export function getBranchRecordKey(branchId?: string): string {
  const clean = String(branchId || '').trim();
  if (!clean || clean === DEFAULT_BRANCH_ID) {
    return RECORD_KEY;
  }
  return `gatan_branch_db_${clean}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function getGatanIDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this browser environment'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
          if (!db.objectStoreNames.contains(DAILY_BACKUPS_STORE)) {
            db.createObjectStore(DAILY_BACKUPS_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(BACKUP_CONFIG_STORE)) {
            db.createObjectStore(BACKUP_CONFIG_STORE);
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          dbPromise = null;
          reject(request.error);
        };
      } catch (err) {
        dbPromise = null;
        reject(err);
      }
    });
  }

  return dbPromise;
}

/**
 * ذخیره ایمن دیتابیس شعبه در IndexedDB با ظرفیت نامحدود (صدها مگابایت)
 */
export async function saveToIndexedDB(database: AppDatabase, branchId?: string): Promise<boolean> {
  try {
    const db = await getGatanIDB();
    const recordKey = getBranchRecordKey(branchId);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        let request: IDBRequest<IDBValidKey>;
        try {
          request = store.put(database, recordKey);
        } catch (_cloneErr) {
          const cleanCopy = JSON.parse(JSON.stringify(database));
          request = store.put(cleanCopy, recordKey);
        }

        request.onsuccess = () => resolve(true);
        request.onerror = (e) => {
          console.warn('IndexedDB put error:', e);
          resolve(false);
        };
        tx.onabort = () => resolve(false);
      } catch (innerErr) {
        console.warn('IndexedDB transaction error:', innerErr);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('IndexedDB unavailable for save:', err);
    return false;
  }
}

/**
 * بازیابی دیتابیس شعبه از IndexedDB
 */
export async function loadFromIndexedDB(branchId?: string): Promise<AppDatabase | null> {
  try {
    const db = await getGatanIDB();
    const recordKey = getBranchRecordKey(branchId);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(recordKey);

        request.onsuccess = () => {
          const val = request.result;
          if (val && typeof val === 'object') {
            resolve(val as AppDatabase);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (innerErr) {
        console.warn('IndexedDB transaction read error:', innerErr);
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('IndexedDB unavailable for load:', err);
    return null;
  }
}

export async function deleteBranchFromIndexedDB(branchId: string): Promise<boolean> {
  if (!branchId || branchId === DEFAULT_BRANCH_ID) return false;
  try {
    const db = await getGatanIDB();
    const recordKey = getBranchRecordKey(branchId);
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(recordKey);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function saveSharedMetaToIndexedDB<T>(key: string, value: T): Promise<boolean> {
  try {
    const db = await getGatanIDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, `gatan_shared_${key}`);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function loadSharedMetaFromIndexedDB<T>(key: string): Promise<T | null> {
  try {
    const db = await getGatanIDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(`gatan_shared_${key}`);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
