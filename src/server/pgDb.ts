/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import {
  CLIENT_ONLY_DB_KEYS,
  canWriteCollection,
  isAdminUser,
  normalizePermissions,
  type AuthUserLike,
} from '../shared/rbac.ts';

const CHUNK_SIZE = 5000;
const SESSION_TTL_HOURS = 24 * 7; // 7 days

export interface PgUserPublic {
  id: string;
  username: string;
  fullName: string;
  name: string;
  role: string;
  permissions: string[];
  is2FA: boolean;
  isActive: boolean;
  secretCode?: string;
}

export interface PgDbStatus {
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

export interface AuditLogEntry {
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

const DEFAULT_SEED_USERS = [
  {
    id: 'usr-1',
    username: 'admin',
    fullName: 'مدیر کل سامانه گاتان',
    role: 'مدیر ارشد',
    password: '123',
    is2FA: false,
    secretCode: '123456',
    permissions: ['*'],
  },
  {
    id: 'usr-2',
    username: 'acc',
    fullName: 'حسابدار ارشد',
    role: 'حسابدار',
    password: '123',
    is2FA: false,
    secretCode: '654321',
    permissions: ['items', 'sales', 'cogs', 'payroll', 'expenses', 'procurement'],
  },
  {
    id: 'usr-3',
    username: 'store',
    fullName: 'کاربر انبار گاتان',
    role: 'کاربر انبار',
    password: '123',
    is2FA: false,
    secretCode: '111111',
    permissions: ['items'],
  },
];

let pool: Pool | null = null;
let isPgConfigured = false;
let isPgReady = false;
let lastPgError: string | null = null;

function hasPostgresEnv(): boolean {
  return Boolean(
    (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') ||
      (process.env.PGHOST &&
        process.env.PGHOST.trim() !== '' &&
        process.env.PGDATABASE &&
        process.env.PGDATABASE.trim() !== '')
  );
}

function createPgPool(): Pool {
  const sslEnabled =
    process.env.PGSSLMODE === 'require' || process.env.DATABASE_SSL === 'true';

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
    return new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    });
  }

  return new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'gatan_db',
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  });
}

function hashToken(token: string): string {
  const secret = process.env.AUTH_SECRET || 'gatan-selfhosted-pg-session';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function isBcryptHash(val: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(val);
}

function mapUserRow(row: any, includeSecret = false): PgUserPublic {
  const perms = Array.isArray(row.permissions) ? row.permissions : [];
  const mapped: PgUserPublic = {
    id: String(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    name: String(row.full_name),
    role: String(row.role),
    permissions: normalizePermissions(perms),
    is2FA: Boolean(row.is_2fa),
    isActive: row.is_active !== false,
  };
  if (includeSecret) {
    mapped.secretCode = String(row.secret_code || '');
  }
  return mapped;
}

export function isPostgresModeActive(): boolean {
  return isPgConfigured && isPgReady && pool !== null;
}

export async function initPostgres(): Promise<void> {
  isPgConfigured = hasPostgresEnv();
  if (!isPgConfigured) {
    isPgReady = false;
    lastPgError = null;
    console.log(
      '[PostgreSQL] DATABASE_URL / PGHOST is not configured. Running in local browser storage mode.'
    );
    return;
  }

  try {
    pool = createPgPool();
    const client = await pool.connect();
    try {
      const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const ddl = fs.readFileSync(schemaPath, 'utf8');
        await client.query(ddl);
      }

      // Seed default users if app_users table is empty
      const { rows: countRows } = await client.query<{ cnt: string }>(
        'SELECT COUNT(*)::text AS cnt FROM app_users'
      );
      const usersCount = Number(countRows[0]?.cnt || 0);
      if (usersCount === 0) {
        for (const u of DEFAULT_SEED_USERS) {
          const pwHash = await bcrypt.hash(u.password, 10);
          await client.query(
            `INSERT INTO app_users (id, username, full_name, role, permissions, password_hash, is_2fa, secret_code, is_active)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, TRUE)
             ON CONFLICT (username) DO NOTHING`,
            [
              u.id,
              u.username,
              u.fullName,
              u.role,
              JSON.stringify(u.permissions),
              pwHash,
              u.is2FA,
              u.secretCode,
            ]
          );
        }
        console.log('[PostgreSQL] Seeded default RBAC users (admin, acc, store).');
      }

      isPgReady = true;
      lastPgError = null;
      console.log('[PostgreSQL] Connected and schema initialized successfully.');
    } finally {
      client.release();
    }
  } catch (err: any) {
    isPgReady = false;
    lastPgError = err?.message || String(err);
    console.error('[PostgreSQL] Initialization failed:', lastPgError);
  }
}

export async function getPostgresStatus(): Promise<PgDbStatus> {
  if (!isPgConfigured) {
    return {
      mode: 'local',
      configured: false,
      connected: false,
    };
  }

  if (!pool) {
    return {
      mode: 'postgres',
      configured: true,
      connected: false,
      error: lastPgError || 'PostgreSQL pool is not initialized',
    };
  }

  try {
    const [verRes, sizeRes, sessRes, usersRes, collRes, metaRes] = await Promise.all([
      pool.query<{ version: string; db_name: string }>(
        'SELECT version() AS version, current_database() AS db_name'
      ),
      pool.query<{ size_bytes: string }>(
        'SELECT pg_database_size(current_database())::text AS size_bytes'
      ),
      pool.query<{ cnt: string }>(
        'SELECT COUNT(*)::text AS cnt FROM app_sessions WHERE expires_at > NOW()'
      ),
      pool.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM app_users'),
      pool.query<{ collection_key: string; item_count: number }>(
        'SELECT collection_key, item_count FROM app_collections'
      ),
      pool.query<{ meta_value: any }>(
        "SELECT meta_value FROM app_metadata WHERE meta_key = 'seed_state'"
      ),
    ]);

    isPgReady = true;
    lastPgError = null;

    const collectionCounts: Record<string, number> = {};
    for (const row of collRes.rows) {
      collectionCounts[row.collection_key] = Number(row.item_count || 0);
    }

    const seedState = metaRes.rows[0]?.meta_value;
    return {
      mode: 'postgres',
      configured: true,
      connected: true,
      dbVersion: verRes.rows[0]?.version?.split(' ').slice(0, 2).join(' ') || 'PostgreSQL',
      databaseName: verRes.rows[0]?.db_name,
      dbSizeBytes: Number(sizeRes.rows[0]?.size_bytes || 0),
      isEmpty: collRes.rows.length === 0,
      initializedByUser: Boolean(seedState?.initializedByUser),
      activeSessionsCount: Number(sessRes.rows[0]?.cnt || 0),
      usersCount: Number(usersRes.rows[0]?.cnt || 0),
      collectionCounts,
    };
  } catch (err: any) {
    isPgReady = false;
    lastPgError = err?.message || String(err);
    return {
      mode: 'postgres',
      configured: true,
      connected: false,
      error: lastPgError || 'Connection check failed',
    };
  }
}

export async function getPublicUsersFromPg(): Promise<
  Array<{ id: string; username: string; fullName: string; role: string; is2FA: boolean }>
> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, username, full_name, role, is_2fa
     FROM app_users
     WHERE is_active = TRUE
     ORDER BY CASE WHEN username = 'admin' THEN 0 ELSE 1 END, created_at ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    username: String(r.username),
    fullName: String(r.full_name),
    role: String(r.role),
    is2FA: Boolean(r.is_2fa),
  }));
}

export async function authenticateUserInPg(
  username: string,
  password: string,
  mfaCode?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  ok: boolean;
  requires2FA?: boolean;
  token?: string;
  user?: PgUserPublic;
  error?: string;
}> {
  if (!pool) return { ok: false, error: 'پایگاه داده PostgreSQL متصل نیست.' };

  const cleanUsername = String(username || '').trim();
  const { rows } = await pool.query(
    'SELECT * FROM app_users WHERE username = $1 LIMIT 1',
    [cleanUsername]
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, error: 'نام کاربری یا رمز عبور اشتباه است.' };
  }
  if (row.is_active === false) {
    return { ok: false, error: 'حساب کاربری شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.' };
  }

  const storedHash = String(row.password_hash || '');
  let passwordMatched = false;
  if (isBcryptHash(storedHash)) {
    passwordMatched = await bcrypt.compare(password, storedHash);
  } else {
    passwordMatched = storedHash === password;
    if (passwordMatched) {
      // Auto-upgrade legacy plaintext password to bcrypt
      const upgraded = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [upgraded, row.id]
      );
    }
  }

  if (!passwordMatched) {
    return { ok: false, error: 'نام کاربری یا رمز عبور اشتباه است.' };
  }

  const safeUser = mapUserRow(row, false);

  if (row.is_2fa) {
    if (!mfaCode || !mfaCode.trim()) {
      return { ok: false, requires2FA: true, user: safeUser };
    }
    if (mfaCode.trim() !== String(row.secret_code || '').trim()) {
      return { ok: false, error: 'کد تایید دو مرحله‌ای وارد شده معتبر نمی‌باشد.' };
    }
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await pool.query(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash, row.id, expiresAt, ipAddress || null, userAgent || null]
  );

  // Clean up old expired sessions opportunistically
  pool.query('DELETE FROM app_sessions WHERE expires_at <= NOW()').catch(() => {});

  await logAuditAction(
    pool,
    row.id,
    row.username,
    'LOGIN',
    null,
    null,
    { role: row.role },
    ipAddress
  );

  return {
    ok: true,
    token: rawToken,
    user: safeUser,
  };
}

export async function getSessionUserFromPg(token: string): Promise<PgUserPublic | null> {
  if (!pool || !token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    `SELECT u.*
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE
     LIMIT 1`,
    [tokenHash]
  );
  if (!rows[0]) return null;
  return mapUserRow(rows[0], false);
}

export async function revokeSessionInPg(token: string): Promise<void> {
  if (!pool || !token) return;
  const tokenHash = hashToken(token);
  await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function getAllUsersAdminFromPg(): Promise<PgUserPublic[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM app_users ORDER BY CASE WHEN username = 'admin' THEN 0 ELSE 1 END, created_at ASC`
  );
  return rows.map((r) => mapUserRow(r, true));
}

export async function createUserAdminInPg(
  actor: AuthUserLike,
  input: {
    id?: string;
    username: string;
    fullName: string;
    role: string;
    permissions: string[];
    password: string;
    is2FA?: boolean;
    secretCode?: string;
    isActive?: boolean;
  },
  ipAddress?: string
): Promise<PgUserPublic> {
  if (!pool) throw new Error('PostgreSQL متصل نیست.');

  const cleanUsername = String(input.username || '').trim();
  if (!cleanUsername) throw new Error('نام کاربری الزامی است.');
  if (!input.password || !input.password.trim()) {
    throw new Error('رمز عبور برای کاربر جدید الزامی است.');
  }

  const id = input.id?.trim() || `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pwHash = await bcrypt.hash(input.password, 10);
  const perms = normalizePermissions(input.permissions);

  const { rows } = await pool.query(
    `INSERT INTO app_users (id, username, full_name, role, permissions, password_hash, is_2fa, secret_code, is_active)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      cleanUsername,
      input.fullName.trim() || cleanUsername,
      input.role || 'کاربر انبار',
      JSON.stringify(perms),
      pwHash,
      Boolean(input.is2FA),
      String(input.secretCode || '123456'),
      input.isActive !== false,
    ]
  );

  await logAuditAction(
    pool,
    actor.id || null,
    actor.username || 'admin',
    'USER_CREATE',
    'users',
    1,
    { targetUsername: cleanUsername, role: input.role, permissions: perms },
    ipAddress
  );

  return mapUserRow(rows[0], true);
}

export async function updateUserAdminInPg(
  actor: AuthUserLike,
  userId: string,
  input: {
    username?: string;
    fullName?: string;
    role?: string;
    permissions?: string[];
    password?: string;
    is2FA?: boolean;
    secretCode?: string;
    isActive?: boolean;
  },
  ipAddress?: string
): Promise<PgUserPublic> {
  if (!pool) throw new Error('PostgreSQL متصل نیست.');

  const existingRes = await pool.query('SELECT * FROM app_users WHERE id = $1 LIMIT 1', [userId]);
  const existing = existingRes.rows[0];
  if (!existing) throw new Error('کاربر مورد نظر یافت نشد.');

  const nextUsername = input.username !== undefined ? input.username.trim() : existing.username;
  const nextFullName = input.fullName !== undefined ? input.fullName.trim() : existing.full_name;
  const nextRole = input.role !== undefined ? input.role : existing.role;
  const nextPerms =
    input.permissions !== undefined
      ? normalizePermissions(input.permissions)
      : existing.permissions;
  const nextIs2FA = input.is2FA !== undefined ? Boolean(input.is2FA) : existing.is_2fa;
  const nextSecret = input.secretCode !== undefined ? String(input.secretCode) : existing.secret_code;
  const nextIsActive = input.isActive !== undefined ? Boolean(input.isActive) : existing.is_active;

  let nextPasswordHash = existing.password_hash;
  if (input.password && input.password.trim() !== '') {
    nextPasswordHash = await bcrypt.hash(input.password, 10);
  }

  const { rows } = await pool.query(
    `UPDATE app_users
     SET username = $1,
         full_name = $2,
         role = $3,
         permissions = $4::jsonb,
         password_hash = $5,
         is_2fa = $6,
         secret_code = $7,
         is_active = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      nextUsername,
      nextFullName,
      nextRole,
      JSON.stringify(nextPerms),
      nextPasswordHash,
      nextIs2FA,
      nextSecret,
      nextIsActive,
      userId,
    ]
  );

  // If user deactivated, revoke active sessions
  if (!nextIsActive) {
    await pool.query('DELETE FROM app_sessions WHERE user_id = $1', [userId]);
  }

  await logAuditAction(
    pool,
    actor.id || null,
    actor.username || 'admin',
    'USER_UPDATE',
    'users',
    1,
    { targetUserId: userId, targetUsername: nextUsername, role: nextRole },
    ipAddress
  );

  return mapUserRow(rows[0], true);
}

export async function deleteUserAdminInPg(
  actor: AuthUserLike,
  userId: string,
  ipAddress?: string
): Promise<void> {
  if (!pool) throw new Error('PostgreSQL متصل نیست.');
  if (actor.id === userId) {
    throw new Error('شما نمی‌توانید حساب کاربری فعلی خودتان را حذف کنید.');
  }
  const { rows } = await pool.query('DELETE FROM app_users WHERE id = $1 RETURNING username', [
    userId,
  ]);
  if (!rows[0]) throw new Error('کاربر مورد نظر یافت نشد.');

  await logAuditAction(
    pool,
    actor.id || null,
    actor.username || 'admin',
    'USER_DELETE',
    'users',
    1,
    { targetUsername: rows[0].username },
    ipAddress
  );
}

async function logAuditAction(
  executor: Pool | PoolClient,
  userId: string | null,
  username: string,
  action: string,
  collectionKey: string | null,
  recordCount: number | null,
  details: Record<string, unknown> | null,
  ipAddress?: string
): Promise<void> {
  try {
    await executor.query(
      `INSERT INTO app_audit_logs (user_id, username, action, collection_key, record_count, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        userId,
        username,
        action,
        collectionKey,
        recordCount,
        details ? JSON.stringify(details) : null,
        ipAddress || null,
      ]
    );
  } catch (err) {
    console.warn('[PostgreSQL] Audit log write warning:', err);
  }
}

async function saveCollectionInTx(
  client: PoolClient,
  collectionKey: string,
  value: unknown,
  username: string
): Promise<number> {
  await client.query('DELETE FROM app_collection_chunks WHERE collection_key = $1', [
    collectionKey,
  ]);

  const isArr = Array.isArray(value);
  const itemCount = isArr ? (value as unknown[]).length : value && typeof value === 'object' ? 1 : 0;

  if (isArr && (value as unknown[]).length > CHUNK_SIZE) {
    const arr = value as unknown[];
    const chunkCount = Math.ceil(arr.length / CHUNK_SIZE);
    const stub = { __chunked: true, chunkCount, totalItems: arr.length };

    const { rows } = await client.query<{ version: string }>(
      `INSERT INTO app_collections (collection_key, data, item_count, is_chunked, version, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, TRUE, 1, $4, NOW())
       ON CONFLICT (collection_key) DO UPDATE
       SET data = EXCLUDED.data,
           item_count = EXCLUDED.item_count,
           is_chunked = TRUE,
           version = app_collections.version + 1,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
       RETURNING version::text AS version`,
      [collectionKey, JSON.stringify(stub), arr.length, username]
    );

    for (let c = 0; c < chunkCount; c++) {
      const slice = arr.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      await client.query(
        `INSERT INTO app_collection_chunks (collection_key, chunk_index, data)
         VALUES ($1, $2, $3::jsonb)`,
        [collectionKey, c, JSON.stringify(slice)]
      );
    }

    return Number(rows[0]?.version || 1);
  }

  const serialized = JSON.stringify(value === undefined ? null : value);
  const { rows } = await client.query<{ version: string }>(
    `INSERT INTO app_collections (collection_key, data, item_count, is_chunked, version, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, FALSE, 1, $4, NOW())
     ON CONFLICT (collection_key) DO UPDATE
     SET data = EXCLUDED.data,
         item_count = EXCLUDED.item_count,
         is_chunked = FALSE,
         version = app_collections.version + 1,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
     RETURNING version::text AS version`,
    [collectionKey, serialized, itemCount, username]
  );

  return Number(rows[0]?.version || 1);
}

export async function getCollectionVersionsFromPg(): Promise<Record<string, number>> {
  if (!pool) return {};
  const { rows } = await pool.query<{ collection_key: string; version: string }>(
    'SELECT collection_key, version::text AS version FROM app_collections'
  );
  const versions: Record<string, number> = {};
  for (const r of rows) {
    versions[r.collection_key] = Number(r.version || 1);
  }
  return versions;
}

export async function loadCollectionsFromPg(
  actor: AuthUserLike,
  keys?: string[]
): Promise<{
  collections: Record<string, unknown>;
  versions: Record<string, number>;
  isEmpty: boolean;
}> {
  if (!pool) {
    return { collections: {}, versions: {}, isEmpty: true };
  }

  const filterKeys = Array.isArray(keys) && keys.length > 0 ? keys : null;
  const { rows } = filterKeys
    ? await pool.query(
        'SELECT collection_key, data, is_chunked, version::text AS version FROM app_collections WHERE collection_key = ANY($1)',
        [filterKeys]
      )
    : await pool.query(
        'SELECT collection_key, data, is_chunked, version::text AS version FROM app_collections'
      );

  const collections: Record<string, unknown> = {};
  const versions: Record<string, number> = {};

  for (const row of rows) {
    const key = String(row.collection_key);
    versions[key] = Number(row.version || 1);
    if (row.is_chunked) {
      const { rows: chunkRows } = await pool.query<{ data: unknown[] }>(
        'SELECT data FROM app_collection_chunks WHERE collection_key = $1 ORDER BY chunk_index ASC',
        [key]
      );
      const assembled: unknown[] = [];
      for (const ch of chunkRows) {
        if (Array.isArray(ch.data)) {
          for (let i = 0; i < ch.data.length; i++) {
            assembled.push(ch.data[i]);
          }
        }
      }
      collections[key] = assembled;
    } else {
      collections[key] = row.data;
    }
  }

  // Always inject live sanitized users list from app_users unless restricted subset did not ask for users
  if (!filterKeys || filterKeys.includes('users')) {
    const { rows: userRows } = await pool.query(
      `SELECT * FROM app_users ORDER BY CASE WHEN username = 'admin' THEN 0 ELSE 1 END, created_at ASC`
    );
    const adminView = isAdminUser(actor);
    collections.users = userRows.map((u) => ({
      ...mapUserRow(u, adminView),
      password: '',
    }));
  }

  // Check if app_collections overall is empty
  let isEmpty = rows.length === 0;
  if (filterKeys) {
    const { rows: totalRows } = await pool.query<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM app_collections'
    );
    isEmpty = Number(totalRows[0]?.cnt || 0) === 0;
  }

  return { collections, versions, isEmpty };
}

export async function syncCollectionsDeltaToPg(
  actor: AuthUserLike,
  changes: Record<string, unknown>,
  baseVersions: Record<string, number>,
  ipAddress?: string
): Promise<{
  ok: boolean;
  versions: Record<string, number>;
  conflicts: string[];
  conflictedCollections: Record<string, unknown>;
  error?: string;
  forbiddenKeys?: string[];
}> {
  if (!pool) {
    return {
      ok: false,
      versions: {},
      conflicts: [],
      conflictedCollections: {},
      error: 'پایگاه داده PostgreSQL متصل نیست.',
    };
  }

  const candidateKeys = Object.keys(changes || {}).filter(
    (k) => !CLIENT_ONLY_DB_KEYS.has(k) && k !== 'users'
  );

  if (candidateKeys.length === 0) {
    const versions = await getCollectionVersionsFromPg();
    return { ok: true, versions, conflicts: [], conflictedCollections: {} };
  }

  // RBAC check
  const forbiddenKeys = candidateKeys.filter((k) => !canWriteCollection(actor, k));
  if (forbiddenKeys.length > 0) {
    return {
      ok: false,
      versions: {},
      conflicts: [],
      conflictedCollections: {},
      forbiddenKeys,
      error: `عدم دسترسی برای ویرایش بخش‌های: ${forbiddenKeys.join(', ')}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query<{
      collection_key: string;
      version: string;
    }>(
      'SELECT collection_key, version::text AS version FROM app_collections WHERE collection_key = ANY($1) FOR UPDATE',
      [candidateKeys]
    );

    const serverVersions = new Map<string, number>();
    for (const r of existingRows) {
      serverVersions.set(r.collection_key, Number(r.version || 1));
    }

    const updatedVersions: Record<string, number> = {};
    const conflicts: string[] = [];

    for (const key of candidateKeys) {
      const serverVer = serverVersions.get(key) || 0;
      const clientBaseVer = baseVersions?.[key];

      if (
        typeof clientBaseVer === 'number' &&
        clientBaseVer > 0 &&
        serverVer > clientBaseVer
      ) {
        conflicts.push(key);
        updatedVersions[key] = serverVer;
        continue;
      }

      const val = changes[key];
      const newVer = await saveCollectionInTx(
        client,
        key,
        val,
        actor.username || 'unknown'
      );
      updatedVersions[key] = newVer;

      const count = Array.isArray(val) ? val.length : 1;
      await logAuditAction(
        client,
        actor.id || null,
        actor.username || 'unknown',
        'SYNC',
        key,
        count,
        { newVersion: newVer },
        ipAddress
      );
    }

    await client.query(
      `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
       VALUES ('seed_state', $1::jsonb, NOW())
       ON CONFLICT (meta_key) DO UPDATE
       SET meta_value = EXCLUDED.meta_value, updated_at = NOW()`,
      [JSON.stringify({ initializedByUser: true, updatedAt: new Date().toISOString() })]
    );

    await client.query('COMMIT');

    // Fetch latest data for any conflicted keys so the client can auto-reconcile
    let conflictedCollections: Record<string, unknown> = {};
    if (conflicts.length > 0) {
      const loaded = await loadCollectionsFromPg(actor, conflicts);
      conflictedCollections = loaded.collections;
    }

    const allVersions = await getCollectionVersionsFromPg();
    return {
      ok: conflicts.length === 0,
      versions: { ...allVersions, ...updatedVersions },
      conflicts,
      conflictedCollections,
    };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function importFullDatabaseToPg(
  actor: AuthUserLike,
  fullDb: Record<string, unknown>,
  source: string,
  ipAddress?: string
): Promise<{ versions: Record<string, number>; importedCollections: number }> {
  if (!pool) throw new Error('PostgreSQL متصل نیست.');
  if (!isAdminUser(actor)) {
    throw new Error('فقط مدیر ارشد مجاز به انتقال یا بازیابی کامل پایگاه داده است.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Sync users if included in imported DB (preserving existing hashes if incoming password is empty)
    if (Array.isArray(fullDb.users) && fullDb.users.length > 0) {
      for (const rawUser of fullDb.users as any[]) {
        if (!rawUser || !rawUser.username) continue;
        const uname = String(rawUser.username).trim();
        const uid = String(rawUser.id || `usr-${uname}`);
        const perms = normalizePermissions(
          Array.isArray(rawUser.permissions) ? rawUser.permissions : ['*']
        );
        const existingRes = await client.query<{ password_hash: string }>(
          'SELECT password_hash FROM app_users WHERE username = $1 LIMIT 1',
          [uname]
        );
        let pwHash = existingRes.rows[0]?.password_hash || '';
        const incomingPw = String(rawUser.password || '').trim();
        if (incomingPw !== '') {
          pwHash = isBcryptHash(incomingPw)
            ? incomingPw
            : await bcrypt.hash(incomingPw, 10);
        } else if (!pwHash) {
          pwHash = await bcrypt.hash('123', 10);
        }

        await client.query(
          `INSERT INTO app_users (id, username, full_name, role, permissions, password_hash, is_2fa, secret_code, is_active)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
           ON CONFLICT (username) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               role = EXCLUDED.role,
               permissions = EXCLUDED.permissions,
               password_hash = EXCLUDED.password_hash,
               is_2fa = EXCLUDED.is_2fa,
               secret_code = EXCLUDED.secret_code,
               is_active = EXCLUDED.is_active,
               updated_at = NOW()`,
          [
            uid,
            uname,
            String(rawUser.fullName || rawUser.name || uname),
            String(rawUser.role || 'کاربر انبار'),
            JSON.stringify(perms),
            pwHash,
            Boolean(rawUser.is2FA),
            String(rawUser.secretCode || '123456'),
            rawUser.isActive !== false,
          ]
        );
      }
    }

    const keys = Object.keys(fullDb).filter(
      (k) => !CLIENT_ONLY_DB_KEYS.has(k) && k !== 'users' && fullDb[k] !== undefined
    );

    const versions: Record<string, number> = {};
    for (const key of keys) {
      versions[key] = await saveCollectionInTx(
        client,
        key,
        fullDb[key],
        actor.username || 'admin'
      );
    }

    await client.query(
      `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
       VALUES ('seed_state', $1::jsonb, NOW())
       ON CONFLICT (meta_key) DO UPDATE
       SET meta_value = EXCLUDED.meta_value, updated_at = NOW()`,
      [
        JSON.stringify({
          initializedByUser: true,
          source,
          updatedAt: new Date().toISOString(),
        }),
      ]
    );

    await logAuditAction(
      client,
      actor.id || null,
      actor.username || 'admin',
      'IMPORT',
      '*',
      keys.length,
      { source },
      ipAddress
    );

    await client.query('COMMIT');
    return { versions, importedCollections: keys.length };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getAuditLogsFromPg(limit = 100): Promise<AuditLogEntry[]> {
  if (!pool) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const { rows } = await pool.query(
    `SELECT id, user_id, username, action, collection_key, record_count, details, ip_address, created_at
     FROM app_audit_logs
     ORDER BY id DESC
     LIMIT $1`,
    [safeLimit]
  );

  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id ? String(r.user_id) : null,
    username: String(r.username),
    action: String(r.action),
    collectionKey: r.collection_key ? String(r.collection_key) : null,
    recordCount: r.record_count !== null ? Number(r.record_count) : null,
    details: r.details || null,
    ipAddress: r.ip_address ? String(r.ip_address) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}
