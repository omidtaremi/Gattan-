/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppDatabase, User } from '../types';
import { sanitizeAndMergeDatabase } from '../db';
import {
  BACKUP_CONFIG_STORE,
  DAILY_BACKUPS_STORE,
  getGatanIDB,
} from '../utils/idbStorage';
import { fetchFullBackupFromPostgres } from './postgresSyncService';

const SETTINGS_KEY = 'daily_backup_settings';
const DIR_HANDLE_KEY = 'daily_backup_dir_handle';
const LS_LAST_AUTO_BACKUP_DATE = 'gatan_last_auto_backup_date';

export interface DailyBackupSettings {
  autoBackupEnabled: boolean;
  autoDownloadFile: boolean;
  scheduledHour: number; // 0..23 (0 = اولین ورود در هر روز)
  retentionDays: number; // e.g. 30
  lastBackupDate: string; // YYYY-MM-DD (local)
  lastBackupTime: string; // ISO timestamp
  lastBackupStatus?: 'success' | 'needs_folder_permission' | 'error';
  lastBackupMethod?: 'folder' | 'download' | 'vault';
  lastBackupError?: string;
  directoryName?: string;
}

export interface BackupStatsSummary {
  periods: number;
  items: number;
  products: number;
  personnel: number;
  salesTransactions: number;
  users: number;
  roles: number;
}

export interface GatanBackupEnvelope {
  format: 'gatan-db-backup';
  version: 1;
  createdAt: string;
  dateKey: string;
  jalaliDate: string;
  sourceMode: 'postgres' | 'local';
  createdBy: string;
  stats: BackupStatsSummary;
  database: AppDatabase;
}

export interface DailyBackupRecord {
  id: string;
  dateKey: string;
  jalaliDate: string;
  createdAt: string;
  sizeBytes: number;
  sourceMode: 'postgres' | 'local';
  method: 'folder' | 'download' | 'vault';
  trigger: 'auto' | 'manual';
  createdBy: string;
  stats: BackupStatsSummary;
  payloadJson: string;
}

export type DailyBackupMetadata = Omit<DailyBackupRecord, 'payloadJson'>;

export const DEFAULT_DAILY_BACKUP_SETTINGS: DailyBackupSettings = {
  autoBackupEnabled: true,
  autoDownloadFile: true,
  scheduledHour: 0,
  retentionDays: 30,
  lastBackupDate: '',
  lastBackupTime: '',
};

let backupExecutionInFlight: Promise<BackupRunResult> | null = null;

export function getLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getJalaliDateLabel(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return getLocalDateKey(date);
  }
}

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showDirectoryPicker === 'function'
  );
}

function computeBackupStats(database: Partial<AppDatabase>): BackupStatsSummary {
  return {
    periods: Array.isArray(database.periods) ? database.periods.length : 0,
    items: Array.isArray(database.items) ? database.items.length : 0,
    products: Array.isArray(database.products) ? database.products.length : 0,
    personnel: Array.isArray(database.personnel) ? database.personnel.length : 0,
    salesTransactions: Array.isArray(database.salesTransactions) ? database.salesTransactions.length : 0,
    users: Array.isArray(database.users) ? database.users.length : 0,
    roles: Array.isArray(database.roles) ? database.roles.length : 0,
  };
}

export async function getDailyBackupSettings(): Promise<DailyBackupSettings> {
  try {
    const db = await getGatanIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(BACKUP_CONFIG_STORE, 'readonly');
      const store = tx.objectStore(BACKUP_CONFIG_STORE);
      const req = store.get(SETTINGS_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (val && typeof val === 'object') {
          resolve({ ...DEFAULT_DAILY_BACKUP_SETTINGS, ...val });
        } else {
          resolve({ ...DEFAULT_DAILY_BACKUP_SETTINGS });
        }
      };
      req.onerror = () => resolve({ ...DEFAULT_DAILY_BACKUP_SETTINGS });
      tx.onabort = () => resolve({ ...DEFAULT_DAILY_BACKUP_SETTINGS });
    });
  } catch {
    return { ...DEFAULT_DAILY_BACKUP_SETTINGS };
  }
}

export async function saveDailyBackupSettings(
  next: Partial<DailyBackupSettings>
): Promise<DailyBackupSettings> {
  const current = await getDailyBackupSettings();
  const merged: DailyBackupSettings = {
    ...current,
    ...next,
    scheduledHour: Math.min(23, Math.max(0, Number(next.scheduledHour ?? current.scheduledHour) || 0)),
    retentionDays: Math.min(90, Math.max(3, Number(next.retentionDays ?? current.retentionDays) || 30)),
  };
  try {
    const db = await getGatanIDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BACKUP_CONFIG_STORE, 'readwrite');
      tx.objectStore(BACKUP_CONFIG_STORE).put(merged, SETTINGS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore storage restriction
  }
  return merged;
}

export async function getSavedBackupDirectoryHandle(): Promise<any | null> {
  try {
    const db = await getGatanIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(BACKUP_CONFIG_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_CONFIG_STORE).get(DIR_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function pickBackupDirectory(): Promise<{
  ok: boolean;
  directoryName?: string;
  cancelled?: boolean;
  error?: string;
}> {
  if (!isFileSystemAccessSupported()) {
    return {
      ok: false,
      error: 'مرورگر فعلی یا آدرس غیر HTTPS از انتخاب مستقیم پوشه سیستم پشتیبانی نمی‌کند؛ فایل پشتیبان به‌صورت دانلود مستقیم روی سیستم ذخیره خواهد شد.',
    };
  }
  try {
    const handle = await (window as any).showDirectoryPicker({
      id: 'gatan-daily-backups',
      mode: 'readwrite',
    });
    if (!handle) {
      return { ok: false, cancelled: true };
    }
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      return {
        ok: false,
        error: 'مجوز نوشتن در پوشه انتخاب‌شده تایید نشد.',
      };
    }

    const db = await getGatanIDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BACKUP_CONFIG_STORE, 'readwrite');
      tx.objectStore(BACKUP_CONFIG_STORE).put(handle, DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    await saveDailyBackupSettings({ directoryName: String(handle.name || 'BackupFolder') });
    return { ok: true, directoryName: String(handle.name || 'BackupFolder') };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, cancelled: true };
    }
    return {
      ok: false,
      error: 'مرورگر در این محیط امنیتی (iframe پیش‌نمایش) اجازه انتخاب پوشه محلی را نمی‌دهد (Cross-origin error). لطفاً از قابلیت «دانلود فایل پشتیبان (JSON)» یا «پشتیبان‌گیری روی سرور (VPS)» استفاده کنید.',
    };
  }
}

export async function clearBackupDirectory(): Promise<void> {
  try {
    const db = await getGatanIDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BACKUP_CONFIG_STORE, 'readwrite');
      tx.objectStore(BACKUP_CONFIG_STORE).delete(DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
  await saveDailyBackupSettings({ directoryName: undefined });
}

async function writeBackupToFolderHandle(
  handle: any,
  filename: string,
  jsonText: string,
  retentionDays: number,
  interactivePrompt: boolean
): Promise<'written' | 'needs_permission' | 'error'> {
  if (!handle) return 'error';
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && interactivePrompt) {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') {
      return 'needs_permission';
    }

    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonText);
    await writable.close();

    // Prune older Gatan_DB_Backup_*.json files in the connected folder beyond retentionDays
    try {
      const backupFiles: string[] = [];
      for await (const [entryName, entry] of handle.entries()) {
        if (
          entry?.kind === 'file' &&
          /^Gatan_DB_Backup_\d{4}-\d{2}-\d{2}\.json$/i.test(entryName)
        ) {
          backupFiles.push(entryName);
        }
      }
      if (backupFiles.length > retentionDays) {
        backupFiles.sort(); // chronological YYYY-MM-DD
        const toRemove = backupFiles.slice(0, backupFiles.length - retentionDays);
        for (const oldName of toRemove) {
          await handle.removeEntry(oldName).catch(() => {});
        }
      }
    } catch {
      // ignore folder pruning error
    }

    return 'written';
  } catch {
    return 'error';
  }
}

export function triggerBackupDownload(filename: string, jsonText: string): void {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function saveRecordInDailyVault(
  record: DailyBackupRecord,
  retentionDays: number
): Promise<void> {
  const db = await getGatanIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DAILY_BACKUPS_STORE, 'readwrite');
    const store = tx.objectStore(DAILY_BACKUPS_STORE);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('IndexedDB abort'));
  });

  // Prune old entries beyond retentionDays
  const all = await listDailyBackupsMeta();
  if (all.length > retentionDays) {
    const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const expired = sorted.slice(retentionDays);
    if (expired.length > 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(DAILY_BACKUPS_STORE, 'readwrite');
        const store = tx.objectStore(DAILY_BACKUPS_STORE);
        for (const item of expired) {
          store.delete(item.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  }
}

export async function listDailyBackupsMeta(): Promise<DailyBackupMetadata[]> {
  try {
    const db = await getGatanIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(DAILY_BACKUPS_STORE, 'readonly');
      const req = tx.objectStore(DAILY_BACKUPS_STORE).getAll();
      req.onsuccess = () => {
        const items: DailyBackupRecord[] = Array.isArray(req.result) ? req.result : [];
        const meta: DailyBackupMetadata[] = items
          .map(({ payloadJson: _ignored, ...rest }) => rest)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(meta);
      };
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function getDailyBackupRecordById(id: string): Promise<DailyBackupRecord | null> {
  try {
    const db = await getGatanIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(DAILY_BACKUPS_STORE, 'readonly');
      const req = tx.objectStore(DAILY_BACKUPS_STORE).get(id);
      req.onsuccess = () => resolve((req.result as DailyBackupRecord) || null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteDailyBackupById(id: string): Promise<void> {
  try {
    const db = await getGatanIDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DAILY_BACKUPS_STORE, 'readwrite');
      tx.objectStore(DAILY_BACKUPS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export function buildBackupEnvelope(
  database: AppDatabase,
  sourceMode: 'postgres' | 'local',
  createdBy: string,
  now = new Date()
): GatanBackupEnvelope {
  const cleanDb: AppDatabase = {
    ...database,
    syncStatus: sourceMode === 'postgres' ? 'synced' : 'offline',
  };
  return {
    format: 'gatan-db-backup',
    version: 1,
    createdAt: now.toISOString(),
    dateKey: getLocalDateKey(now),
    jalaliDate: getJalaliDateLabel(now),
    sourceMode,
    createdBy,
    stats: computeBackupStats(cleanDb),
    database: cleanDb,
  };
}

export interface ParsedBackupValidation {
  ok: boolean;
  database?: AppDatabase;
  meta?: {
    createdAt?: string;
    dateKey?: string;
    jalaliDate?: string;
    sourceMode?: string;
    stats: BackupStatsSummary;
  };
  error?: string;
}

export function parseAndValidateBackupJson(rawText: string): ParsedBackupValidation {
  try {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) {
      return { ok: false, error: 'فایل پشتیبان خالی است.' };
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'ساختار فایل پشتیبان JSON نامعتبر است.' };
    }

    let rawDb: any;
    let envelopeMeta: ParsedBackupValidation['meta'] | undefined;

    if (parsed.format === 'gatan-db-backup' && parsed.database && typeof parsed.database === 'object') {
      rawDb = parsed.database;
      envelopeMeta = {
        createdAt: parsed.createdAt,
        dateKey: parsed.dateKey,
        jalaliDate: parsed.jalaliDate,
        sourceMode: parsed.sourceMode,
        stats: computeBackupStats(rawDb),
      };
    } else if (
      Array.isArray(parsed.periods) ||
      Array.isArray(parsed.items) ||
      Array.isArray(parsed.products) ||
      Array.isArray(parsed.users)
    ) {
      rawDb = parsed;
      envelopeMeta = {
        stats: computeBackupStats(rawDb),
      };
    } else {
      return {
        ok: false,
        error: 'این فایل متعلق به نسخه پشتیبان سامانه گاتان نیست (فیلدهای پایه پایگاه داده یافت نشد).',
      };
    }

    const sanitized = sanitizeAndMergeDatabase(rawDb);
    return {
      ok: true,
      database: sanitized,
      meta: envelopeMeta,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `خطا در خواندن یا تحلیل فایل JSON پشتیبان: ${err?.message || String(err)}`,
    };
  }
}

export interface BackupRunResult {
  ok: boolean;
  skipped?: boolean;
  needsFolderPermission?: boolean;
  method?: 'folder' | 'download' | 'vault';
  filename?: string;
  record?: DailyBackupMetadata;
  settings?: DailyBackupSettings;
  error?: string;
}

export async function performDatabaseBackup(params: {
  trigger: 'auto' | 'manual';
  serverMode: 'postgres' | 'local';
  currentDb: AppDatabase;
  currentUser: User | null;
  interactiveFolderPrompt?: boolean;
  forceDownload?: boolean;
}): Promise<BackupRunResult> {
  if (backupExecutionInFlight) {
    return backupExecutionInFlight;
  }

  const run = async (): Promise<BackupRunResult> => {
    const {
      trigger,
      serverMode,
      currentDb,
      currentUser,
      interactiveFolderPrompt = false,
      forceDownload = false,
    } = params;

    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const settings = await getDailyBackupSettings();

    if (trigger === 'auto') {
      if (!settings.autoBackupEnabled) {
        return { ok: true, skipped: true, settings };
      }
      if (now.getHours() < (settings.scheduledHour ?? 0)) {
        return { ok: true, skipped: true, settings };
      }
      let lsDate = '';
      try {
        lsDate = localStorage.getItem(LS_LAST_AUTO_BACKUP_DATE) || '';
      } catch {
        // ignore
      }
      if (settings.lastBackupDate === todayKey || lsDate === todayKey) {
        return { ok: true, skipped: true, settings };
      }
      // Lock across tabs optimistically
      try {
        localStorage.setItem(LS_LAST_AUTO_BACKUP_DATE, todayKey);
      } catch {
        // ignore
      }
    }

    let sourceDb: AppDatabase = currentDb;
    if (serverMode === 'postgres') {
      const pgRes = await fetchFullBackupFromPostgres();
      if (!pgRes.ok || !pgRes.database) {
        if (trigger === 'auto') {
          try {
            localStorage.removeItem(LS_LAST_AUTO_BACKUP_DATE);
          } catch {
            // ignore
          }
        }
        const errMsg = pgRes.error || 'خطا در دریافت داده‌ها از PostgreSQL برای پشتیبان‌گیری';
        const nextSettings = await saveDailyBackupSettings({
          lastBackupStatus: 'error',
          lastBackupError: errMsg,
        });
        return { ok: false, error: errMsg, settings: nextSettings };
      }
      sourceDb = sanitizeAndMergeDatabase(pgRes.database);
    } else {
      sourceDb = sanitizeAndMergeDatabase(currentDb);
    }

    const createdBy = String(currentUser?.fullName || currentUser?.username || 'admin');
    const envelope = buildBackupEnvelope(sourceDb, serverMode, createdBy, now);
    const jsonText = JSON.stringify(envelope);
    const sizeBytes = new Blob([jsonText]).size;
    const filename =
      trigger === 'manual' && !forceDownload
        ? `Gatan_DB_Backup_${todayKey}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`
        : `Gatan_DB_Backup_${todayKey}.json`;

    let method: 'folder' | 'download' | 'vault' = 'vault';
    let needsFolderPermission = false;

    const dirHandle = await getSavedBackupDirectoryHandle();
    if (dirHandle && !forceDownload) {
      const folderWrite = await writeBackupToFolderHandle(
        dirHandle,
        `Gatan_DB_Backup_${todayKey}.json`,
        jsonText,
        settings.retentionDays,
        interactiveFolderPrompt
      );
      if (folderWrite === 'written') {
        method = 'folder';
      } else if (folderWrite === 'needs_permission') {
        needsFolderPermission = true;
      }
    }

    if (method !== 'folder') {
      if (forceDownload || trigger === 'manual' || (trigger === 'auto' && settings.autoDownloadFile)) {
        triggerBackupDownload(filename, jsonText);
        method = 'download';
      }
    }

    const recordId =
      trigger === 'auto'
        ? `daily-${todayKey}`
        : `manual-${todayKey}-${now.getTime()}`;

    const fullRecord: DailyBackupRecord = {
      id: recordId,
      dateKey: todayKey,
      jalaliDate: envelope.jalaliDate,
      createdAt: envelope.createdAt,
      sizeBytes,
      sourceMode: serverMode,
      method,
      trigger,
      createdBy,
      stats: envelope.stats,
      payloadJson: jsonText,
    };

    await saveRecordInDailyVault(fullRecord, settings.retentionDays);

    const nextSettings = await saveDailyBackupSettings({
      lastBackupDate: todayKey,
      lastBackupTime: envelope.createdAt,
      lastBackupStatus: needsFolderPermission ? 'needs_folder_permission' : 'success',
      lastBackupMethod: method,
      lastBackupError: '',
    });

    const { payloadJson: _omit, ...metaRecord } = fullRecord;
    return {
      ok: true,
      needsFolderPermission,
      method,
      filename,
      record: metaRecord,
      settings: nextSettings,
    };
  };

  backupExecutionInFlight = run().finally(() => {
    backupExecutionInFlight = null;
  });
  return backupExecutionInFlight;
}

export interface ServerBackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchServerBackups(): Promise<ServerBackupItem[]> {
  try {
    const token = localStorage.getItem('gatan_token') || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/server-backups', { headers });
    const data = await res.json();
    if (data.ok && Array.isArray(data.backups)) {
      return data.backups;
    }
  } catch (err) {
    console.error('Error fetching server backups', err);
  }
  return [];
}

export async function createServerBackup(): Promise<{ ok: boolean; error?: string; backup?: ServerBackupItem }> {
  try {
    const token = localStorage.getItem('gatan_token') || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/server-backups', { method: 'POST', headers });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ارتباط با سرور' };
  }
}

export async function restoreServerBackup(filename: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = localStorage.getItem('gatan_token') || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/server-backups/restore/${encodeURIComponent(filename)}`, { method: 'POST', headers });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ارتباط با سرور' };
  }
}

export async function deleteServerBackup(filename: string): Promise<boolean> {
  try {
    const token = localStorage.getItem('gatan_token') || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/server-backups/${encodeURIComponent(filename)}`, { method: 'DELETE', headers });
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

