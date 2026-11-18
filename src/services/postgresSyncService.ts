/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppDatabase, User } from '../types';

const TOKEN_STORAGE_KEY = 'gatan_pg_auth_token';

export interface ServerDbStatus {
  mode: 'postgres' | 'local';
  configured: boolean;
  connected: boolean;
  dbVersion?: string;
  databaseName?: string;
  dbSizeBytes?: number;
  isEmpty?: boolean;
  initializedByUser?: boolean;
  activeSessionsCount?: number;
  usersCount?: number;
  collectionCounts?: Record<string, number>;
  error?: string;
}

export interface PublicUserSummary {
  id: string;
  username: string;
  fullName: string;
  role: string;
  is2FA: boolean;
}

export interface AuditLogItem {
  id: number;
  userId: string | null;
  username: string;
  action: string;
  collectionKey: string | null;
  recordCount: number | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export function getAuthToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export function clearAuthToken(): void {
  setAuthToken('');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchPostgresStatus(): Promise<ServerDbStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('/api/db/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { mode: 'local', configured: false, connected: false };
    }
    const data = await res.json();
    return data as ServerDbStatus;
  } catch {
    clearTimeout(timer);
    return { mode: 'local', configured: false, connected: false };
  }
}

export async function fetchPublicUsers(): Promise<PublicUserSummary[]> {
  try {
    const res = await fetch('/api/auth/public-users', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

export async function loginWithPostgres(
  username: string,
  password: string,
  mfaCode?: string
): Promise<{
  ok: boolean;
  requires2FA?: boolean;
  token?: string;
  user?: User;
  error?: string;
}> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password, mfaCode }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok && data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function logoutFromPostgres(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders(),
    });
  } catch {
    // ignore
  } finally {
    clearAuthToken();
  }
}

export async function fetchCurrentUser(): Promise<User | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) clearAuthToken();
      return null;
    }
    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

export async function loadSharedDatabaseFromPostgres(keys?: string[]): Promise<{
  ok: boolean;
  collections: Record<string, unknown>;
  versions: Record<string, number>;
  isEmpty: boolean;
  status?: number;
  error?: string;
}> {
  const qs = keys && keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : '';
  const res = await fetch(`/api/db${qs}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      collections: {},
      versions: {},
      isEmpty: false,
      status: res.status,
      error: data.error || 'خطا در دریافت داده‌ها از PostgreSQL',
    };
  }
  return {
    ok: true,
    collections: data.collections || {},
    versions: data.versions || {},
    isEmpty: Boolean(data.isEmpty),
  };
}

export async function fetchPostgresVersions(): Promise<{
  ok: boolean;
  versions: Record<string, number>;
  status?: number;
}> {
  const res = await fetch('/api/db/versions', {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!res.ok) {
    return { ok: false, versions: {}, status: res.status };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, versions: data.versions || {} };
}

export async function syncDeltaToPostgres(
  changes: Record<string, unknown>,
  baseVersions: Record<string, number>
): Promise<{
  ok: boolean;
  status: number;
  versions: Record<string, number>;
  conflicts: string[];
  conflictedCollections: Record<string, unknown>;
  error?: string;
}> {
  const res = await fetch('/api/db/sync', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ changes, baseVersions }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: Boolean(data.ok),
    status: res.status,
    versions: data.versions || {},
    conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
    conflictedCollections: data.conflictedCollections || {},
    error: data.error,
  };
}

interface StagedChunkPayload {
  collectionKey: string;
  chunkIndex: number;
  totalChunks: number;
  data: unknown;
}

const MAX_STAGE_BATCH_BYTES = 380_000;

export async function importDatabaseToPostgres(
  database: AppDatabase,
  source = 'manual_migration'
): Promise<{
  ok: boolean;
  versions?: Record<string, number>;
  importedCollections?: number;
  error?: string;
}> {
  try {
    const dbRecord = database as unknown as Record<string, unknown>;
    const keys = Object.keys(dbRecord).filter(
      (k) =>
        k !== 'users' &&
        k !== 'currentUser' &&
        k !== 'syncStatus' &&
        k !== 'lastSyncTime' &&
        k !== 'syncLogs' &&
        k !== 'selectedPeriodId' &&
        dbRecord[k] !== undefined
    );

    const chunks: Array<{ payload: StagedChunkPayload; byteEstimate: number }> = [];

    for (const key of keys) {
      const val = dbRecord[key];
      let serializedLen = 0;
      try {
        serializedLen = JSON.stringify(val).length;
      } catch {
        return { ok: false, error: `خطا در آماده‌سازی داده‌های بخش ${key} برای ارسال به سرور.` };
      }

      if (Array.isArray(val) && val.length > 0 && serializedLen > MAX_STAGE_BATCH_BYTES) {
        // Dynamically slice array into chunks under MAX_STAGE_BATCH_BYTES
        const slices: unknown[][] = [];
        let currentSlice: unknown[] = [];
        let currentBytes = 2;

        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          const itemLen = JSON.stringify(item).length + 1;
          if (currentSlice.length > 0 && currentBytes + itemLen > MAX_STAGE_BATCH_BYTES) {
            slices.push(currentSlice);
            currentSlice = [item];
            currentBytes = 2 + itemLen;
          } else {
            currentSlice.push(item);
            currentBytes += itemLen;
          }
        }
        if (currentSlice.length > 0) {
          slices.push(currentSlice);
        }

        const totalChunks = slices.length;
        slices.forEach((sliceData, idx) => {
          chunks.push({
            payload: {
              collectionKey: key,
              chunkIndex: idx,
              totalChunks,
              data: sliceData,
            },
            byteEstimate: MAX_STAGE_BATCH_BYTES,
          });
        });
      } else {
        chunks.push({
          payload: {
            collectionKey: key,
            chunkIndex: 0,
            totalChunks: 1,
            data: val,
          },
          byteEstimate: serializedLen + key.length + 64,
        });
      }
    }

    // Estimate total JSON size: if tiny (< 320KB), single /api/db/import works immediately
    const totalEstimatedBytes = chunks.reduce((sum, c) => sum + c.byteEstimate, 0);
    if (totalEstimatedBytes < 320_000) {
      const res = await fetch('/api/db/import', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ database, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || `خطای سرور (${res.status}) در انتقال داده‌ها به PostgreSQL` };
      }
      return {
        ok: true,
        versions: data.versions,
        importedCollections: data.importedCollections,
      };
    }

    // Large payload path: send in <= ~380KB batches via /api/db/import/stage then /api/db/import/commit
    const importId = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let currentBatch: StagedChunkPayload[] = [];
    let currentBatchBytes = 0;

    const flushBatch = async (batch: StagedChunkPayload[]) => {
      if (batch.length === 0) return;
      const stageRes = await fetch('/api/db/import/stage', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ importId, chunks: batch }),
      });
      const stageData = await stageRes.json().catch(() => ({}));
      if (!stageRes.ok) {
        throw new Error(stageData.error || `خطای سرور (${stageRes.status}) در ارسال بسته داده به PostgreSQL`);
      }
    };

    for (const item of chunks) {
      if (currentBatch.length > 0 && currentBatchBytes + item.byteEstimate > MAX_STAGE_BATCH_BYTES) {
        await flushBatch(currentBatch);
        currentBatch = [];
        currentBatchBytes = 0;
      }
      currentBatch.push(item.payload);
      currentBatchBytes += item.byteEstimate;
    }
    if (currentBatch.length > 0) {
      await flushBatch(currentBatch);
    }

    const commitRes = await fetch('/api/db/import/commit', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        importId,
        source,
        users: Array.isArray(database.users) ? database.users : [],
      }),
    });
    const commitData = await commitRes.json().catch(() => ({}));
    if (!commitRes.ok) {
      return {
        ok: false,
        error: commitData.error || `خطای سرور (${commitRes.status}) در نهایی‌سازی انتقال داده‌ها به PostgreSQL`,
      };
    }

    return {
      ok: true,
      versions: commitData.versions,
      importedCollections: commitData.importedCollections,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `خطای ارتباط با سرور PostgreSQL هنگام ارسال داده‌ها: ${err?.message || String(err)}`,
    };
  }
}

export async function fetchAdminUsers(): Promise<{ ok: boolean; users: User[]; error?: string }> {
  const res = await fetch('/api/users', {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, users: [], error: data.error };
  return { ok: true, users: data.users || [] };
}

export async function createAdminUser(payload: {
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  password: string;
  is2FA: boolean;
  secretCode: string;
  isActive: boolean;
}): Promise<{ ok: boolean; user?: User; error?: string }> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true, user: data.user };
}

export async function updateAdminUser(
  userId: string,
  payload: {
    username?: string;
    fullName?: string;
    role?: string;
    permissions?: string[];
    password?: string;
    is2FA?: boolean;
    secretCode?: string;
    isActive?: boolean;
  }
): Promise<{ ok: boolean; user?: User; error?: string }> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true, user: data.user };
}

export async function deleteAdminUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

export async function fetchAuditLogs(limit = 60): Promise<AuditLogItem[]> {
  try {
    const res = await fetch(`/api/audit-logs?limit=${limit}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}
