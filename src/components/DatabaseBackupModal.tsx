/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppDatabase, User } from '../types';
import {
  Database,
  Download,
  Upload,
  CheckCircle,
  Scale,
  ShieldAlert,
  FolderOpen,
  CalendarClock,
  RotateCcw,
  Trash2,
  HardDrive,
  FileJson,
  FolderCheck,
  X,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { isAdminUser } from '../shared/rbac';
import { toPersianDigits } from '../utils/persianUtils';
import {
  type DailyBackupSettings,
  type DailyBackupMetadata,
  DEFAULT_DAILY_BACKUP_SETTINGS,
  getDailyBackupSettings,
  saveDailyBackupSettings,
  listDailyBackupsMeta,
  getDailyBackupRecordById,
  deleteDailyBackupById,
  pickBackupDirectory,
  clearBackupDirectory,
  isFileSystemAccessSupported,
  performDatabaseBackup,
  triggerBackupDownload,
  parseAndValidateBackupJson,
} from '../services/backupService';

interface DatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: AppDatabase;
  currentUser: User;
  serverMode: 'postgres' | 'local';
  backupRevision: number;
  onRestoreDatabase: (restoredDb: AppDatabase, sourceLabel: string) => Promise<boolean>;
  onExportExcelBackup: () => void;
  onImportExcelBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportDibalExcelBackup: () => void;
  onImportDibalExcelBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPurgeAllDatabase: () => void;
  askConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '۰ بایت';
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} KB`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} MB`;
}

function formatMethodLabel(method?: string): string {
  if (method === 'folder') return 'ذخیره مستقیم در پوشه سیستم';
  if (method === 'download') return 'دانلود فایل در سیستم';
  return 'ذخیره در حافظه مرورگر سیستم';
}

export default function DatabaseBackupModal({
  isOpen,
  onClose,
  db,
  currentUser,
  serverMode,
  backupRevision,
  onRestoreDatabase,
  onExportExcelBackup,
  onImportExcelBackup,
  onExportDibalExcelBackup,
  onImportDibalExcelBackup,
  onPurgeAllDatabase,
  askConfirm,
}: DatabaseBackupModalProps) {
  const isAdmin = isAdminUser(currentUser);
  const fsSupported = isFileSystemAccessSupported();

  const [settings, setSettings] = useState<DailyBackupSettings>(DEFAULT_DAILY_BACKUP_SETTINGS);
  const [history, setHistory] = useState<DailyBackupMetadata[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const loadBackupState = async () => {
    if (!isAdmin) return;
    const [s, h] = await Promise.all([getDailyBackupSettings(), listDailyBackupsMeta()]);
    setSettings(s);
    setHistory(h);
  };

  useEffect(() => {
    if (isOpen && isAdmin) {
      loadBackupState();
    }
  }, [isOpen, isAdmin, backupRevision]);

  if (!isOpen) return null;

  const handleToggleSetting = async (patch: Partial<DailyBackupSettings>) => {
    const updated = await saveDailyBackupSettings(patch);
    setSettings(updated);
  };

  const handlePickFolder = async () => {
    setStatusBanner(null);
    const res = await pickBackupDirectory();
    if (res.cancelled) return;
    if (!res.ok) {
      setStatusBanner({ type: 'error', text: res.error || 'خطا در انتخاب پوشه پشتیبان‌گیری' });
      return;
    }
    await loadBackupState();
    setStatusBanner({
      type: 'success',
      text: `پوشه «${res.directoryName}» با موفقیت برای پشتیبان‌گیری روزانه متصل شد. از این پس فایل بکاپ مستقیماً در این پوشه ذخیره می‌شود.`,
    });
  };

  const handleDisconnectFolder = async () => {
    await clearBackupDirectory();
    await loadBackupState();
    setStatusBanner({
      type: 'info',
      text: 'اتصال پوشه مستقیم سیستم قطع شد. در صورت فعال بودن دانلود خودکار، فایل بکاپ روزانه به صورت خودکار دانلود می‌شود.',
    });
  };

  const handleRunManualBackup = async (forceDownload = false) => {
    if (!isAdmin) return;
    setIsBusy(true);
    setStatusBanner(null);
    try {
      const res = await performDatabaseBackup({
        trigger: 'manual',
        serverMode,
        currentDb: db,
        currentUser,
        interactiveFolderPrompt: true,
        forceDownload,
      });
      if (!res.ok) {
        setStatusBanner({ type: 'error', text: res.error || 'خطا در تهیه نسخه پشتیبان' });
        return;
      }
      await loadBackupState();
      setStatusBanner({
        type: 'success',
        text:
          res.method === 'folder'
            ? `نسخه پشتیبان کامل دیتابیس با موفقیت در پوشه «${settings.directoryName || 'انتخاب‌شده'}» و تاریخچه سیستم ذخیره شد.`
            : `فایل پشتیبان کامل دیتابیس (${res.filename}) با موفقیت روی سیستم شما دانلود و در تاریخچه ذخیره شد.`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadVaultItem = async (item: DailyBackupMetadata) => {
    setIsBusy(true);
    try {
      const full = await getDailyBackupRecordById(item.id);
      if (!full || !full.payloadJson) {
        setStatusBanner({ type: 'error', text: 'محتوای این نسخه پشتیبان یافت نشد.' });
        return;
      }
      triggerBackupDownload(`Gatan_DB_Backup_${item.dateKey}.json`, full.payloadJson);
      setStatusBanner({
        type: 'success',
        text: `فایل پشتیبان تاریخ ${item.jalaliDate} با موفقیت دانلود شد.`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreVaultItem = async (item: DailyBackupMetadata) => {
    if (!isAdmin) return;
    const full = await getDailyBackupRecordById(item.id);
    if (!full || !full.payloadJson) {
      setStatusBanner({ type: 'error', text: 'محتوای این نسخه پشتیبان در حافظه یافت نشد.' });
      return;
    }

    const validation = parseAndValidateBackupJson(full.payloadJson);
    if (!validation.ok || !validation.database) {
      setStatusBanner({ type: 'error', text: validation.error || 'ساختار نسخه پشتیبان معتبر نیست.' });
      return;
    }

    const stats = validation.meta?.stats;
    const statsInfo = stats
      ? `\n\nاطلاعات موجود در این نسخه: ${toPersianDigits(stats.items)} ماده اولیه، ${toPersianDigits(stats.products)} محصول، ${toPersianDigits(stats.personnel)} پرسنل، ${toPersianDigits(stats.salesTransactions)} ردیف فروش و ${toPersianDigits(stats.users)} کاربر.`
      : '';

    askConfirm(
      `بازیابی کامل دیتابیس از بکاپ تاریخ ${item.jalaliDate}`,
      `هشدار مهم: تمامی داده‌های فعلی سامانه (دوره‌ها، کالاها، فاکتورها، فرمولاسیون، فروش، خزانه، حقوق و کاربران) با نسخه تاریخ ${item.jalaliDate} جایگزین خواهد شد.${statsInfo}\n\nآیا از بازیابی اطمینان دارید؟`,
      async () => {
        setIsBusy(true);
        try {
          const ok = await onRestoreDatabase(validation.database!, `بازیابی از تاریخ ${item.jalaliDate}`);
          if (ok) {
            setStatusBanner({
              type: 'success',
              text: `کل دیتابیس با موفقیت به نسخه تاریخ ${item.jalaliDate} بازیابی و همگام‌سازی شد.`,
            });
          }
        } finally {
          setIsBusy(false);
        }
      }
    );
  };

  const handleDeleteVaultItem = async (item: DailyBackupMetadata) => {
    askConfirm(
      'حذف نسخه پشتیبان',
      `آیا از حذف نسخه پشتیبان تاریخ ${item.jalaliDate} از تاریخچه مرورگر مطمئن هستید؟`,
      async () => {
        await deleteDailyBackupById(item.id);
        await loadBackupState();
      }
    );
  };

  const handleImportJsonBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAdmin) {
      alert('فقط مدیر ارشد مجاز به بازیابی کامل پایگاه داده است.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setStatusBanner({ type: 'error', text: 'خطا در خواندن فایل پشتیبان از سیستم.' });
    };
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '');
      const validation = parseAndValidateBackupJson(text);
      if (!validation.ok || !validation.database) {
        setStatusBanner({
          type: 'error',
          text: validation.error || 'فایل JSON انتخاب‌شده معتبر نیست.',
        });
        return;
      }

      const stats = validation.meta?.stats;
      const dateLabel = validation.meta?.jalaliDate || file.name;
      const statsInfo = stats
        ? `\n\nخلاصه داده‌های فایل: ${toPersianDigits(stats.items)} ماده اولیه، ${toPersianDigits(stats.products)} محصول، ${toPersianDigits(stats.personnel)} پرسنل، ${toPersianDigits(stats.salesTransactions)} ردیف فروش، ${toPersianDigits(stats.users)} کاربر و ${toPersianDigits(stats.roles)} نقش.`
        : '';

      askConfirm(
        'بازیابی کامل دیتابیس از فایل پشتیبان (JSON)',
        `هشدار امنیتی: با تایید این عملیات، کل پایگاه داده فعلی${serverMode === 'postgres' ? ' (از جمله PostgreSQL سرور و تمامی کاربران متصل)' : ''} با اطلاعات فایل «${dateLabel}» جایگزین خواهد شد.${statsInfo}\n\nادامه می‌دهید؟`,
        async () => {
          setIsBusy(true);
          try {
            const ok = await onRestoreDatabase(validation.database!, `بازیابی فایل ${file.name}`);
            if (ok) {
              setStatusBanner({
                type: 'success',
                text: `کل پایگاه داده با موفقیت از فایل «${file.name}» بازیابی و همگام‌سازی گردید.`,
              });
            }
          } finally {
            setIsBusy(false);
          }
        }
      );
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div
      className="fixed inset-0 bg-zinc-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in font-sans"
      dir="rtl"
    >
      <div className="glass-card rounded-3xl p-6 max-w-4xl w-full space-y-5 text-zinc-100 overflow-y-auto max-h-[92vh] border border-zinc-800 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-400" />
              مرکز پشتیبان‌گیری روزانه و بازیابی کامل دیتابیس سامانه
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              {isAdmin
                ? 'تهیه نسخه پشتیبان کامل (JSON و اکسل)، برنامه‌ریزی ذخیره خودکار روزانه روی سیستم مدیر و بازیابی مطمئن کل پایگاه داده'
                : 'خروجی گرفتن اکسل اطلاعات مجاز سامانه'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {statusBanner && (
          <div
            className={`p-3 rounded-2xl border text-xs flex items-center gap-2 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                : statusBanner.type === 'error'
                ? 'bg-rose-950/40 border-rose-700/50 text-rose-300'
                : 'bg-sky-950/40 border-sky-700/50 text-sky-300'
            }`}
          >
            {statusBanner.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* Section 1: Admin Full JSON Backup, Daily Auto Backup & Restore */}
        {isAdmin && (
          <div className="space-y-4 border border-emerald-800/40 bg-emerald-950/10 rounded-2xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileJson className="h-5 w-5 text-emerald-400" />
                <div>
                  <h4 className="text-sm font-black text-white">
                    پشتیبان‌گیری کامل و روزانه روی سیستم مدیر (Lossless JSON Snapshot)
                  </h4>
                  <p className="text-[11px] text-zinc-400">
                    تمامی جداول، کدهای حسابداری، فرمولاسیون، فروش، خزانه، حقوق، نقش‌های کاربری و کاربران بدون هیچ‌گونه تغییر یا محدودیت ستون ذخیره و بازیابی می‌شوند.
                  </p>
                </div>
              </div>
              <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 shrink-0">
                منبع فعلی: {serverMode === 'postgres' ? 'PostgreSQL سرور' : 'حافظه محلی'}
              </span>
            </div>

            {/* Instant Download & Restore Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleRunManualBackup(true)}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
              >
                {isBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                تهیه و دانلود فوری فایل کامل پشتیبان (.json)
              </button>

              <label className="bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all">
                <RotateCcw className="h-4 w-4" />
                بازیابی کامل دیتابیس از فایل پشتیبان (.json)
                <input
                  id="db-backup-json-import"
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonBackup}
                  className="hidden"
                />
              </label>
            </div>

            {/* Daily Auto-Backup Config */}
            <div className="bg-zinc-950/75 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4.5 w-4.5 text-amber-400" />
                  <span className="text-xs font-bold text-zinc-100">
                    زمان‌بندی پشتیبان‌گیری خودکار روزانه روی سیستم شما
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400">
                  آخرین بکاپ:{' '}
                  {settings.lastBackupTime ? (
                    <span className="text-emerald-400 font-bold">
                      {new Date(settings.lastBackupTime).toLocaleString('fa-IR')} ({formatMethodLabel(settings.lastBackupMethod)})
                    </span>
                  ) : (
                    <span className="text-amber-300">هنوز ثبت نشده</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-200 bg-zinc-900/70 p-2.5 rounded-xl border border-zinc-800">
                  <input
                    type="checkbox"
                    checked={settings.autoBackupEnabled}
                    onChange={(e) => handleToggleSetting({ autoBackupEnabled: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 h-4 w-4"
                  />
                  <span>فعال‌سازی پشتیبان‌گیری خودکار روزانه (توسط مدیر سیستم)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-200 bg-zinc-900/70 p-2.5 rounded-xl border border-zinc-800">
                  <input
                    type="checkbox"
                    checked={settings.autoDownloadFile}
                    onChange={(e) => handleToggleSetting({ autoDownloadFile: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 h-4 w-4"
                  />
                  <span>دانلود خودکار فایل روی سیستم در صورت عدم اتصال پوشه مستقیم</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                    زمان اجرای خودکار روزانه:
                  </label>
                  <select
                    value={settings.scheduledHour}
                    onChange={(e) => handleToggleSetting({ scheduledHour: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  >
                    <option value={0}>اولین ورود مدیر در هر روز (۰۰:۰۰ به بعد)</option>
                    {Array.from({ length: 23 }, (_, idx) => idx + 1).map((h) => (
                      <option key={h} value={h}>
                        ساعت {toPersianDigits(String(h).padStart(2, '0'))}:۰۰ به بعد
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                    نگهداری تاریخچه نسخه‌های روزانه:
                  </label>
                  <select
                    value={settings.retentionDays}
                    onChange={(e) => handleToggleSetting({ retentionDays: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  >
                    <option value={7}>{toPersianDigits(7)} نسخه اخیر</option>
                    <option value={15}>{toPersianDigits(15)} نسخه اخیر</option>
                    <option value={30}>{toPersianDigits(30)} نسخه اخیر (پیش‌فرض)</option>
                    <option value={60}>{toPersianDigits(60)} نسخه اخیر</option>
                    <option value={90}>{toPersianDigits(90)} نسخه اخیر</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleRunManualBackup(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                >
                  <HardDrive className="h-4 w-4" />
                  ذخیره نسخه پشتیبان همین الان
                </button>
              </div>

              {/* Direct OS Folder Picker */}
              <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-0.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-zinc-200">
                    {settings.directoryName ? (
                      <FolderCheck className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <FolderOpen className="h-4 w-4 text-sky-400" />
                    )}
                    <span>
                      {settings.directoryName
                        ? `پوشه متصل روی سیستم: ${settings.directoryName}`
                        : 'انتخاب پوشه اختصاصی روی کامپیوتر (اختیاری)'}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-zinc-400">
                    {fsSupported
                      ? 'با انتخاب یک پوشه روی هارد کامپیوتر (در مرورگرهای Chrome / Edge)، بکاپ‌های روزانه مستقیماً داخل همان پوشه ذخیره می‌شوند.'
                      : 'مرورگر یا بستر فعلی از دسترسی مستقیم پوشه پشتیبانی نمی‌کند؛ بکاپ روزانه از طریق دانلود فایل در پوشه Downloads و خزانه سیستم انجام می‌شود.'}
                  </p>
                </div>

                {fsSupported && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="bg-sky-700 hover:bg-sky-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                    >
                      {settings.directoryName ? 'تغییر پوشه' : 'انتخاب پوشه سیستم'}
                    </button>
                    {settings.directoryName && (
                      <button
                        type="button"
                        onClick={handleDisconnectFolder}
                        className="bg-zinc-800 hover:bg-rose-950 text-rose-300 border border-zinc-700 text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer"
                      >
                        قطع اتصال
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Daily Backup History Vault */}
            <div className="bg-zinc-950/75 border border-zinc-800 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-zinc-200">
                  تاریخچه نسخه‌های پشتیبان ذخیره‌شده روی این سیستم ({toPersianDigits(history.length)} نسخه)
                </h5>
                <span className="text-[10.5px] text-zinc-500">
                  امکان دانلود مجدد یا بازیابی یک‌کلیکی کل پایگاه داده از هر تاریخ
                </span>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-4 text-xs text-zinc-500">
                  هنوز نسخه پشتیبانی در خزانه این سیستم ثبت نشده است. با کلیک بر روی «ذخیره نسخه پشتیبان همین الان» اولین بکاپ ثبت می‌شود.
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto border border-zinc-800/80 rounded-xl">
                  <table className="w-full text-[11px] text-right">
                    <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">تاریخ و ساعت</th>
                        <th className="py-2 px-2.5">منبع و روش</th>
                        <th className="py-2 px-2.5">خلاصه اطلاعات</th>
                        <th className="py-2 px-2.5">حجم</th>
                        <th className="py-2 px-2.5 text-left">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-zinc-900/50">
                          <td className="py-2 px-2.5">
                            <div className="font-bold text-zinc-200">{item.jalaliDate}</div>
                            <div className="text-[10px] text-zinc-400 font-mono" dir="ltr">
                              {new Date(item.createdAt).toLocaleTimeString('fa-IR')} ({item.trigger === 'auto' ? 'خودکار' : 'دستی'})
                            </div>
                          </td>
                          <td className="py-2 px-2.5">
                            <div className="text-emerald-400 font-semibold">
                              {item.sourceMode === 'postgres' ? 'PostgreSQL' : 'محلی'}
                            </div>
                            <div className="text-[10px] text-zinc-400">{formatMethodLabel(item.method)}</div>
                          </td>
                          <td className="py-2 px-2.5 text-zinc-300">
                            {toPersianDigits(item.stats.items)} ماده • {toPersianDigits(item.stats.products)} محصول •{' '}
                            {toPersianDigits(item.stats.personnel)} پرسنل • {toPersianDigits(item.stats.salesTransactions)} فروش
                          </td>
                          <td className="py-2 px-2.5 font-mono text-zinc-300">{formatBytes(item.sizeBytes)}</td>
                          <td className="py-2 px-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDownloadVaultItem(item)}
                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-300 rounded-lg text-[10.5px] font-bold flex items-center gap-1 cursor-pointer"
                                title="دانلود فایل بکاپ JSON"
                              >
                                <Download className="h-3 w-3" /> دانلود
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleRestoreVaultItem(item)}
                                className="px-2 py-1 bg-sky-900/60 hover:bg-sky-800 text-sky-200 border border-sky-700/50 rounded-lg text-[10.5px] font-bold flex items-center gap-1 cursor-pointer"
                                title="بازیابی کل دیتابیس به این نسخه"
                              >
                                <RotateCcw className="h-3 w-3" /> بازیابی
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDeleteVaultItem(item)}
                                className="p-1 bg-zinc-800 hover:bg-rose-950 text-rose-400 rounded-lg cursor-pointer"
                                title="حذف نسخه"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 2: Excel Multi-sheet Backup & Restore */}
        <div className="space-y-3 border border-zinc-800 rounded-2xl p-4 bg-zinc-900/30">
          <div>
            <h4 className="text-sm font-extrabold text-white flex items-center gap-1.5">
              <Database className="h-4.5 w-4.5 text-indigo-400" />
              پشتیبان‌گیری و گزارش‌گیری اکسل چند برگه‌ای (Excel)
            </h4>
            <p className="text-[11px] text-zinc-400 mt-1">
              خروجی گرفتن تمام جداول، فرمول‌ها، رکوردهای فروش، ترازوی دیبال M-525 و ریز محاسبات حقوق در قالب شیت‌های منظم اکسل جهت بررسی یا ویرایش گروهی.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-zinc-800 p-3.5 rounded-2xl bg-zinc-900/50 flex flex-col justify-between items-center text-center space-y-2.5">
              <div>
                <h5 className="text-xs font-black text-zinc-200">خروجی اکسل چند برگه‌ای (دانلود بکاپ)</h5>
                <p className="text-[10px] text-zinc-500 mt-0.5">دریافت فایل XLSX شیت‌بندی شده</p>
              </div>
              <button
                type="button"
                onClick={onExportExcelBackup}
                className="w-full bg-zinc-800 text-emerald-400 border border-zinc-700 hover:bg-zinc-700 hover:text-emerald-300 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              >
                <Download className="h-4 w-4" /> تهیه فایل اکسل جامع
              </button>
            </div>

            {isAdmin && (
              <div className="border border-zinc-800 p-3.5 rounded-2xl bg-zinc-900/50 flex flex-col justify-between items-center text-center space-y-2.5">
                <div>
                  <h5 className="text-xs font-black text-zinc-200">بازیابی اطلاعات از فایل اکسل (Excel)</h5>
                  <p className="text-[10px] text-zinc-500 mt-0.5">بارگذاری شیت‌های اکسل و بروزرسانی دیتابیس</p>
                </div>
                <label className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl text-xs cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all">
                  <Upload className="h-4 w-4" /> بارگذاری فایل اکسل جامع
                  <input
                    id="db-backup-excel-import"
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    onChange={onImportExcelBackup}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Dibal Scale Management Backup Block */}
          <div className="border border-rose-900/50 p-3.5 rounded-2xl bg-rose-950/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-rose-400" />
                <h5 className="text-xs font-black text-rose-200">پشتیبان‌گیری اختصاصی ترازوهای دیبال (Dibal M-525)</h5>
              </div>
              <span className="text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full font-mono">
                Model M-525 DFW
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onExportDibalExcelBackup}
                className="bg-zinc-800 hover:bg-zinc-700 text-rose-300 border border-zinc-700 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              >
                <Download className="h-4 w-4" /> ارسال اطلاعات ترازو دیبال به اکسل
              </button>
              <label className="bg-rose-900/80 hover:bg-rose-800 text-white font-bold py-2 px-3 rounded-xl text-xs cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all border border-rose-700">
                <Upload className="h-4 w-4" /> دریافت اطلاعات ترازو دیبال از اکسل
                <input
                  id="dibal-backup-excel-import"
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={onImportDibalExcelBackup}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Factory Reset */}
        {isAdmin && (
          <div className="border border-rose-950/40 bg-zinc-900/30 p-3.5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-right">
            <div>
              <h4 className="text-xs font-bold text-rose-300 flex items-center gap-1">
                <ShieldAlert className="h-4 w-4 text-rose-400" /> پاک‌سازی و ریست کارخانه کل سیستم
              </h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                حذف همگانی و بازنشانی کلیه اقلام، فاکتورها و دوره‌ها به حالت خام اولیه.
              </p>
            </div>
            <button
              type="button"
              onClick={onPurgeAllDatabase}
              className="w-full sm:w-auto px-4 py-2 bg-rose-700/80 hover:bg-rose-700 text-white font-bold text-xs rounded-xl border border-rose-600 shadow cursor-pointer transition-colors shrink-0"
            >
              پاک‌سازی دیتابیس
            </button>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 font-bold text-xs rounded-xl cursor-pointer transition-colors"
          >
            بستن پنجره پشتیبان
          </button>
        </div>
      </div>
    </div>
  );
}
