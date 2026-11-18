/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppDatabase, User } from '../types';
import {
  Server, Database, RefreshCw, Upload, Download, Users, Shield, Plus,
  Edit3, Trash2, CheckCircle, AlertTriangle, HardDrive, Link, Activity, Lock, ChevronDown, ChevronUp
} from 'lucide-react';
import { toPersianDigits } from '../utils/persianUtils';
import { SYSTEM_TABS, isAdminUser } from '../shared/rbac';
import {
  type ServerDbStatus,
  type AuditLogItem,
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  fetchAuditLogs,
} from '../services/postgresSyncService';

interface DatabaseServerPanelProps {
  db: AppDatabase;
  currentUser: User;
  serverStatus: ServerDbStatus | null;
  pgSyncState: 'synced' | 'syncing' | 'error' | 'offline';
  lastPgSyncTime: string;
  onRefreshStatusAndPull: () => Promise<void>;
  onMigrateLocalToPostgres: () => Promise<void>;
  onUpdateDb: (nextDb: AppDatabase) => void;
  onOpenBackupPanel: () => void;
  // Legacy SQL Server & Sheets props
  sqlServerUrl: string;
  setSqlServerUrl: (val: string) => void;
  sqlServerApiKey: string;
  setSqlServerApiKey: (val: string) => void;
  sqlServerAutoSync: boolean;
  setSqlServerAutoSync: (val: boolean) => void;
  isSqlServerTesting: boolean;
  isSqlServerSyncing: boolean;
  sqlServerStatusMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  onTestSqlServerConnection: () => void;
  onSaveToSqlServer: () => void;
  onRestoreFromSqlServer: () => void;
  onDownloadSqlServerScript: () => void;
}

const ROLE_PRESETS: Record<string, string[]> = {
  'مدیر ارشد': ['*'],
  'حسابدار': ['items', 'suppliers', 'customers', 'sales', 'cogs', 'procurement', 'treasury', 'payroll', 'expenses'],
  'کاربر انبار': ['items', 'procurement', 'dibal_scale'],
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '۰ بایت';
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} KB`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} MB`;
}

export default function DatabaseServerPanel({
  db,
  currentUser,
  serverStatus,
  pgSyncState,
  lastPgSyncTime,
  onRefreshStatusAndPull,
  onMigrateLocalToPostgres,
  onUpdateDb,
  onOpenBackupPanel,
  sqlServerUrl,
  setSqlServerUrl,
  sqlServerApiKey,
  setSqlServerApiKey,
  sqlServerAutoSync,
  setSqlServerAutoSync,
  isSqlServerTesting,
  isSqlServerSyncing,
  sqlServerStatusMessage,
  onTestSqlServerConnection,
  onSaveToSqlServer,
  onRestoreFromSqlServer,
  onDownloadSqlServerScript,
}: DatabaseServerPanelProps) {
  const isAdmin = isAdminUser(currentUser);
  const isPgConnected = Boolean(serverStatus?.mode === 'postgres' && serverStatus?.connected);

  const [isBusy, setIsBusy] = useState(false);
  const [usersList, setUsersList] = useState<User[]>(db.users || []);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [showLegacySql, setShowLegacySql] = useState(false);

  // User Add/Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formFullName, setFormFullName] = useState('');
  const [formRole, setFormRole] = useState<'مدیر ارشد' | 'حسابدار' | 'کاربر انبار'>('حسابدار');
  const [formPassword, setFormPassword] = useState('');
  const [formPermissions, setFormPermissions] = useState<string[]>(['items', 'sales']);
  const [formIs2FA, setFormIs2FA] = useState(false);
  const [formSecretCode, setFormSecretCode] = useState('123456');
  const [formIsActive, setFormIsActive] = useState(true);
  const [userFormError, setUserFormError] = useState('');

  const loadPgAdminData = async () => {
    if (!isPgConnected || !isAdmin) {
      setUsersList(db.users || []);
      return;
    }
    const [uRes, logsRes] = await Promise.all([fetchAdminUsers(), fetchAuditLogs(40)]);
    if (uRes.ok) setUsersList(uRes.users);
    setAuditLogs(logsRes);
  };

  useEffect(() => {
    loadPgAdminData();
  }, [isPgConnected, isAdmin, db.users]);

  const openCreateUserModal = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormFullName('');
    setFormRole('حسابدار');
    setFormPassword('');
    setFormPermissions(ROLE_PRESETS['حسابدار']);
    setFormIs2FA(false);
    setFormSecretCode('123456');
    setFormIsActive(true);
    setUserFormError('');
    setIsUserModalOpen(true);
  };

  const openEditUserModal = (u: any) => {
    setEditingUser(u);
    setFormUsername(u.username || '');
    setFormFullName(u.fullName || u.name || '');
    setFormRole((u.role as any) || 'کاربر انبار');
    setFormPassword('');
    setFormPermissions(Array.isArray(u.permissions) ? u.permissions : []);
    setFormIs2FA(Boolean(u.is2FA));
    setFormSecretCode(u.secretCode || '123456');
    setFormIsActive(u.isActive !== false);
    setUserFormError('');
    setIsUserModalOpen(true);
  };

  const handleRoleChange = (nextRole: 'مدیر ارشد' | 'حسابدار' | 'کاربر انبار') => {
    setFormRole(nextRole);
    if (!editingUser) {
      setFormPermissions(ROLE_PRESETS[nextRole] || ['items']);
    }
  };

  const togglePermission = (tabId: string) => {
    if (tabId === '*') {
      setFormPermissions(formPermissions.includes('*') ? [] : ['*']);
      return;
    }
    const cleaned = formPermissions.filter((p) => p !== '*');
    if (cleaned.includes(tabId)) {
      setFormPermissions(cleaned.filter((p) => p !== tabId));
    } else {
      setFormPermissions([...cleaned, tabId]);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');

    if (!formUsername.trim()) {
      setUserFormError('نام کاربری الزامی است.');
      return;
    }
    if (!editingUser && !formPassword.trim()) {
      setUserFormError('رمز عبور برای کاربر جدید الزامی است.');
      return;
    }

    const finalPerms = formRole === 'مدیر ارشد' || formPermissions.includes('*')
      ? ['*']
      : formPermissions;

    if (isPgConnected) {
      setIsBusy(true);
      try {
        if (editingUser) {
          const res = await updateAdminUser(editingUser.id, {
            username: formUsername.trim(),
            fullName: formFullName.trim() || formUsername.trim(),
            role: formRole,
            permissions: finalPerms,
            password: formPassword.trim() ? formPassword.trim() : undefined,
            is2FA: formIs2FA,
            secretCode: formSecretCode.trim() || '123456',
            isActive: formIsActive,
          });
          if (!res.ok) {
            setUserFormError(res.error || 'خطا در ویرایش کاربر');
            return;
          }
        } else {
          const res = await createAdminUser({
            username: formUsername.trim(),
            fullName: formFullName.trim() || formUsername.trim(),
            role: formRole,
            permissions: finalPerms,
            password: formPassword.trim(),
            is2FA: formIs2FA,
            secretCode: formSecretCode.trim() || '123456',
            isActive: formIsActive,
          });
          if (!res.ok) {
            setUserFormError(res.error || 'خطا در ایجاد کاربر');
            return;
          }
        }
        await loadPgAdminData();
        setIsUserModalOpen(false);
      } finally {
        setIsBusy(false);
      }
    } else {
      // Local / Offline mode fallback
      const currentUsers = [...(db.users || [])];
      if (editingUser) {
        const updatedUsers = currentUsers.map((u) =>
          u.id === editingUser.id
            ? {
                ...u,
                username: formUsername.trim(),
                fullName: formFullName.trim() || formUsername.trim(),
                role: formRole,
                permissions: finalPerms,
                password: formPassword.trim() ? formPassword.trim() : u.password,
                is2FA: formIs2FA,
                secretCode: formSecretCode.trim() || '123456',
              }
            : u
        );
        onUpdateDb({ ...db, users: updatedUsers });
      } else {
        if (currentUsers.some((u) => u.username === formUsername.trim())) {
          setUserFormError('این نام کاربری قبلاً ثبت شده است.');
          return;
        }
        const newUser: User = {
          id: `usr-${Date.now()}`,
          username: formUsername.trim(),
          fullName: formFullName.trim() || formUsername.trim(),
          role: formRole,
          permissions: finalPerms,
          password: formPassword.trim(),
          is2FA: formIs2FA,
          secretCode: formSecretCode.trim() || '123456',
        };
        onUpdateDb({ ...db, users: [...currentUsers, newUser] });
      }
      setIsUserModalOpen(false);
    }
  };

  const handleDeleteUser = async (u: User) => {
    if (u.id === currentUser.id || u.username === currentUser.username) {
      alert('شما نمی‌توانید کاربر جاری خودتان را حذف کنید.');
      return;
    }
    if (!window.confirm(`آیا از حذف کاربر "${u.fullName || u.username}" اطمینان دارید؟`)) {
      return;
    }
    if (isPgConnected) {
      setIsBusy(true);
      try {
        const res = await deleteAdminUser(u.id);
        if (!res.ok) {
          alert(res.error || 'خطا در حذف کاربر');
          return;
        }
        await loadPgAdminData();
      } finally {
        setIsBusy(false);
      }
    } else {
      onUpdateDb({
        ...db,
        users: (db.users || []).filter((item) => item.id !== u.id),
      });
    }
  };

  const handleManualPull = async () => {
    setIsBusy(true);
    try {
      await onRefreshStatusAndPull();
      await loadPgAdminData();
    } finally {
      setIsBusy(false);
    }
  };

  const handleManualPushMigration = async () => {
    setIsBusy(true);
    try {
      await onMigrateLocalToPostgres();
      await loadPgAdminData();
    } finally {
      setIsBusy(false);
    }
  };

  const totalPgRecords = serverStatus?.collectionCounts
    ? Object.values(serverStatus.collectionCounts).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : 0;

  return (
    <div className="bg-[#121214] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl text-right space-y-6 animate-fade-in font-sans" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Server className="h-6 w-6 text-emerald-400" />
            مدیریت پایگاه داده مشترک (PostgreSQL) و کاربران
          </h2>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            تمامی داده‌های کالا، فروش، فرمولاسیون، حقوق و خزانه به صورت متمرکز در پایگاه داده PostgreSQL روی سرور Ubuntu 24 ذخیره شده و با سطح دسترسی تفکیک‌شده (RBAC) بین تمامی کاربران به اشتراک گذاشته می‌شوند.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenBackupPanel}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md transition-all shrink-0"
        >
          <Download className="h-4 w-4" /> پشتیبان‌گیری اکسل (فوری)
        </button>
      </div>

      {/* PostgreSQL Live Status Card */}
      <div className={`p-5 rounded-2xl border space-y-4 ${
        isPgConnected
          ? 'bg-emerald-950/15 border-emerald-800/40'
          : 'bg-zinc-900 border-zinc-800'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">وضعیت اتصال پایگاه داده:</span>
              {isPgConnected ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold bg-emerald-950/60 border border-emerald-700/50 px-3 py-1 rounded-lg">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  متصل به PostgreSQL سرور (اشتراک‌گذاری زنده فعال)
                </span>
              ) : serverStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 text-rose-400 text-xs font-bold bg-rose-950/40 border border-rose-800/50 px-3 py-1 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  خطا در اتصال به PostgreSQL: {serverStatus.error || 'پاسخی دریافت نشد'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-bold bg-amber-950/30 border border-amber-700/40 px-3 py-1 rounded-lg">
                  <HardDrive className="h-3.5 w-3.5" />
                  حالت آفلاین / پیش‌نمایش محلی (IndexedDB) — آماده استقرار روی سرور Ubuntu 24
                </span>
              )}
            </div>

            <div className="text-[11px] text-zinc-400 flex flex-wrap gap-x-5 gap-y-1">
              {isPgConnected ? (
                <>
                  <span>بانک اطلاعاتی: <strong className="text-zinc-200 font-mono">{serverStatus?.databaseName}</strong> ({serverStatus?.dbVersion})</span>
                  <span>حجم دیتابیس: <strong className="text-emerald-400">{formatBytes(serverStatus?.dbSizeBytes)}</strong></span>
                  <span>مجموع رکوردها: <strong className="text-emerald-400 font-mono">{toPersianDigits(totalPgRecords)}</strong></span>
                  <span>نشست‌های فعال: <strong className="text-sky-400 font-mono">{toPersianDigits(serverStatus?.activeSessionsCount || 1)}</strong> کاربر</span>
                  {lastPgSyncTime && (
                    <span>آخرین همگام‌سازی: <strong className="text-zinc-300">{lastPgSyncTime}</strong></span>
                  )}
                </>
              ) : (
                <span>
                  برای فعال‌سازی اتصال دائمی به PostgreSQL روی سرور Ubuntu 24، متغیر <code className="font-mono text-emerald-400 bg-zinc-950 px-1.5 py-0.5 rounded">DATABASE_URL</code> را در فایل <code className="font-mono text-emerald-400 bg-zinc-950 px-1.5 py-0.5 rounded">.env</code> سرور تنظیم و سرویس را اجرا نمایید.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleManualPull}
              className="bg-zinc-800 hover:bg-zinc-750 text-zinc-100 border border-zinc-700 text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className={`h-4 w-4 text-emerald-400 ${isBusy || pgSyncState === 'syncing' ? 'animate-spin' : ''}`} />
              {isPgConnected ? 'بروزرسانی از PostgreSQL' : 'بررسی مجدد اتصال سرور'}
            </button>

            {isPgConnected && isAdmin && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleManualPushMigration}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg transition-all"
              >
                <Upload className="h-4 w-4" />
                ارسال / جایگزینی کل داده‌های فعلی در PostgreSQL
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RBAC User Management Section (Admin Only) */}
      {isAdmin ? (
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="h-4.5 w-4.5 text-emerald-400" />
                مدیریت کاربران و سطوح دسترسی مشترک (RBAC)
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                هر کاربر با نام کاربری و رمز عبور اختصاصی وارد شده و تنها ماژول‌های مجاز خود را مشاهده و ویرایش می‌کند.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateUserModal}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
            >
              <Plus className="h-4 w-4" /> افزودن کاربر جدید
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 text-[11px]">
                  <th className="py-2.5 px-3">نام کاربری</th>
                  <th className="py-2.5 px-3">نام و نام خانوادگی</th>
                  <th className="py-2.5 px-3">نقش سازمانی</th>
                  <th className="py-2.5 px-3">دسترسی بخش‌ها</th>
                  <th className="py-2.5 px-3">وضعیت</th>
                  <th className="py-2.5 px-3 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {usersList.map((u: any) => {
                  const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
                  const hasAll = u.role === 'مدیر ارشد' || perms.includes('*');
                  return (
                    <tr key={u.id || u.username} className="hover:bg-zinc-850/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-zinc-200">{u.username}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{u.fullName || u.name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${
                          hasAll
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-zinc-400">
                        {hasAll ? (
                          <span className="text-emerald-400 font-bold">دسترسی کامل به کل سامانه</span>
                        ) : perms.length === 0 ? (
                          <span className="text-rose-400">بدون دسترسی</span>
                        ) : (
                          <span>
                            {perms
                              .map((p) => SYSTEM_TABS.find((t) => t.id === (p === 'orders' ? 'procurement' : p))?.label || p)
                              .join('، ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.isActive !== false ? (
                          <span className="text-emerald-400 text-[11px] font-bold">فعال</span>
                        ) : (
                          <span className="text-rose-400 text-[11px] font-bold">غیرفعال</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditUserModal(u)}
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-sky-400 rounded-lg cursor-pointer transition-colors"
                            title="ویرایش کاربر و سطح دسترسی"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {u.username !== currentUser.username && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 bg-zinc-800 hover:bg-rose-950 text-rose-400 rounded-lg cursor-pointer transition-colors"
                              title="حذف کاربر"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center gap-3 text-xs text-zinc-400">
          <Lock className="h-4 w-4 text-amber-400 shrink-0" />
          <span>مدیریت کاربران، انتقال کل دیتابیس و مشاهده گزارش وقایع فقط در سطح دسترسی <strong className="text-zinc-200">مدیر ارشد</strong> فعال است.</span>
        </div>
      )}

      {/* Audit Logs Viewer (when PostgreSQL connected & Admin) */}
      {isPgConnected && isAdmin && (
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-sky-400" />
              گزارش آخرین تغییرات و فعالیت کاربران (Audit Log)
            </h3>
            <button
              type="button"
              onClick={loadPgAdminData}
              className="text-[11px] text-sky-400 hover:text-sky-300 font-bold cursor-pointer"
            >
              بروزرسانی لیست
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-zinc-500">هنوز رویدادی در PostgreSQL ثبت نشده است.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto border border-zinc-850 rounded-xl">
              <table className="w-full text-[11px] text-right">
                <thead className="bg-zinc-950 text-zinc-400 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">کاربر</th>
                    <th className="py-2 px-3">عملیات</th>
                    <th className="py-2 px-3">بخش / جدول</th>
                    <th className="py-2 px-3">تعداد رکورد</th>
                    <th className="py-2 px-3">زمان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-850/30">
                      <td className="py-1.5 px-3 font-mono font-bold text-emerald-400">{log.username}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-200">{log.action}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{log.collectionKey || '-'}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-300">
                        {log.recordCount !== null ? toPersianDigits(log.recordCount) : '-'}
                      </td>
                      <td className="py-1.5 px-3 text-zinc-400 font-mono" dir="ltr">
                        {new Date(log.createdAt).toLocaleString('fa-IR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Legacy SQL Server / Google Sheets Panel */}
      <div className="border border-zinc-800 rounded-2xl bg-zinc-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLegacySql((prev) => !prev)}
          className="w-full p-4 flex items-center justify-between text-xs font-bold text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-400" />
            تنظیمات جانبی همگام‌سازی (SQL Server فروشگاه محلی و Google Sheets)
          </span>
          {showLegacySql ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showLegacySql && (
          <div className="p-5 border-t border-zinc-800 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  آدرس سرور فروشگاه (SQL Server REST API URL):
                </label>
                <input
                  type="text"
                  value={sqlServerUrl}
                  onChange={(e) => setSqlServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:5000/api"
                  className="w-full bg-zinc-950 text-zinc-100 border border-zinc-800 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  کلید دسترسی API Key (اختیاری):
                </label>
                <input
                  type="password"
                  value={sqlServerApiKey}
                  onChange={(e) => setSqlServerApiKey(e.target.value)}
                  className="w-full bg-zinc-950 text-zinc-100 border border-zinc-800 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sql-auto-sync-check"
                  checked={sqlServerAutoSync}
                  onChange={(e) => {
                    setSqlServerAutoSync(e.target.checked);
                    onUpdateDb({
                      ...db,
                      sqlServerConfig: { ...db.sqlServerConfig, autoSync: e.target.checked },
                    });
                  }}
                  className="rounded border-zinc-700 text-blue-600 h-4 w-4 bg-zinc-950 cursor-pointer"
                />
                <label htmlFor="sql-auto-sync-check" className="text-xs text-zinc-300 cursor-pointer font-bold">
                  همگام‌سازی خودکار با SQL Server فروشگاه
                </label>
              </div>
              {sqlServerStatusMessage && (
                <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  sqlServerStatusMessage.type === 'success'
                    ? 'bg-emerald-950/30 text-emerald-300'
                    : sqlServerStatusMessage.type === 'error'
                    ? 'bg-rose-950/30 text-rose-300'
                    : 'bg-blue-950/30 text-blue-300'
                }`}>
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{sqlServerStatusMessage.text}</span>
                </div>
              )}
              <button
                type="button"
                onClick={onTestSqlServerConnection}
                disabled={isSqlServerTesting}
                className="w-full bg-zinc-800 hover:bg-zinc-750 text-blue-300 border border-zinc-700 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-2"
              >
                <Link className="h-4 w-4" /> تست اتصال SQL Server
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onSaveToSqlServer}
                  disabled={isSqlServerSyncing}
                  className="bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Upload className="h-4 w-4" /> ارسال (Push)
                </button>
                <button
                  type="button"
                  onClick={onRestoreFromSqlServer}
                  disabled={isSqlServerSyncing}
                  className="bg-zinc-800 hover:bg-zinc-750 text-amber-300 border border-zinc-700 py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Download className="h-4 w-4" /> دریافت (Pull)
                </button>
              </div>
              <button
                type="button"
                onClick={onDownloadSqlServerScript}
                className="w-full bg-zinc-950 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-2"
              >
                <Download className="h-4 w-4" /> دانلود اسکریپت T-SQL (SSMS)
              </button>
              <div>
                <label className="block text-[10.5px] font-semibold text-zinc-400 mb-1">
                  آدرس وب‌هوک گوگل شیت (اختیاری):
                </label>
                <input
                  type="text"
                  value={db.googleSheetsUrl || ''}
                  onChange={(e) => onUpdateDb({ ...db, googleSheetsUrl: e.target.value })}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full bg-zinc-950 text-zinc-200 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Shield className="h-4.5 w-4.5 text-emerald-400" />
                {editingUser ? `ویرایش کاربر: ${editingUser.username}` : 'تعریف کاربر جدید'}
              </h3>
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نام کاربری (انگلیسی)</label>
                  <input
                    type="text"
                    required
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نام و نام خانوادگی</label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نقش کاربر</label>
                  <select
                    value={formRole}
                    onChange={(e) => handleRoleChange(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  >
                    <option value="مدیر ارشد">مدیر ارشد (دسترسی کامل)</option>
                    <option value="حسابدار">حسابدار</option>
                    <option value="کاربر انبار">کاربر انبار</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                    {editingUser ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={editingUser ? 'در صورت تغییر وارد کنید...' : 'رمز عبور'}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  حساب فعال است
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={formIs2FA}
                    onChange={(e) => setFormIs2FA(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  تایید دو مرحله‌ای (2FA)
                </label>
                {formIs2FA && (
                  <input
                    type="text"
                    maxLength={6}
                    value={formSecretCode}
                    onChange={(e) => setFormSecretCode(e.target.value)}
                    placeholder="کد ۶ رقمی"
                    className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs font-mono text-center text-white"
                    dir="ltr"
                  />
                )}
              </div>

              {formRole !== 'مدیر ارشد' && (
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <label className="block text-[11px] font-bold text-zinc-300">
                    بخش‌های مجاز برای مشاهده و ویرایش:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-zinc-900/60 rounded-xl border border-zinc-800">
                    {SYSTEM_TABS.filter((t) => t.id !== 'cloud_sync').map((tab) => {
                      const checked = formPermissions.includes('*') || formPermissions.includes(tab.id);
                      return (
                        <label key={tab.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(tab.id)}
                            className="rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                          />
                          <span>{tab.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {userFormError && (
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                  {userFormError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  {editingUser ? 'ذخیره تغییرات کاربر' : 'ایجاد کاربر'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
