/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Printer,
  X,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  Trash2,
  KeyRound,
  Download,
  Copy,
  Check,
  Wifi,
  WifiOff,
  Monitor,
  Terminal,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  fetchPrintQueueState,
  enqueueTestPrintJob,
  retryPosPrintJob,
  deletePosPrintJob,
  clearFinishedPosPrintJobs,
  rotatePrintAgentStationKey,
  fetchPrintAgentBundleFiles,
  buildWindowsOneClickSetupPs1,
  buildWindowsUpdaterPs1,
  type PrintJobSummary,
  type PrintStationStatus,
} from '../services/printQueueService';
import { toPersianDigits } from '../utils/persianUtils';

interface PrintQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStationStatusChange?: (status: PrintStationStatus) => void;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  customer_receipt: 'رسید مشتری',
  workshop_ticket: 'برگه کارگاه',
  test_print: 'فیش تست چاپگر',
};

const JOB_STATUS_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  pending: {
    label: 'در صف چاپ',
    badgeClass:
      'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  },
  printing: {
    label: 'در حال چاپ...',
    badgeClass:
      'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  },
  printed: {
    label: 'چاپ شده',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  },
  failed: {
    label: 'خطا در چاپ',
    badgeClass:
      'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',
  },
  cancelled: {
    label: 'لغو شده',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  },
};

function formatTimeFa(iso?: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return toPersianDigits(
      d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    );
  } catch {
    return '-';
  }
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PrintQueueModal({
  isOpen,
  onClose,
  onStationStatusChange,
}: PrintQueueModalProps) {
  const [activeTab, setActiveTab] = useState<'queue' | 'setup'>('queue');
  const [jobs, setJobs] = useState<PrintJobSummary[]>([]);
  const [station, setStation] = useState<PrintStationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Setup state
  const [generatedKey, setGeneratedKey] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const [printerNameInput, setPrinterNameInput] = useState<string>('auto');

  const loadQueue = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetchPrintQueueState(60);
        setJobs(res.jobs || []);
        setStation(res.station || null);
        if (res.station && onStationStatusChange) {
          onStationStatusChange(res.station);
        }
      } catch (err: any) {
        if (!silent) {
          setFeedback({ type: 'error', message: err?.message || 'خطا در دریافت وضعیت صف چاپ' });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onStationStatusChange]
  );

  useEffect(() => {
    if (!isOpen) return;
    loadQueue(false);
    const interval = setInterval(() => {
      loadQueue(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [isOpen, loadQueue]);

  if (!isOpen) return null;

  const handleTestPrint = async () => {
    setBusyAction('test');
    setFeedback(null);
    try {
      const res = await enqueueTestPrintJob();
      setStation(res.station);
      onStationStatusChange?.(res.station);
      setFeedback({
        type: 'success',
        message: res.station.online
          ? 'فیش تست به صف چاپگر صندوق ارسال شد و تا چند ثانیه دیگر روی Sewoo 100 چاپ می‌شود.'
          : 'فیش تست در صف ثبت شد. به محض روشن شدن سرویس چاپ سیستم صندوق، به‌صورت خودکار چاپ می‌شود.',
      });
      await loadQueue(true);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در ثبت فیش تست' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetry = async (jobId: string) => {
    setBusyAction(`retry_${jobId}`);
    try {
      await retryPosPrintJob(jobId);
      setFeedback({ type: 'success', message: 'فیش مجدداً به صف چاپ ارسال شد.' });
      await loadQueue(true);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در ارسال مجدد فیش' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (jobId: string) => {
    setBusyAction(`del_${jobId}`);
    try {
      await deletePosPrintJob(jobId);
      await loadQueue(true);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در حذف فیش' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearFinished = async () => {
    setBusyAction('clear');
    try {
      const res = await clearFinishedPosPrintJobs();
      setFeedback({
        type: 'info',
        message: `${toPersianDigits(res.deletedCount)} فیش تکمیل‌شده از تاریخچه صف پاک شد.`,
      });
      await loadQueue(true);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در پاک‌سازی تاریخچه' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRotateKey = async () => {
    setBusyAction('rotate');
    setFeedback(null);
    try {
      const res = await rotatePrintAgentStationKey('صندوق فروشگاه (Sewoo 100)');
      setGeneratedKey(res.apiKey);
      setStation(res.status);
      onStationStatusChange?.(res.status);
      setFeedback({
        type: 'success',
        message: 'کلید امنیتی جدید ساخته شد. اکنون نصاب خودکار ویندوز ۱۰ یا فایل config.json را دانلود کنید.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در تولید کلید سرویس چاپ' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyKey = async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadOneClickInstaller = async () => {
    if (!generatedKey) {
      setFeedback({
        type: 'error',
        message: 'ابتدا روی «تولید کلید امنیتی جدید» کلیک کنید تا کلید اتصال داخل نصاب قرار بگیرد.',
      });
      return;
    }
    setBusyAction('download_installer');
    try {
      const files = await fetchPrintAgentBundleFiles();
      const ps1 = buildWindowsOneClickSetupPs1(files, {
        serverUrl: serverUrlInput.trim().replace(/\/+$/, ''),
        apiKey: generatedKey,
        printerName: printerNameInput.trim() || 'auto',
      });
      downloadTextFile('setup-gatan-printer-win10.ps1', '\uFEFF' + ps1, 'text/plain;charset=utf-8');
      setFeedback({
        type: 'success',
        message:
          'فایل setup-gatan-printer-win10.ps1 دانلود شد. روی سیستم صندوق ویندوز ۱۰ کلیک راست کرده و «Run with PowerShell» را بزنید.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در ساخت فایل نصاب ویندوز' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadUpdater = async () => {
    setBusyAction('download_updater');
    setFeedback(null);
    try {
      const files = await fetchPrintAgentBundleFiles();
      const ps1 = buildWindowsUpdaterPs1(files);
      downloadTextFile('update-gatan-printer-win10.ps1', '\uFEFF' + ps1, 'text/plain;charset=utf-8');
      setFeedback({
        type: 'success',
        message:
          'فایل بروزرسانی update-gatan-printer-win10.ps1 دانلود شد. روی آن کلیک راست و «Run with PowerShell» بزنید تا فایل‌های سرویس بدون تغییر کلید بروزرسانی و تست شوند.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'خطا در ساخت فایل بروزرسانی' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadConfigJson = () => {
    if (!generatedKey) {
      setFeedback({
        type: 'error',
        message: 'ابتدا کلید امنیتی را تولید کنید تا داخل فایل config.json ثبت شود.',
      });
      return;
    }
    const cfg = JSON.stringify(
      {
        serverUrl: serverUrlInput.trim().replace(/\/+$/, ''),
        apiKey: generatedKey,
        printerName: printerNameInput.trim() || 'auto',
        stationId: 'cashier-main',
        pollIntervalMs: 2000,
      },
      null,
      2
    );
    downloadTextFile('config.json', cfg, 'application/json;charset=utf-8');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 shrink-0">
              <Printer className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                صف چاپ و سرویس فیش‌پرینتر صندوق (Sewoo 100)
              </h3>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                {station?.online ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                    <Wifi className="h-3.5 w-3.5" />
                    <span>
                      صندوق آنلاین
                      {station.hostname ? ` (${station.hostname})` : ''}
                      {station.printerName && station.printerName !== 'auto'
                        ? ` · چاپگر: ${station.printerName}`
                        : ''}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-bold">
                    <WifiOff className="h-3.5 w-3.5" />
                    <span>
                      سرویس صندوق متصل نیست
                      {station?.lastHeartbeatAt
                        ? ` (آخرین اتصال: ${formatTimeFa(station.lastHeartbeatAt)})`
                        : ' (نیاز به نصب روی ویندوز ۱۰ صندوق)'}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub Tabs */}
        <div className="px-4 sm:px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`px-3.5 py-2 text-xs font-extrabold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'queue'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>صف چاپ زنده</span>
              {(station?.pendingCount || 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[10px]">
                  {toPersianDigits(station?.pendingCount || 0)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('setup')}
              className={`px-3.5 py-2 text-xs font-extrabold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'setup'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>نصب سرویس روی ویندوز ۱۰ صندوق</span>
            </button>
          </div>

          {activeTab === 'queue' && (
            <div className="flex items-center gap-1.5 pb-2">
              <button
                type="button"
                onClick={handleTestPrint}
                disabled={busyAction === 'test'}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Play className="h-3 w-3" />
                <span>چاپ تست Sewoo 100</span>
              </button>
              <button
                type="button"
                onClick={() => loadQueue(false)}
                disabled={loading}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                title="بروزرسانی صف"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {feedback && (
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : feedback.type === 'error'
                  ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
                  : 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30 text-sky-800 dark:text-sky-300'
              }`}
            >
              <span>{feedback.message}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="p-0.5 rounded hover:bg-black/5 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeTab === 'queue' ? (
            <>
              {/* Quick Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500 font-bold">در صف انتظار</div>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">
                    {toPersianDigits(station?.pendingCount || 0)}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500 font-bold">در حال چاپ</div>
                  <div className="text-lg font-black text-sky-600 dark:text-sky-400 mt-0.5">
                    {toPersianDigits(station?.printingCount || 0)}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500 font-bold">چاپ‌شده ۲۴ ساعت اخیر</div>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {toPersianDigits(station?.printedTodayCount || 0)}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[11px] text-slate-500 font-bold">خطادار</div>
                  <div className="text-lg font-black text-rose-600 dark:text-rose-400 mt-0.5">
                    {toPersianDigits(station?.failedCount || 0)}
                  </div>
                </div>
              </div>

              {!station?.online && (
                <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200 font-bold">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>
                      سرویس چاپ روی ویندوز ۱۰ صندوق هنوز آنلاین نیست. فیش‌ها در صف ذخیره می‌شوند و به محض اجرای سرویس، به ترتیب چاپ خواهند شد.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('setup')}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold whitespace-nowrap cursor-pointer"
                  >
                    راهنمای نصب سرویس
                  </button>
                </div>
              )}

              {/* Jobs List */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                    آخرین فیش‌های ارسالی به چاپگر صندوق ({toPersianDigits(jobs.length)})
                  </span>
                  {jobs.some((j) => j.status === 'printed' || j.status === 'failed' || j.status === 'cancelled') && (
                    <button
                      type="button"
                      onClick={handleClearFinished}
                      disabled={busyAction === 'clear'}
                      className="text-[11px] font-bold text-slate-500 hover:text-rose-600 cursor-pointer flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>پاک‌سازی چاپ‌شده‌ها</span>
                    </button>
                  )}
                </div>

                {jobs.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    صف چاپ صندوق خالی است. روی «رسید مشتری»، «برگه کارگاه» یا «چاپ تست Sewoo 100» کلیک کنید.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {jobs.map((job) => {
                      const st = JOB_STATUS_META[job.status] || JOB_STATUS_META.pending;
                      return (
                        <div
                          key={job.id}
                          className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-black text-slate-900 dark:text-white">
                                {job.title}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md border text-[10px] font-extrabold ${st.badgeClass}`}
                              >
                                {st.label}
                              </span>
                              <span className="text-[10px] font-bold text-slate-500">
                                {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                              <span>ثبت: {formatTimeFa(job.createdAt)}</span>
                              {job.printedAt && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                  چاپ: {formatTimeFa(job.printedAt)}
                                </span>
                              )}
                              <span>درخواست‌کننده: {job.requestedBy || '-'}</span>
                            </div>
                            {job.errorMessage && (
                              <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold">
                                خطا: {job.errorMessage}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRetry(job.id)}
                              disabled={busyAction === `retry_${job.id}`}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              title="ارسال مجدد به چاپگر صندوق"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>چاپ مجدد</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(job.id)}
                              disabled={busyAction === `del_${job.id}`}
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:border-rose-300 cursor-pointer"
                              title="حذف از صف"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* SETUP TAB FOR WINDOWS 10 + SEWOO 100 USB */
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-emerald-900 dark:text-emerald-200">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  <span>نصب سریع سرویس چاپ پس‌زمینه روی ویندوز ۱۰ صندوق (Sewoo 100 USB)</span>
                </div>
                <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300 leading-relaxed">
                  این سرویس بدون نیاز به IP استاتیک، تنظیم مودم یا باز ماندن مرورگر، هر ۲ ثانیه صف چاپ سرور گاتان را بررسی کرده و فیش‌های ۷۲ میلی‌متری (رسید مشتری و برگه کارگاه بدون عکس) را با طول دقیق و برش خودکار روی چاپگر <strong>Sewoo 100</strong> چاپ می‌کند.
                </p>
              </div>

              {/* Step 1: Key & Server URL */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                      <KeyRound className="h-4 w-4 text-emerald-600" />
                      <span>مرحله ۱: تولید کلید امنیتی اتصال سیستم صندوق</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      وضعیت فعلی کلید:{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {station?.hasKeyConfigured
                          ? station.keySource === 'env'
                            ? 'تنظیم‌شده از طریق متغیر محیطی سرور (PRINT_AGENT_KEY)'
                            : 'فعال در پایگاه داده'
                          : 'هنوز کلیدی تولید نشده است'}
                      </strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRotateKey}
                    disabled={busyAction === 'rotate'}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>
                      {station?.hasKeyConfigured ? 'تولید کلید جدید (جایگزینی)' : 'تولید کلید امنیتی'}
                    </span>
                  </button>
                </div>

                {generatedKey && (
                  <div className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-xs flex items-center justify-between gap-2">
                    <span className="truncate select-all" dir="ltr">
                      {generatedKey}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-sans font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedKey ? 'کپی شد' : 'کپی کلید'}</span>
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      آدرس سرور ERP گاتان (روی VPS)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={serverUrlInput}
                      onChange={(e) => setServerUrlInput(e.target.value)}
                      placeholder="https://erp.gatan.ir"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      نام چاپگر در ویندوز ۱۰ (پیش‌فرض: تشخیص خودکار Sewoo)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={printerNameInput}
                      onChange={(e) => setPrinterNameInput(e.target.value)}
                      placeholder="auto"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-left"
                    />
                    {station?.availablePrinters && station.availablePrinters.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {station.availablePrinters.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPrinterNameInput(p)}
                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-[10px] font-mono cursor-pointer"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 2: Download & Install */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Download className="h-4 w-4 text-emerald-600" />
                  <span>مرحله ۲: دانلود و نصب یک‌کلیکی روی ویندوز ۱۰ صندوق</span>
                </h4>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadOneClickInstaller}
                    disabled={busyAction === 'download_installer'}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>دانلود نصاب کامل ویندوز ۱۰ (setup-gatan-printer-win10.ps1)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadUpdater}
                    disabled={busyAction === 'download_updater'}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>بروزرسانی سرویس نصب‌شده (بدون تغییر کلید)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadConfigJson}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    <span>فقط دانلود config.json</span>
                  </button>
                </div>

                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed pt-1">
                  <li>
                    روی سیستم صندوق ویندوز ۱۰ مطمئن شوید <strong>درایور Sewoo 100</strong> و{' '}
                    <strong>Node.js نسخه LTS</strong> نصب باشند.
                  </li>
                  <li>
                    فایل دانلود شده (<code className="font-mono text-[11px]">setup-gatan-printer-win10.ps1</code>) را روی سیستم صندوق قرار دهید، روی آن <strong>کلیک راست</strong> کرده و{' '}
                    <strong>Run with PowerShell</strong> را بزنید.
                  </li>
                  <li>
                    نصاب تمام فایل‌ها را در پوشه <code className="font-mono text-[11px]">C:\GatanPrintAgent</code> قرار داده، سرویس خودکار ویندوز را ثبت می‌کند و بلافاصله اجرا می‌شود.
                  </li>
                  <li>
                    ظرف ۱۰ ثانیه وضعیت بالای همین پنجره به <strong className="text-emerald-600">«صندوق آنلاین»</strong> تغییر می‌کند و می‌توانید با دکمه <strong>«چاپ تست Sewoo 100»</strong> خروجی را امتحان کنید.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
