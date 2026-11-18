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

export async function importDatabaseToPostgres(
  database: AppDatabase,
  source = 'manual_migration'
): Promise<{
  ok: boolean;
  versions?: Record<string, number>;
  importedCollections?: number;
  error?: string;
}> {
  const res = await fetch('/api/db/import', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ database, source }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || 'خطا در انتقال داده‌ها به PostgreSQL' };
  }
  return {
    ok: true,
    versions: data.versions,
    importedCollections: data.importedCollections,
  };
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
