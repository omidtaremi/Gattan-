/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import path from 'node:path';
import zlib from 'node:zlib';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import {
  initPostgres,
  isPostgresModeActive,
  getPostgresStatus,
  getPublicUsersFromPg,
  authenticateUserInPg,
  getSessionUserFromPg,
  revokeSessionInPg,
  getAllUsersAdminFromPg,
  createUserAdminInPg,
  updateUserAdminInPg,
  deleteUserAdminInPg,
  getRolesAdminFromPg,
  createRoleAdminInPg,
  updateRoleAdminInPg,
  deleteRoleAdminInPg,
  getCollectionVersionsFromPg,
  loadCollectionsFromPg,
  exportFullDatabaseFromPg,
  syncCollectionsDeltaToPg,
  importFullDatabaseToPg,
  stageImportChunksInPg,
  commitStagedImportInPg,
  getAuditLogsFromPg,
  getPublicDigitalMenuFromPg,
  getDigitalMenuConfigAdminFromPg,
  saveDigitalMenuConfigInPg,
  type PgUserPublic,
} from './src/server/pgDb.ts';
import { canAccessTab, isAdminUser } from './src/shared/rbac.ts';

interface AuthenticatedRequest extends Request {
  authUser?: PgUserPublic;
  authToken?: string;
}

function extractToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k === 'gatan_token') {
          return decodeURIComponent(v);
        }
      }
    }
  }
  return '';
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isPostgresModeActive()) {
    res.status(503).json({
      ok: false,
      error: 'PostgreSQL در سرور پیکربندی یا متصل نشده است.',
    });
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'نیاز به ورود به سامانه دارید.' });
    return;
  }

  try {
    const user = await getSessionUserFromPg(token);
    if (!user) {
      res.status(401).json({ ok: false, error: 'نشست کاربری منقضی یا نامعتبر است.' });
      return;
    }
    req.authUser = user;
    req.authToken = token;
    next();
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در بررسی نشست کاربری' });
  }
}

function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser || !isAdminUser(req.authUser)) {
    res.status(403).json({
      ok: false,
      error: 'این عملیات فقط برای مدیر ارشد سامانه مجاز است.',
    });
    return;
  }
  next();
}

function requireDigitalMenuAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser || !canAccessTab(req.authUser, 'digital_menu')) {
    res.status(403).json({
      ok: false,
      error: 'شما مجوز مدیریت منوی دیجیتال کافه را ندارید.',
    });
    return;
  }
  next();
}

async function startServer() {
  await initPostgres();

  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(cors());

  // Safe streaming gzip JSON request decompression (with strict compressed & decompressed size bounds)
  const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
  const MAX_DECOMPRESSED_BYTES = 150 * 1024 * 1024;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const encoding = String(req.headers['content-encoding'] || '').trim().toLowerCase();
    if (encoding !== 'gzip') {
      next();
      return;
    }

    const declaredLen = Number(req.headers['content-length'] || 0);
    if (declaredLen > MAX_COMPRESSED_BYTES) {
      res.status(413).json({ ok: false, error: 'حجم بسته فشرده ارسالی بیش از حد مجاز است.' });
      return;
    }

    let compressedBytes = 0;
    let decompressedBytes = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const gunzip = zlib.createGunzip();

    const fail = (status: number, message: string) => {
      if (settled) return;
      settled = true;
      req.unpipe(gunzip);
      gunzip.destroy();
      res.status(status).json({ ok: false, error: message });
    };

    req.on('data', (chunk: Buffer) => {
      compressedBytes += chunk.length;
      if (compressedBytes > MAX_COMPRESSED_BYTES) {
        fail(413, 'حجم بسته فشرده ارسالی بیش از حد مجاز است.');
      }
    });

    req.on('error', () => fail(400, 'خطا در دریافت بدنه درخواست.'));

    gunzip.on('data', (chunk: Buffer) => {
      decompressedBytes += chunk.length;
      if (decompressedBytes > MAX_DECOMPRESSED_BYTES) {
        fail(413, 'حجم داده پس از بازگشایی بیش از حد مجاز است.');
        return;
      }
      chunks.push(chunk);
    });

    gunzip.on('error', () => fail(400, 'بسته فشرده ارسالی نامعتبر است.'));

    gunzip.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const rawText = Buffer.concat(chunks).toString('utf8');
        req.body = rawText.trim() ? JSON.parse(rawText) : {};
        (req as any)._body = true;
        delete req.headers['content-encoding'];
        next();
      } catch {
        res.status(400).json({ ok: false, error: 'ساختار JSON ارسالی نامعتبر است.' });
      }
    });

    req.pipe(gunzip);
  });

  app.use(express.json({ limit: '150mb' }));

  // 1. Health & Database Status
  app.get('/api/health', async (_req: Request, res: Response) => {
    const status = await getPostgresStatus();
    res.json({
      ok: true,
      mode: status.mode,
      connected: status.connected,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/db/status', async (_req: Request, res: Response) => {
    try {
      const status = await getPostgresStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({
        mode: 'local',
        configured: false,
        connected: false,
        error: err?.message || 'Status error',
      });
    }
  });

  // 1b. Strictly Read-Only Public Digital Menu API (Zero Auth Required, Sanitized Projection Only)
  app.get('/api/public/menu', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
    if (!isPostgresModeActive()) {
      res.json({ ok: true, mode: 'local', menu: null });
      return;
    }
    try {
      const menu = await getPublicDigitalMenuFromPg();
      res.json({ ok: true, mode: 'postgres', menu });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در بارگذاری منوی دیجیتال' });
    }
  });

  app.get('/api/public/menu/products/:productId', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
    if (!isPostgresModeActive()) {
      res.json({ ok: true, mode: 'local', product: null });
      return;
    }
    try {
      const productId = String(req.params.productId || '').trim();
      if (!productId || productId.length > 120) {
        res.status(400).json({ ok: false, error: 'شناسه محصول نامعتبر است.' });
        return;
      }
      const menu = await getPublicDigitalMenuFromPg();
      if (!menu.enabled) {
        res.status(404).json({ ok: false, error: 'منوی دیجیتال در حال حاضر غیرفعال است.' });
        return;
      }
      const product = menu.products.find((p) => p.id === productId);
      if (!product) {
        res.status(404).json({ ok: false, error: 'محصول مورد نظر در منو یافت نشد.' });
        return;
      }
      res.json({ ok: true, mode: 'postgres', product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت جزئیات محصول' });
    }
  });

  // 2. Authentication Routes
  app.get('/api/auth/public-users', async (_req: Request, res: Response) => {
    if (!isPostgresModeActive()) {
      res.json({ ok: true, users: [] });
      return;
    }
    try {
      const users = await getPublicUsersFromPg();
      res.json({ ok: true, users });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت لیست کاربران' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    if (!isPostgresModeActive()) {
      res.status(503).json({
        ok: false,
        error: 'پایگاه داده PostgreSQL متصل نیست.',
      });
      return;
    }
    try {
      const { username, password, mfaCode } = req.body || {};
      const result = await authenticateUserInPg(
        String(username || ''),
        String(password || ''),
        mfaCode !== undefined ? String(mfaCode) : undefined,
        getClientIp(req),
        req.headers['user-agent']
      );

      if (!result.ok) {
        if (result.requires2FA) {
          res.status(200).json({
            ok: false,
            requires2FA: true,
            user: result.user,
          });
          return;
        }
        res.status(401).json({ ok: false, error: result.error || 'اطلاعات ورود اشتباه است.' });
        return;
      }

      if (result.token) {
        res.cookie('gatan_token', result.token, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 7 * 24 * 3600 * 1000,
          path: '/',
        });
      }

      res.json({
        ok: true,
        token: result.token,
        user: result.user,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در ورود به سامانه' });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (token && isPostgresModeActive()) {
      await revokeSessionInPg(token).catch(() => {});
    }
    res.clearCookie('gatan_token', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ ok: true, user: req.authUser });
  });

  // 3. Admin User Management Routes (RBAC)
  app.get('/api/users', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const users = await getAllUsersAdminFromPg();
      res.json({ ok: true, users });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت کاربران' });
    }
  });

  app.post('/api/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const created = await createUserAdminInPg(
        req.authUser!,
        req.body || {},
        getClientIp(req)
      );
      res.status(201).json({ ok: true, user: created });
    } catch (err: any) {
      const msg = err?.code === '23505' ? 'این نام کاربری قبلاً ثبت شده است.' : (err?.message || 'خطا در ایجاد کاربر');
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.put('/api/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updated = await updateUserAdminInPg(
        req.authUser!,
        String(req.params.id),
        req.body || {},
        getClientIp(req)
      );
      res.json({ ok: true, user: updated });
    } catch (err: any) {
      const msg = err?.code === '23505' ? 'این نام کاربری تکراری است.' : (err?.message || 'خطا در ویرایش کاربر');
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.delete('/api/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await deleteUserAdminInPg(
        req.authUser!,
        String(req.params.id),
        getClientIp(req)
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در حذف کاربر' });
    }
  });

  // 3b. Admin Role Definition Management Routes (RBAC)
  app.get('/api/roles', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const roles = await getRolesAdminFromPg();
      res.json({ ok: true, roles });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت نقش‌های کاربری' });
    }
  });

  app.post('/api/roles', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const created = await createRoleAdminInPg(
        req.authUser!,
        req.body || {},
        getClientIp(req)
      );
      res.status(201).json({ ok: true, role: created });
    } catch (err: any) {
      const msg = err?.code === '23505' ? 'نقشی با این نام قبلاً تعریف شده است.' : (err?.message || 'خطا در تعریف نقش جدید');
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.put('/api/roles/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updated = await updateRoleAdminInPg(
        req.authUser!,
        String(req.params.id),
        req.body || {},
        getClientIp(req)
      );
      res.json({ ok: true, role: updated });
    } catch (err: any) {
      const msg = err?.code === '23505' ? 'نام نقش وارد شده تکراری است.' : (err?.message || 'خطا در ویرایش نقش کاربری');
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.delete('/api/roles/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await deleteRoleAdminInPg(
        req.authUser!,
        String(req.params.id),
        getClientIp(req)
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در حذف نقش کاربری' });
    }
  });

  // 4. Shared Database Read / Delta Sync / Import Routes
  app.get('/api/db', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const keysParam = typeof req.query.keys === 'string' ? req.query.keys : '';
      const keys = keysParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const data = await loadCollectionsFromPg(req.authUser!, keys.length > 0 ? keys : undefined);
      res.json({ ok: true, ...data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در خواندن پایگاه داده' });
    }
  });

  app.get('/api/db/backup', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const backup = await exportFullDatabaseFromPg(req.authUser!, getClientIp(req));
      res.json({ ok: true, mode: 'postgres', ...backup });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در تهیه نسخه پشتیبان کامل از PostgreSQL' });
    }
  });

  app.get('/api/db/versions', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const versions = await getCollectionVersionsFromPg();
      res.json({ ok: true, versions });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در بررسی نسخه‌ها' });
    }
  });

  app.post('/api/db/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { changes, recordPatches, baseVersions } = req.body || {};
      const result = await syncCollectionsDeltaToPg(
        req.authUser!,
        changes && typeof changes === 'object' ? changes : {},
        baseVersions && typeof baseVersions === 'object' ? baseVersions : {},
        getClientIp(req),
        recordPatches && typeof recordPatches === 'object' ? recordPatches : undefined
      );
      if (result.forbiddenKeys && result.forbiddenKeys.length > 0) {
        res.status(403).json(result);
        return;
      }
      if (result.conflicts.length > 0) {
        res.status(409).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در همگام‌سازی داده‌ها' });
    }
  });

  app.post('/api/db/import', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { database, source } = req.body || {};
      if (!database || typeof database !== 'object') {
        res.status(400).json({ ok: false, error: 'ساختار پایگاه داده نامعتبر است.' });
        return;
      }
      const result = await importFullDatabaseToPg(
        req.authUser!,
        database as Record<string, unknown>,
        String(source || 'manual_import'),
        getClientIp(req)
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در انتقال پایگاه داده' });
    }
  });

  app.post('/api/db/import/stage', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { importId, chunks } = req.body || {};
      const result = await stageImportChunksInPg(
        req.authUser!,
        String(importId || ''),
        Array.isArray(chunks) ? chunks : []
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در ارسال بسته داده به صف PostgreSQL' });
    }
  });

  app.post('/api/db/import/commit', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { importId, source, users, roles } = req.body || {};
      const result = await commitStagedImportInPg(
        req.authUser!,
        String(importId || ''),
        String(source || 'chunked_import'),
        users,
        getClientIp(req),
        roles
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در نهایی‌سازی ذخیره داده‌ها در PostgreSQL' });
    }
  });

  app.get('/api/audit-logs', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = Number(req.query.limit || 100);
      const logs = await getAuditLogsFromPg(limit);
      res.json({ ok: true, logs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت گزارش وقایع' });
    }
  });

  // 4b. ERP Admin Digital Menu Configuration Routes (RBAC-Protected)
  app.get('/api/digital-menu/config', requireAuth, requireDigitalMenuAccess, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await getDigitalMenuConfigAdminFromPg();
      res.json({ ok: true, ...data });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطا در دریافت تنظیمات منوی دیجیتال' });
    }
  });

  app.put('/api/digital-menu/config', requireAuth, requireDigitalMenuAccess, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const payload = req.body?.config !== undefined ? req.body.config : req.body;
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ ok: false, error: 'ساختار تنظیمات منوی دیجیتال نامعتبر است.' });
        return;
      }
      const saved = await saveDigitalMenuConfigInPg(req.authUser!, payload, getClientIp(req));
      res.json({ ok: true, ...saved });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در ذخیره تنظیمات منوی دیجیتال' });
    }
  });

  // Unknown API endpoints return JSON 404
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'مسیر API یافت نشد.' });
  });

  // 5. Vite Middleware (Dev) or Static Dist (Production)
  const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Server] Gatan System running on http://0.0.0.0:${port} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
