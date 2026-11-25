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
  Server,
  CloudUpload,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Check
} from 'lucide-react';
import { isAdminUser } from '../shared/rbac';
import { toPersianDigits } from '../utils/persianUtils';
import { ERP_BUTTON_LABELS, ErpButton, UnifiedModal } from './ui/UnifiedErpUi';
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
  fetchServerBackups,
  createServerBackup,
  restoreServerBackup,
  deleteServerBackup,
  type ServerBackupItem,
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

  const [activeTab, setActiveTab] = useState<'local' | 'server' | 'excel'>('local');
  const [settings, setSettings] = useState<DailyBackupSettings>(DEFAULT_DAILY_BACKUP_SETTINGS);
  const [history, setHistory] = useState<DailyBackupMetadata[]>([]);
  const [serverBackups, setServerBackups] = useState<ServerBackupItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const loadBackupState = async () => {
    if (!isAdmin) return;
    setIsBusy(true);
    try {
      const [s, h, srv] = await Promise.all([
        getDailyBackupSettings(),
        listDailyBackupsMeta(),
        fetchServerBackups()
      ]);
      setSettings(s);
      setHistory(h);
      setServerBackups(srv);
    } finally {
      setIsBusy(false);
    }
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
      text: `پوشه «${res.directoryName}» با موفقیت برای پشتیبان‌گیری متصل شد.`,
    });
  };

  const handleDisconnectFolder = async () => {
    await clearBackupDirectory();
    await loadBackupState();
    setStatusBanner({
      type: 'info',
      text: 'اتصال پوشه سیستم قطع شد.',
    });
  };

  const handleRunManualLocalBackup = async (forceDownload = false) => {
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
        text: 'نسخه پشتیبان محلی با موفقیت ایجاد و در تاریخچه مرورگر ثبت گردید.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateServerBackup = async () => {
    if (!isAdmin) return;
    setIsBusy(true);
    setStatusBanner(null);
    try {
      const res = await createServerBackup();
      if (!res.ok) {
        setStatusBanner({ type: 'error', text: res.error || 'خطا در ایجاد پشتیبان روی سرور' });
        return;
      }
      await loadBackupState();
      setStatusBanner({
        type: 'success',
        text: 'نسخه پشتیبان دیتابیس با موفقیت روی سرور (VPS) ذخیره شد.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreServerBackupItem = async (item: ServerBackupItem) => {
    if (!isAdmin) return;
    askConfirm(
      'بازیابی دیتابیس از سرور',
      `هشدار مهم: با بازیابی نسخه سرور (${item.filename})، تمام اطلاعات فعلی جایگزین خواهد شد. آیا مطمئن هستید؟`,
      async () => {
        setIsBusy(true);
        setStatusBanner(null);
        try {
          const res = await restoreServerBackup(item.filename);
          if (!res.ok) {
            setStatusBanner({ type: 'error', text: res.error || 'خطا در بازیابی پشتیبان سرور' });
            return;
          }
          // Reload full database from server or refresh page state
          window.location.reload();
        } finally {
          setIsBusy(false);
        }
      }
    );
  };

  const handleDeleteServerBackupItem = async (item: ServerBackupItem) => {
    askConfirm(
      'حذف نسخه پشتیبان سرور',
      `آیا از حذف فایل ${item.filename} از سرور مطمئن هستید؟`,
      async () => {
        await deleteServerBackup(item.filename);
        await loadBackupState();
      }
    );
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
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreVaultItem = async (item: DailyBackupMetadata) => {
    if (!isAdmin) return;
    const full = await getDailyBackupRecordById(item.id);
    if (!full || !full.payloadJson) {
      setStatusBanner({ type: 'error', text: 'محتوای این نسخه پشتیبان یافت نشد.' });
      return;
    }

    const validation = parseAndValidateBackupJson(full.payloadJson);
    if (!validation.ok || !validation.database) {
      setStatusBanner({ type: 'error', text: validation.error || 'ساختار نسخه پشتیبان معتبر نیست.' });
      return;
    }

    askConfirm(
      `بازیابی دیتابیس از تاریخ ${item.jalaliDate}`,
      `هشدار مهم: تمامی اطلاعات فعلی با این نسخه پشتیبان جایگزین خواهد شد. آیا مطمئن هستید؟`,
      async () => {
        setIsBusy(true);
        try {
          const ok = await onRestoreDatabase(validation.database!, `بازیابی از تاریخ ${item.jalaliDate}`);
          if (ok) {
            setStatusBanner({ type: 'success', text: `دیتابیس با موفقیت بازیابی شد.` });
          }
        } finally {
          setIsBusy(false);
        }
      }
    );
  };

  const handleDeleteVaultItem = async (item: DailyBackupMetadata) => {
    askConfirm('حذف نسخه پشتیبان', `آیا از حذف این مورد از تاریخچه مطمئن هستید؟`, async () => {
      await deleteDailyBackupById(item.id);
      await loadBackupState();
    });
  };

  const handleImportJsonBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAdmin) {
      alert('فقط مدیر ارشد مجاز به بازیابی است.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const text = event.target?.result as string;
        const validation = parseAndValidateBackupJson(text);
        if (!validation.ok || !validation.database) {
          setStatusBanner({ type: 'error', text: validation.error || 'فایل پشتیبان نامعتبر است.' });
          return;
        }

        askConfirm(
          'بازیابی از فایل JSON',
          'هشدار: تمامی داده‌های فعلی سامانه با داده‌های این فایل جایگزین خواهد شد. آیا ادامه می‌دهید؟',
          async () => {
            setIsBusy(true);
            try {
              const ok = await onRestoreDatabase(validation.database!, 'بازیابی از فایل انتخابی');
              if (ok) {
                setStatusBanner({ type: 'success', text: 'دیتابیس با موفقیت از فایل بارگذاری و بازیابی شد.' });
              }
            } finally {
              setIsBusy(false);
            }
          }
        );
      } catch (err: any) {
        setStatusBanner({ type: 'error', text: err?.message || 'خطا در خواندن فایل' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <UnifiedModal
      open={isOpen}
      onClose={onClose}
      title="مدیریت پیشرفته پشتیبان‌گیری و بازیابی دیتابیس"
      subtitle="حفاظت از اطلاعات، پشتیبان‌گیری روی سرور VPS و بازیابی امن"
      icon={<Database className="w-5 h-5 text-emerald-500" />}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-6 text-right" dir="rtl">
        {/* Status Banner */}
        {statusBanner && (
          <div
            className={`p-4 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : statusBanner.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                : 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBanner.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{statusBanner.text}</span>
            </div>
            <button type="button" onClick={() => setStatusBanner(null)} className="opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'local'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            پشتیبان‌گیری محلی و مرورگر
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('server')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'server'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            <Server className="w-4 h-4" />
            پشتیبان‌گیری روی سرور (VPS)
            {serverBackups.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px]">
                {toPersianDigits(serverBackups.length)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('excel')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'excel'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            پشتیبان‌گیری اکسل و ترازو
          </button>
        </div>

        {/* TAB 1: LOCAL & BROWSER */}
        {activeTab === 'local' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <Download className="w-5 h-5" />
                  <span>ایجاد نسخه پشتیبان فوری</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                  یک فایل فشرده JSON شامل کل اطلاعات دیتابیس (دوره‌ها، کالاها، انبار، فروش، پرسنل، حقوق، اسناد خزانه و تنظیمات) دانلود کنید.
                </p>
                <div className="pt-2 flex items-center gap-2">
                  <ErpButton
                    variant="primary"
                    disabled={isBusy}
                    onClick={() => handleRunManualLocalBackup(true)}
                    icon={<Download className="w-4 h-4" />}
                  >
                    دانلود فایل پشتیبان (JSON)
                  </ErpButton>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-bold text-sm">
                  <Upload className="w-5 h-5" />
                  <span>بازیابی دیتابیس از فایل</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                  فایل پشتیبان قبلی خود را انتخاب کنید تا کل اطلاعات سامانه جایگزین و همگام‌سازی شود.
                </p>
                <div className="pt-2">
                  <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm">
                    <Upload className="w-4 h-4" />
                    <span>انتخاب فایل و بازیابی</span>
                    <input type="file" accept=".json" onChange={handleImportJsonBackup} className="hidden" />
                  </label>
                </div>
              </div>
            </div>

            {/* Folder auto-backup settings */}
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">اتصال به پوشه سیستم برای ذخیره خودکار</h4>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    ذخیره مستقیم فایل‌های پشتیبان روزانه در پوشه انتخابی روی کامپیوتر شما
                  </p>
                </div>
                {fsSupported && (
                  <div className="flex items-center gap-2">
                    {settings.directoryName ? (
                      <ErpButton variant="danger" size="sm" onClick={handleDisconnectFolder}>
                        قطع اتصال پوشه
                      </ErpButton>
                    ) : (
                      <ErpButton variant="primary" size="sm" onClick={handlePickFolder} icon={<FolderOpen className="w-4 h-4" />}>
                        انتخاب پوشه
                      </ErpButton>
                    )}
                  </div>
                )}
              </div>
              {settings.directoryName && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <FolderCheck className="w-4 h-4 shrink-0" />
                  <span>پوشه متصل: <strong>{settings.directoryName}</strong></span>
                </div>
              )}
            </div>

            {/* Browser Vault History */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-emerald-500" />
                <span>تاریخچه نسخه‌های پشتیبان در حافظه مرورگر</span>
              </h4>
              {history.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 text-xs">
                  هیچ سابقه پشتیبانی در مرورگر ثبت نشده است.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {history.map(item => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                          <span>{item.jalaliDate}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                            {formatBytes(item.sizeBytes)}
                          </span>
                        </div>
                        <div className="text-slate-500 dark:text-zinc-400 flex items-center gap-3">
                          <span>مواد اولیه: {toPersianDigits(item.stats.items)}</span>
                          <span>محصولات: {toPersianDigits(item.stats.products)}</span>
                          <span>پرسنل: {toPersianDigits(item.stats.personnel)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDownloadVaultItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-medium flex items-center gap-1 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>دانلود</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRestoreVaultItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>بازیابی</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteVaultItem(item)}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SERVER-SIDE BACKUPS */}
        {activeTab === 'server' && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <Server className="w-5 h-5" />
                  <span>پشتیبان‌گیری روی سرور (VPS)</span>
                </div>
                <ErpButton
                  variant="primary"
                  disabled={isBusy}
                  onClick={handleCreateServerBackup}
                  icon={<CloudUpload className="w-4 h-4" />}
                >
                  تهیه پشتیبان جدید روی سرور
                </ErpButton>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                این قابلیت نسخه پشتیبان کامل پایگاه داده را مستقیماً در فضای ذخیره‌سازی سرور ابری (VPS) شما ذخیره می‌کند تا امنیت اطلاعات کاملاً تضمین شود.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-500" />
                <span>فایل‌های پشتیبان ذخیره‌شده روی سرور</span>
              </h4>
              {serverBackups.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 text-xs">
                  هیچ نسخه پشتیبانی روی سرور یافت نشد. برای شروع دکمه بالا را بزنید.
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {serverBackups.map(item => (
                    <div
                      key={item.filename}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                          <FileJson className="w-4 h-4 text-emerald-500" />
                          <span>{item.filename}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                            {formatBytes(item.sizeBytes)}
                          </span>
                        </div>
                        <div className="text-slate-500 dark:text-zinc-400">
                          تاریخ ایجاد: {toPersianDigits(new Date(item.createdAt).toLocaleString('fa-IR'))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`/api/server-backups/download/${encodeURIComponent(item.filename)}`}
                          download
                          className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-medium flex items-center gap-1 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>دانلود</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRestoreServerBackupItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>بازیابی از سرور</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteServerBackupItem(item)}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: EXCEL & DIBAL */}
        {activeTab === 'excel' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>پشتیبان‌گیری اکسل اطلاعات</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                  خروجی و ورود اطلاعات پایه، انبار و فروش در قالب فایل‌های اکسل استاندارد.
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <ErpButton variant="primary" size="sm" onClick={onExportExcelBackup} icon={<Download className="w-4 h-4" />}>
                    خروجی اکسل کل اطلاعات
                  </ErpButton>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-semibold cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>بارگذاری اکسل</span>
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={onImportExcelBackup} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold text-sm">
                  <Database className="w-5 h-5" />
                  <span>پشتیبان‌گیری ترازوهای دیبال</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                  مدیریت و پشتیبان‌گیری کدهای PLU و تنظیمات ترازوهای فروشگاهی دیبال.
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <ErpButton variant="secondary" size="sm" onClick={onExportDibalExcelBackup} icon={<Download className="w-4 h-4" />}>
                    خروجی اکسل دیبال
                  </ErpButton>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-semibold cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>بارگذاری اکسل دیبال</span>
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={onImportDibalExcelBackup} className="hidden" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </UnifiedModal>
  );
}
