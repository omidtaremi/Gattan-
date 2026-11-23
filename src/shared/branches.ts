/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Multi-Branch model, strict PostgreSQL database identifier validation,
 * and branch-level RBAC access helpers (used by both Express server and React client).
 */

import { isAdminUser, type AuthUserLike } from './rbac.ts';

export interface BranchDefinition {
  id: string;
  slug: string;
  name: string;
  /** Dedicated PostgreSQL database name. Empty string on the default branch means primary PGDATABASE. */
  dbName: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

export const DEFAULT_BRANCH_ID = 'branch-1';
export const SECOND_BRANCH_ID = 'branch-2';

export const DEFAULT_BRANCHES: BranchDefinition[] = [
  {
    id: DEFAULT_BRANCH_ID,
    slug: 'branch-1',
    name: 'شعبه مرکزی (شعبه ۱)',
    dbName: '',
    address: '',
    phone: '',
    isActive: true,
    isDefault: true,
    createdAt: '2026-03-21T00:00:00Z',
  },
  {
    id: SECOND_BRANCH_ID,
    slug: 'branch-2',
    name: 'شعبه ۲',
    dbName: 'gatan_branch_2',
    address: '',
    phone: '',
    isActive: true,
    isDefault: false,
    createdAt: '2026-03-21T00:00:00Z',
  },
];

/**
 * Strict allowlist regex for PostgreSQL database identifiers (prevents SQL injection).
 * Only lowercase ASCII letters, digits, and underscores, starting with a letter, 2..49 chars.
 */
const SAFE_PG_DB_NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;
const SAFE_BRANCH_ID_RE = /^[a-z0-9][a-z0-9_-]{0,48}$/;

export function isValidPgDatabaseName(dbName: string): boolean {
  return SAFE_PG_DB_NAME_RE.test(String(dbName || '').trim());
}

export function isValidBranchIdentifier(val: string): boolean {
  return SAFE_BRANCH_ID_RE.test(String(val || '').trim().toLowerCase());
}

export function normalizeBranchSlug(raw: string, fallback: number | string = 1): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  if (cleaned && /^[a-z0-9]/.test(cleaned)) {
    return cleaned;
  }
  if (typeof fallback === 'string') {
    const cleanFallback = fallback
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (cleanFallback && /^[a-z0-9]/.test(cleanFallback)) {
      return cleanFallback;
    }
  }
  return `branch-${typeof fallback === 'number' ? fallback : 1}`;
}

export function buildSafeBranchDbName(slugOrSeq: string | number, basePrefix = 'gatan_'): string {
  const safePrefix = String(basePrefix || 'gatan_')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, 'g');
  const rawSuffix =
    typeof slugOrSeq === 'number'
      ? `branch_${Math.max(1, Math.floor(slugOrSeq))}`
      : String(slugOrSeq || '');
  const suffix = rawSuffix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const combined = `${safePrefix}${suffix || 'branch'}`.slice(0, 48).replace(/_+$/g, '');
  if (isValidPgDatabaseName(combined)) {
    return combined;
  }
  return `gatan_branch_${Date.now().toString(36).slice(-6)}`;
}

export function normalizeAllowedBranches(
  allowed?: unknown,
  role?: string,
  permissions?: string[] | null
): string[] {
  if (role && isAdminUser({ role, permissions: permissions || undefined })) {
    return ['*'];
  }
  if (!Array.isArray(allowed) || allowed.length === 0) {
    // Backward-compatible default so existing users never lose access unexpectedly
    return ['*'];
  }
  const clean = new Set<string>();
  for (const item of allowed) {
    const val = String(item || '').trim();
    if (!val) continue;
    if (val === '*') return ['*'];
    clean.add(val);
  }
  return clean.size > 0 ? Array.from(clean) : ['*'];
}

export function canAccessBranch(
  user: AuthUserLike | null | undefined,
  branchId: string
): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const target = String(branchId || '').trim();
  if (!target) return false;
  const allowed = normalizeAllowedBranches(user.allowedBranches, user.role, user.permissions);
  return allowed.includes('*') || allowed.includes(target);
}

export function getAllowedBranches<T extends { id: string; isActive?: boolean }>(
  user: AuthUserLike | null | undefined,
  branches: T[]
): T[] {
  const activeList = (branches || []).filter((b) => b && b.isActive !== false);
  if (!user) return activeList;
  if (isAdminUser(user)) return activeList;
  return activeList.filter((b) => canAccessBranch(user, b.id));
}
