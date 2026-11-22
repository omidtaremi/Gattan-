/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { getPgPool, isPostgresModeActive } from './pgDb.ts';

export type PrintJobType = 'customer_receipt' | 'workshop_ticket' | 'test_print';
export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed' | 'cancelled';

export interface PrintJobRecord {
  id: string;
  stationId: string;
  jobType: PrintJobType;
  title: string;
  orderId?: string;
  orderNumber?: string;
  departmentName?: string;
  paperWidthMm: number;
  copies: number;
  htmlContent?: string;
  status: PrintJobStatus;
  attempts: number;
  errorMessage?: string;
  requestedBy: string;
  createdAt: string;
  claimedAt?: string;
  printedAt?: string;
}

export interface PrintStationStatus {
  stationId: string;
  stationName: string;
  hasKeyConfigured: boolean;
  keySource: 'env' | 'database' | 'none';
  keyUpdatedAt?: string;
  online: boolean;
  lastHeartbeatAt?: string;
  hostname?: string;
  printerName?: string;
  availablePrinters: string[];
  agentVersion?: string;
  pendingCount: number;
  printingCount: number;
  printedTodayCount: number;
  failedCount: number;
}

interface StoredAgentMeta {
  stationId: string;
  stationName: string;
  keyHash?: string;
  keyUpdatedAt?: string;
  lastHeartbeatAt?: string;
  hostname?: string;
  printerName?: string;
  availablePrinters?: string[];
  agentVersion?: string;
  lastIp?: string;
}

const META_KEY = 'print_agent_config';
const DEFAULT_STATION_ID = 'cashier-main';
const DEFAULT_STATION_NAME = 'صندوق فروشگاه (Sewoo 100)';
const ONLINE_WINDOW_MS = 20_000;
const STALE_PRINTING_TIMEOUT_MS = 90_000;
const MAX_HTML_BYTES = 300_000;
const MAX_IN_MEMORY_JOBS = 200;

// In-memory fallback store (used only when PostgreSQL is not configured, e.g., local preview mode)
let memMeta: StoredAgentMeta = {
  stationId: DEFAULT_STATION_ID,
  stationName: DEFAULT_STATION_NAME,
  availablePrinters: [],
};
let memJobs: PrintJobRecord[] = [];
let pgTableEnsured = false;

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function ensurePrintJobsTableInPg(): Promise<void> {
  if (pgTableEnsured) return;
  const pgPool = getPgPool();
  if (!pgPool) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_print_jobs (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL DEFAULT 'cashier-main',
      job_type TEXT NOT NULL,
      title TEXT NOT NULL,
      order_id TEXT,
      order_number TEXT,
      department_name TEXT,
      paper_width_mm INTEGER NOT NULL DEFAULT 72,
      copies INTEGER NOT NULL DEFAULT 1,
      html_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      requested_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      printed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_app_print_jobs_station_status
      ON app_print_jobs (station_id, status, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_app_print_jobs_created_at
      ON app_print_jobs (created_at DESC);
  `);
  pgTableEnsured = true;
}

async function readAgentMeta(): Promise<StoredAgentMeta> {
  const pgPool = getPgPool();
  if (!pgPool) {
    return { ...memMeta };
  }
  await ensurePrintJobsTableInPg();
  const { rows } = await pgPool.query<{ meta_value: StoredAgentMeta }>(
    'SELECT meta_value FROM app_metadata WHERE meta_key = $1',
    [META_KEY]
  );
  if (rows.length === 0 || !rows[0].meta_value) {
    return {
      stationId: DEFAULT_STATION_ID,
      stationName: DEFAULT_STATION_NAME,
      availablePrinters: [],
    };
  }
  return {
    stationId: DEFAULT_STATION_ID,
    stationName: DEFAULT_STATION_NAME,
    availablePrinters: [],
    ...rows[0].meta_value,
  };
}

async function writeAgentMeta(meta: StoredAgentMeta): Promise<void> {
  const pgPool = getPgPool();
  if (!pgPool) {
    memMeta = { ...meta };
    return;
  }
  await ensurePrintJobsTableInPg();
  await pgPool.query(
    `INSERT INTO app_metadata (meta_key, meta_value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (meta_key)
     DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = NOW()`,
    [META_KEY, JSON.stringify(meta)]
  );
}

function getEnvPrintAgentKey(): string {
  const raw = (process.env.PRINT_AGENT_KEY || '').trim();
  if (!raw || raw.includes('CHANGE_ME_')) return '';
  return raw;
}

export async function verifyPrintAgentKey(providedKey: string): Promise<boolean> {
  const trimmed = (providedKey || '').trim();
  if (!trimmed || trimmed.length < 16 || trimmed.length > 256) return false;

  const providedHash = sha256Hex(trimmed);
  const envKey = getEnvPrintAgentKey();
  if (envKey) {
    return timingSafeHexEqual(providedHash, sha256Hex(envKey));
  }

  const meta = await readAgentMeta();
  if (!meta.keyHash) return false;
  return timingSafeHexEqual(providedHash, meta.keyHash);
}

export async function rotatePrintAgentKey(
  stationName?: string
): Promise<{ apiKey: string; status: PrintStationStatus }> {
  const newKey = `gatan_prt_${crypto.randomBytes(24).toString('hex')}`;
  const current = await readAgentMeta();
  const updated: StoredAgentMeta = {
    ...current,
    stationId: DEFAULT_STATION_ID,
    stationName: (stationName || current.stationName || DEFAULT_STATION_NAME).trim().slice(0, 80),
    keyHash: sha256Hex(newKey),
    keyUpdatedAt: new Date().toISOString(),
  };
  await writeAgentMeta(updated);
  const status = await getPrintStationStatus();
  return { apiKey: newKey, status };
}

export async function recordAgentHeartbeat(input: {
  hostname?: string;
  printerName?: string;
  availablePrinters?: string[];
  agentVersion?: string;
  ipAddress?: string;
}): Promise<PrintStationStatus> {
  const current = await readAgentMeta();
  const sanitizedPrinters = Array.isArray(input.availablePrinters)
    ? input.availablePrinters
        .map((p) => String(p || '').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 30)
    : current.availablePrinters || [];

  const updated: StoredAgentMeta = {
    ...current,
    lastHeartbeatAt: new Date().toISOString(),
    hostname: input.hostname ? String(input.hostname).trim().slice(0, 100) : current.hostname,
    printerName: input.printerName ? String(input.printerName).trim().slice(0, 120) : current.printerName,
    availablePrinters: sanitizedPrinters,
    agentVersion: input.agentVersion ? String(input.agentVersion).trim().slice(0, 32) : current.agentVersion,
    lastIp: input.ipAddress ? String(input.ipAddress).trim().slice(0, 64) : current.lastIp,
  };
  await writeAgentMeta(updated);
  return getPrintStationStatus();
}

function mapPgJobRow(row: any, includeHtml: boolean): PrintJobRecord {
  const rec: PrintJobRecord = {
    id: String(row.id),
    stationId: String(row.station_id || DEFAULT_STATION_ID),
    jobType: row.job_type as PrintJobType,
    title: String(row.title || ''),
    orderId: row.order_id ? String(row.order_id) : undefined,
    orderNumber: row.order_number ? String(row.order_number) : undefined,
    departmentName: row.department_name ? String(row.department_name) : undefined,
    paperWidthMm: Number(row.paper_width_mm || 72),
    copies: Number(row.copies || 1),
    status: row.status as PrintJobStatus,
    attempts: Number(row.attempts || 0),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    requestedBy: String(row.requested_by || ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    claimedAt: row.claimed_at
      ? row.claimed_at instanceof Date
        ? row.claimed_at.toISOString()
        : String(row.claimed_at)
      : undefined,
    printedAt: row.printed_at
      ? row.printed_at instanceof Date
        ? row.printed_at.toISOString()
        : String(row.printed_at)
      : undefined,
  };
  if (includeHtml) {
    rec.htmlContent = String(row.html_content || '');
  }
  return rec;
}

export async function getPrintStationStatus(): Promise<PrintStationStatus> {
  const meta = await readAgentMeta();
  const envKey = getEnvPrintAgentKey();
  const keySource: 'env' | 'database' | 'none' = envKey
    ? 'env'
    : meta.keyHash
    ? 'database'
    : 'none';

  const lastHbMs = meta.lastHeartbeatAt ? Date.parse(meta.lastHeartbeatAt) : 0;
  const online = Boolean(lastHbMs && Date.now() - lastHbMs <= ONLINE_WINDOW_MS);

  let pendingCount = 0;
  let printingCount = 0;
  let printedTodayCount = 0;
  let failedCount = 0;

  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rows } = await pgPool.query<{
      pending_cnt: string;
      printing_cnt: string;
      printed_today_cnt: string;
      failed_cnt: string;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_cnt,
        COUNT(*) FILTER (WHERE status = 'printing')::text AS printing_cnt,
        COUNT(*) FILTER (WHERE status = 'printed' AND printed_at >= NOW() - INTERVAL '24 hours')::text AS printed_today_cnt,
        COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_cnt
       FROM app_print_jobs
       WHERE station_id = $1`,
      [DEFAULT_STATION_ID]
    );
    if (rows[0]) {
      pendingCount = Number(rows[0].pending_cnt || 0);
      printingCount = Number(rows[0].printing_cnt || 0);
      printedTodayCount = Number(rows[0].printed_today_cnt || 0);
      failedCount = Number(rows[0].failed_cnt || 0);
    }
  } else {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const j of memJobs) {
      if (j.status === 'pending') pendingCount++;
      else if (j.status === 'printing') printingCount++;
      else if (j.status === 'failed') failedCount++;
      else if (j.status === 'printed' && j.printedAt && Date.parse(j.printedAt) >= dayAgo) {
        printedTodayCount++;
      }
    }
  }

  return {
    stationId: meta.stationId || DEFAULT_STATION_ID,
    stationName: meta.stationName || DEFAULT_STATION_NAME,
    hasKeyConfigured: keySource !== 'none',
    keySource,
    keyUpdatedAt: meta.keyUpdatedAt,
    online,
    lastHeartbeatAt: meta.lastHeartbeatAt,
    hostname: meta.hostname,
    printerName: meta.printerName,
    availablePrinters: meta.availablePrinters || [],
    agentVersion: meta.agentVersion,
    pendingCount,
    printingCount,
    printedTodayCount,
    failedCount,
  };
}

function sanitizePrintHtml(rawHtml: string): string {
  let clean = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
  if (!/Content-Security-Policy/i.test(clean) && /<head[^>]*>/i.test(clean)) {
    clean = clean.replace(
      /<head([^>]*)>/i,
      '<head$1><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:;">'
    );
  }
  return clean;
}

export async function enqueuePrintJob(input: {
  jobType: string;
  title: string;
  orderId?: string;
  orderNumber?: string;
  departmentName?: string;
  paperWidthMm?: number;
  copies?: number;
  htmlContent: string;
  requestedBy: string;
}): Promise<PrintJobRecord> {
  const allowedTypes: PrintJobType[] = ['customer_receipt', 'workshop_ticket', 'test_print'];
  const jobType: PrintJobType = allowedTypes.includes(input.jobType as PrintJobType)
    ? (input.jobType as PrintJobType)
    : 'customer_receipt';

  const title = String(input.title || 'فیش چاپی').trim().slice(0, 140);
  const rawHtml = String(input.htmlContent || '').trim();
  if (!rawHtml) {
    throw new Error('محتوای چاپی خالی است.');
  }
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('حجم محتوای فیش بیش از حد مجاز است.');
  }
  const htmlContent = sanitizePrintHtml(rawHtml);

  const paperWidthMm = [58, 72, 80].includes(Number(input.paperWidthMm))
    ? Number(input.paperWidthMm) === 80
      ? 72
      : Number(input.paperWidthMm)
    : 72;
  const copies = Math.min(5, Math.max(1, Math.floor(Number(input.copies || 1))));
  const id = `prt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();

  const orderId = input.orderId ? String(input.orderId).trim().slice(0, 120) : undefined;
  const orderNumber = input.orderNumber ? String(input.orderNumber).trim().slice(0, 60) : undefined;
  const departmentName = input.departmentName
    ? String(input.departmentName).trim().slice(0, 80)
    : undefined;
  const requestedBy = String(input.requestedBy || 'کاربر سامانه').trim().slice(0, 100);

  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rows } = await pgPool.query(
      `INSERT INTO app_print_jobs
        (id, station_id, job_type, title, order_id, order_number, department_name, paper_width_mm, copies, html_content, status, attempts, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', 0, $11)
       RETURNING *`,
      [
        id,
        DEFAULT_STATION_ID,
        jobType,
        title,
        orderId || null,
        orderNumber || null,
        departmentName || null,
        paperWidthMm,
        copies,
        htmlContent,
        requestedBy,
      ]
    );
    return mapPgJobRow(rows[0], false);
  }

  const job: PrintJobRecord = {
    id,
    stationId: DEFAULT_STATION_ID,
    jobType,
    title,
    orderId,
    orderNumber,
    departmentName,
    paperWidthMm,
    copies,
    htmlContent,
    status: 'pending',
    attempts: 0,
    requestedBy,
    createdAt,
  };
  memJobs.unshift(job);
  if (memJobs.length > MAX_IN_MEMORY_JOBS) {
    memJobs = memJobs.slice(0, MAX_IN_MEMORY_JOBS);
  }
  const { htmlContent: _omit, ...summary } = job;
  return summary;
}

export async function listPrintJobs(limit = 50): Promise<PrintJobRecord[]> {
  const safeLimit = Math.min(150, Math.max(1, Math.floor(Number(limit) || 50)));
  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rows } = await pgPool.query(
      `SELECT id, station_id, job_type, title, order_id, order_number, department_name,
              paper_width_mm, copies, status, attempts, error_message, requested_by,
              created_at, claimed_at, printed_at
       FROM app_print_jobs
       WHERE station_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [DEFAULT_STATION_ID, safeLimit]
    );
    return rows.map((r) => mapPgJobRow(r, false));
  }

  return memJobs.slice(0, safeLimit).map(({ htmlContent: _omit, ...rest }) => rest);
}

export async function claimNextPrintJob(stationId = DEFAULT_STATION_ID): Promise<PrintJobRecord | null> {
  const safeStation = String(stationId || DEFAULT_STATION_ID).trim().slice(0, 64) || DEFAULT_STATION_ID;
  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    // Recover any stale printing jobs (e.g., POS rebooted mid-print)
    await pgPool.query(
      `UPDATE app_print_jobs
       SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
           error_message = CASE WHEN attempts >= 3 THEN 'پاسخی از چاپگر دریافت نشد (توقف بیش از ۹۰ ثانیه)' ELSE error_message END
       WHERE station_id = $1
         AND status = 'printing'
         AND claimed_at < NOW() - INTERVAL '90 seconds'`,
      [safeStation]
    );

    const { rows } = await pgPool.query(
      `WITH next_job AS (
         SELECT id
         FROM app_print_jobs
         WHERE station_id = $1 AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE app_print_jobs j
       SET status = 'printing',
           attempts = j.attempts + 1,
           claimed_at = NOW(),
           error_message = NULL
       FROM next_job
       WHERE j.id = next_job.id
       RETURNING j.*`,
      [safeStation]
    );
    if (rows.length === 0) return null;
    return mapPgJobRow(rows[0], true);
  }

  // In-memory recovery + FIFO claim
  const now = Date.now();
  for (const j of memJobs) {
    if (
      j.stationId === safeStation &&
      j.status === 'printing' &&
      j.claimedAt &&
      now - Date.parse(j.claimedAt) > STALE_PRINTING_TIMEOUT_MS
    ) {
      if (j.attempts >= 3) {
        j.status = 'failed';
        j.errorMessage = 'پاسخی از چاپگر دریافت نشد (توقف بیش از ۹۰ ثانیه)';
      } else {
        j.status = 'pending';
      }
    }
  }

  const pendingAsc = memJobs
    .filter((j) => j.stationId === safeStation && j.status === 'pending')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  if (pendingAsc.length === 0) return null;
  const next = pendingAsc[0];
  next.status = 'printing';
  next.attempts += 1;
  next.claimedAt = new Date().toISOString();
  next.errorMessage = undefined;
  return { ...next };
}

export async function completePrintJob(
  jobId: string,
  result: { ok: boolean; errorMessage?: string }
): Promise<PrintJobRecord | null> {
  const safeId = String(jobId || '').trim().slice(0, 100);
  if (!safeId) return null;
  const nextStatus: PrintJobStatus = result.ok ? 'printed' : 'failed';
  const errMsg = result.ok
    ? null
    : String(result.errorMessage || 'خطای نامشخص در چاپگر صندوق').trim().slice(0, 400);

  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rows } = await pgPool.query(
      `UPDATE app_print_jobs
       SET status = $2,
           error_message = $3,
           printed_at = CASE WHEN $2 = 'printed' THEN NOW() ELSE printed_at END
       WHERE id = $1
       RETURNING *`,
      [safeId, nextStatus, errMsg]
    );
    if (rows.length === 0) return null;
    return mapPgJobRow(rows[0], false);
  }

  const found = memJobs.find((j) => j.id === safeId);
  if (!found) return null;
  found.status = nextStatus;
  found.errorMessage = errMsg || undefined;
  if (result.ok) {
    found.printedAt = new Date().toISOString();
  }
  const { htmlContent: _omit, ...summary } = found;
  return summary;
}

export async function retryPrintJob(jobId: string): Promise<PrintJobRecord | null> {
  const safeId = String(jobId || '').trim().slice(0, 100);
  if (!safeId) return null;

  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rows } = await pgPool.query(
      `UPDATE app_print_jobs
       SET status = 'pending',
           attempts = 0,
           error_message = NULL,
           claimed_at = NULL
       WHERE id = $1
       RETURNING *`,
      [safeId]
    );
    if (rows.length === 0) return null;
    return mapPgJobRow(rows[0], false);
  }

  const found = memJobs.find((j) => j.id === safeId);
  if (!found) return null;
  found.status = 'pending';
  found.attempts = 0;
  found.errorMessage = undefined;
  found.claimedAt = undefined;
  const { htmlContent: _omit, ...summary } = found;
  return summary;
}

export async function cancelPrintJob(jobId: string): Promise<boolean> {
  const safeId = String(jobId || '').trim().slice(0, 100);
  if (!safeId) return false;

  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rowCount } = await pgPool.query('DELETE FROM app_print_jobs WHERE id = $1', [safeId]);
    return Number(rowCount || 0) > 0;
  }

  const before = memJobs.length;
  memJobs = memJobs.filter((j) => j.id !== safeId);
  return memJobs.length < before;
}

export async function clearFinishedPrintJobs(): Promise<number> {
  const pgPool = getPgPool();
  if (pgPool) {
    await ensurePrintJobsTableInPg();
    const { rowCount } = await pgPool.query(
      `DELETE FROM app_print_jobs
       WHERE station_id = $1 AND status IN ('printed', 'cancelled', 'failed')`,
      [DEFAULT_STATION_ID]
    );
    return Number(rowCount || 0);
  }

  const before = memJobs.length;
  memJobs = memJobs.filter((j) => j.status === 'pending' || j.status === 'printing');
  return before - memJobs.length;
}

export function buildTestPrintHtml(): string {
  const nowFa = new Date().toLocaleString('fa-IR');
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<title>تست چاپگر صندوق گاتان</title>
<style>
  @page { size: 72mm auto; margin: 0mm !important; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body {
    margin: 0; padding: 0;
    width: 72mm; max-width: 72mm;
    background: #ffffff; color: #000000;
    font-family: Tahoma, 'Vazirmatn', Arial, sans-serif;
    direction: rtl; text-align: right; font-size: 11px; line-height: 1.5;
  }
  .sheet { width: 68mm; margin: 0 auto; padding: 3mm 0.5mm 4mm 0.5mm; }
  .bar { background: #000; color: #fff; text-align: center; font-weight: 900; padding: 5px; border-radius: 3px; font-size: 12px; }
  .box { border: 2px solid #000; border-radius: 4px; padding: 6px; margin-top: 7px; }
  .kv { display: flex; justify-content: space-between; font-size: 10.5px; margin: 2px 0; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
</style>
</head>
<body>
  <div class="sheet">
    <div style="text-align: center; font-size: 18px; font-weight: 900;">گـاتـان</div>
    <div class="bar" style="margin-top: 4px;">تست اتصال سرویس چاپ صندوق</div>
    <div class="box">
      <div class="kv"><span>چاپگر هدف:</span><strong>Sewoo 100 (USB)</strong></div>
      <div class="kv"><span>عرض کاغذ:</span><strong>۷۲ میلی‌متر</strong></div>
      <div class="kv"><span>وضعیت فارسی:</span><strong>گ چ پ ژ — ۰۱۲۳۴۵۶۷۸۹</strong></div>
      <div class="hr"></div>
      <div style="text-align: center; font-weight: 800; font-size: 10.5px;">
        اتصال سرور گاتان به سیستم صندوق برقرار است ✓
      </div>
    </div>
    <div style="text-align: center; font-size: 9px; margin-top: 6px;">زمان تست: ${nowFa}</div>
  </div>
</body>
</html>`;
}

export function isPrintQueueUsingPostgres(): boolean {
  return isPostgresModeActive();
}
