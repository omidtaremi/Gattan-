/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ماژول ذخیره‌سازی نامحدود پایگاه داده در IndexedDB مرورگر
 * جهت جایگزینی با محدودیت ۵ مگابایتی LocalStorage
 */

import { AppDatabase } from '../types';

const DB_NAME = 'GatanSystemDatabase';
const DB_VERSION = 2;
const STORE_NAME = 'app_state';
export const DAILY_BACKUPS_STORE = 'daily_backups';
export const BACKUP_CONFIG_STORE = 'backup_config';
const RECORD_KEY = 'gatan_system_db';

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
 * ذخیره ایمن دیتابیس در IndexedDB با ظرفیت نامحدود (صدها مگابایت)
 */
export async function saveToIndexedDB(database: AppDatabase): Promise<boolean> {
  try {
    const db = await getGatanIDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        // Pass object directly to IndexedDB (Structured Clone natively supports plain JSON data without main-thread JSON round-trip)
        let request: IDBRequest<IDBValidKey>;
        try {
          request = store.put(database, RECORD_KEY);
        } catch (_cloneErr) {
          const cleanCopy = JSON.parse(JSON.stringify(database));
          request = store.put(cleanCopy, RECORD_KEY);
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
 * بازیابی دیتابیس از IndexedDB
 */
export async function loadFromIndexedDB(): Promise<AppDatabase | null> {
  try {
    const db = await getGatanIDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(RECORD_KEY);

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
