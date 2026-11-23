/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAuthToken, getSyncBranchId } from './postgresSyncService';

export type PrintJobType = 'customer_receipt' | 'workshop_ticket' | 'test_print';
export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed' | 'cancelled';

export interface PrintJobSummary {
  id: string;
  stationId: string;
  jobType: PrintJobType;
  title: string;
  orderId?: string;
  orderNumber?: string;
  departmentName?: string;
  paperWidthMm: number;
  copies: number;
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

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Branch-Id': getSyncBranchId(),
    ...extra,
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text || `خطای سرور (${res.status})` };
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `خطای ارتباط با سرور چاپ (${res.status})`);
  }
  return data as T;
}

export async function fetchPrintQueueState(
  limit = 50
): Promise<{ jobs: PrintJobSummary[]; station: PrintStationStatus }> {
  const res = await fetch(`/api/print-jobs?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: buildHeaders(),
  });
  return parseApiJson<{ jobs: PrintJobSummary[]; station: PrintStationStatus }>(res);
}

export async function enqueuePosPrintJob(input: {
  jobType: PrintJobType;
  title: string;
  orderId?: string;
  orderNumber?: string;
  departmentName?: string;
  paperWidthMm?: 58 | 72 | 80;
  copies?: number;
  htmlContent: string;
  requestedBy?: string;
}): Promise<{ job: PrintJobSummary; station: PrintStationStatus }> {
  const res = await fetch('/api/print-jobs', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  return parseApiJson<{ job: PrintJobSummary; station: PrintStationStatus }>(res);
}

export async function enqueueTestPrintJob(): Promise<{
  job: PrintJobSummary;
  station: PrintStationStatus;
}> {
  const res = await fetch('/api/print-jobs/test', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  return parseApiJson<{ job: PrintJobSummary; station: PrintStationStatus }>(res);
}

export async function retryPosPrintJob(
  jobId: string
): Promise<{ job: PrintJobSummary; station: PrintStationStatus }> {
  const res = await fetch(`/api/print-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  return parseApiJson<{ job: PrintJobSummary; station: PrintStationStatus }>(res);
}

export async function deletePosPrintJob(jobId: string): Promise<{ station: PrintStationStatus }> {
  const res = await fetch(`/api/print-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  return parseApiJson<{ station: PrintStationStatus }>(res);
}

export async function clearFinishedPosPrintJobs(): Promise<{
  deletedCount: number;
  station: PrintStationStatus;
}> {
  const res = await fetch('/api/print-jobs/clear-finished', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  return parseApiJson<{ deletedCount: number; station: PrintStationStatus }>(res);
}

export async function rotatePrintAgentStationKey(
  stationName?: string
): Promise<{ apiKey: string; status: PrintStationStatus }> {
  const res = await fetch('/api/print-agent/rotate-key', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ stationName }),
  });
  return parseApiJson<{ apiKey: string; status: PrintStationStatus }>(res);
}

export async function fetchPrintAgentBundleFiles(): Promise<Record<string, string>> {
  const res = await fetch('/api/print-agent/bundle', {
    method: 'GET',
    headers: buildHeaders(),
  });
  const data = await parseApiJson<{ files: Record<string, string> }>(res);
  return data.files || {};
}

/**
 * Generates a single self-extracting PowerShell script for Windows 10 that creates
 * C:\GatanPrintAgent with all agent scripts + pre-filled config.json (serverUrl & apiKey).
 */
export function buildWindowsOneClickSetupPs1(
  files: Record<string, string>,
  config: { serverUrl: string; apiKey: string; printerName?: string }
): string {
  const configJson = JSON.stringify(
    {
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      printerName: config.printerName || 'auto',
      stationId: 'cashier-main',
      pollIntervalMs: 2000,
    },
    null,
    2
  );

  const allFiles: Record<string, string> = {
    ...files,
    'config.json': configJson,
  };

  const toBase64Utf8 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const fileWriteBlocks = Object.entries(allFiles)
    .map(([fileName, content]) => {
      const b64 = toBase64Utf8(content);
      return `[System.IO.File]::WriteAllBytes((Join-Path $targetDir '${fileName}'), [System.Convert]::FromBase64String('${b64}'))`;
    })
    .join('\r\n');

  return [
    '# Gatan POS Print Agent — One-Click Windows 10 Installer (Sewoo 100 USB)',
    '$ErrorActionPreference = "Stop"',
    '$targetDir = "C:\\GatanPrintAgent"',
    'Write-Host "Installing Gatan Print Agent into $targetDir ..." -ForegroundColor Cyan',
    'New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    fileWriteBlocks,
    'Write-Host "All files extracted to $targetDir" -ForegroundColor Green',
    '& (Join-Path $targetDir "install-service.bat")',
  ].join('\r\n');
}

/**
 * Generates a PowerShell updater script that updates agent.mjs & print-image.ps1 in C:\GatanPrintAgent
 * without modifying config.json, restarts the background agent, and runs a quick test print.
 */
export function buildWindowsUpdaterPs1(files: Record<string, string>): string {
  const toBase64Utf8 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const fileWriteBlocks = Object.entries(files)
    .map(([fileName, content]) => {
      const b64 = toBase64Utf8(content);
      return `[System.IO.File]::WriteAllBytes((Join-Path $targetDir '${fileName}'), [System.Convert]::FromBase64String('${b64}'))`;
    })
    .join('\r\n');

  return [
    '# Gatan POS Print Agent — Windows 10 Updater (keeps existing config.json)',
    '$ErrorActionPreference = "Stop"',
    '$targetDir = "C:\\GatanPrintAgent"',
    'New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    'Write-Host "Stopping running Gatan Print Agent..." -ForegroundColor Yellow',
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*agent.mjs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Start-Sleep -Seconds 1',
    fileWriteBlocks,
    'Write-Host "Updated agent files in $targetDir (config.json preserved)." -ForegroundColor Green',
    '$vbs = Join-Path $targetDir "start-hidden.vbs"',
    'if (Test-Path $vbs) { Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`"" }',
    'Write-Host "Running 72mm test print on Sewoo 100..." -ForegroundColor Cyan',
    '& node (Join-Path $targetDir "agent.mjs") --test',
    'Write-Host "Done! Press Enter to close." -ForegroundColor Green',
    'Read-Host',
  ].join('\r\n');
}
