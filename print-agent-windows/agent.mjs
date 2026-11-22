/**
 * Gatan POS Print Agent for Windows 10 + Sewoo 100 (USB)
 * Zero-dependency Node.js 18+ background service.
 *
 * Usage:
 *   node agent.mjs                 -> Run background print queue agent
 *   node agent.mjs --list-printers -> List installed Windows printers
 *   node agent.mjs --test          -> Print a local 72mm test ticket immediately
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AGENT_VERSION = '1.0.0';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PRINT_PS1_PATH = path.join(__dirname, 'print-image.ps1');
const TMP_DIR = path.join(__dirname, 'tmp');
const LOG_PATH = path.join(__dirname, 'agent.log');

fs.mkdirSync(TMP_DIR, { recursive: true });

function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
    // Keep log file under 2 MB
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > 2 * 1024 * 1024) {
      const content = fs.readFileSync(LOG_PATH, 'utf8');
      fs.writeFileSync(LOG_PATH, content.slice(-500_000), 'utf8');
    }
  } catch {
    // ignore log write errors
  }
}

function runExecFile(file, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message || '').toString().trim();
          reject(new Error(detail || `Process failed: ${file}`));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function findChromiumBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function listWindowsPrinters() {
  try {
    const { stdout } = await runExecFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name',
      ],
      15_000
    );
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    log('WARN', `Could not list printers: ${err.message}`);
    return [];
  }
}

function pickBestPrinter(configuredName, printers) {
  const cfg = String(configuredName || 'auto').trim();
  if (cfg && cfg.toLowerCase() !== 'auto') {
    const exact = printers.find((p) => p.toLowerCase() === cfg.toLowerCase());
    if (exact) return exact;
    const partial = printers.find((p) => p.toLowerCase().includes(cfg.toLowerCase()));
    if (partial) return partial;
    return cfg;
  }
  // Auto-detect Sewoo 100 or thermal POS printer
  const sewoo = printers.find((p) => /sewoo|lk-?p?100|slk|pos-?80|thermal/i.test(p));
  return sewoo || 'auto';
}

function safeTmpPath(filename) {
  const cleanName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(TMP_DIR, cleanName);
  const baseWithSep = path.resolve(TMP_DIR) + path.sep;
  if (!resolved.startsWith(baseWithSep)) {
    throw new Error('Invalid temporary file path');
  }
  return resolved;
}

function normalizeHtmlForHeadless(htmlContent, paperWidthMm = 72) {
  const widthMm = paperWidthMm === 58 ? 58 : 72;
  const trimmed = String(htmlContent || '').trim();
  if (/<!doctype|<html/i.test(trimmed)) {
    return trimmed;
  }
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    width: ${widthMm}mm; max-width: ${widthMm}mm;
    background: #ffffff; color: #000000;
    font-family: Tahoma, 'Vazirmatn', 'Segoe UI', Arial, sans-serif;
    direction: rtl; text-align: right;
  }
</style>
</head>
<body>${trimmed}</body>
</html>`;
}

async function renderHtmlAndPrint({ jobId, htmlContent, printerName, paperWidthMm = 72, copies = 1 }) {
  const browserPath = findChromiumBrowser();
  if (!browserPath) {
    throw new Error('مرورگر Microsoft Edge یا Chrome روی این سیستم ویندوز پیدا نشد.');
  }
  if (!fs.existsSync(PRINT_PS1_PATH)) {
    throw new Error('فایل print-image.ps1 در پوشه سرویس یافت نشد.');
  }

  const stamp = `${Date.now()}_${String(jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const htmlFile = safeTmpPath(`${stamp}.html`);
  const pngFile = safeTmpPath(`${stamp}.png`);

  // 72mm at 96 CSS DPI = 272px (with 2x scale = 544px..576px crisp 203-DPI thermal output)
  const cssWidthPx = paperWidthMm === 58 ? 220 : 288;
  const fullHtml = normalizeHtmlForHeadless(htmlContent, paperWidthMm);

  try {
    fs.writeFileSync(htmlFile, fullHtml, 'utf8');
    const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');

    await runExecFile(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-extensions',
        '--hide-scrollbars',
        '--virtual-time-budget=2500',
        '--force-device-scale-factor=2',
        `--window-size=${cssWidthPx},2400`,
        `--screenshot=${pngFile}`,
        fileUrl,
      ],
      35_000
    );

    if (!fs.existsSync(pngFile)) {
      throw new Error('تصویر چاپی فیش ایجاد نشد.');
    }

    const { stdout } = await runExecFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        PRINT_PS1_PATH,
        '-PrinterName',
        String(printerName || 'auto'),
        '-ImagePath',
        pngFile,
        '-PaperWidthMm',
        String(paperWidthMm === 58 ? 58 : 72),
        '-Copies',
        String(Math.min(5, Math.max(1, Number(copies) || 1))),
      ],
      35_000
    );

    if (stdout.trim()) {
      log('INFO', `Printer output: ${stdout.trim()}`);
    }
  } finally {
    for (const f of [htmlFile, pngFile]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore cleanup error
      }
    }
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `فایل config.json در کنار agent.mjs پیدا نشد.\nلطفاً config.example.json را به config.json کپی کرده و آدرس سرور و کلید امنیتی را داخل آن قرار دهید.`
    );
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const serverUrl = String(parsed.serverUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(parsed.apiKey || '').trim();
  if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) {
    throw new Error('مقدار serverUrl در config.json نامعتبر است (باید با http:// یا https:// شروع شود).');
  }
  if (!apiKey || apiKey.length < 16) {
    throw new Error('مقدار apiKey در config.json تنظیم نشده یا نامعتبر است.');
  }
  return {
    serverUrl,
    apiKey,
    printerName: String(parsed.printerName || 'auto').trim() || 'auto',
    stationId: String(parsed.stationId || 'cashier-main').trim() || 'cashier-main',
    pollIntervalMs: Math.max(1000, Math.min(15_000, Number(parsed.pollIntervalMs || 2000))),
  };
}

async function apiPost(config, endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${config.serverUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Print-Agent-Key': config.apiKey,
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { ok: false, error: text.slice(0, 200) };
    }
    if (!res.ok) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function runCliTest() {
  const printers = await listWindowsPrinters();
  let printerName = 'auto';
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      printerName = cfg.printerName || 'auto';
    } catch {
      // ignore
    }
  }
  const chosen = pickBestPrinter(printerName, printers);
  const safeChosen = String(chosen)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  log('INFO', `Running local test print on printer: ${chosen}`);
  const testHtml = `<!DOCTYPE html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 72mm; background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; direction: rtl; font-size: 11px; }
  .sheet { width: 68mm; margin: 0 auto; padding: 3mm 0.5mm 4mm 0.5mm; }
  .bar { background: #000; color: #fff; text-align: center; font-weight: 900; padding: 5px; border-radius: 3px; }
  .box { border: 2px solid #000; border-radius: 4px; padding: 6px; margin-top: 6px; }
</style></head><body><div class="sheet">
  <div style="text-align:center;font-size:18px;font-weight:900;">گـاتـان</div>
  <div class="bar" style="margin-top:4px;">تست محلی فیش‌پرینتر Sewoo 100</div>
  <div class="box">
    <div>نام چاپگر: <strong>${safeChosen}</strong></div>
    <div style="margin-top:4px;">حروف فارسی: <strong>گ چ پ ژ — ۰۱۲۳۴۵۶۷۸۹</strong></div>
    <div style="margin-top:4px;text-align:center;font-weight:900;">چاپگر آماده دریافت صف از سرور است ✓</div>
  </div>
</div></body></html>`;
  await renderHtmlAndPrint({
    jobId: 'local_test',
    htmlContent: testHtml,
    printerName: chosen,
    paperWidthMm: 72,
    copies: 1,
  });
  log('INFO', 'Local test print completed successfully.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list-printers')) {
    const printers = await listWindowsPrinters();
    console.log('Installed Windows Printers:');
    printers.forEach((p, idx) => console.log(`  ${idx + 1}. ${p}`));
    return;
  }

  if (args.includes('--test')) {
    await runCliTest();
    return;
  }

  const config = loadConfig();
  log('INFO', `Gatan Print Agent v${AGENT_VERSION} starting...`);
  log('INFO', `Server: ${config.serverUrl} | Station: ${config.stationId}`);

  let cachedPrinters = await listWindowsPrinters();
  let activePrinter = pickBestPrinter(config.printerName, cachedPrinters);
  log('INFO', `Detected printers (${cachedPrinters.length}): ${cachedPrinters.join(', ') || 'none'}`);
  log('INFO', `Selected printer: ${activePrinter}`);

  let lastHeartbeatTs = 0;
  let lastPrinterRefreshTs = Date.now();
  let isBusy = false;

  const tick = async () => {
    if (isBusy) return;
    isBusy = true;
    try {
      const now = Date.now();
      if (now - lastPrinterRefreshTs > 60_000) {
        cachedPrinters = await listWindowsPrinters();
        activePrinter = pickBestPrinter(config.printerName, cachedPrinters);
        lastPrinterRefreshTs = now;
      }

      if (now - lastHeartbeatTs >= 8_000) {
        await apiPost(config, '/api/print-agent/heartbeat', {
          hostname: os.hostname(),
          printerName: activePrinter,
          availablePrinters: cachedPrinters,
          agentVersion: AGENT_VERSION,
        });
        lastHeartbeatTs = now;
      }

      const claimed = await apiPost(config, '/api/print-agent/claim-next', {
        stationId: config.stationId,
      });

      if (claimed && claimed.job) {
        const job = claimed.job;
        log('INFO', `Claimed job ${job.id} (${job.jobType}): ${job.title}`);
        try {
          await renderHtmlAndPrint({
            jobId: job.id,
            htmlContent: job.htmlContent,
            printerName: activePrinter,
            paperWidthMm: job.paperWidthMm || 72,
            copies: job.copies || 1,
          });
          await apiPost(config, `/api/print-agent/jobs/${encodeURIComponent(job.id)}/complete`, {
            ok: true,
          });
          log('INFO', `Job ${job.id} printed successfully.`);
        } catch (printErr) {
          log('ERROR', `Job ${job.id} print failed: ${printErr.message}`);
          await apiPost(config, `/api/print-agent/jobs/${encodeURIComponent(job.id)}/complete`, {
            ok: false,
            errorMessage: printErr.message,
          }).catch(() => {});
        }
      }
    } catch (err) {
      log('WARN', `Poll error: ${err.message}`);
    } finally {
      isBusy = false;
    }
  };

  await tick();
  setInterval(tick, config.pollIntervalMs);
}

main().catch((err) => {
  log('FATAL', err.message || String(err));
  process.exit(1);
});
