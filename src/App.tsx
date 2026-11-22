/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, User, Period } from './types';
import { loadDatabase, loadDatabaseAsync, saveDatabase, getInitialDatabase, syncWithGoogleSheets, loadDatabaseFromSqlServer, saveDatabaseToSqlServer, sanitizeAndMergeDatabase, sanitizeChangedCollections } from './db';
import LoginScreen from './components/LoginScreen';
import ItemManagement from './components/ItemManagement';
import SupplierManagement from './components/SupplierManagement';
import SalesManagement from './components/SalesManagement';
import CogsManagement from './components/CogsManagement';
import ProcurementManagement from './components/ProcurementManagement';
import PayrollManagement from './components/PayrollManagement';
import ExpenseManagement from './components/ExpenseManagement';
import ProductionPlanning from './components/ProductionPlanning';
import DibalScaleManagement from './components/DibalScaleManagement';
import CustomerManagement from './components/CustomerManagement';
import TreasuryManagement from './components/TreasuryManagement';
import DatabaseServerPanel from './components/DatabaseServerPanel';
import DatabaseBackupModal from './components/DatabaseBackupModal';
import PublicDigitalMenu from './components/PublicDigitalMenu';
import DigitalMenuAdmin from './components/DigitalMenuAdmin';
import { performDatabaseBackup } from './services/backupService';
import { testSqlServerConnection, pushToSqlServer, pullFromSqlServer, downloadSqlServerDDLScript } from './services/sqlServerService';
import { exportDatabaseToExcel, importExcelToDatabase, exportDibalDataToExcel, importDibalDataFromExcel } from './utils/excelService';
import {
  canAccessTab,
  getFirstAllowedTab,
  isAdminUser,
  canWriteCollection,
  CLIENT_ONLY_DB_KEYS,
  type SystemTabId,
} from './shared/rbac';
import {
  fetchPostgresStatus,
  fetchPublicUsers,
  fetchCurrentUser,
  logoutFromPostgres,
  loadSharedDatabaseFromPostgres,
  fetchPostgresVersions,
  syncDeltaToPostgres,
  importDatabaseToPostgres,
  type ServerDbStatus,
  type PublicUserSummary,
  type RecordPatchPayload,
} from './services/postgresSyncService';

import { 
  Database, RefreshCw, LogOut, ChevronDown, CheckCircle, AlertTriangle, 
  Settings, FolderKanban, ShieldAlert, Wifi, WifiOff, FileJson, Upload, LayoutDashboard,
  Boxes, Users2, LineChart, Banknote, FileCheck, Landmark, GraduationCap, Coins, Download, Cloud, Check,
  Trash2, Calendar, Scale, Users, Server, HardDrive, Link, Copy, MoreVertical, X, Sun, Moon, QrCode
} from 'lucide-react';
import {
  toPersianDigits,
  toEnglishDigits,
  normalizeAccountingCode,
  getProductFormulaKey,
  getMaterialFormulaKey
} from './utils/persianUtils';
import { useTheme } from './utils/theme';

function isPublicMenuPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/menu' || normalized.startsWith('/menu/');
}

export default function App() {
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (isPublicMenuPath(pathname)) {
    return <PublicDigitalMenu />;
  }

  return (
    <ErpApplication
      onOpenPublicMenu={() => {
        if (typeof window !== 'undefined') {
          window.history.pushState({}, '', '/menu');
          setPathname('/menu');
        }
      }}
    />
  );
}

function ErpApplication({ onOpenPublicMenu }: { onOpenPublicMenu: () => void }) {
  const { isDark, toggleTheme } = useTheme();
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // PostgreSQL Shared Server States
  const [serverStatus, setServerStatus] = useState<ServerDbStatus | null>(null);
  const [publicUsers, setPublicUsers] = useState<PublicUserSummary[]>([]);
  const [pgSyncState, setPgSyncState] = useState<'synced' | 'syncing' | 'error' | 'offline'>('offline');
  const [lastPgSyncTime, setLastPgSyncTime] = useState('');
  const [showLocalMigrationBanner, setShowLocalMigrationBanner] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [backupRevision, setBackupRevision] = useState(0);
  const [pendingBackupFolderPrompt, setPendingBackupFolderPrompt] = useState(false);

  const lastSyncedDbRef = useRef<AppDatabase | null>(null);
  const latestDbRef = useRef<AppDatabase | null>(null);
  const collectionVersionsRef = useRef<Record<string, number>>({});
  const pgSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPgSyncInFlightRef = useRef(false);
  const pendingResyncRef = useRef(false);
  const currentUserRef = useRef<User | null>(null);
  const serverMode: 'postgres' | 'local' =
    serverStatus?.mode === 'postgres' && serverStatus?.connected ? 'postgres' : 'local';

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  
  // SQL Server Store Database States
  const [sqlServerUrl, setSqlServerUrl] = useState('');
  const [sqlServerApiKey, setSqlServerApiKey] = useState('');
  const [sqlServerAutoSync, setSqlServerAutoSync] = useState(true);
  const [isSqlServerTesting, setIsSqlServerTesting] = useState(false);
  const [isSqlServerSyncing, setIsSqlServerSyncing] = useState(false);
  const [sqlServerStatusMessage, setSqlServerStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);

  // App parameters
  const [activePeriodId, setActivePeriodId] = useState('1405-01'); // Default to preloaded Period 1 (1405-01)
  const [activeTab, setActiveTab] = useState<string>('items');
  const [isOnline, setIsOnline] = useState(true);
  const [googleSheetsSyncStatus, setGoogleSheetsSyncStatus] = useState<'synced' | 'pending' | 'failed'>('synced');
  const [mobileHasSelectedForm, setMobileHasSelectedForm] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Modals
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [showPeriodManager, setShowPeriodManager] = useState(false);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [copySourcePeriodId, setCopySourcePeriodId] = useState<string>('');
  const [cleanupTargetPeriod, setCleanupTargetPeriod] = useState<Period | null>(null);
  const [cleanupConfirmInput, setCleanupConfirmInput] = useState<string>('');

  // Custom confirmation modal state for sandboxed iframe compatibility
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const askConfirm = (title: string, message: string, action: () => void) => {
    setConfirmModal({
      title,
      message,
      onConfirm: action
    });
  };

  // Period dates states & Shamsi Date Picker helpers
  const [newPeriodStartDate, setNewPeriodStartDate] = useState<string>('1405/01/01');
  const [newPeriodEndDate, setNewPeriodEndDate] = useState<string>('1405/12/29');
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [editPeriodName, setEditPeriodName] = useState<string>('');
  const [editPeriodStartDate, setEditPeriodStartDate] = useState<string>('');
  const [editPeriodEndDate, setEditPeriodEndDate] = useState<string>('');

  const [openDatePickerId, setOpenDatePickerId] = useState<string | null>(null);
  const [pickerYear, setPickerYear] = useState<number>(1405);
  const [pickerMonth, setPickerMonth] = useState<number>(1);

  const isShamsiLeap = (jy: number): boolean => {
    const r = jy % 33;
    return r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
  };

  const getShamsiMonthDays = (jy: number, jm: number): number => {
    if (jm >= 1 && jm <= 6) return 31;
    if (jm >= 7 && jm <= 11) return 30;
    if (jm === 12) {
      return isShamsiLeap(jy) ? 30 : 29;
    }
    return 30;
  };

  const jalaliToGregorian = (jy: number, jm: number, jd: number): Date => {
    const jy_offset = jy - 979;
    const jm_offset = jm - 1;
    const jd_offset = jd - 1;

    let j_day_no = 365 * jy_offset + Math.floor(jy_offset / 33) * 8 + Math.floor(((jy_offset % 33) + 3) / 4);
    for (let i = 0; i < jm_offset; ++i) {
      j_day_no += (i < 6) ? 31 : 30;
    }
    j_day_no += jd_offset;

    let g_day_no = j_day_no + 79;

    let gy = 1600 + 400 * Math.floor(g_day_no / 146097);
    g_day_no = g_day_no % 146097;

    let leap = true;
    if (g_day_no >= 36525) {
      g_day_no--;
      gy += 100 * Math.floor(g_day_no / 36524);
      g_day_no = g_day_no % 36524;

      if (g_day_no >= 365) {
        g_day_no++;
      } else {
        leap = false;
      }
    }

    gy += 4 * Math.floor(g_day_no / 1461);
    g_day_no = g_day_no % 1461;

    if (g_day_no >= 366) {
      leap = false;
      g_day_no--;
      gy += Math.floor(g_day_no / 365);
      g_day_no = g_day_no % 365;
    }

    let gd = g_day_no + 1;
    const sal_g = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0;
    for (let i = 1; i <= 12; i++) {
      if (gd <= sal_g[i]) {
        gm = i;
        break;
      }
      gd -= sal_g[i];
    }
    return new Date(gy, gm - 1, gd);
  };

  const getShamsiWeekdayStart = (jy: number, jm: number): number => {
    const gd = jalaliToGregorian(jy, jm, 1);
    const gDay = gd.getDay();
    return (gDay + 1) % 7;
  };

  const renderShamsiDatePicker = (
    id: string,
    label: string,
    value: string,
    onChange: (val: string) => void
  ) => {
    const parts = value.split('/');
    const currentY = parseInt(parts[0]) || 1405;
    const currentM = parseInt(parts[1]) || 1;
    const currentD = parseInt(parts[2]) || 1;

    const daysCount = getShamsiMonthDays(pickerYear, pickerMonth);
    const startWeekday = getShamsiWeekdayStart(pickerYear, pickerMonth);

    const monthNames = [
      'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
      'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
    ];

    const days = [];
    for (let i = 0; i < startWeekday; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysCount; i++) {
      days.push(i);
    }

    const togglePicker = () => {
      if (openDatePickerId === id) {
        setOpenDatePickerId(null);
      } else {
        setOpenDatePickerId(id);
        setPickerYear(currentY);
        setPickerMonth(currentM);
      }
    };

    const handleSelectDay = (day: number) => {
      const yy = pickerYear;
      const mm = String(pickerMonth).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      onChange(`${yy}/${mm}/${dd}`);
      setOpenDatePickerId(null);
    };

    return (
      <div className="relative space-y-1.5 text-right font-sans" dir="rtl">
        <label className="block text-[10.5px] font-bold text-zinc-400">{label}</label>
        <div className="relative">
          <input
            type="text"
            readOnly
            onClick={togglePicker}
            value={toPersianDigits(value)}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 outline-none transition-all font-mono font-bold cursor-pointer"
          />
          <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
        </div>

        {openDatePickerId === id && (
          <div className="absolute z-50 mt-1 w-64 bg-zinc-950 border border-zinc-800 rounded-2xl p-3 shadow-2xl space-y-3 font-sans animate-fade-in">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  if (pickerMonth === 12) {
                    setPickerMonth(1);
                    setPickerYear(prev => prev + 1);
                  } else {
                    setPickerMonth(prev => prev + 1);
                  }
                }}
                className="p-1 hover:bg-zinc-850 rounded text-zinc-400 hover:text-white transition-colors"
              >
                &lt;
              </button>
              <span className="text-xs font-black text-white">
                {monthNames[pickerMonth - 1]} {toPersianDigits(String(pickerYear))}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (pickerMonth === 1) {
                    setPickerMonth(12);
                    setPickerYear(prev => prev - 1);
                  } else {
                    setPickerMonth(prev => prev - 1);
                  }
                }}
                className="p-1 hover:bg-zinc-850 rounded text-zinc-400 hover:text-white transition-colors"
              >
                &gt;
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-500 font-bold border-b border-zinc-900 pb-1.5">
              <span>ش</span>
              <span>ی</span>
              <span>د</span>
              <span>س</span>
              <span>چ</span>
              <span>پ</span>
              <span>ج</span>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {days.map((day, idx) => {
                if (day === null) return <span key={`empty-${idx}`} />;
                const isSelected = pickerYear === currentY && pickerMonth === currentM && day === currentD;
                return (
                  <button
                    key={`day-${day}`}
                    type="button"
                    onClick={() => handleSelectDay(day)}
                    className={`h-7 w-7 rounded-lg flex items-center justify-center font-bold font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-600 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {toPersianDigits(String(day))}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleStartEditPeriod = (p: Period) => {
    setEditingPeriod(p);
    setEditPeriodName(p.name);
    setEditPeriodStartDate(p.startDate || '1405/01/01');
    setEditPeriodEndDate(p.endDate || '1405/12/29');
  };

  const handleSaveEditPeriod = (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !editingPeriod) return;
    const updatedPeriods = db.periods.map(p => {
      if (p.id === editingPeriod.id) {
        return {
          ...p,
          name: editPeriodName.trim(),
          startDate: toEnglishDigits(editPeriodStartDate).trim(),
          endDate: toEnglishDigits(editPeriodEndDate).trim()
        };
      }
      return p;
    });
    handleUpdateDatabase({
      ...db,
      periods: updatedPeriods
    });
    setEditingPeriod(null);
    alert('تغییرات دوره با موفقیت ذخیره گردید.');
  };

  // Sync SQL Server initial configuration from loaded database
  useEffect(() => {
    if (db?.sqlServerConfig) {
      if (db.sqlServerConfig.serverUrl) setSqlServerUrl(db.sqlServerConfig.serverUrl);
      if (db.sqlServerConfig.apiKey) setSqlServerApiKey(db.sqlServerConfig.apiKey);
      if (db.sqlServerConfig.autoSync !== undefined) setSqlServerAutoSync(db.sqlServerConfig.autoSync);
    }
  }, [db?.sqlServerConfig]);

  const handleTestSqlServerConnection = async () => {
    if (!sqlServerUrl.trim()) {
      alert('لطفاً ابتدا آدرس سرور فروشگاه را وارد نمایید (مانند: http://localhost:5000/api یا http://192.168.1.100:5000/api)');
      return;
    }
    setIsSqlServerTesting(true);
    setSqlServerStatusMessage({ type: 'info', text: 'درحال بررسی ارتباط با سرور دیتابیس فروشگاه...' });
    try {
      const result = await testSqlServerConnection(sqlServerUrl.trim(), sqlServerApiKey.trim());
      if (result.success) {
        setSqlServerStatusMessage({ type: 'success', text: result.message });
        if (db) {
          const updated: AppDatabase = {
            ...db,
            sqlServerConfig: {
              ...db.sqlServerConfig,
              serverUrl: sqlServerUrl.trim(),
              apiKey: sqlServerApiKey.trim(),
              autoSync: sqlServerAutoSync,
              status: 'connected',
              lastSyncTime: new Date().toISOString()
            }
          };
          handleUpdateDatabase(updated);
        }
      } else {
        setSqlServerStatusMessage({ type: 'error', text: result.message });
      }
    } catch (err: any) {
      setSqlServerStatusMessage({ type: 'error', text: err.message || 'خطا در ارتباط با سرور' });
    } finally {
      setIsSqlServerTesting(false);
    }
  };

  const handleSaveToSqlServer = async () => {
    if (!sqlServerUrl.trim()) {
      alert('لطفاً ابتدا آدرس سرور فروشگاه را وارد نمایید.');
      return;
    }
    if (!db) return;
    setIsSqlServerSyncing(true);
    setSqlServerStatusMessage({ type: 'info', text: 'درحال ارسال و ذخیره داده‌ها در دیتابیس SQL Server فروشگاه...' });
    try {
      const result = await pushToSqlServer(sqlServerUrl.trim(), db, sqlServerApiKey.trim());
      if (result.success) {
        setSqlServerStatusMessage({ type: 'success', text: result.message });
        const updated: AppDatabase = {
          ...db,
          sqlServerConfig: {
            ...db.sqlServerConfig,
            serverUrl: sqlServerUrl.trim(),
            apiKey: sqlServerApiKey.trim(),
            autoSync: sqlServerAutoSync,
            status: 'connected',
            lastSyncTime: new Date().toISOString()
          }
        };
        handleUpdateDatabase(updated);
        alert('بانک اطلاعاتی با موفقیت در SQL Server فروشگاه ذخیره گردید.');
      } else {
        setSqlServerStatusMessage({ type: 'error', text: result.message });
        alert(result.message);
      }
    } catch (err: any) {
      const msg = err.message || 'خطا در ذخیره‌سازی';
      setSqlServerStatusMessage({ type: 'error', text: msg });
      alert(`خطا در ذخیره داده در SQL Server: ${msg}`);
    } finally {
      setIsSqlServerSyncing(false);
    }
  };

  const handleRestoreFromSqlServer = async () => {
    if (!sqlServerUrl.trim()) {
      alert('لطفاً ابتدا آدرس سرور فروشگاه را وارد نمایید.');
      return;
    }
    const confirmed = window.confirm('آیا از بازیابی داده‌ها از SQL Server فروشگاه اطمینان دارید؟ تمام داده‌های محلی فعلی با داده‌های سرور جایگزین خواهند شد.');
    if (!confirmed) return;

    setIsSqlServerSyncing(true);
    setSqlServerStatusMessage({ type: 'info', text: 'درحال بارگیری داده‌ها از SQL Server فروشگاه...' });
    try {
      const result = await pullFromSqlServer(sqlServerUrl.trim(), sqlServerApiKey.trim());
      if (result.success && result.data) {
        handleUpdateDatabase(result.data);
        setSqlServerStatusMessage({ type: 'success', text: result.message });
        alert('بانک اطلاعاتی با موفقیت از SQL Server بازیابی و سیستم به‌روزرسانی شد.');
      } else {
        setSqlServerStatusMessage({ type: 'error', text: result.message });
        alert(result.message);
      }
    } catch (err: any) {
      const msg = err.message || 'خطا در بازیابی';
      setSqlServerStatusMessage({ type: 'error', text: msg });
      alert(`خطا در بازیابی از SQL Server: ${msg}`);
    } finally {
      setIsSqlServerSyncing(false);
    }
  };

  const handleDownloadSqlServerScript = () => {
    downloadSqlServerDDLScript();
  };

  const hydrateFromPostgres = async (user: User, fallbackLocalDb?: AppDatabase | null) => {
    try {
      setPgSyncState('syncing');
      const res = await loadSharedDatabaseFromPostgres();
      if (!res.ok) {
        setPgSyncState('error');
        return;
      }

      if (res.isEmpty) {
        const localSource = fallbackLocalDb || latestDbRef.current || db || getInitialDatabase();
        const sanitizedLocal = sanitizeAndMergeDatabase(localSource);
        latestDbRef.current = sanitizedLocal;
        lastSyncedDbRef.current = null;
        collectionVersionsRef.current = res.versions || {};
        setDb(sanitizedLocal);
        setPgSyncState('synced');
        if (isAdminUser(user)) {
          setShowLocalMigrationBanner(true);
        }
        return;
      }

      const merged = sanitizeAndMergeDatabase({
        ...getInitialDatabase(),
        ...res.collections,
      } as AppDatabase);

      lastSyncedDbRef.current = merged;
      latestDbRef.current = merged;
      collectionVersionsRef.current = res.versions || {};
      setDb(merged);
      saveDatabase(merged);
      setShowLocalMigrationBanner(false);
      setPgSyncState('synced');
      setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));

      if (merged.periods && merged.periods.length > 0) {
        const matched = merged.periods.find((p) => p.id === activePeriodId) || merged.periods[0];
        setActivePeriodId(matched.id);
      }
    } catch (err) {
      console.warn('Postgres hydration notice:', err);
      setPgSyncState('error');
    }
  };

  const isUniqueIdRecordArray = (val: unknown): val is Array<Record<string, unknown>> => {
    if (!Array.isArray(val)) return false;
    const seen = new Set<string>();
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const rawId = (item as Record<string, unknown>).id;
      if (typeof rawId !== 'string' || !rawId.trim()) return false;
      const cleanId = rawId.trim();
      if (seen.has(cleanId)) return false;
      seen.add(cleanId);
    }
    return true;
  };

  const areRecordsStructurallyEqual = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    if (a === b) return true;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      const k = keysA[i];
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      const va = a[k];
      const vb = b[k];
      if (va === vb) continue;
      if (va && vb && typeof va === 'object' && typeof vb === 'object') {
        if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
      } else {
        return false;
      }
    }
    return true;
  };

  const flushDeltaToPostgres = async () => {
    const user = currentUserRef.current;
    const latest = latestDbRef.current;
    if (!user || !latest) return;

    if (isPgSyncInFlightRef.current) {
      pendingResyncRef.current = true;
      return;
    }

    const baseline = lastSyncedDbRef.current;
    const changes: Record<string, unknown> = {};
    const recordPatches: Record<string, RecordPatchPayload> = {};
    const syncedSnapshots: Record<string, unknown> = {};
    const baseVersions: Record<string, number> = {};
    const noOpKeys: string[] = [];

    const keys = Object.keys(latest) as Array<keyof AppDatabase>;
    for (const k of keys) {
      const keyStr = String(k);
      if (CLIENT_ONLY_DB_KEYS.has(keyStr) || keyStr === 'users' || keyStr === 'roles') continue;
      if (!canWriteCollection(user, keyStr)) continue;
      if (!baseline || latest[k] !== baseline[k]) {
        const nextVal = latest[k];
        const prevVal = baseline ? baseline[k] : undefined;

        if (baseline && isUniqueIdRecordArray(prevVal) && isUniqueIdRecordArray(nextVal)) {
          const prevMap = new Map<string, { item: Record<string, unknown>; idx: number }>();
          for (let i = 0; i < prevVal.length; i++) {
            const id = String(prevVal[i].id).trim();
            prevMap.set(id, { item: prevVal[i], idx: i });
          }

          const upserts: Array<{ id: string; sortOrder: number; data: Record<string, unknown> }> = [];
          for (let idx = 0; idx < nextVal.length; idx++) {
            const item = nextVal[idx];
            const id = String(item.id).trim();
            const prevEntry = prevMap.get(id);
            if (!prevEntry) {
              upserts.push({ id, sortOrder: idx, data: item });
            } else {
              prevMap.delete(id);
              if (prevEntry.item !== item && !areRecordsStructurallyEqual(prevEntry.item, item)) {
                upserts.push({ id, sortOrder: idx, data: item });
              }
            }
          }
          const deletes = Array.from(prevMap.keys());

          if (upserts.length === 0 && deletes.length === 0) {
            noOpKeys.push(keyStr);
            continue;
          }

          recordPatches[keyStr] = { upserts, deletes };
          syncedSnapshots[keyStr] = nextVal;
          if (collectionVersionsRef.current[keyStr]) {
            baseVersions[keyStr] = collectionVersionsRef.current[keyStr];
          }
        } else {
          changes[keyStr] = nextVal;
          syncedSnapshots[keyStr] = nextVal;
          if (collectionVersionsRef.current[keyStr]) {
            baseVersions[keyStr] = collectionVersionsRef.current[keyStr];
          }
        }
      }
    }

    // Advance baseline references for cloned-but-identical arrays so we don't re-diff them next tick
    if (noOpKeys.length > 0 && baseline) {
      const updatedBaseline: AppDatabase = { ...baseline };
      for (const nk of noOpKeys) {
        (updatedBaseline as any)[nk] = (latest as any)[nk];
      }
      lastSyncedDbRef.current = updatedBaseline;
    }

    const touchedKeys = Object.keys(syncedSnapshots);
    if (touchedKeys.length === 0) return;

    isPgSyncInFlightRef.current = true;
    setPgSyncState('syncing');

    try {
      const res = await syncDeltaToPostgres(changes, baseVersions, recordPatches);
      if (res.status === 401) {
        setCurrentUser(null);
        setPgSyncState('offline');
        return;
      }

      if (res.versions && Object.keys(res.versions).length > 0) {
        collectionVersionsRef.current = {
          ...collectionVersionsRef.current,
          ...res.versions,
        };
      }

      if (res.ok) {
        const nextBaseline: AppDatabase = { ...(lastSyncedDbRef.current || latest) };
        for (const k of touchedKeys) {
          (nextBaseline as any)[k] = syncedSnapshots[k];
        }
        lastSyncedDbRef.current = nextBaseline;
        setPgSyncState('synced');
        setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));
        setSyncNotice(null);
      } else if (res.status === 409 && res.conflicts.length > 0) {
        // Auto-reconcile server versions for conflicted collections while preserving non-conflicted updates
        const currentLatest = latestDbRef.current || latest;
        const reconciled = sanitizeAndMergeDatabase({
          ...currentLatest,
          ...res.conflictedCollections,
        } as AppDatabase);
        const nextBaseline: AppDatabase = { ...(lastSyncedDbRef.current || reconciled) };
        for (const k of touchedKeys) {
          if (!res.conflicts.includes(k)) {
            (nextBaseline as any)[k] = syncedSnapshots[k];
          }
        }
        for (const ck of res.conflicts) {
          (nextBaseline as any)[ck] = (reconciled as any)[ck];
        }
        lastSyncedDbRef.current = nextBaseline;
        latestDbRef.current = reconciled;
        setDb(reconciled);
        saveDatabase(reconciled, { skipLocalStorage: true });
        setPgSyncState('synced');
        setSyncNotice('تغییرات هم‌زمان کاربر دیگر از سرور بارگیری و جایگزین شد.');
      } else {
        setPgSyncState('error');
        if (res.error) setSyncNotice(res.error);
      }
    } catch {
      setPgSyncState('error');
    } finally {
      isPgSyncInFlightRef.current = false;
      if (pendingResyncRef.current) {
        pendingResyncRef.current = false;
        flushDeltaToPostgres();
      }
    }
  };

  const schedulePostgresDeltaSync = () => {
    if (pgSyncTimeoutRef.current) {
      clearTimeout(pgSyncTimeoutRef.current);
    }
    pgSyncTimeoutRef.current = setTimeout(() => {
      pgSyncTimeoutRef.current = null;
      flushDeltaToPostgres();
    }, 400);
  };

  // Prevent accidental tab close while a PostgreSQL sync is still pending/in-flight
  useEffect(() => {
    if (serverMode !== 'postgres') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isPgSyncInFlightRef.current || pgSyncTimeoutRef.current !== null) {
        if (pgSyncTimeoutRef.current) {
          clearTimeout(pgSyncTimeoutRef.current);
          pgSyncTimeoutRef.current = null;
          flushDeltaToPostgres();
        }
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [serverMode]);

  const handleMigrateLocalToPostgres = async () => {
    const targetDb = latestDbRef.current || db;
    if (!targetDb) return;
    try {
      const res = await importDatabaseToPostgres(targetDb, 'browser_local_migration');
      if (res.ok) {
        if (res.versions) {
          collectionVersionsRef.current = res.versions;
        }
        lastSyncedDbRef.current = targetDb;
        setShowLocalMigrationBanner(false);
        setPgSyncState('synced');
        setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));
        const refreshed = await fetchPostgresStatus();
        setServerStatus(refreshed);
        alert('تمامی داده‌های محلی با موفقیت به پایگاه داده مشترک PostgreSQL منتقل شدند.');
      } else {
        alert(res.error || 'خطا در انتقال داده‌ها به PostgreSQL');
      }
    } catch (err: any) {
      alert(`خطا در انتقال داده‌ها به PostgreSQL: ${err?.message || String(err)}`);
    }
  };

  const handleRefreshStatusAndPull = async () => {
    const status = await fetchPostgresStatus();
    setServerStatus(status);
    if (status.mode === 'postgres' && status.connected && currentUserRef.current) {
      await hydrateFromPostgres(currentUserRef.current);
    }
  };

  const handleLoginSuccess = async (user: User) => {
    setCurrentUser(user);
    setMobileHasSelectedForm(false);
    setIsMobileMenuOpen(false);
    if (!canAccessTab(user, activeTab as SystemTabId)) {
      setActiveTab(getFirstAllowedTab(user));
    }
    if (serverStatus?.mode === 'postgres' && serverStatus?.connected) {
      await hydrateFromPostgres(user);
    }
  };

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    if (window.innerWidth < 1024) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isMobileMenuOpen]);

  // 1. Initial database loading on boot with IndexedDB + PostgreSQL detection
  useEffect(() => {
    let isMounted = true;

    const boot = async () => {
      let loadedLocal: AppDatabase;
      try {
        loadedLocal = await loadDatabaseAsync();
      } catch (err) {
        console.warn('Fallback load on boot:', err);
        loadedLocal = loadDatabase();
      }

      if (!isMounted) return;
      latestDbRef.current = loadedLocal;
      setDb(loadedLocal);
      if (loadedLocal && loadedLocal.periods && loadedLocal.periods.length > 0) {
        const defaultPeriod = loadedLocal.selectedPeriodId || loadedLocal.periods[0].id;
        const matched = loadedLocal.periods.find((p) => p.id === defaultPeriod) || loadedLocal.periods[0];
        setActivePeriodId(matched.id);
      }

      const status = await fetchPostgresStatus();
      if (!isMounted) return;
      setServerStatus(status);

      if (status.mode === 'postgres' && status.connected) {
        const [pubUsers, activeSessionUser] = await Promise.all([
          fetchPublicUsers(),
          fetchCurrentUser(),
        ]);
        if (!isMounted) return;
        setPublicUsers(pubUsers);
        if (activeSessionUser) {
          setCurrentUser(activeSessionUser);
          if (!canAccessTab(activeSessionUser, activeTab as SystemTabId)) {
            setActiveTab(getFirstAllowedTab(activeSessionUser));
          }
          await hydrateFromPostgres(activeSessionUser, loadedLocal);
        }
      }
    };

    boot();

    return () => {
      isMounted = false;
    };
  }, []);

  // 1b. Multi-user background polling from PostgreSQL every 12 seconds
  useEffect(() => {
    if (serverMode !== 'postgres' || !currentUser) return;

    const intervalId = setInterval(async () => {
      if (isPgSyncInFlightRef.current || pgSyncTimeoutRef.current) return;
      try {
        const vRes = await fetchPostgresVersions();
        if (vRes.status === 401) {
          setCurrentUser(null);
          return;
        }
        if (!vRes.ok) return;

        const changedKeys: string[] = [];
        for (const [k, serverVer] of Object.entries(vRes.versions)) {
          if (CLIENT_ONLY_DB_KEYS.has(k)) continue;
          const localVer = collectionVersionsRef.current[k] || 0;
          if (serverVer > localVer) {
            changedKeys.push(k);
          }
        }

        if (changedKeys.length === 0) return;

        const pullRes = await loadSharedDatabaseFromPostgres(changedKeys);
        if (!pullRes.ok) return;

        const base = latestDbRef.current || db;
        if (!base) return;

        const merged = sanitizeAndMergeDatabase({
          ...base,
          ...pullRes.collections,
        } as AppDatabase);

        collectionVersionsRef.current = {
          ...collectionVersionsRef.current,
          ...pullRes.versions,
        };
        lastSyncedDbRef.current = merged;
        latestDbRef.current = merged;
        setDb(merged);
        saveDatabase(merged, { skipLocalStorage: true });
        setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));
      } catch {
        // silent background retry next tick
      }
    }, 12000);

    return () => clearInterval(intervalId);
  }, [serverMode, currentUser?.id]);

  // Automatic Daily Database Backup Scheduler (System Admin Only)
  useEffect(() => {
    if (!currentUser || !isAdminUser(currentUser) || !db) return;

    let cancelled = false;
    const checkAndRunDailyBackup = async () => {
      if (cancelled) return;
      const latest = latestDbRef.current || db;
      if (!latest || !currentUserRef.current || !isAdminUser(currentUserRef.current)) return;

      const res = await performDatabaseBackup({
        trigger: 'auto',
        serverMode,
        currentDb: latest,
        currentUser: currentUserRef.current,
        interactiveFolderPrompt: false,
      });

      if (cancelled) return;
      if (res.needsFolderPermission) {
        setPendingBackupFolderPrompt(true);
      } else if (res.ok && !res.skipped) {
        setPendingBackupFolderPrompt(false);
        setBackupRevision((prev) => prev + 1);
      }
    };

    const initTimer = setTimeout(() => {
      checkAndRunDailyBackup().catch(() => {});
    }, 4500);

    const intervalId = setInterval(() => {
      checkAndRunDailyBackup().catch(() => {});
    }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      clearTimeout(initTimer);
      clearInterval(intervalId);
    };
  }, [currentUser?.id, serverMode, Boolean(db)]);

  // Update central state and save to local storage + schedule PostgreSQL delta sync
  const handleUpdateDatabase = (updatedDb: AppDatabase) => {
    const sanitized = sanitizeChangedCollections(latestDbRef.current, updatedDb);
    latestDbRef.current = sanitized;
    setDb(sanitized);
    saveDatabase(sanitized, { skipLocalStorage: serverMode === 'postgres' });

    if (serverMode === 'postgres' && currentUserRef.current) {
      schedulePostgresDeltaSync();
    }

    // If online and configured with a web app URL, auto-sync to Sheets
    const isWebHookUrl = Boolean(
      updatedDb.googleSheetsUrl &&
      (updatedDb.googleSheetsUrl.startsWith('https://script.google.com/') ||
      (updatedDb.googleSheetsUrl.startsWith('https://') && updatedDb.googleSheetsUrl.includes('/exec')))
    );

    if (isOnline && isWebHookUrl) {
      setGoogleSheetsSyncStatus('pending');
      syncWithGoogleSheets(updatedDb)
        .then(success => {
          setGoogleSheetsSyncStatus(success ? 'synced' : 'failed');
        })
        .catch(() => {
          setGoogleSheetsSyncStatus('failed');
        });
    } else if (isWebHookUrl) {
      setGoogleSheetsSyncStatus('pending'); // queue changes for offline sync
    }
  };

  // 2. Offline Mode toggle & auto sync resolver
  const handleToggleOnlineStatus = () => {
    const nextStatus = !isOnline;
    setIsOnline(nextStatus);

    const isWebHookUrl = Boolean(
      db?.googleSheetsUrl &&
      (db.googleSheetsUrl.startsWith('https://script.google.com/') ||
      (db.googleSheetsUrl.startsWith('https://') && db.googleSheetsUrl.includes('/exec')))
    );

    if (nextStatus && db && isWebHookUrl) {
      // User switched back online, trigger auto sync of cached logs!
      setGoogleSheetsSyncStatus('pending');
      syncWithGoogleSheets(db)
        .then(success => {
          setGoogleSheetsSyncStatus(success ? 'synced' : 'failed');
        })
        .catch(() => {
          setGoogleSheetsSyncStatus('failed');
        });
    }
  };

  // 3. Backup and Restore (JSON Daily Backup & Excel Backup) Section 1-b

  const handleRestoreFullDatabase = async (
    restoredDb: AppDatabase,
    sourceLabel: string
  ): Promise<boolean> => {
    if (!isAdminUser(currentUser)) {
      alert('فقط مدیر ارشد مجاز به بازیابی کامل پایگاه داده است.');
      return false;
    }

    const sanitized = sanitizeAndMergeDatabase(restoredDb);
    latestDbRef.current = sanitized;
    setDb(sanitized);
    saveDatabase(sanitized);

    if (serverMode === 'postgres') {
      try {
        const pgRes = await importDatabaseToPostgres(sanitized, sourceLabel);
        if (!pgRes.ok) {
          alert(
            `فایل پشتیبان خوانده شد، اما ذخیره در PostgreSQL با خطا مواجه شد:\n${
              pgRes.error || 'خطای نامشخص سرور'
            }`
          );
          return false;
        }
        if (pgRes.versions) collectionVersionsRef.current = pgRes.versions;
        lastSyncedDbRef.current = sanitized;
        setShowLocalMigrationBanner(false);
        setPgSyncState('synced');
        setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));
        fetchPostgresStatus().then(setServerStatus).catch(() => {});
      } catch (pgErr: any) {
        alert(
          `ارسال داده‌های بازیابی‌شده به PostgreSQL با خطا مواجه شد: ${
            pgErr?.message || String(pgErr)
          }`
        );
        return false;
      }
    }

    if (sanitized.periods.length > 0) {
      const matched = sanitized.periods.find((p) => p.id === activePeriodId) || sanitized.periods[0];
      setActivePeriodId(matched.id);
    }
    setBackupRevision((prev) => prev + 1);
    return true;
  };

  const handleGrantBackupFolderWrite = async () => {
    if (!db || !currentUser || !isAdminUser(currentUser)) return;
    const res = await performDatabaseBackup({
      trigger: 'manual',
      serverMode,
      currentDb: latestDbRef.current || db,
      currentUser,
      interactiveFolderPrompt: true,
    });
    if (res.ok) {
      setPendingBackupFolderPrompt(false);
      setBackupRevision((prev) => prev + 1);
      alert(
        res.method === 'folder'
          ? 'نسخه پشتیبان روزانه امروز با موفقیت در پوشه متصل سیستم ذخیره شد.'
          : `فایل پشتیبان (${res.filename}) با موفقیت ذخیره شد.`
      );
    } else if (res.error) {
      alert(res.error);
    }
  };

  const handleExportExcelBackup = () => {
    if (!db) return;
    try {
      exportDatabaseToExcel(db);
    } catch (e) {
      alert('خطا در خروجی گرفتن اکسل: ' + String(e));
    }
  };

  const handleImportExcelBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !db) return;
    if (!isAdminUser(currentUser)) {
      alert('فقط مدیر ارشد مجاز به بازیابی کامل فایل اکسل است.');
      return;
    }

    askConfirm(
      'بازیابی کل اطلاعات از فایل اکسل (Excel)',
      'هشدار حساس: بارگذاری فایل اکسل تمامی داده‌های فعلی شما را بازنویسی و اطلاعات داخل ورقه‌های اکسل بارگذاری شده را جایگزین خواهد کرد. مایل به نهایی‌سازی هستید؟',
      () => {
        const reader = new FileReader();
        reader.onerror = () => {
          alert('خطا در خواندن فایل از سیستم. لطفا مجدداً فایل را انتخاب نمایید.');
        };
        reader.onload = async (event) => {
          const buffer = event.target?.result as ArrayBuffer;
          if (!buffer) {
            alert('محتوای فایل اکسل خالی یا غیرقابل خواندن است.');
            return;
          }

          let sanitized: AppDatabase;
          try {
            const restoredDb = importExcelToDatabase(buffer, db);
            sanitized = sanitizeAndMergeDatabase(restoredDb);
          } catch (excelErr: any) {
            console.error('Error parsing Excel backup:', excelErr);
            const detail = excelErr?.message ? `\nجزئیات: ${excelErr.message}` : '';
            alert(
              `خطا در ساختار ورقه اکسل وارد شده. لطفا یک فایل معتبر خروجی گرفته شده بارگذاری کنید.${detail}`
            );
            return;
          }

          latestDbRef.current = sanitized;
          setDb(sanitized);
          saveDatabase(sanitized);

          if (serverMode === 'postgres') {
            try {
              const pgRes = await importDatabaseToPostgres(sanitized, 'excel_full_restore');
              if (!pgRes.ok) {
                alert(
                  `فایل اکسل خوانده شد، اما ذخیره در PostgreSQL با خطا مواجه شد:\n${
                    pgRes.error || 'خطای نامشخص سرور'
                  }`
                );
                return;
              }
              if (pgRes.versions) collectionVersionsRef.current = pgRes.versions;
              lastSyncedDbRef.current = sanitized;
              setShowLocalMigrationBanner(false);
              setPgSyncState('synced');
              setLastPgSyncTime(new Date().toLocaleTimeString('fa-IR'));
              fetchPostgresStatus().then(setServerStatus).catch(() => {});
            } catch (pgErr: any) {
              console.error('Error syncing Excel backup to Postgres:', pgErr);
              alert(
                `فایل اکسل با موفقیت خوانده شد، اما ارسال به سرور PostgreSQL با خطا مواجه شد: ${
                  pgErr?.message || String(pgErr)
                }`
              );
              return;
            }
          }

          // Switch to a valid period
          if (sanitized.periods.length > 0) {
            const matched = sanitized.periods.find(p => p.id === activePeriodId) || sanitized.periods[0];
            setActivePeriodId(matched.id);
          }

          alert('کل دیتابیس با موفقیت از فایل اکسل بازیابی و همگام گردید.');
          setShowBackupPanel(false);
        };
        reader.readAsArrayBuffer(file);
      }
    );
  };

  const handleExportDibalExcelBackup = () => {
    if (!db) return;
    try {
      exportDibalDataToExcel(db);
    } catch (e) {
      alert('خطا در خروجی گرفتن اکسل ترازو دیبال: ' + String(e));
    }
  };

  const handleImportDibalExcelBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;

    askConfirm(
      'بازیابی اطلاعات مدیریت ترازو دیبال M-525 از فایل اکسل',
      'آیا از بارگذاری فایل اکسل و به‌روزرسانی تنظیمات ترازو، جدول کالاها (PLU)، کلیدهای مستقیم کیپد و قبوض ترازو دیبال اطمینان دارید؟',
      () => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const buffer = event.target?.result as ArrayBuffer;
          if (!buffer) return;

          try {
            const restoredDb = importDibalDataFromExcel(buffer, db);
            handleUpdateDatabase(restoredDb);
            alert('اطلاعات فرم مدیریت ترازو دیبال M-525 با موفقیت از فایل اکسل بازیابی گردید.');
          } catch (err) {
            console.error('Error importing Dibal Excel:', err);
            alert('خطا در ساختار ورقه اکسل ترازو دیبال.');
          }
        };
        reader.readAsArrayBuffer(file);
      }
    );
  };

  const handlePurgeAllDatabase = () => {
    if (!isAdminUser(currentUser)) {
      alert('فقط مدیر ارشد مجاز به بازنشانی کل دیتابیس است.');
      return;
    }
    askConfirm(
      'هشدار امنیتی بسیار مهم!',
      'آیا از بازنشانی کلی و پاک‌سازی کامل کل سیستم دیتابیس اطمینان صد در صد دارید؟ تمام کالاها، تامین‌کنندگان، فاکتورها، شمارش‌ها و مبالغ در تمام ادوار باطل شده و به حالت خام اولیه برمی‌گردند.',
      () => {
        askConfirm(
          'تایید نهایی فرآیند بازنشانی',
          'این کار تمام اطلاعات را مواجه با حذف دائمی می‌کند. آیا فرآیند بازنشانی دیتابیس آغاز شود؟ آی‌پی شما و مهر زمانی ثبت خواهد شد.',
          async () => {
            const freshDb = getInitialDatabase();
            latestDbRef.current = freshDb;
            setDb(freshDb);
            saveDatabase(freshDb);
            if (serverMode === 'postgres') {
              const pgRes = await importDatabaseToPostgres(freshDb, 'factory_reset');
              if (pgRes.versions) collectionVersionsRef.current = pgRes.versions;
              lastSyncedDbRef.current = freshDb;
            }
            alert('کل بانک اطلاعاتی نرم‌افزار گاتان با موفقیت کاملاً فرمت و بازنشانی گردید.');
            setShowBackupPanel(false);
            if (freshDb.periods[0]) {
              setActivePeriodId(freshDb.periods[0].id);
            }
          }
        );
      }
    );
  };

  // 4. Time Periods Manager
  const handleCreatePeriod = (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !newPeriodName.trim()) return;

    const newPeriod: Period = {
      id: `period-${Date.now()}`,
      name: newPeriodName.trim(),
      isActive: true,
      startDate: toEnglishDigits(newPeriodStartDate).trim() || '1405/01/01',
      endDate: toEnglishDigits(newPeriodEndDate).trim() || '1405/12/29',
      createdAt: new Date().toISOString()
    };

    const selectedSourceId = copySourcePeriodId || activePeriodId;
    const sourcePeriodId = selectedSourceId === 'none' ? '' : selectedSourceId;

    // Cloning maps
    const itemCatMap: Record<string, string> = {};
    const clonedItemCategories = (db.itemCategories || []).filter(cat => cat.periodId === sourcePeriodId).map((cat, idx) => {
      const newId = `cat-item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      itemCatMap[cat.id] = newId;
      return {
        ...cat,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const warehouseMap: Record<string, string> = {};
    const clonedWarehouses = (db.warehouses || []).filter(wh => wh.periodId === sourcePeriodId).map((wh, idx) => {
      const newId = `wh-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      warehouseMap[wh.id] = newId;
      return {
        ...wh,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const itemMap: Record<string, string> = {};
    const clonedItems = (db.items || []).filter(item => item.periodId === sourcePeriodId).map((item, idx) => {
      const newId = `item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      itemMap[item.id] = newId;
      return {
        ...item,
        id: newId,
        periodId: newPeriod.id,
        categoryId: itemCatMap[item.categoryId] || item.categoryId,
        warehouse: item.warehouse ? (warehouseMap[item.warehouse] || item.warehouse) : item.warehouse
      };
    });

    const deptMap: Record<string, string> = {};
    const clonedDepartments = (db.departments || []).filter(d => d.periodId === sourcePeriodId).map((d, idx) => {
      const newId = d.isShared ? `dept-${Date.now()}-${idx}-cat-4` : `dept-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      deptMap[d.id] = newId;
      return {
        ...d,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const prodCatMap: Record<string, string> = {};
    const clonedProductCategories = (db.productCategories || []).filter(pcat => pcat.periodId === sourcePeriodId).map((pcat, idx) => {
      const newId = `cat-prod-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      prodCatMap[pcat.id] = newId;
      return {
        ...pcat,
        id: newId,
        periodId: newPeriod.id,
        departmentId: pcat.departmentId ? (deptMap[pcat.departmentId] || pcat.departmentId) : undefined
      };
    });

    const productMap: Record<string, string> = {};
    const clonedProducts = (db.products || []).filter(prod => prod.periodId === sourcePeriodId).map((prod, idx) => {
      const newId = `prod-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      productMap[prod.id] = newId;
      return {
        ...prod,
        id: newId,
        periodId: newPeriod.id,
        categoryId: prodCatMap[prod.categoryId] || prod.categoryId
      };
    });

    const clonedSuppliers = (db.suppliers || []).filter(sup => sup.periodId === sourcePeriodId).map((sup, idx) => {
      const newId = `sup-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      const mappedSuppliedItemIds = (sup.suppliedItemIds || []).map(oldId => itemMap[oldId] || oldId);
      return {
        ...sup,
        id: newId,
        periodId: newPeriod.id,
        suppliedItemIds: mappedSuppliedItemIds
      };
    });

    const clonedUnitConversions = (db.unitConversions || []).filter(conv => conv.periodId === sourcePeriodId).map((conv, idx) => {
      const newId = `conv-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...conv,
        id: newId,
        periodId: newPeriod.id,
        rawMaterialId: itemMap[conv.rawMaterialId] || conv.rawMaterialId
      };
    });

    const clonedProductFormulas = (db.productFormulas || []).filter(f => f.periodId === sourcePeriodId).map((f, idx) => {
      const newId = `formula-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      const sourceItemsList = (db.items || []).filter(i => i.periodId === sourcePeriodId);
      const sourceProductsList = (db.products || []).filter(p => p.periodId === sourcePeriodId);

      const sourceProdObj = sourceProductsList.find(p =>
        (p.accountId && normalizeAccountingCode(p.accountId) === normalizeAccountingCode(f.productId)) || p.id === f.productId
      );
      const clonedProdObj = sourceProdObj ? clonedProducts.find(cp => cp.id === productMap[sourceProdObj.id]) : undefined;
      const targetProdFormulaKey = clonedProdObj
        ? getProductFormulaKey(clonedProdObj)
        : (productMap[f.productId] || normalizeAccountingCode(f.productId) || f.productId);

      const mappedIngredients = (f.ingredients || []).map(ing => {
        const srcItem = sourceItemsList.find(i =>
          (i.accountId && normalizeAccountingCode(i.accountId) === normalizeAccountingCode(ing.rawMaterialId)) || i.id === ing.rawMaterialId
        );
        const clonedItem = srcItem ? clonedItems.find(ci => ci.id === itemMap[srcItem.id]) : undefined;
        const srcWip = !srcItem ? sourceProductsList.find(p =>
          p.isWip && ((p.accountId && normalizeAccountingCode(p.accountId) === normalizeAccountingCode(ing.rawMaterialId)) || p.id === ing.rawMaterialId)
        ) : undefined;
        const clonedWip = srcWip ? clonedProducts.find(cp => cp.id === productMap[srcWip.id]) : undefined;

        const targetMatKey = clonedItem
          ? getMaterialFormulaKey(clonedItem)
          : clonedWip
            ? getMaterialFormulaKey(clonedWip)
            : (itemMap[ing.rawMaterialId] || productMap[ing.rawMaterialId] || normalizeAccountingCode(ing.rawMaterialId) || ing.rawMaterialId);

        return {
          ...ing,
          rawMaterialId: targetMatKey
        };
      });
      return {
        ...f,
        id: newId,
        periodId: newPeriod.id,
        productId: targetProdFormulaKey,
        ingredients: mappedIngredients
      };
    });

    const clonedDailyProductionSegments = (db.dailyProductionSegments || []).filter(seg => seg.periodId === sourcePeriodId).map((seg, idx) => {
      const newId = `seg-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...seg,
        id: newId,
        periodId: newPeriod.id,
        productId: productMap[seg.productId] || seg.productId
      };
    });

    const clonedPersonnelAllocations = (db.personnelAllocations || []).filter(alloc => alloc.periodId === sourcePeriodId).map((alloc, idx) => {
      const newId = `alloc-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...alloc,
        id: newId,
        periodId: newPeriod.id,
        departmentCategoryId: deptMap[alloc.departmentCategoryId] || prodCatMap[alloc.departmentCategoryId] || alloc.departmentCategoryId
      };
    });

    const clonedPersonnel = (db.personnel || []).filter(pers => pers.periodId === sourcePeriodId).map((pers, idx) => {
      const newId = `pers-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...pers,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const clonedSalesPeriods = (db.salesPeriods || []).filter(s => s.periodId === sourcePeriodId).map((s, idx) => {
      const newId = `sp-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...s,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const clonedPayrollPeriods = (db.payrollPeriods || []).filter(p => p.periodId === sourcePeriodId).map((p, idx) => {
      const newId = `pp-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...p,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const clonedSalaryBaseRates = (db.salaryBaseRates || []).filter(rate => rate.periodId === sourcePeriodId).map((rate, idx) => {
      const newId = `rate-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...rate,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const clonedPersonnelContracts = (db.personnelContracts || []).filter(contract => contract.periodId === sourcePeriodId).map((contract, idx) => {
      const newId = `contract-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...contract,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const clonedCustomers = (db.customers || []).filter(cust => cust.periodId === sourcePeriodId).map((cust, idx) => {
      const newId = `cust-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 10)}`;
      return {
        ...cust,
        id: newId,
        periodId: newPeriod.id
      };
    });

    const updatedDb: AppDatabase = {
      ...db,
      periods: [...db.periods, newPeriod],
      itemCategories: [...db.itemCategories, ...clonedItemCategories],
      warehouses: [...(db.warehouses || []), ...clonedWarehouses],
      items: [...db.items, ...clonedItems],
      productCategories: [...db.productCategories, ...clonedProductCategories],
      departments: [...(db.departments || []), ...clonedDepartments],
      products: [...db.products, ...clonedProducts],
      suppliers: [...db.suppliers, ...clonedSuppliers],
      unitConversions: [...db.unitConversions, ...clonedUnitConversions],
      productFormulas: [...db.productFormulas, ...clonedProductFormulas],
      dailyProductionSegments: [...(db.dailyProductionSegments || []), ...clonedDailyProductionSegments],
      personnelAllocations: [...db.personnelAllocations, ...clonedPersonnelAllocations],
      personnel: [...db.personnel, ...clonedPersonnel],
      salesPeriods: [...(db.salesPeriods || []), ...clonedSalesPeriods],
      payrollPeriods: [...(db.payrollPeriods || []), ...clonedPayrollPeriods],
      salaryBaseRates: [...(db.salaryBaseRates || []), ...clonedSalaryBaseRates],
      personnelContracts: [...(db.personnelContracts || []), ...clonedPersonnelContracts],
      customers: [...(db.customers || []), ...clonedCustomers]
    };

    handleUpdateDatabase(updatedDb);
    setNewPeriodName('');
    setCopySourcePeriodId('');
    setActivePeriodId(newPeriod.id);
    setShowPeriodManager(false);
    if (sourcePeriodId) {
      const sourceName = db.periods.find(p => p.id === sourcePeriodId)?.name || '';
      alert(`دوره مالی "${newPeriod.name}" با موفقیت ایجاد و فعال گردید.\nاطلاعات بخش‌های تنظیم و مدیریت انبارها، فرمولاسیون، برنامه‌ریزی تولید، ضریب تبدیل، کالای در جریان ساخت، حساب‌های تامین‌کنندگان و تسهیم زمان‌محور با موفقیت از دوره منتخب (${sourceName}) تکثیر شد.`);
    } else {
      alert(`دوره مالی "${newPeriod.name}" به عنوان یک دوره کاری جدید و خام با موفقیت ایجاد و فعال گردید.`);
    }
  };

  const handleOpenCleanupModal = (p: Period) => {
    if (!db) return;
    if (db.periods.length <= 1) {
      alert('حداقل وجود یک دوره کاری الزامی است. شما نمی‌توانید تنها دوره موجود را حذف کنید.');
      return;
    }
    setCleanupTargetPeriod(p);
    setCleanupConfirmInput('');
  };

  const handleExecuteSmartCleanup = () => {
    if (!db || !cleanupTargetPeriod) return;
    if (cleanupConfirmInput.trim() !== 'پاکسازی دوره') {
      alert('لطفاً جهت تایید نهایی عبارت «پاکسازی دوره» را دقیقا وارد نمایید.');
      return;
    }

    const targetPeriodId = cleanupTargetPeriod.id;
    const pName = cleanupTargetPeriod.name;

    let nextActiveId = activePeriodId;
    if (activePeriodId === targetPeriodId) {
      const remaining = db.periods.filter(p => p.id !== targetPeriodId);
      nextActiveId = remaining[0]?.id || '';
      setActivePeriodId(nextActiveId);
    }

    // 1. MASTER DATA CONSOLIDATION TO NEXT ACTIVE PERIOD (nextActiveId)

    // a) Personnel
    const activeEmpCodes = new Set(
      (db.personnel || [])
        .filter(p => p.periodId === nextActiveId)
        .map(p => String(p.employeeCode || '').trim())
    );
    const clonedPersonnel = (db.personnel || [])
      .filter(p => p.periodId === targetPeriodId)
      .filter(p => p.employeeCode && !activeEmpCodes.has(String(p.employeeCode).trim()))
      .map(p => ({
        ...p,
        id: p.id.startsWith('emp-') ? p.id : `emp-${p.employeeCode}-${Date.now()}`,
        periodId: nextActiveId,
        isActive: true
      }));

    const updatedPersonnel = [
      ...(db.personnel || []).filter(p => p.periodId !== targetPeriodId),
      ...clonedPersonnel
    ];

    // b) Items & Categories
    const activeItemCodes = new Set(
      (db.items || [])
        .filter(i => i.periodId === nextActiveId)
        .map(i => String(i.code || i.barcode || '').trim())
    );
    const clonedItems = (db.items || [])
      .filter(i => i.periodId === targetPeriodId)
      .filter(i => (i.code || i.barcode) && !activeItemCodes.has(String(i.code || i.barcode).trim()))
      .map(i => ({
        ...i,
        id: i.id.startsWith('item-') ? i.id : `item-${i.code}-${Date.now()}`,
        periodId: nextActiveId
      }));

    const updatedItems = [
      ...(db.items || []).filter(i => i.periodId !== targetPeriodId),
      ...clonedItems
    ];

    const activeItemCatNames = new Set(
      (db.itemCategories || [])
        .filter(c => c.periodId === nextActiveId)
        .map(c => c.name.trim())
    );
    const clonedItemCategories = (db.itemCategories || [])
      .filter(c => c.periodId === targetPeriodId)
      .filter(c => c.name && !activeItemCatNames.has(c.name.trim()))
      .map(c => ({
        ...c,
        id: `icat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));

    const updatedItemCategories = [
      ...(db.itemCategories || []).filter(c => c.periodId !== targetPeriodId),
      ...clonedItemCategories
    ];

    // c) Products & Product Categories
    const activeProdCodes = new Set(
      (db.products || [])
        .filter(p => p.periodId === nextActiveId)
        .map(p => String(p.code || p.barcode || '').trim())
    );
    const clonedProducts = (db.products || [])
      .filter(p => p.periodId === targetPeriodId)
      .filter(p => (p.code || p.barcode) && !activeProdCodes.has(String(p.code || p.barcode).trim()))
      .map(p => ({
        ...p,
        id: p.id.startsWith('prod-') ? p.id : `prod-${p.code}-${Date.now()}`,
        periodId: nextActiveId
      }));

    const updatedProducts = [
      ...(db.products || []).filter(p => p.periodId !== targetPeriodId),
      ...clonedProducts
    ];

    const activeDeptNames = new Set(
      (db.departments || [])
        .filter(d => d.periodId === nextActiveId)
        .map(d => d.name.trim())
    );
    const clonedDepartmentsCleanup = (db.departments || [])
      .filter(d => d.periodId === targetPeriodId)
      .filter(d => d.name && !activeDeptNames.has(d.name.trim()))
      .map(d => ({
        ...d,
        id: `dept-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));
    const updatedDepartments = [
      ...(db.departments || []).filter(d => d.periodId !== targetPeriodId),
      ...clonedDepartmentsCleanup
    ];

    const activeProdCatNames = new Set(
      (db.productCategories || [])
        .filter(c => c.periodId === nextActiveId)
        .map(c => c.name.trim())
    );
    const clonedProdCategories = (db.productCategories || [])
      .filter(c => c.periodId === targetPeriodId)
      .filter(c => c.name && !activeProdCatNames.has(c.name.trim()))
      .map(c => ({
        ...c,
        id: `pcat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));

    const updatedProductCategories = [
      ...(db.productCategories || []).filter(c => c.periodId !== targetPeriodId),
      ...clonedProdCategories
    ];

    // d) Customers & Customer Categories
    const activeCustomerCodes = new Set(
      (db.customers || [])
        .filter(c => c.periodId === nextActiveId)
        .map(c => String(c.code || c.nationalId || c.phone || '').trim())
    );
    const clonedCustomers = (db.customers || [])
      .filter(c => c.periodId === targetPeriodId)
      .filter(c => (c.code || c.nationalId || c.phone) && !activeCustomerCodes.has(String(c.code || c.nationalId || c.phone).trim()))
      .map(c => ({
        ...c,
        id: c.id.startsWith('cust-') ? c.id : `cust-${c.code}-${Date.now()}`,
        periodId: nextActiveId
      }));

    const updatedCustomers = [
      ...(db.customers || []).filter(c => c.periodId !== targetPeriodId),
      ...clonedCustomers
    ];

    // e) Suppliers
    const activeSupplierNames = new Set(
      (db.suppliers || [])
        .filter(s => s.periodId === nextActiveId)
        .map(s => String(s.name || s.phone || '').trim())
    );
    const clonedSuppliers = (db.suppliers || [])
      .filter(s => s.periodId === targetPeriodId)
      .filter(s => (s.name || s.phone) && !activeSupplierNames.has(String(s.name || s.phone).trim()))
      .map(s => ({
        ...s,
        id: `sup-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));

    const updatedSuppliers = [
      ...(db.suppliers || []).filter(s => s.periodId !== targetPeriodId),
      ...clonedSuppliers
    ];

    // f) Product Formulas
    const activeFormulaProdIds = new Set(
      (db.productFormulas || [])
        .filter(f => f.periodId === nextActiveId)
        .map(f => normalizeAccountingCode(f.productId))
    );
    const clonedFormulas = (db.productFormulas || [])
      .filter(f => f.periodId === targetPeriodId)
      .filter(f => f.productId && !activeFormulaProdIds.has(normalizeAccountingCode(f.productId)))
      .map(f => ({
        ...f,
        id: `form-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));

    const updatedFormulas = [
      ...(db.productFormulas || []).filter(f => f.periodId !== targetPeriodId),
      ...clonedFormulas
    ];

    // g) Unit Conversions
    const activeConversionKeys = new Set(
      (db.unitConversions || [])
        .filter(uc => uc.periodId === nextActiveId)
        .map(uc => `${uc.rawMaterialId}_${uc.consumptionUnit}`)
    );
    const clonedConversions = (db.unitConversions || [])
      .filter(uc => uc.periodId === targetPeriodId)
      .filter(uc => !activeConversionKeys.has(`${uc.rawMaterialId}_${uc.consumptionUnit}`))
      .map(uc => ({
        ...uc,
        id: `uc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        periodId: nextActiveId
      }));

    const updatedConversions = [
      ...(db.unitConversions || []).filter(uc => uc.periodId !== targetPeriodId),
      ...clonedConversions
    ];

    // h) Warehouses & Bank Accounts
    const activeWarehouseNames = new Set(
      (db.warehouses || []).filter(w => w.periodId === nextActiveId).map(w => w.name.trim())
    );
    const clonedWarehouses = (db.warehouses || [])
      .filter(w => w.periodId === targetPeriodId && !activeWarehouseNames.has(w.name.trim()))
      .map(w => ({ ...w, id: `wh-${Date.now()}`, periodId: nextActiveId }));

    const updatedWarehouses = [
      ...(db.warehouses || []).filter(w => w.periodId !== targetPeriodId),
      ...clonedWarehouses
    ];

    const activeBankAccNos = new Set(
      (db.bankAccounts || []).filter(b => b.periodId === nextActiveId).map(b => b.accountNo.trim())
    );
    const clonedBankAccounts = (db.bankAccounts || [])
      .filter(b => b.periodId === targetPeriodId && !activeBankAccNos.has(b.accountNo.trim()))
      .map(b => ({ ...b, id: `bank-${Date.now()}`, periodId: nextActiveId }));

    const updatedBankAccounts = [
      ...(db.bankAccounts || []).filter(b => b.periodId !== targetPeriodId),
      ...clonedBankAccounts
    ];

    // 2. TRANSACTIONAL PURGING (حذف کامل داده‌های سنگین دوره قدیم)
    const updatedDb: AppDatabase = {
      ...db,
      periods: (db.periods || []).filter(p => p.id !== targetPeriodId),
      selectedPeriodId: db.selectedPeriodId === targetPeriodId ? nextActiveId : (db.selectedPeriodId || nextActiveId),

      // Master Data (consolidated)
      personnel: updatedPersonnel,
      items: updatedItems,
      itemCategories: updatedItemCategories,
      products: updatedProducts,
      productCategories: updatedProductCategories,
      departments: updatedDepartments,
      customers: updatedCustomers,
      suppliers: updatedSuppliers,
      productFormulas: updatedFormulas,
      unitConversions: updatedConversions,
      warehouses: updatedWarehouses,
      bankAccounts: updatedBankAccounts,

      // Purged Heavy Transactions
      salesTransactions: (db.salesTransactions || []).filter(x => x.periodId !== targetPeriodId),
      purchaseInvoices: (db.purchaseInvoices || []).filter(x => x.periodId !== targetPeriodId),
      stockCountAudits: (db.stockCountAudits || []).filter(x => x.periodId !== targetPeriodId),
      stockCounts: (db.stockCounts || []).filter(x => x.periodId !== targetPeriodId),
      procurementOrders: (db.procurementOrders || []).filter(x => x.periodId !== targetPeriodId),
      dailyProductionSegments: (db.dailyProductionSegments || []).filter(x => x.periodId !== targetPeriodId),
      productSales: (db.productSales || []).filter(x => x.periodId !== targetPeriodId),
      salesPeriods: (db.salesPeriods || []).filter(x => x.periodId !== targetPeriodId),
      periodOverheads: (db.periodOverheads || []).filter(x => x.periodId !== targetPeriodId),
      productionPlanningOrders: (db.productionPlanningOrders || []).filter(x => x.periodId !== targetPeriodId),
      treasuryReceipts: (db.treasuryReceipts || []).filter(x => x.periodId !== targetPeriodId),
      treasuryPayments: (db.treasuryPayments || []).filter(x => x.periodId !== targetPeriodId),
      barterTransactions: (db.barterTransactions || []).filter(x => x.periodId !== targetPeriodId),
      counterpartySettlements: (db.counterpartySettlements || []).filter(x => x.periodId !== targetPeriodId),
      cashierShiftCloseouts: (db.cashierShiftCloseouts || []).filter(x => x.periodId !== targetPeriodId),
      payrollPeriods: (db.payrollPeriods || []).filter(x => x.periodId !== targetPeriodId),
      payrollItems: (db.payrollItems || []).filter(x => x.periodId !== targetPeriodId),
      personnelAllocations: (db.personnelAllocations || []).filter(x => x.periodId !== targetPeriodId),
      salaryBaseRates: (db.salaryBaseRates || []).filter(x => x.periodId !== targetPeriodId),
      personnelContracts: (db.personnelContracts || []).filter(x => x.periodId !== targetPeriodId),
      personnelSettlements: (db.personnelSettlements || []).filter(x => x.periodId !== targetPeriodId),
      shiftAssignments: (db.shiftAssignments || []).filter(x => x.periodId !== targetPeriodId),
      attendanceRecords: (db.attendanceRecords || []).filter(x => x.periodId !== targetPeriodId),
      cashDrawers: (db.cashDrawers || []).filter(x => x.periodId !== targetPeriodId),
      posTerminals: (db.posTerminals || []).filter(x => x.periodId !== targetPeriodId),
      cashiers: (db.cashiers || []).filter(x => x.periodId !== targetPeriodId),
      chequeBooks: (db.chequeBooks || []).filter(x => x.periodId !== targetPeriodId),
      chequeLeaves: (db.chequeLeaves || []).filter(x => x.periodId !== targetPeriodId)
    };

    handleUpdateDatabase(updatedDb);
    setCleanupTargetPeriod(null);
    setCleanupConfirmInput('');

    alert(`دوره مالی "${pName}" با موفقیت پاکسازی شد.\n\n✓ اطلاعات پایه مشترک (شامل ${toPersianDigits(clonedPersonnel.length)} پرسنل، ${toPersianDigits(clonedItems.length)} کالا، ${toPersianDigits(clonedProducts.length)} محصول، ${toPersianDigits(clonedFormulas.length)} فرمول ساخت و ${toPersianDigits(clonedCustomers.length)} مشتری جدید) با موفقیت به دوره فعال منتقل گردید.\n✓ تمام داده‌ها و تراکنش‌های سنگین قدیمی با موفقیت پاکسازی شدند و حافظه سیستم آزاد شد.`);
  };


  // Wait for db retrieval
  if (!db) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center font-sans" dir="rtl">
        <div className="text-center space-y-3">
          <RefreshCw className="h-10 w-10 text-rose-500 animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">در حال راه‌اندازی و بررسی بارگذار سامانه گاتان...</p>
        </div>
      </div>
    );
  }

  // Guard: User Login
  if (!currentUser) {
    return (
      <LoginScreen 
        users={db.users}
        serverMode={serverMode}
        publicUsers={publicUsers}
        onLoginSuccess={handleLoginSuccess} 
      />
    );
  }


  const navItems: Array<{
    id: SystemTabId;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
  }> = [
    { id: 'items', label: 'مدیریت کالا و انبارگردانی', shortLabel: 'کالا و انبارگردانی', icon: <Boxes className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'suppliers', label: 'تامین کنندگان', shortLabel: 'تامین‌کنندگان', icon: <Users2 className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'customers', label: 'مشتریان', shortLabel: 'مشتریان', icon: <Users className="h-4.5 w-4.5 text-emerald-400 shrink-0" /> },
    { id: 'sales', label: 'فروش', shortLabel: 'فروش', icon: <LineChart className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'cogs', label: 'بهای قیمت تمام شده (COGS)', shortLabel: 'بهای تمام‌شده', icon: <Coins className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'production_planning', label: 'برنامه‌ریزی تولید و سفارشات', shortLabel: 'برنامه‌ریزی تولید', icon: <Calendar className="h-4.5 w-4.5 text-emerald-400 shrink-0" /> },
    { id: 'procurement', label: 'سفارش کالا', shortLabel: 'سفارش کالا', icon: <FileCheck className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'treasury', label: 'وجوه نقد و بانک (خزانه)', shortLabel: 'خزانه‌داری', icon: <Coins className="h-4.5 w-4.5 text-emerald-400 shrink-0" /> },
    { id: 'payroll', label: 'حقوق و دستمزد', shortLabel: 'حقوق و دستمزد', icon: <GraduationCap className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'expenses', label: 'هزینه‌ها و مخارج سربار', shortLabel: 'هزینه‌ها و سربار', icon: <Landmark className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'dibal_scale', label: 'مدیریت ترازوی دیبال (Dibal M-525)', shortLabel: 'ترازوی دیبال', icon: <Scale className="h-4.5 w-4.5 shrink-0" /> },
    { id: 'digital_menu', label: 'منوی دیجیتال کافه (QR)', shortLabel: 'منوی دیجیتال', icon: <QrCode className="h-4.5 w-4.5 text-emerald-400 shrink-0" /> },
    { id: 'cloud_sync', label: 'دیتابیس، کاربران و PostgreSQL', shortLabel: 'دیتابیس و کاربران', icon: <Server className="h-4.5 w-4.5 text-emerald-400 shrink-0" /> },
  ];

  const accessibleNavItems = navItems.filter((item) => canAccessTab(currentUser, item.id));
  const activeNavItem = navItems.find((item) => item.id === activeTab);

  const handleSelectNavTab = (tabId: SystemTabId) => {
    setActiveTab(tabId);
    setMobileHasSelectedForm(true);
    setIsMobileMenuOpen(false);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLogoutClick = () => {
    setIsMobileMenuOpen(false);
    askConfirm(
      'خروج از حساب کاربری',
      'آیا مایل به خروج از سامانه گاتان هستید؟ برای ورود مجدد نیاز به نام کاربری و رمز عبور خواهد بود.',
      async () => {
        if (serverMode === 'postgres') {
          await logoutFromPostgres();
        }
        lastSyncedDbRef.current = null;
        collectionVersionsRef.current = {};
        setMobileHasSelectedForm(false);
        setIsMobileMenuOpen(false);
        setCurrentUser(null);
      }
    );
  };

  return (
    <div className="min-h-screen bg-[#e8eef5] dark:bg-[#09090b] text-slate-900 dark:text-[#fafafa] font-sans flex flex-col" dir="rtl">
      
      {/* ================= HEADER TOP BAR ================= */}
      <header className="bg-white/95 dark:bg-[#0d0d0f]/95 backdrop-blur-md text-slate-900 dark:text-white shadow-[0_2px_14px_-4px_rgba(15,23,42,0.09)] dark:shadow-xl px-2.5 py-1.5 lg:px-6 lg:py-4 sticky top-0 z-40 border-b border-slate-300/80 dark:border-zinc-800/80">
        
        {/* COMPACT MOBILE & TABLET HEADER (< lg) */}
        <div className="lg:hidden flex flex-col gap-1">
          {/* Primary Compact Row: 3-dot Menu + Active Form Title + Theme Toggle + DB Status Icon */}
          <div className="flex items-center justify-between gap-2 min-h-[36px]">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  if (!mobileHasSelectedForm) {
                    setMobileHasSelectedForm(true);
                  } else {
                    setIsMobileMenuOpen((prev) => !prev);
                  }
                }}
                aria-label="منوی بخش‌های سامانه"
                aria-expanded={isMobileMenuOpen || !mobileHasSelectedForm}
                className={`h-9 w-9 -mr-1 rounded-xl flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  isMobileMenuOpen
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/80 active:bg-slate-200 dark:active:bg-zinc-800'
                }`}
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <MoreVertical className="h-5 w-5" />}
              </button>

              <div className="h-6 w-6 rounded-lg bg-emerald-600/90 flex items-center justify-center shrink-0">
                <Boxes className="h-3.5 w-3.5 text-white" />
              </div>

              <h1 className="text-[13px] font-black tracking-tight text-slate-900 dark:text-white truncate">
                {mobileHasSelectedForm ? (activeNavItem?.label || 'سامانه گاتان') : 'سامانه جامع گاتان'}
              </h1>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Mobile Compact Theme Switcher */}
              <button
                type="button"
                onClick={toggleTheme}
                className="h-8 w-8 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                title={isDark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
                aria-label={isDark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
              >
                {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-indigo-600" />}
              </button>

              {/* Compact DB Status Icon + Label */}
              <button
                type="button"
                onClick={() => {
                  if (canAccessTab(currentUser, 'cloud_sync')) {
                    handleSelectNavTab('cloud_sync');
                  }
                }}
                className={`h-8 px-2 rounded-lg border flex items-center gap-1 text-[10px] font-bold shrink-0 transition-colors cursor-pointer ${
                  serverMode === 'postgres'
                    ? pgSyncState === 'error'
                      ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30'
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                    : 'bg-amber-50 dark:bg-zinc-900 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-zinc-800'
                }`}
                title={
                  serverMode === 'postgres'
                    ? (lastPgSyncTime ? `PostgreSQL متصل — آخرین همگام‌سازی: ${lastPgSyncTime}` : 'PostgreSQL متصل')
                    : 'ذخیره محلی (آفلاین)'
                }
              >
                {serverMode === 'postgres' ? (
                  <>
                    <Server className={`h-3.5 w-3.5 shrink-0 ${pgSyncState === 'syncing' ? 'animate-spin text-sky-500 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
                    <span className="whitespace-nowrap">{pgSyncState === 'syncing' ? 'همگام‌سازی' : 'متصل'}</span>
                  </>
                ) : (
                  <>
                    <HardDrive className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="whitespace-nowrap">محلی</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Slim Secondary Meta Row: Period Selector + User Name + Logout */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/70 text-[11px]">
            <div className="flex items-center gap-1 min-w-0">
              <Calendar className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <select
                aria-label="دوره کاری"
                className="mobile-compact-select bg-zinc-900 text-zinc-100 font-bold max-w-[165px] truncate outline-none"
                value={activePeriodId}
                onChange={(e) => setActivePeriodId(e.target.value)}
              >
                {db.periods.map(p => (
                  <option key={p.id} value={p.id} className="bg-zinc-950 text-zinc-100">{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 min-w-0 shrink-0">
              <span className="text-[11px] font-bold text-emerald-400 truncate max-w-[110px]">
                {currentUser.fullName || currentUser.name || currentUser.username}
              </span>
              <span className="text-zinc-700 select-none" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={handleLogoutClick}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/70 transition-colors cursor-pointer shrink-0"
                title="خروج از حساب"
                aria-label="خروج از حساب"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* FULL DESKTOP HEADER (>= lg) */}
        <div className="hidden lg:flex max-w-7xl mx-auto flex-row items-center justify-between gap-4">
          
          {/* Logo Title */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-605 to-emerald-400 flex items-center justify-center shadow-lg transform rotate-3 bg-emerald-600">
              <Boxes className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5 font-sans">
                سامانه جامع و یکپارچه گاتان
                <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full">نسخه ۱.۴</span>
              </h1>
              <p className="text-[10.5px] text-slate-500 dark:text-zinc-400 mt-0.5 font-medium">پلتفرم پیشرفته کارگاهی انبارداری، حسابداری، خرید و بهای قیمت تمام شده محصول</p>
            </div>
          </div>

          {/* Quick status trackers */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            
            {/* Light / Dark Theme Switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 px-3 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              title={isDark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
              aria-label={isDark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
            >
              {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-600" />}
              <span>{isDark ? 'تم روشن' : 'تم تیره'}</span>
            </button>

            {/* PostgreSQL / Local Mode Status Indicator */}
            <button
              onClick={() => {
                if (canAccessTab(currentUser, 'cloud_sync')) setActiveTab('cloud_sync');
              }}
              className={`p-2 px-3 rounded-xl border flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                serverMode === 'postgres'
                  ? pgSyncState === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/60'
                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-800'
              }`}
              title={lastPgSyncTime ? `آخرین همگام‌سازی: ${lastPgSyncTime}` : 'وضعیت پایگاه داده'}
            >
              {serverMode === 'postgres' ? (
                <>
                  <Server className={`h-4 w-4 ${pgSyncState === 'syncing' ? 'animate-spin text-sky-500 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400'}`} />
                  <span>{pgSyncState === 'syncing' ? 'در حال همگام‌سازی...' : 'PostgreSQL متصل'}</span>
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span>ذخیره محلی (آفلاین)</span>
                </>
              )}
            </button>

            {/* General Backup trigger */}
            <button
              onClick={() => setShowBackupPanel(true)}
              className="p-2 px-3 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-300 flex items-center gap-1.5 cursor-pointer transition-colors relative"
              title="پشتیبان‌گیری روزانه، خروجی و بازیابی کامل دیتابیس"
            >
              <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>پشتیبان و بازیابی</span>
              {pendingBackupFolderPrompt && isAdminUser(currentUser) && (
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>

            {/* Active Switcher for Period validation */}
            <div className="h-9 w-[1px] bg-slate-200 dark:bg-zinc-800 hidden md:block" />

            <div className="flex items-center gap-1">
              <span className="text-slate-500 dark:text-zinc-500 hidden md:inline ml-1">دوره کاری:</span>
              <select
                id="active-period-selector"
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-150 p-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-zinc-800 text-xs font-bold focus:border-emerald-500 outline-none"
                value={activePeriodId}
                onChange={(e) => {
                  setActivePeriodId(e.target.value);
                }}
              >
                {db.periods.map(p => (
                  <option key={p.id} value={p.id} className="bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100">{p.name}</option>
                ))}
              </select>
              {isAdminUser(currentUser) && (
                <button
                  type="button"
                  onClick={() => setShowPeriodManager(true)}
                  className="p-1.5 px-2.5 bg-slate-100 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-750 hover:text-slate-900 dark:hover:text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                >
                  + جدید
                </button>
              )}
            </div>

            {/* Current user & logout */}
            <div className="flex items-center gap-2 p-1.5 px-3 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 rounded-xl">
              <div>
                <span className="block text-[9.5px] text-slate-500 dark:text-zinc-500">{currentUser.role}</span>
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{currentUser.fullName || currentUser.name || currentUser.username}</span>
              </div>
              <button
                onClick={handleLogoutClick}
                className="p-1 border border-slate-300 dark:border-zinc-805 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white rounded-lg cursor-pointer transition-all"
                title="خروج از حساب"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

          </div>

        </div>
      </header>

      {/* ================= MOBILE SLIDE-OVER MENU DRAWER (3-DOT TRIGGERED) ================= */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex justify-start" dir="rtl">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-[84vw] max-w-[310px] h-full bg-white dark:bg-[#0d0d0f] border-l border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-fadeIn">
            {/* Drawer Header */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
                  <Boxes className="h-4.5 w-4.5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-black text-slate-900 dark:text-white truncate">بخش‌های مدیریتی سامانه</div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 truncate">
                    {currentUser.fullName || currentUser.name || currentUser.username} · {currentUser.role}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
                aria-label="بستن منو"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Module List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 text-xs font-extrabold">
              {accessibleNavItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNavTab(item.id)}
                    className={`w-full text-right px-3 py-2.5 min-h-[44px] rounded-xl flex items-center gap-2.5 transition-all cursor-pointer ${
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-500/25'
                        : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/50 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Drawer Footer Utilities */}
            <div className="p-3 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50 dark:bg-zinc-950/60 space-y-2 text-xs">
              <button
                type="button"
                onClick={toggleTheme}
                className="w-full px-3 py-2 min-h-[40px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl text-slate-800 dark:text-zinc-200 flex items-center justify-center gap-2 text-[11px] font-bold cursor-pointer transition-colors"
              >
                {isDark ? <Sun className="h-4 w-4 text-amber-400 shrink-0" /> : <Moon className="h-4 w-4 text-indigo-600 shrink-0" />}
                <span>{isDark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setShowBackupPanel(true);
                  }}
                  className="px-2.5 py-2 min-h-[40px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer relative"
                >
                  <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>پشتیبان‌گیری</span>
                  {pendingBackupFolderPrompt && isAdminUser(currentUser) && (
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                  )}
                </button>

                {isAdminUser(currentUser) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setShowPeriodManager(true);
                    }}
                    className="px-2.5 py-2 min-h-[40px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer"
                  >
                    <FolderKanban className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>مدیریت دوره‌ها</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogoutClick}
                    className="px-2.5 py-2 min-h-[40px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/25 hover:bg-rose-100 dark:hover:bg-rose-950/70 rounded-xl text-rose-700 dark:text-rose-300 flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5 shrink-0" />
                    <span>خروج</span>
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-zinc-500 px-1 pt-0.5">
                <span className="truncate">
                  {serverMode === 'postgres'
                    ? (lastPgSyncTime ? `PostgreSQL متصل · ${lastPgSyncTime}` : 'PostgreSQL متصل')
                    : 'ذخیره محلی (آفلاین)'}
                </span>
                {isAdminUser(currentUser) && (
                  <button
                    type="button"
                    onClick={handleLogoutClick}
                    className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-bold flex items-center gap-1 cursor-pointer shrink-0 mr-2"
                  >
                    <LogOut className="h-3 w-3" />
                    <span>خروج</span>
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* First-Time Migration / Sync Conflict / Daily Backup Folder Permission Banner */}
      {(showLocalMigrationBanner || syncNotice || (pendingBackupFolderPrompt && isAdminUser(currentUser))) && (
        <div className="max-w-7xl w-full mx-auto px-2.5 sm:px-4 md:px-6 lg:px-8 pt-3 lg:pt-4 space-y-2">
          {pendingBackupFolderPrompt && isAdminUser(currentUser) && (
            <div className="p-3.5 rounded-2xl bg-amber-950/35 border border-amber-700/45 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="text-amber-100 leading-relaxed">
                <strong className="text-amber-300 block mb-0.5">تایید دسترسی پوشه پشتیبان‌گیری روزانه</strong>
                <span>مرورگر پس از باز شدن مجدد نیاز به تایید یک‌کلیکی برای ذخیره مستقیم فایل بکاپ امروز در پوشه انتخاب‌شده سیستم شما دارد.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleGrantBackupFolderWrite}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors"
                >
                  ذخیره بکاپ امروز در پوشه
                </button>
                <button
                  type="button"
                  onClick={() => setPendingBackupFolderPrompt(false)}
                  className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold px-3 py-2 rounded-xl cursor-pointer"
                >
                  بستن
                </button>
              </div>
            </div>
          )}
          {showLocalMigrationBanner && serverMode === 'postgres' && isAdminUser(currentUser) && (
            <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-700/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="text-blue-200 leading-relaxed">
                <strong className="text-white block mb-0.5">پایگاه داده PostgreSQL هنوز خالی است!</strong>
                <span>آیا مایلید داده‌های فعلی ذخیره شده در مرورگر (دوره‌ها، کالاها، فرمول‌ها و سوابق) را به عنوان اطلاعات اولیه مشترک به PostgreSQL منتقل کنید؟</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleMigrateLocalToPostgres}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors"
                >
                  انتقال به PostgreSQL
                </button>
                <button
                  type="button"
                  onClick={() => setShowLocalMigrationBanner(false)}
                  className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold px-3 py-2 rounded-xl cursor-pointer"
                >
                  بعداً
                </button>
              </div>
            </div>
          )}
          {syncNotice && (
            <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-700/40 flex items-center justify-between gap-3 text-xs text-amber-200">
              <span>{syncNotice}</span>
              <button
                type="button"
                onClick={() => setSyncNotice(null)}
                className="text-amber-400 hover:text-white font-bold cursor-pointer"
              >
                بستن
              </button>
            </div>
          )}
        </div>
      )}


      {/* ================= MAIN DASHBOARD BOARD ================= */}
      <main className="flex-grow max-w-7xl w-full mx-auto p-2 sm:p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-4 gap-3 lg:gap-6">
        
        {/* NAVIGATION SIDEBAR: Always visible on desktop; on mobile starts open until user selects a form, then collapses behind the 3-dot button */}
        <nav
          className={`${
            mobileHasSelectedForm ? 'hidden lg:flex' : 'flex'
          } lg:col-span-1 bg-white dark:bg-[#0d0d0f] p-3.5 sm:p-5 rounded-2xl lg:rounded-3xl border border-slate-300/75 dark:border-zinc-800/80 shadow-md dark:shadow-2xl h-fit space-y-1 select-none flex-col justify-between`}
        >
          <div>
            <div className="pb-2.5 lg:pb-3 mb-3 lg:mb-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between gap-2">
              <h3 className="text-xs font-black text-slate-700 dark:text-zinc-500 tracking-wider">بخش‌های مدیریتی سامانه</h3>
              <span className="lg:hidden text-[10px] text-slate-500 dark:text-zinc-500 font-medium">یک بخش را انتخاب کنید</span>
            </div>

            <div className="space-y-1.5 text-xs font-extrabold font-sans">
              {accessibleNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNavTab(item.id)}
                  className={`w-full text-right p-3 min-h-[44px] rounded-xl flex items-center gap-2.5 transition-all cursor-pointer ${
                    activeTab === item.id
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 font-black border-r-[3px] border-emerald-600 dark:border-emerald-500 shadow-xs'
                      : 'text-slate-700 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/40 hover:text-slate-950 dark:hover:text-zinc-200'
                  }`}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile Quick Actions on Initial Menu View */}
          <div className="lg:hidden mt-4 pt-3 border-t border-slate-200 dark:border-zinc-800/80 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowBackupPanel(true)}
              className="px-3 py-2.5 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer"
            >
              <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>پشتیبان و بازیابی</span>
            </button>
            {isAdminUser(currentUser) && (
              <button
                type="button"
                onClick={() => setShowPeriodManager(true)}
                className="px-3 py-2.5 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 text-[11px] font-bold cursor-pointer"
              >
                <FolderKanban className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>مدیریت دوره‌ها</span>
              </button>
            )}
          </div>

          <div className="hidden lg:block mt-8 border-t border-slate-200 dark:border-zinc-850 pt-4 space-y-2 text-[10px] text-slate-500 dark:text-zinc-500 font-normal leading-normal select-none">
            <div>فعال در بازه مالی: <strong className="text-emerald-700 dark:text-emerald-400 block mt-0.5">{db.periods.find(p => p.id === activePeriodId)?.name}</strong></div>
            <div>
              {serverMode === 'postgres'
                ? 'اتصال مشترک چندکاربره با پایگاه داده PostgreSQL برقرار است.'
                : 'سامانه در حالت ذخیره محلی مرورگر (آفلاین) فعال می‌باشد.'}
            </div>
          </div>
        </nav>


        {/* RIGHT FLEXIBLE VIEWPORT CONTAINER */}
        <section className={`${mobileHasSelectedForm ? 'block' : 'hidden lg:block'} lg:col-span-3 space-y-4 lg:space-y-6 min-w-0`}>
          
          {/* Item Management View */}
          {activeTab === 'items' && (
            <ItemManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* Supplier Directory View */}
          {activeTab === 'suppliers' && (
            <SupplierManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* Customer Directory & Production Orders View */}
          {activeTab === 'customers' && (
            <CustomerManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
              currentUserName={currentUser?.fullName || currentUser?.name || currentUser?.username || ''}
            />
          )}

          {/* Monthly Sales & Analytics View */}
          {activeTab === 'sales' && (
            <SalesManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* COGS Recipe & Cost-Sharing View */}
          {activeTab === 'cogs' && (
            <CogsManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* Production Planning and Orders View */}
          {activeTab === 'production_planning' && (
            <ProductionPlanning
              db={db}
              onUpdateDb={handleUpdateDatabase}
              activePeriodId={activePeriodId}
              currentUserName={currentUser?.fullName || currentUser?.name || currentUser?.username || ''}
            />
          )}

          {/* Purchase Order Proposals View */}
          {activeTab === 'procurement' && (
            <ProcurementManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId}
              currentUserName={currentUser?.fullName || currentUser?.name || currentUser?.username || ''}
            />
          )}

          {/* Personnel Payroll & Insurance View */}
          {activeTab === 'payroll' && (
            <PayrollManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* Treasury & Bank Management View */}
          {activeTab === 'treasury' && db && (
            <TreasuryManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
              askConfirm={askConfirm}
            />
          )}

          {/* Operating Overheads Ledger View */}
          {activeTab === 'expenses' && (
            <ExpenseManagement 
              db={db} 
              onUpdateDb={handleUpdateDatabase} 
              activePeriodId={activePeriodId} 
            />
          )}

          {/* Dibal Scale Integration View */}
          {activeTab === 'dibal_scale' && db && (
            <DibalScaleManagement
              db={db}
              onUpdateDb={handleUpdateDatabase}
              activePeriodId={activePeriodId}
            />
          )}

          {/* Public QR Digital Menu Admin View */}
          {activeTab === 'digital_menu' && db && (
            <DigitalMenuAdmin
              db={db}
              onUpdateDb={handleUpdateDatabase}
              activePeriodId={activePeriodId}
              serverMode={serverMode}
              onOpenPublicPreview={onOpenPublicMenu}
            />
          )}

          {/* PostgreSQL Database, Users (RBAC) & Server View */}
          {activeTab === 'cloud_sync' && db && (
            <DatabaseServerPanel
              db={db}
              currentUser={currentUser}
              serverStatus={serverStatus}
              pgSyncState={pgSyncState}
              lastPgSyncTime={lastPgSyncTime}
              onRefreshStatusAndPull={handleRefreshStatusAndPull}
              onMigrateLocalToPostgres={handleMigrateLocalToPostgres}
              onUpdateDb={handleUpdateDatabase}
              onOpenBackupPanel={() => setShowBackupPanel(true)}
              sqlServerUrl={sqlServerUrl}
              setSqlServerUrl={setSqlServerUrl}
              sqlServerApiKey={sqlServerApiKey}
              setSqlServerApiKey={setSqlServerApiKey}
              sqlServerAutoSync={sqlServerAutoSync}
              setSqlServerAutoSync={setSqlServerAutoSync}
              isSqlServerTesting={isSqlServerTesting}
              isSqlServerSyncing={isSqlServerSyncing}
              sqlServerStatusMessage={sqlServerStatusMessage}
              onTestSqlServerConnection={handleTestSqlServerConnection}
              onSaveToSqlServer={handleSaveToSqlServer}
              onRestoreFromSqlServer={handleRestoreFromSqlServer}
              onDownloadSqlServerScript={handleDownloadSqlServerScript}
            />
          )}
        </section>
      </main>
      <DatabaseBackupModal
        isOpen={showBackupPanel}
        onClose={() => setShowBackupPanel(false)}
        db={db}
        currentUser={currentUser}
        serverMode={serverMode}
        backupRevision={backupRevision}
        onRestoreDatabase={handleRestoreFullDatabase}
        onExportExcelBackup={handleExportExcelBackup}
        onImportExcelBackup={handleImportExcelBackup}
        onExportDibalExcelBackup={handleExportDibalExcelBackup}
        onImportDibalExcelBackup={handleImportDibalExcelBackup}
        onPurgeAllDatabase={handlePurgeAllDatabase}
        askConfirm={askConfirm}
      />

      {/* ================= MODAL WINDOW B: NEW TIME PERIOD POPUP ================= */}
      {showPeriodManager && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in font-sans" dir="rtl">
          <div className="glass-card rounded-3xl p-6 max-w-lg w-full space-y-5 text-zinc-100">
            <div>
              <h3 className="text-sm font-extrabold text-white flex items-center gap-1.5">
                <FolderKanban className="h-5 w-5 text-emerald-500" /> مدیریت دوره‌های زمانی و مالی
              </h3>
              <p className="text-[10.5px] text-zinc-400 mt-1">بخش‌های بهای تمام شده، انبارداری، تردد پرسنل و فروش محصولات بر اساس این دوره‌ها تفکیک می‌گردند.</p>
            </div>

            {editingPeriod ? (
              <form onSubmit={handleSaveEditPeriod} className="space-y-4 bg-zinc-900/40 p-4 rounded-2xl border border-zinc-800">
                <div className="text-xs font-bold text-emerald-400 border-b border-zinc-800 pb-2 flex items-center justify-between">
                  <span>ویرایش دوره: {editingPeriod.name}</span>
                  <button 
                    type="button" 
                    onClick={() => setEditingPeriod(null)}
                    className="text-[10px] text-zinc-400 hover:text-white"
                  >
                    انصراف از ویرایش
                  </button>
                </div>
                
                <div>
                  <label htmlFor="edit-period-name-modal" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">نام دوره مالی</label>
                  <input
                    id="edit-period-name-modal"
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 outline-none transition-all font-bold"
                    value={editPeriodName}
                    onChange={(e) => setEditPeriodName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderShamsiDatePicker('edit-start-date', 'تاریخ شروع دوره (انتخابگر شمسی)', editPeriodStartDate, setEditPeriodStartDate)}
                  {renderShamsiDatePicker('edit-end-date', 'تاریخ پایان دوره (انتخابگر شمسی)', editPeriodEndDate, setEditPeriodEndDate)}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-grow bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-xl shadow cursor-pointer transition-colors"
                  >
                    ذخیره تغییرات دوره
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPeriod(null)}
                    className="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    انصراف
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreatePeriod} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-period-name-modal" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">تعریف دوره مالی جدید</label>
                    <input
                      id="new-period-name-modal"
                      type="text"
                      required
                      placeholder="مثال: دوره فروردین ۱۴۰۵"
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 outline-none transition-all font-bold"
                      value={newPeriodName}
                      onChange={(e) => setNewPeriodName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="copy-source-period-modal" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">کپی اطلاعات پایه از دوره:</label>
                    <select
                      id="copy-source-period-modal"
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 outline-none transition-all font-bold"
                      value={copySourcePeriodId || activePeriodId}
                      onChange={(e) => setCopySourcePeriodId(e.target.value)}
                    >
                      {db.periods.map(p => (
                        <option key={p.id} value={p.id} className="bg-zinc-950 text-zinc-100">
                          {p.name} {p.id === activePeriodId ? ' (دوره جاری)' : ''}
                        </option>
                      ))}
                      <option value="none" className="bg-zinc-950 text-zinc-455">بدون کپی اطلاعات (دوره خام)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderShamsiDatePicker('new-start-date', 'تاریخ شروع دوره (انتخابگر شمسی)', newPeriodStartDate, setNewPeriodStartDate)}
                  {renderShamsiDatePicker('new-end-date', 'تاریخ پایان دوره (انتخابگر شمسی)', newPeriodEndDate, setNewPeriodEndDate)}
                </div>

                <div className="flex gap-2 pt-1 border-b border-zinc-800 pb-3">
                  <button
                    type="submit"
                    className="flex-grow bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-xl shadow cursor-pointer transition-colors"
                  >
                    ایجاد دوره کاری جدید
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPeriodManager(false)}
                    className="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    بستن
                  </button>
                </div>
              </form>
            )}

            {/* Existing periods listing with Delete action */}
            <div className="space-y-2 pt-1 text-right">
              <span className="block text-[10.5px] font-bold text-zinc-400">دوره‌های مالی تعریف شده:</span>
              <div className="max-h-52 overflow-y-auto space-y-2 pr-1 border border-zinc-900 bg-zinc-900/25 p-2 rounded-xl">
                {db.periods.map(p => (
                  <div key={p.id} className="flex flex-col gap-1.5 bg-zinc-900/50 p-2.5 px-3.5 rounded-xl border border-zinc-850 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={`font-black ${p.id === activePeriodId ? 'text-emerald-400' : 'text-zinc-200'}`}>
                        {p.name} {p.id === activePeriodId && ' (جاری)'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEditPeriod(p)}
                          className="p-1 hover:bg-indigo-950/40 text-indigo-400 rounded cursor-pointer transition-colors"
                          title="ویرایش تاریخ‌های دوره"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCleanupModal(p)}
                          className="p-1 hover:bg-rose-950/40 text-rose-400 rounded cursor-pointer transition-colors"
                          title="پاکسازی هوشمند و حذف دوره مالی"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-400 font-bold flex justify-start gap-4">
                      <span>تاریخ شروع: <strong className="font-mono text-emerald-500">{p.startDate ? toPersianDigits(p.startDate) : 'ثبت نشده'}</strong></span>
                      <span>تاریخ پایان: <strong className="font-mono text-rose-400">{p.endDate ? toPersianDigits(p.endDate) : 'ثبت نشده'}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}


      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn animate-duration-200 font-sans text-right" dir="rtl">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 text-rose-500 mb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                <ShieldAlert className="h-6 w-6 text-rose-50/80 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-[#fafafa]">{confirmModal.title}</h3>
            </div>
            
            <p className="text-xs text-zinc-300 leading-relaxed font-semibold mb-6">
              {confirmModal.message}
            </p>
            
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 font-extrabold text-xs rounded-xl transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-[#fafafa] font-extrabold text-xs rounded-xl shadow-lg border border-rose-500/15 transition-all cursor-pointer"
              >
                تایید و ادامه
              </button>
            </div>
          </div>
        </div>
      )}

      {cleanupTargetPeriod && db && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans text-right" dir="rtl">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-850 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">پاکسازی هوشمند و حذف دوره مالی</h3>
                  <span className="text-[11px] font-bold text-zinc-400">دوره انتخاب شده: {cleanupTargetPeriod.name}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCleanupTargetPeriod(null)}
                className="p-1.5 hover:bg-zinc-850 text-zinc-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>اطلاعات پایه انتقالی/ادغام شونده به دوره فعال (بدون حذف)</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300 font-bold pt-1">
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    پرسنل جدید: <strong className="text-emerald-400 font-mono">{toPersianDigits((db.personnel || []).filter(p => p.periodId === cleanupTargetPeriod.id).length)}</strong> نفر
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    کالاها و محصولات: <strong className="text-emerald-400 font-mono">{toPersianDigits((db.items || []).filter(i => i.periodId === cleanupTargetPeriod.id).length + (db.products || []).filter(p => p.periodId === cleanupTargetPeriod.id).length)}</strong> کالا
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    فرمول‌های ساخت: <strong className="text-emerald-400 font-mono">{toPersianDigits((db.productFormulas || []).filter(f => f.periodId === cleanupTargetPeriod.id).length)}</strong> فرمول
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    مشتریان و تامین‌کنندگان: <strong className="text-emerald-400 font-mono">{toPersianDigits((db.customers || []).filter(c => c.periodId === cleanupTargetPeriod.id).length + (db.suppliers || []).filter(s => s.periodId === cleanupTargetPeriod.id).length)}</strong> شخص
                  </div>
                </div>
              </div>

              <div className="bg-rose-950/20 border border-rose-800/40 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>حجم تراکنش‌های سنگین قابل پاکسازی (آزادسازی حافظه)</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300 font-bold pt-1">
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    تراکنش‌های فروش: <strong className="text-rose-400 font-mono">{toPersianDigits((db.salesTransactions || []).filter(t => t.periodId === cleanupTargetPeriod.id).length)}</strong> ردیف
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    فاکتورهای خرید: <strong className="text-rose-400 font-mono">{toPersianDigits((db.purchaseInvoices || []).filter(p => p.periodId === cleanupTargetPeriod.id).length)}</strong> فاکتور
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    اسناد خزانه‌داری: <strong className="text-rose-400 font-mono">{toPersianDigits((db.treasuryReceipts || []).filter(r => r.periodId === cleanupTargetPeriod.id).length + (db.treasuryPayments || []).filter(p => p.periodId === cleanupTargetPeriod.id).length)}</strong> سند
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-xl border border-zinc-800">
                    شمارش‌های انبار: <strong className="text-rose-400 font-mono">{toPersianDigits((db.stockCounts || []).filter(s => s.periodId === cleanupTargetPeriod.id).length)}</strong> سطر
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-zinc-850">
              <label className="block text-[11px] font-bold text-zinc-300">
                جهت تایید نهایی پاکسازی و آزادسازی حافظه، عبارت <strong className="text-rose-400 font-mono underline">پاکسازی دوره</strong> را وارد نمایید:
              </label>
              <input
                type="text"
                value={cleanupConfirmInput}
                onChange={(e) => setCleanupConfirmInput(e.target.value)}
                placeholder="پاکسازی دوره"
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-bold text-white placeholder-zinc-600 focus:border-rose-500 outline-none transition-all font-mono text-center"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleExecuteSmartCleanup}
                disabled={cleanupConfirmInput.trim() !== 'پاکسازی دوره'}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all shadow cursor-pointer ${
                  cleanupConfirmInput.trim() === 'پاکسازی دوره'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-zinc-850 text-zinc-600 cursor-not-allowed'
                }`}
              >
                اجرای یکپارچه‌سازی و پاکسازی دوره
              </button>
              <button
                type="button"
                onClick={() => setCleanupTargetPeriod(null)}
                className="px-5 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
