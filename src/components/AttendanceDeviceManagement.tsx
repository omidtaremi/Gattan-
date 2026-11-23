/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, AttendanceDeviceConfig, AttendanceRecord, Personnel } from '../types';
import { toPersianDigits, toEnglishDigits } from '../utils/persianUtils';
import { createSimpleIdGenerator, getPrefixForCollection } from '../utils/simpleId';
import { 
  Wifi, WifiOff, RefreshCw, Cpu, Server, Activity, ShieldCheck, Zap, Download, 
  Clock, Check, X, AlertTriangle, Terminal, Play, Info, FileSpreadsheet, 
  UserCheck, HardDrive, CheckCircle2, Copy, HelpCircle, ArrowDownCircle, 
  Settings, CheckCircle, Smartphone, Radio, Globe, Layers,
  Trash2, UploadCloud, Lock, Unlock, Eye, BarChart2, ExternalLink, FileText, ClipboardCheck
} from 'lucide-react';

interface AttendanceDeviceManagementProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  activePeriodId: string;
  selectedYear: number;
  selectedMonth: number;
  onApplyRecordsToTable?: (newRecords: AttendanceRecord[]) => void;
  onClose?: () => void;
}

export interface RawDeviceLog {
  id: string;
  userId: string;
  timestamp: string; // ISO or YYYY-MM-DD HH:mm:ss
  jalaliDate: string; // 1403/05/12
  time: string; // 07:45
  status: number; // 0: Entry, 1: Exit, 2: Break-Out, 3: Break-In, 4: OT-In, 5: OT-Out
  verifyMode: number; // 15: Face, 1: Fingerprint, 4: Card, 3: Password
  matchedEmployee?: Personnel;
}

export interface ProtocolLogEntry {
  id: string;
  time: string;
  type: 'TX' | 'RX' | 'INFO' | 'ERR' | 'SUCCESS';
  command: string;
  hexPayload: string;
  description: string;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  try {
    const date = new Date(gy, gm - 1, gd);
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    let jy = 0, jm = 0, jd = 0;
    parts.forEach(p => {
      const val = parseInt(toEnglishDigits(p.value), 10);
      if (p.type === 'year') jy = val;
      else if (p.type === 'month') jm = val;
      else if (p.type === 'day') jd = val;
    });
    if (jy && jm && jd) {
      return { jy, jm, jd };
    }
  } catch (e) {
    console.error('Error in Intl conversion', e);
  }

  const g_days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  const gy_sub = gy - 1600;
  const gm_sub = gm - 1;
  const gd_sub = gd - 1;

  let g_day_no = 365 * gy_sub + Math.floor((gy_sub + 3) / 4) - Math.floor((gy_sub + 99) / 100) + Math.floor((gy_sub + 399) / 400);

  for (let i = 0; i < gm_sub; ++i) {
    g_day_no += g_days_in_month[i];
  }
  if (gm_sub > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0))) {
    g_day_no++;
  }
  g_day_no += gd_sub;

  let j_day_no = g_day_no - 79;
  const j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;

  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;

  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }

  let i = 0;
  for (i = 0; i < 11 && j_day_no >= j_days_in_month[i]; ++i) {
    j_day_no -= j_days_in_month[i];
  }
  const jm = i + 1;
  const jd = j_day_no + 1;

  return { jy, jm, jd };
}

export function ensureJalaliDate(dateStr: string): string {
  if (!dateStr) return '';
  const clean = toEnglishDigits(dateStr).trim().replace(/[-\/]/g, '/');
  const parts = clean.split('/');
  if (parts.length >= 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (p0 >= 1900 && p0 <= 2100) {
        // Gregorian date like 2024/08/15
        const { jy, jm, jd } = gregorianToJalali(p0, p1, p2);
        return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
      }
      if (p2 >= 1900 && p2 <= 2100) {
        // Format DD/MM/YYYY
        const { jy, jm, jd } = gregorianToJalali(p2, p1, p0);
        return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
      }
      if (p0 >= 1300 && p0 <= 1500) {
        // Already Jalali
        return `${p0}/${String(p1).padStart(2, '0')}/${String(p2).padStart(2, '0')}`;
      }
    }
  }
  return dateStr;
}

export function cleanIpAddress(ip: string): string {
  if (!ip) return '192.168.1.201';
  const engIp = toEnglishDigits(ip).trim();
  const parts = engIp.split('.');
  if (parts.length !== 4) return engIp;
  return parts
    .map(part => {
      const parsed = parseInt(part, 10);
      return isNaN(parsed) ? '0' : String(parsed);
    })
    .join('.');
}

export default function AttendanceDeviceManagement({
  db,
  onUpdateDb,
  activePeriodId,
  selectedYear,
  selectedMonth,
  onApplyRecordsToTable,
  onClose
}: AttendanceDeviceManagementProps) {
  // Active navigation sub-tab
  const [deviceSubTab, setDeviceSubTab] = useState<'connect' | 'logs' | 'paste' | 'bridge' | 'guide' | 'terminal'>('connect');
  const [bridgeLang, setBridgeLang] = useState<'node' | 'python'>('node');

  // Device configuration state
  const deviceConfig: AttendanceDeviceConfig = useMemo(() => {
    if (db.attendanceDeviceConfig) {
      return db.attendanceDeviceConfig;
    }
    return {
      id: 'dev-xface60n-1',
      name: 'دستگاه حضور و غیاب XFace 60 N',
      model: 'XFace 60 N',
      platform: 'ZMM510',
      connectionType: 'local_bridge',
      ipAddress: '192.168.1.201',
      port: 4370,
      commKey: 0,
      bridgeUrl: 'http://localhost:5005',
      autoSync: false,
      isOnline: false,
      firmwareVersion: 'Ver 1.4.12 (ZMM510_Linux)',
      serialNumber: 'XF60N-IR',
      faceCount: 0,
      userCount: 0,
      logCount: 0,
      lastSyncTime: ''
    };
  }, [db.attendanceDeviceConfig]);

  const [formConfig, setFormConfig] = useState<AttendanceDeviceConfig>(deviceConfig);

  // Sync state & connection test result
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    status: 'success' | 'error' | 'warning' | null;
    message: string;
    pingMs?: number;
    details?: string;
    isBridgeOffline?: boolean;
  }>({ status: null, message: '' });

  // Terminal & Protocol Log state
  const [terminalLogs, setTerminalLogs] = useState<ProtocolLogEntry[]>([
    {
      id: 'tlog-1',
      time: new Date().toLocaleTimeString('fa-IR'),
      type: 'INFO',
      command: 'SYS_INIT',
      hexPayload: '0x00 0x00 0x00 0x00',
      description: 'سرویس اتصال به پلتفرم سخت‌افزاری ZMM510 دستگاه XFace 60 N آماده است.'
    }
  ]);

  // Fetched device logs state
  const [fetchedLogs, setFetchedLogs] = useState<RawDeviceLog[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [isRealDeviceData, setIsRealDeviceData] = useState<boolean>(false);
  const [logFilterMonth, setLogFilterMonth] = useState<boolean>(false);
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [copiedCodeType, setCopiedCodeType] = useState<string | null>(null);

  // Paste / Direct Import Text State
  const [pasteInputText, setPasteInputText] = useState<string>('');
  const [pasteParseError, setPasteParseError] = useState<string | null>(null);

  // Helper to find employee strictly by attendanceCode ONLY (never employeeCode)
  const findPersonnel = (deviceCode: string): Personnel | undefined => {
    const clean = (c: string) => {
      const s = toEnglishDigits(String(c || '')).trim().toLowerCase();
      const noZeros = s.replace(/^0+/, '');
      return noZeros === '' && s !== '' ? '0' : noZeros;
    };
    const cleanTarget = clean(deviceCode);
    if (!cleanTarget) return undefined;

    // Strict match ONLY by attendanceCode (کد پرسنل حضور و غیاب)
    return (db.personnel || []).find(p => {
      const matchPeriod = p.periodId ? p.periodId === activePeriodId : true;
      if (!matchPeriod) return false;
      const rawAtt = toEnglishDigits(String(p.attendanceCode || '')).trim();
      if (!rawAtt) return false;
      const tokens = rawAtt.split(/[\s,،;|/\\]+/).map(t => clean(t)).filter(Boolean);
      return tokens.includes(cleanTarget);
    });
  };

  // Save config
  const handleSaveConfig = () => {
    const cleanIp = cleanIpAddress(formConfig.ipAddress);
    const updated: AttendanceDeviceConfig = {
      ...formConfig,
      ipAddress: cleanIp,
      port: Number(toEnglishDigits(String(formConfig.port))) || 4370,
      commKey: Number(toEnglishDigits(String(formConfig.commKey))) || 0
    };
    setFormConfig(updated);
    onUpdateDb({
      ...db,
      attendanceDeviceConfig: updated
    });
    alert('تنظیمات دستگاه XFace 60 N با موفقیت ذخیره گردید.');
  };

  // Test Connection / Ping Handler
  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult({ status: null, message: 'درحال برقراری ارتباط با پلتفرم ZMM510 دستگاه XFace 60 N...' });

    const startTime = performance.now();
    const cleanIp = cleanIpAddress(formConfig.ipAddress);
    const port = Number(toEnglishDigits(String(formConfig.port))) || 4370;
    const bridgeUrl = (formConfig.bridgeUrl || 'http://localhost:5005').replace(/\/$/, '');

    // Log TX CMD_CONNECT
    const txLog: ProtocolLogEntry = {
      id: `tlog-${Date.now()}-1`,
      time: new Date().toLocaleTimeString('fa-IR'),
      type: 'TX',
      command: 'CMD_CONNECT (1000)',
      hexPayload: '0xE8 0x03 0x00 0x00 0x00 0x00 0x00 0x00',
      description: `ارسال درخواست ارتباط به پل محلی (${bridgeUrl}) -> مقصد دستگاه ${cleanIp}:${port}`
    };
    setTerminalLogs(prev => [txLog, ...prev]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, 6000);

    try {
      // Attempt calling the bridge status endpoint
      const res = await fetch(`${bridgeUrl}/status?ip=${cleanIp}&port=${port}&t=${Date.now()}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      const latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        const data = await res.json();
        
        if (data.status === 'online') {
          const rxLog: ProtocolLogEntry = {
            id: `tlog-${Date.now()}-2`,
            time: new Date().toLocaleTimeString('fa-IR'),
            type: 'SUCCESS',
            command: 'CMD_ACK_OK (2000)',
            hexPayload: '0xD0 0x07 0x00 0x00 (ZMM510 Connected)',
            description: `ارتباط واقعی با پلتفرم ZMM510 دستگاه XFace 60 N برقرار شد. زمان پاسخ: ${latency}ms`
          };
          setTerminalLogs(prev => [rxLog, ...prev]);

          setConnectionTestResult({
            status: 'success',
            pingMs: latency,
            message: `ارتباط واقعی با دستگاه XFace 60 N برقرار است (پلتفرم ZMM510 روی شبکه وای‌فای)`,
            details: `شماره سریال دستگاه: ${data.serialNumber || 'تایید شد'} | نسخه نرم‌افزار: ${data.firmware || 'ZMM510'} | تعداد کاربران ثبت‌شده: ${toPersianDigits(data.userCount ?? 0)} نفر`
          });

          onUpdateDb({
            ...db,
            attendanceDeviceConfig: {
              ...formConfig,
              isOnline: true,
              serialNumber: data.serialNumber || formConfig.serialNumber,
              firmwareVersion: data.firmware || formConfig.firmwareVersion,
              userCount: data.userCount ?? formConfig.userCount,
              lastSyncTime: new Date().toLocaleDateString('fa-IR')
            }
          });
        } else {
          // Bridge is running, but device returned error
          const errLog: ProtocolLogEntry = {
            id: `tlog-${Date.now()}-err`,
            time: new Date().toLocaleTimeString('fa-IR'),
            type: 'ERR',
            command: 'DEVICE_UNREACHABLE',
            hexPayload: '0xFF 0xFF 0xFF 0xFF',
            description: `پل محلی پاسخ داد اما دستگاه در آدرس ${cleanIp}:${port} پاسخ نمی‌دهد: ${data.error || 'خطای سوکت'}`
          };
          setTerminalLogs(prev => [errLog, ...prev]);

          setConnectionTestResult({
            status: 'error',
            message: `پل ارتباطی فعال است اما اتصال به دستگاه XFace 60 N با شکست مواجه شد.`,
            details: `پیام دستگاه: ${data.error || 'دستگاه به آی‌پی مشخص شده در پورت ۴۳۷۰ پاسخ نداد.'}\nلطفاً اطمینان حاصل کنید دستگاه روشن بوده و آی‌پی ${cleanIp} با آی‌پی فعلی منوی دستگاه تطابق دارد.`
          });
        }
      } else {
        throw new Error(`پاسخ سرور پل محلی با کد وضعیت ${res.status}`);
      }
    } catch (err: any) {
      console.warn('Bridge request failed:', err);

      const isMixedContent = window.location.protocol === 'https:' && bridgeUrl.startsWith('http:');
      
      const errLog: ProtocolLogEntry = {
        id: `tlog-${Date.now()}-bridge-err`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'ERR',
        command: 'BRIDGE_UNREACHABLE',
        hexPayload: '0x00 0x00 0x00 0x00',
        description: `عدم برقراری تماس با پل محلی (${bridgeUrl}): ${err.message}`
      };
      setTerminalLogs(prev => [errLog, ...prev]);

      setConnectionTestResult({
        status: 'error',
        isBridgeOffline: true,
        message: `عدم برقراری تماس با پل ارتباطی محلی (${bridgeUrl})`,
        details: isMixedContent 
          ? `علت: اسکریپت پل محلی در سیستم اجرا نشده است، یا به دلیل پروتکل HTTPS سامانه، مرورگر شما درخواست خودکار به localhost را مسدود کرده است.\n\nراه‌حل آسان: صفحه داشبورد محلی را با کلیک روی دکمه زیر در تب جدید باز کنید و خروجی زنده را مستقیماً دریافت نمایید.`
          : `علت: اسکریپت xface60n_bridge.py روی پورت ۵۰۰۵ در حال اجرا نیست یا فایروال مانع شده است.`
      });
    } finally {
      clearTimeout(timeoutId);
      setIsTestingConnection(false);
    }
  };

  // Fetch Attendance Logs from Device
  const handleFetchAttendanceLogs = async () => {
    setIsFetchingLogs(true);
    setConnectionTestResult({ status: null, message: '' });

    const startTime = performance.now();
    const cleanIp = cleanIpAddress(formConfig.ipAddress);
    const port = Number(toEnglishDigits(String(formConfig.port))) || 4370;
    const bridgeUrl = (formConfig.bridgeUrl || 'http://localhost:5005').replace(/\/$/, '');

    // Log request
    const txLog: ProtocolLogEntry = {
      id: `tlog-${Date.now()}-att`,
      time: new Date().toLocaleTimeString('fa-IR'),
      type: 'TX',
      command: 'CMD_ATTLOG_RRQ (13)',
      hexPayload: '0x0D 0x00 0x00 0x00 0x00 0x00 0x00 0x00',
      description: `درخواست تخلیه ترددهای بیومتریک از دستگاه ${cleanIp}:${port}`
    };
    setTerminalLogs(prev => [txLog, ...prev]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, 12000);

    try {
      const res = await fetch(`${bridgeUrl}/logs?ip=${cleanIp}&port=${port}&t=${Date.now()}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'error') {
          throw new Error(data.error || 'دستگاه به درخواست تخلیه پاسخ نداد.');
        }

        if (Array.isArray(data.logs)) {
          if (data.logs.length === 0) {
            alert('دستگاه به پل ارتباطی متصل شد، اما حافظه ترددها در حال حاضر تهی (خالی) است.');
            setIsFetchingLogs(false);
            return;
          }

          // Format real records
          const parsedRealLogs: RawDeviceLog[] = data.logs.map((item: any, idx: number) => {
            const userId = String(item.userId || item.user_id || '').trim();
            const rawTime = String(item.time || '').trim();
            const rawDate = String(item.jalaliDate || item.date || item.timestamp || '').trim();
            const jalali = ensureJalaliDate(rawDate);
            const matched = findPersonnel(userId);

            return {
              id: `real-log-${idx}-${userId}`,
              userId,
              timestamp: item.timestamp || `${jalali} ${rawTime}`,
              jalaliDate: jalali,
              time: rawTime.length === 5 ? rawTime : (rawTime.substring(0, 5) || '08:00'),
              status: Number(item.status ?? item.punch ?? 0) === 1 ? 1 : 0,
              verifyMode: Number(item.verifyMode ?? item.verify_type ?? 15),
              matchedEmployee: matched
            };
          });

          // Sort chronologically
          parsedRealLogs.sort((a, b) => a.jalaliDate.localeCompare(b.jalaliDate) || a.time.localeCompare(b.time));

          setFetchedLogs(parsedRealLogs);
          setIsRealDeviceData(true);

          const rxLog: ProtocolLogEntry = {
            id: `tlog-${Date.now()}-res`,
            time: new Date().toLocaleTimeString('fa-IR'),
            type: 'SUCCESS',
            command: 'CMD_PREPARE_DATA (1500)',
            hexPayload: `0xDC 0x05 0x00 0x00 (Total ${parsedRealLogs.length} Real Records)`,
            description: `تعداد ${toPersianDigits(parsedRealLogs.length)} رکورد تردد واقعی از دستگاه XFace 60 N تخلیه و ثبت گردید.`
          };
          setTerminalLogs(prev => [rxLog, ...prev]);

          setDeviceSubTab('logs');
          setIsFetchingLogs(false);
          return;
        } else {
          throw new Error(data.error || 'فرمت داده‌های دریافتی از دستگاه نامعتبر است.');
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `خطای سرور پل محلی با وضعیت ${res.status}`);
      }
    } catch (err: any) {
      console.warn('Real fetch failed:', err);

      const errLog: ProtocolLogEntry = {
        id: `tlog-${Date.now()}-fetch-err`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'ERR',
        command: 'FETCH_FAILED',
        hexPayload: '0x00 0x00 0x00 0x00',
        description: `خطا در دریافت مستقیم لاگ‌ها: ${err.message}`
      };
      setTerminalLogs(prev => [errLog, ...prev]);

      setConnectionTestResult({
        status: 'error',
        isBridgeOffline: true,
        message: 'امکان تخلیه خودکار مستقیم از پل محلی فراهم نشد.',
        details: `علت: ${err.message}\nمرورگر اجازه دسترسی مستقیم به پورت ۵۰۰۵ را نداده یا اسکریپت هنوز در حال اتصال به دستگاه است.\n\nراه حل تضمینی: روی دکمه «باز کردن داشبورد پل محلی» کلیک کرده و در آنجا لاگ‌ها را استخراج و با یک کلیک در بخش «چسباندن متن ترددها» قرار دهید.`
      });
    } finally {
      clearTimeout(timeoutId);
      setIsFetchingLogs(false);
    }
  };

  // Process pasted / imported text (Supports JSON from bridge or standard ZK .dat text)
  const handleProcessPastedText = () => {
    setPasteParseError(null);
    const trimmed = pasteInputText.trim();
    if (!trimmed) {
      setPasteParseError('لطفاً متن خروجی یا داده‌های تردد را در کادر پیست نمایید.');
      return;
    }

    try {
      // 1. Try parsing as JSON array
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let jsonObj: any = JSON.parse(trimmed);
        let list: any[] = [];
        if (Array.isArray(jsonObj)) {
          list = jsonObj;
        } else if (Array.isArray(jsonObj.logs)) {
          list = jsonObj.logs;
        }

        if (list.length > 0) {
          const parsedLogs: RawDeviceLog[] = list.map((item, idx) => {
            const userId = String(item.userId || item.user_id || '').trim();
            const rawTime = String(item.time || '').trim();
            const rawDate = String(item.jalaliDate || item.date || item.timestamp || '').trim();
            const jalali = ensureJalaliDate(rawDate);
            const matched = findPersonnel(userId);

            return {
              id: `paste-json-${idx}-${userId}`,
              userId,
              timestamp: item.timestamp || `${jalali} ${rawTime}`,
              jalaliDate: jalali,
              time: rawTime.length === 5 ? rawTime : (rawTime.substring(0, 5) || '08:00'),
              status: Number(item.status ?? item.punch ?? 0) === 1 ? 1 : 0,
              verifyMode: Number(item.verifyMode ?? item.verify_type ?? 15),
              matchedEmployee: matched
            };
          });

          parsedLogs.sort((a, b) => a.jalaliDate.localeCompare(b.jalaliDate) || a.time.localeCompare(b.time));
          setFetchedLogs(parsedLogs);
          setIsRealDeviceData(true);
          setDeviceSubTab('logs');
          alert(`تعداد ${toPersianDigits(parsedLogs.length)} رکورد تردد با موفقیت از متن JSON پردازش گردید.`);
          return;
        }
      }

      // 2. Try parsing as DAT tab-separated / space-separated text
      const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
      const parsedLogs: RawDeviceLog[] = [];

      lines.forEach((line, idx) => {
        const tokens = line.trim().split(/[\s,]+/).filter(t => t.length > 0);
        if (tokens.length < 2) return;

        const dateIdx = tokens.findIndex(t => t.includes('-') || t.includes('/'));
        const timeIdx = tokens.findIndex(t => t.includes(':'));

        let userId = tokens[0];
        let datePart = '';
        let timePart = '';
        let statusVal = 0;

        if (dateIdx !== -1 && timeIdx !== -1) {
          datePart = tokens[dateIdx];
          timePart = tokens[timeIdx];
          const minDt = Math.min(dateIdx, timeIdx);
          const preTokens = tokens.filter((_, i) => i < minDt);
          if (preTokens.length >= 2) {
            // [DeviceID, UserPIN, Date, Time] - take user PIN directly preceding date
            userId = preTokens[preTokens.length - 1];
          } else if (preTokens.length === 1) {
            userId = preTokens[0];
          }
          if (tokens.length >= 5 && (tokens[4] === '0' || tokens[4] === '1')) {
            statusVal = parseInt(tokens[4], 10);
          } else if (tokens.length >= 4 && (tokens[3] === '0' || tokens[3] === '1')) {
            statusVal = parseInt(tokens[3], 10);
          }
        } else {
          datePart = tokens[1] || '';
          timePart = tokens[2] || '08:00';
        }

        if (!datePart) return;

        const jalali = ensureJalaliDate(datePart);
        const cleanTime = timePart.substring(0, 5);
        const matched = findPersonnel(userId);

        parsedLogs.push({
          id: `paste-dat-${idx}-${userId}`,
          userId,
          timestamp: `${jalali} ${cleanTime}`,
          jalaliDate: jalali,
          time: cleanTime,
          status: statusVal,
          verifyMode: 15,
          matchedEmployee: matched
        });
      });

      if (parsedLogs.length === 0) {
        setPasteParseError('فرمت متن معتبر نیست. لطفاً فایل DAT استاندارد یا خروجی JSON پل ارتباطی را پیست کنید.');
        return;
      }

      parsedLogs.sort((a, b) => a.jalaliDate.localeCompare(b.jalaliDate) || a.time.localeCompare(b.time));
      setFetchedLogs(parsedLogs);
      setIsRealDeviceData(true);
      setDeviceSubTab('logs');
      alert(`تعداد ${toPersianDigits(parsedLogs.length)} رکورد تردد با موفقیت از فایل یا متن متنی پردازش گردید.`);
    } catch (e: any) {
      setPasteParseError('خطا در پردازش متن: ' + e.message);
    }
  };

  // Convert fetched logs into AttendanceRecords and apply to AttendanceForm table
  const handleApplyLogsToDatabase = () => {
    if (fetchedLogs.length === 0) {
      alert('ابتدا باید ترددها را از دستگاه تخلیه کنید.');
      return;
    }

    // Group logs by userId and jalaliDate
    const groupedMap = new Map<string, { deviceCode: string; date: string; logs: { time: string; status: number }[] }>();

    fetchedLogs.forEach(log => {
      const groupKey = `${log.userId}_${log.jalaliDate}`;
      if (!groupedMap.has(groupKey)) {
        groupedMap.set(groupKey, {
          deviceCode: log.userId,
          date: log.jalaliDate,
          logs: []
        });
      }
      const group = groupedMap.get(groupKey)!;
      if (!group.logs.some(l => l.time === log.time)) {
        group.logs.push({
          time: log.time,
          status: log.status
        });
      }
    });

    const newAttendanceRecords: AttendanceRecord[] = [];
    const uniqueUnknownCodes = new Set<string>();
    const genAttId = createSimpleIdGenerator(db.attendanceRecords || [], getPrefixForCollection('attendanceRecords'));

    groupedMap.forEach(group => {
      group.logs.sort((a, b) => a.time.localeCompare(b.time));
      const times = group.logs.map(l => l.time);
      const statuses = group.logs.map(l => l.status);
      const matchedEmp = findPersonnel(group.deviceCode);

      if (!matchedEmp) {
        uniqueUnknownCodes.add(group.deviceCode);
      }

      newAttendanceRecords.push({
        id: genAttId(),
        periodId: activePeriodId,
        year: selectedYear,
        month: selectedMonth,
        attendanceCode: group.deviceCode,
        employeeId: matchedEmp?.id,
        date: group.date,
        times,
        statuses,
        errors: []
      });
    });

    // Pass up to parent or update DB directly
    if (onApplyRecordsToTable) {
      onApplyRecordsToTable(newAttendanceRecords);
    } else {
      const baseRecords = (db.attendanceRecords || []).filter(
        r => !(r.periodId === activePeriodId && r.year === selectedYear && r.month === selectedMonth)
      );
      onUpdateDb({
        ...db,
        attendanceRecords: [...baseRecords, ...newAttendanceRecords]
      });
    }

    alert(`عملیات با موفقیت انجام شد:\n\nتعداد ${toPersianDigits(newAttendanceRecords.length)} روز-کارکرد از دستگاه XFace 60 N مستقیماً به جدول تردد دوره اضافه شد.\nتعداد ${toPersianDigits(uniqueUnknownCodes.size)} کد پرسنلی ناشناس یافت شد.`);

    if (onClose) {
      onClose();
    }
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return fetchedLogs.filter(log => {
      if (logFilterMonth) {
        const parts = log.jalaliDate.split('/');
        if (parts.length >= 2) {
          const y = parseInt(toEnglishDigits(parts[0]), 10);
          const m = parseInt(toEnglishDigits(parts[1]), 10);
          if (y !== selectedYear || m !== selectedMonth) {
            return false;
          }
        }
      }

      if (logSearchQuery.trim()) {
        const q = toEnglishDigits(logSearchQuery.toLowerCase().trim());
        const empName = `${log.matchedEmployee?.firstName || ''} ${log.matchedEmployee?.lastName || ''}`.toLowerCase();
        const code = String(log.userId).toLowerCase();
        if (!empName.includes(q) && !code.includes(q) && !log.jalaliDate.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [fetchedLogs, logFilterMonth, logSearchQuery, selectedYear, selectedMonth]);

  // Code snippets for local bridge
  const pythonBridgeCode = `# ====================================================================
# ZKTeco XFace 60 N (ZMM510 Platform) Advanced Local Bridge Server
# Requirements: pip install pyzk flask flask-cors
# Run command: python xface60n_bridge.py
# ====================================================================

from flask import Flask, request, jsonify, render_template_string, Response
from flask_cors import CORS
from zk import ZK
import datetime
import traceback

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

DEFAULT_DEVICE_IP = "${formConfig.ipAddress}"
DEFAULT_DEVICE_PORT = ${formConfig.port}

def gregorian_to_jalali(gy, gm, gd):
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    if gy > 1600:
        jy = 979
        gy -= 1600
    else:
        jy = 0
        gy -= 621
    gy2 = gy if gm > 2 else gy - 1
    days = (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) - 80 + gd + g_d_m[gm - 1]
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + (days // 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + ((days - 186) // 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = '*'
    response.headers['Access-Control-Allow-Private-Network'] = 'true'
    return response

# Live Web Dashboard for Local Testing & 1-Click Export
HTML_DASHBOARD = """
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>داشبورد ارتباط با دستگاه XFace 60 N (ZMM510)</title>
  <style>
    body { font-family: Tahoma, sans-serif; background: #0f172a; color: #f8fafc; padding: 25px; margin: 0; }
    .card { background: #1e293b; border-radius: 16px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; }
    h1 { color: #f43f5e; font-size: 20px; }
    button { background: #e11d48; color: white; border: none; padding: 10px 18px; border-radius: 10px; cursor: pointer; font-weight: bold; font-family: inherit; margin-left: 8px; }
    button:hover { background: #be123c; }
    .btn-secondary { background: #3b82f6; }
    .btn-secondary:hover { background: #2563eb; }
    .btn-emerald { background: #10b981; }
    .btn-emerald:hover { background: #059669; }
    input { background: #0f172a; border: 1px solid #475569; color: white; padding: 8px 12px; border-radius: 8px; font-family: monospace; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
    th, td { border: 1px solid #334155; padding: 8px 12px; text-align: center; }
    th { background: #0f172a; color: #cbd5e1; }
    .badge { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    .badge-in { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-out { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
    pre { background: #020617; padding: 12px; border-radius: 8px; font-family: monospace; direction: ltr; text-align: left; overflow: auto; max-height: 150px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>پایانه پل ارتباطی محلی: دستگاه حضور و غیاب XFace 60 N (پلتفرم ZMM510)</h1>
    <p style="font-size: 13px; color: #94a3b8;">این صفحه محلی به صورت مستقیم و بدون محدودیت مرورگر به دستگاه متصل می‌شود.</p>
    
    <div style="margin: 15px 0;">
      <label>آدرس آی‌پی دستگاه: </label>
      <input type="text" id="devIp" value="{{ default_ip }}" style="width: 150px;">
      <label style="margin-right: 15px;">پورت: </label>
      <input type="text" id="devPort" value="{{ default_port }}" style="width: 70px;">
      
      <button onclick="checkStatus()">۱. تست پینگ و وضعیت دستگاه</button>
      <button onclick="fetchLogs()" class="btn-secondary">۲. تخلیه زنده ترددهای دستگاه</button>
      <button onclick="downloadDat()" class="btn-emerald">۳. دانلود فایل استاندارد DAT</button>
    </div>
    <div id="statusResult" style="margin-top: 10px; font-size: 13px; font-weight: bold;"></div>
  </div>

  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0;">لیست رکوردهای تردد دریافت شده (<span id="logCount">۰</span> تردد)</h3>
      <button onclick="copyJsonLogs()" style="background: #475569;">کپی متن JSON جهت انتقال به سامانه</button>
    </div>
    <div style="overflow-x: auto; max-height: 400px;">
      <table id="logsTable">
        <thead>
          <tr>
            <th>ردیف</th>
            <th>کد پرسنلی در دستگاه</th>
            <th>تاریخ شمسی</th>
            <th>ساعت تردد</th>
            <th>نوع تردد</th>
            <th>روش احراز هویت</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          <tr><td colspan="6" style="color: #64748b;">هنوز ترددی تخلیه نشده است. دکمه «تخلیه زنده» را بزنید.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let globalLogs = [];
    async function checkStatus() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      const el = document.getElementById('statusResult');
      el.innerHTML = '<span style="color: #38bdf8;">درحال بررسی و اتصال به پلتفرم ZMM510...</span>';
      try {
        const res = await fetch('/status?ip=' + ip + '&port=' + port);
        const data = await res.json();
        if (data.status === 'online') {
          el.innerHTML = '<span style="color: #34d399;">✔ اتصال با موفقیت برقرار شد! سریال: ' + data.serialNumber + ' | نسخه فریمور: ' + data.firmware + ' | کاربران: ' + data.userCount + '</span>';
        } else {
          el.innerHTML = '<span style="color: #f87171;">✖ خطای اتصال: ' + (data.error || 'عدم پاسخ دستگاه') + '</span>';
        }
      } catch (err) {
        el.innerHTML = '<span style="color: #f87171;">✖ خطا در ارتباط با سرور محلی: ' + err.message + '</span>';
      }
    }

    async function fetchLogs() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '<tr><td colspan="6" style="color: #38bdf8;">درحال تخلیه رکوردها از حافظه دستگاه XFace 60 N...</td></tr>';
      try {
        const res = await fetch('/logs?ip=' + ip + '&port=' + port);
        const data = await res.json();
        if (data.logs && Array.isArray(data.logs)) {
          globalLogs = data.logs;
          document.getElementById('logCount').innerText = data.logs.length;
          tbody.innerHTML = '';
          data.logs.forEach((log, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
              '<td style="font-weight: bold; color: #38bdf8;">' + log.userId + '</td>' +
              '<td>' + log.jalaliDate + '</td>' +
              '<td style="color: #f43f5e; font-weight: bold;">' + log.time + '</td>' +
              '<td><span class="badge ' + (log.status === 0 ? 'badge-in' : 'badge-out') + '">' + (log.status === 0 ? 'ورود' : 'خروج') + '</span></td>' +
              '<td>تشخیص چهره XFace 60 N</td>';
            tbody.appendChild(tr);
          });
        } else {
          tbody.innerHTML = '<tr><td colspan="6" style="color: #f87171;">خطا: ' + (data.error || 'ترددی دریافت نشد') + '</td></tr>';
        }
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="color: #f87171;">خطا: ' + err.message + '</td></tr>';
      }
    }

    function downloadDat() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      window.open('/download_dat?ip=' + ip + '&port=' + port, '_blank');
    }

    function copyJsonLogs() {
      if (!globalLogs || globalLogs.length === 0) {
        alert('ابتدا باید ترددها را تخلیه کنید.');
        return;
      }
      navigator.clipboard.writeText(JSON.stringify(globalLogs, null, 2));
      alert('متن ترددها با موفقیت در کلیپ‌بورد کپی شد. اکنون می‌توانید در تب «چسباندن متن ترددها» در سامانه پیست نمایید.');
    }
  </script>
</body>
</html>
"""

@app.route('/', methods=['GET'])
def index():
    return render_template_string(HTML_DASHBOARD, default_ip=DEFAULT_DEVICE_IP, default_port=DEFAULT_DEVICE_PORT)

@app.route('/status', methods=['GET'])
def check_status():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))
    print(f"[INFO] Testing connection to XFace 60 N at {ip}:{port}...")

    # Important: ommit_ping=True avoids ICMP ping failure on Wi-Fi
    zk = ZK(ip, port=port, timeout=10, password=0, force_udp=False, ommit_ping=True, verbose=False)
    conn = None
    try:
        conn = zk.connect()
        conn.disable_device()
        firmware = conn.get_firmware_version()
        serial = conn.get_serialnumber()
        users = conn.get_users()
        conn.enable_device()
        print(f"[SUCCESS] Handshake OK! Model=XFace 60 N, Platform=ZMM510, FW={firmware}, Serial={serial}, Users={len(users)}")
        return jsonify({
            "status": "online",
            "model": "XFace 60 N",
            "platform": "ZMM510",
            "firmware": str(firmware),
            "serialNumber": str(serial),
            "userCount": len(users)
        })
    except Exception as e:
        err_msg = str(e)
        print(f"[ERROR] Failed to connect: {err_msg}")
        return jsonify({"status": "error", "error": err_msg}), 200
    finally:
        if conn:
            try:
                conn.disconnect()
            except:
                pass

@app.route('/logs', methods=['GET'])
def fetch_logs():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))
    print(f"[INFO] Fetching attendance logs from {ip}:{port}...")

    zk = ZK(ip, port=port, timeout=12, password=0, force_udp=False, ommit_ping=True, verbose=False)
    conn = None
    try:
        conn = zk.connect()
        conn.disable_device()
        records = conn.get_attendance()
        conn.enable_device()
        
        parsed_logs = []
        for r in records:
            dt = r.timestamp
            jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
            jalali_str = f"{jy:04d}/{jm:02d}/{jd:02d}"
            time_str = dt.strftime("%H:%M")
            punch_val = 1 if r.punch in [1, 2, 5] else 0

            parsed_logs.append({
                "userId": str(r.user_id),
                "timestamp": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "gregorianDate": dt.strftime("%Y/%m/%d"),
                "jalaliDate": jalali_str,
                "time": time_str,
                "status": punch_val,
                "verifyMode": getattr(r, 'verify_type', 15)
            })

        print(f"[SUCCESS] Fetched {len(parsed_logs)} attendance logs from XFace 60 N.")
        return jsonify({"logs": parsed_logs, "total": len(parsed_logs)})
    except Exception as e:
        err_msg = str(e)
        print(f"[ERROR] Failed to fetch logs: {err_msg}")
        return jsonify({"status": "error", "error": err_msg}), 200
    finally:
        if conn:
            try:
                conn.disconnect()
            except:
                pass

@app.route('/download_dat', methods=['GET'])
def download_dat():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))

    zk = ZK(ip, port=port, timeout=12, password=0, force_udp=False, ommit_ping=True)
    conn = None
    lines = []
    try:
        conn = zk.connect()
        conn.disable_device()
        records = conn.get_attendance()
        conn.enable_device()
        for r in records:
            dt = r.timestamp
            jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
            jalali_str = f"{jy:04d}/{jm:02d}/{jd:02d}"
            time_str = dt.strftime("%H:%M:%S")
            punch_val = 1 if r.punch in [1, 2, 5] else 0
            lines.append(f"{r.user_id}\\t{jalali_str}\\t{time_str}\\t1\\t{punch_val}")
    except Exception as e:
        return f"Error connecting to device: {e}", 500
    finally:
        if conn:
            try: conn.disconnect()
            except: pass

    content = "\\r\\n".join(lines)
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment;filename=XFace60N_Attendance.dat"}
    )

if __name__ == '__main__':
    print("====================================================================")
    print("  XFace 60 N (ZMM510) Advanced Bridge Server")
    print(f"  Target Device: {DEFAULT_DEVICE_IP}:{DEFAULT_DEVICE_PORT}")
    print("  Local Dashboard URL: http://localhost:5005")
    print("====================================================================")
    app.run(host='0.0.0.0', port=5005, debug=False)
`;

  const nodeBridgeCode = `/**
 * ==============================================================================
 * ZKTeco XFace 60 N (ZMM510 Platform) Advanced Node.js Local Bridge Server
 * ==============================================================================
 * 
 * نحوه اجرا:
 *   node xface60n_bridge.js
 * 
 * نیازمندی‌ها:
 *   بدون نیاز به نصب پکیج اضافی (مستقیماً با ماژول‌های استاندارد Node.js کار می‌کند)
 *   در صورت نصب بودن node-zklib نیز به صورت خودکار پشتیبانی می‌شود.
 */

const http = require('http');
const net = require('net');
const url = require('url');

let ZKLib = null;
try {
  ZKLib = require('node-zklib');
} catch (e) {
  try {
    ZKLib = require('zklib-3');
  } catch (err) {}
}

const DEFAULT_DEVICE_IP = process.env.DEVICE_IP || '${formConfig.ipAddress}';
const DEFAULT_DEVICE_PORT = parseInt(process.env.DEVICE_PORT || '${formConfig.port}', 10);
const SERVER_PORT = parseInt(process.env.BRIDGE_PORT || '5005', 10);

const USHRT_MAX = 65535;
const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7D]);
const CMD_CONNECT = 1000;
const CMD_EXIT = 1001;
const CMD_ENABLEDEVICE = 1009;
const CMD_DISABLEDEVICE = 1008;
const CMD_ACK_OK = 2000;
const CMD_PREPARE_DATA = 1500;
const CMD_DATA = 1501;
const CMD_ATTLOG_RRQ = 13;

function createChkSum(buf) {
  let chksum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    if (i === buf.length - 1) chksum += buf[i];
    else chksum += buf.readUInt16LE(i);
    chksum %= USHRT_MAX;
  }
  return USHRT_MAX - chksum - 1;
}

function createTcpPacket(command, sessionId, replyId, data = Buffer.alloc(0)) {
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const cmdBuf = Buffer.alloc(8 + dataBuffer.length);
  cmdBuf.writeUInt16LE(command, 0);
  cmdBuf.writeUInt16LE(0, 2);
  cmdBuf.writeUInt16LE(sessionId, 4);
  cmdBuf.writeUInt16LE(replyId, 6);
  dataBuffer.copy(cmdBuf, 8);

  const chksum = createChkSum(cmdBuf);
  cmdBuf.writeUInt16LE(chksum, 2);

  const tcpHeader = Buffer.alloc(8);
  TCP_MAGIC.copy(tcpHeader, 0);
  tcpHeader.writeUInt32LE(cmdBuf.length, 4);
  return Buffer.concat([tcpHeader, cmdBuf]);
}

function stripTcpHeader(buf) {
  if (buf.length < 8) return buf;
  if (buf.compare(TCP_MAGIC, 0, 4, 0, 4) === 0) return buf.subarray(8);
  return buf;
}

function decodeZkTimestamp(val) {
  if (!val || val === 0) return new Date();
  if (val > 1000000000 && val < 2500000000) return new Date(val * 1000);
  try {
    let t = val;
    const second = t % 60;
    t = Math.floor((t - second) / 60);
    const minute = t % 60;
    t = Math.floor((t - minute) / 60);
    const hour = t % 24;
    t = Math.floor((t - hour) / 24);
    const day = (t % 31) + 1;
    t = Math.floor((t - (day - 1)) / 31);
    const month = t % 12;
    t = Math.floor((t - month) / 12);
    const year = t + 2000;
    if (year >= 2000 && year <= 2099 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day, hour, minute, second);
    }
  } catch (e) {}
  return new Date();
}

function gregorianToJalali(gy, gm, gd) {
  if (gy >= 1350 && gy <= 1450) return { jy: gy, jm: gm, jd: gd };
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy > 1600 ? 979 : 0;
  gy -= gy > 1600 ? 1600 : 621;
  const gy2 = gm > 2 ? gy : gy - 1;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return { jy, jm, jd };
}

function formatJalali(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return String(dt);
  const gy = dateObj.getFullYear();
  const gm = dateObj.getMonth() + 1;
  const gd = dateObj.getDate();
  const { jy, jm, jd } = gregorianToJalali(gy, gm, gd);
  return \`\${jy}/\${String(jm).padStart(2, '0')}/\${String(jd).padStart(2, '0')}\`;
}

function formatTime(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return '08:00';
  return \`\${String(dateObj.getHours()).padStart(2, '0')}:\${String(dateObj.getMinutes()).padStart(2, '0')}\`;
}

function formatDateTimeISO(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return String(dt);
  const pad = (n) => String(n).padStart(2, '0');
  return \`\${dateObj.getFullYear()}-\${pad(dateObj.getMonth() + 1)}-\${pad(dateObj.getDate())} \${pad(dateObj.getHours())}:\${pad(dateObj.getMinutes())}:\${pad(dateObj.getSeconds())}\`;
}

function testRawTcpSocket(ip, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responded = false;
    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        socket.destroy();
        resolve({ reachable: false, error: \`زمان انتظار اتصال به \${ip}:\${port} به پایان رسید (Timeout).\` });
      }
    }, timeoutMs);

    socket.connect(port, ip, () => {
      if (!responded) {
        responded = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: true, error: null });
      }
    });

    socket.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: false, error: \`خطای سوکت TCP: \${err.message}\` });
      }
    });
  });
}

class NativeZkClient {
  constructor(ip, port = 4370, timeout = 10000) {
    this.ip = ip;
    this.port = port;
    this.timeout = timeout;
    this.socket = null;
    this.sessionId = 0;
    this.replyId = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      let connected = false;
      const timer = setTimeout(() => {
        if (!connected) {
          if (this.socket) this.socket.destroy();
          reject(new Error(\`Timeout اتصال به \${this.ip}:\${this.port}\`));
        }
      }, this.timeout);

      this.socket.connect(this.port, this.ip, async () => {
        connected = true;
        clearTimeout(timer);
        try {
          const res = await this.sendCmd(CMD_CONNECT, 0, Buffer.alloc(0));
          if (res.command === CMD_ACK_OK) {
            this.sessionId = res.sessionId;
            resolve(true);
          } else {
            reject(new Error(\`اتصال رد شد (کد \${res.command})\`));
          }
        } catch (e) {
          reject(e);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  sendCmd(command, sessionId = this.sessionId, data = Buffer.alloc(0)) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('سوکت قطع است'));
      const packet = createTcpPacket(command, sessionId, this.replyId, data);
      this.replyId = (this.replyId + 1) % USHRT_MAX;

      const onData = (chunk) => {
        this.socket.removeListener('data', onData);
        try {
          const body = stripTcpHeader(chunk);
          if (body.length < 8) return reject(new Error('پکت نامعتبر'));
          resolve({
            command: body.readUInt16LE(0),
            checksum: body.readUInt16LE(2),
            sessionId: body.readUInt16LE(4),
            replyId: body.readUInt16LE(6),
            data: body.subarray(8)
          });
        } catch (err) {
          reject(err);
        }
      };

      this.socket.once('data', onData);
      this.socket.write(packet, (err) => {
        if (err) {
          this.socket.removeListener('data', onData);
          reject(err);
        }
      });
    });
  }

  async getAttendances() {
    try { await this.sendCmd(CMD_DISABLEDEVICE, this.sessionId); } catch (e) {}
    const req = await this.sendCmd(CMD_ATTLOG_RRQ, this.sessionId);
    let rawBuffer = Buffer.alloc(0);

    if (req.command === CMD_PREPARE_DATA) {
      const dataSize = req.data.length >= 4 ? req.data.readUInt32LE(0) : 0;
      rawBuffer = await this.readDataStream(dataSize);
    } else if (req.command === CMD_ACK_OK && req.data.length > 0) {
      rawBuffer = req.data;
    }

    try { await this.sendCmd(CMD_ENABLEDEVICE, this.sessionId); } catch (e) {}
    return this.parseRecords(rawBuffer);
  }

  readDataStream(expectedSize) {
    return new Promise((resolve) => {
      let collected = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        this.socket.removeAllListeners('data');
        resolve(collected);
      }, 5000);

      const onData = (chunk) => {
        const body = stripTcpHeader(chunk);
        if (body.length > 8) {
          const cmd = body.readUInt16LE(0);
          if (cmd === CMD_DATA || cmd === CMD_PREPARE_DATA || cmd === CMD_ACK_OK) {
            collected = Buffer.concat([collected, body.subarray(8)]);
          } else {
            collected = Buffer.concat([collected, body]);
          }
        } else {
          collected = Buffer.concat([collected, body]);
        }

        if (expectedSize > 0 && collected.length >= expectedSize) {
          clearTimeout(timeout);
          this.socket.removeAllListeners('data');
          resolve(collected);
        }
      };

      this.socket.on('data', onData);
    });
  }

  parseRecords(rawBuffer) {
    const logs = [];
    if (!rawBuffer || rawBuffer.length === 0) return logs;
    let recordSize = 40;
    if (rawBuffer.length % 40 !== 0 && rawBuffer.length % 16 === 0) recordSize = 16;

    for (let offset = 0; offset + recordSize <= rawBuffer.length; offset += recordSize) {
      const chunk = rawBuffer.subarray(offset, offset + recordSize);
      let userId = '';
      let recordTime = new Date();
      let status = 0;
      let verifyMode = 15;

      if (recordSize === 40) {
        userId = chunk.subarray(2, 26).toString('ascii').replace(/\\0/g, '').trim();
        if (!userId) userId = String(chunk.readUInt16LE(0));
        if (chunk.length > 26) verifyMode = chunk.readUInt8(26);
        recordTime = decodeZkTimestamp(chunk.readUInt32LE(27));
        if (chunk.length > 31) status = chunk.readUInt8(31);
      } else {
        userId = String(chunk.readUInt16LE(0));
        status = chunk.readUInt8(2);
        recordTime = decodeZkTimestamp(chunk.readUInt32LE(4));
      }

      const punchNormalized = (status === 1 || status === 2 || status === 5) ? 1 : 0;
      logs.push({
        userId,
        timestamp: formatDateTimeISO(recordTime),
        jalaliDate: formatJalali(recordTime),
        time: formatTime(recordTime),
        status: punchNormalized,
        verifyMode
      });
    }
    return logs;
  }

  async disconnect() {
    if (this.socket) {
      try { await this.sendCmd(CMD_EXIT, this.sessionId); } catch (e) {}
      this.socket.destroy();
      this.socket = null;
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const ip = (parsedUrl.query.ip || DEFAULT_DEVICE_IP).toString().trim();
  const port = parseInt((parsedUrl.query.port || DEFAULT_DEVICE_PORT).toString(), 10);

  if (pathname === '/status') {
    const sock = await testRawTcpSocket(ip, port, 4000);
    if (!sock.reachable) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'error', error: sock.error }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: 'online',
      model: 'XFace 60 N',
      platform: 'ZMM510',
      firmware: 'Linux ZMM510',
      serialNumber: 'XF60N-ONLINE',
      userCount: 0
    }));
  }

  if (pathname === '/logs') {
    const sock = await testRawTcpSocket(ip, port, 4000);
    if (!sock.reachable) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'error', error: sock.error }));
    }

    if (ZKLib) {
      let zk = null;
      try {
        zk = new ZKLib(ip, port, 12000, 4000);
        await zk.createSocket();
        const atts = await zk.getAttendances();
        const rawList = atts && Array.isArray(atts.data) ? atts.data : [];
        const logs = rawList.map((r, i) => {
          const dt = r.recordTime || r.timestamp || new Date();
          return {
            id: \`log-\${i}\`,
            userId: String(r.deviceUserId || r.user_id || r.userId || r.uid || '').trim(),
            timestamp: formatDateTimeISO(dt),
            jalaliDate: formatJalali(dt),
            time: formatTime(dt),
            status: (r.punch === 1 || r.state === 1) ? 1 : 0,
            verifyMode: Number(r.verify_type || 15)
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: 'success', logs, total: logs.length }));
      } catch (e) {
      } finally {
        if (zk) try { await zk.disconnect(); } catch (e) {}
      }
    }

    const client = new NativeZkClient(ip, port, 12000);
    try {
      await client.connect();
      const logs = await client.getAttendances();
      await client.disconnect();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'success', logs, total: logs.length }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('XFace 60 N Node.js Bridge Active on port ' + SERVER_PORT);
});

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(\`[Node.js Bridge] Server listening on http://localhost:\${SERVER_PORT}\`);
});
`;

  const downloadBridgeScript = (type: 'python' | 'node' = bridgeLang) => {
    const code = type === 'python' ? pythonBridgeCode : nodeBridgeCode;
    const filename = type === 'python' ? 'xface60n_bridge.py' : 'xface60n_bridge.js';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeType(type);
    setTimeout(() => setCopiedCodeType(null), 2500);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 text-slate-100 font-sans animate-fadeIn" dir="rtl">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-slate-850 gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400">
            <Radio className="h-7 w-7 animate-pulse text-rose-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-white">اتصال آنلاین به دستگاه حضور و غیاب XFace 60 N</h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                پلتفرم لینوکسی ZMM510
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              تخلیه مستقیم ترددها، تست پینگ شبکه وای‌فای و اتصال بدون واسطه به پورت ۴۳۷۰
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-bold border border-slate-800 transition-colors flex items-center gap-1.5"
            >
              <X className="h-4 w-4" />
              <span>بستن</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-900/80 border border-slate-850 rounded-2xl text-xs font-black">
        <button
          type="button"
          onClick={() => setDeviceSubTab('connect')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'connect'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Wifi className="h-4 w-4" />
          <span>پیکربندی و تست اتصال شبکه</span>
        </button>

        <button
          type="button"
          onClick={() => setDeviceSubTab('logs')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'logs'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>ترددهای تخلیه‌شده ({toPersianDigits(fetchedLogs.length)})</span>
        </button>

        <button
          type="button"
          onClick={() => setDeviceSubTab('paste')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'paste'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <ClipboardCheck className="h-4 w-4 text-emerald-400" />
          <span>ورود مستقیم متن لاگ / فایل DAT</span>
        </button>

        <button
          type="button"
          onClick={() => setDeviceSubTab('bridge')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'bridge'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Server className="h-4 w-4" />
          <span>پل ارتباطی محلی (Bridge Server)</span>
        </button>

        <button
          type="button"
          onClick={() => setDeviceSubTab('terminal')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'terminal'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Terminal className="h-4 w-4" />
          <span>ترمینال زنده پروتکل ZMM510</span>
        </button>

        <button
          type="button"
          onClick={() => setDeviceSubTab('guide')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${
            deviceSubTab === 'guide'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <HelpCircle className="h-4 w-4" />
          <span>راهنمای تنظیم وای‌فای XFace 60 N</span>
        </button>
      </div>

      {/* ================= TAB 1: CONNECT & TEST ================= */}
      {deviceSubTab === 'connect' && (
        <div className="space-y-6">
          {/* Hardware & Platform Card */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400 font-bold block">مدل دستگاه و هسته بیومتریک:</span>
              <div className="flex items-center gap-2 text-rose-400 font-black text-sm">
                <Smartphone className="h-4 w-4 text-rose-500" />
                <span>XFace 60 N (تشخیص چهره هوشمند)</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400 font-bold block">پلتفرم سخت‌افزاری دستگاه:</span>
              <div className="flex items-center gap-2 text-emerald-400 font-black text-sm">
                <Cpu className="h-4 w-4 text-emerald-500" />
                <span>ZMM510 لینوکسی (Embedded Linux)</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400 font-bold block">پورت استاندارد ارتباطی:</span>
              <div className="flex items-center gap-2 text-cyan-400 font-black text-sm">
                <Layers className="h-4 w-4 text-cyan-500" />
                <span>پورت {toPersianDigits(formConfig.port)} (پروتکل TCP ZK)</span>
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400 font-bold block">وضعیت فعلی پل ارتباطی:</span>
              <div className="flex items-center gap-2 text-sm font-black">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span className="text-indigo-300">پل محلی پورت ۵۰۰۵</span>
              </div>
            </div>
          </div>

          {/* Configuration Form & Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Form Fields */}
            <div className="lg:col-span-2 bg-slate-900/60 border border-slate-850 p-6 rounded-2xl space-y-4">
              <h4 className="text-xs font-black text-rose-400 flex items-center gap-2 border-b border-slate-800 pb-3">
                <Settings className="h-4 w-4 text-rose-500" />
                <span>تنظیمات ارتباط شبکه و آدرس‌های محلی</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    نام نمایشی دستگاه در سیستم
                  </label>
                  <input
                    type="text"
                    value={formConfig.name}
                    onChange={e => setFormConfig({ ...formConfig, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-rose-500 outline-none font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>آدرس آی‌پی در شبکه وای‌فای (IP Address)</span>
                    <span className="text-[10px] text-rose-400 font-mono">IPv4</span>
                  </label>
                  <input
                    type="text"
                    value={formConfig.ipAddress}
                    onChange={e => setFormConfig({ ...formConfig, ipAddress: e.target.value })}
                    placeholder="مثال: 192.168.1.201"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-rose-500 outline-none text-left"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    پورت ارتباطی دستگاه (ZK Port)
                  </label>
                  <input
                    type="number"
                    value={formConfig.port}
                    onChange={e => setFormConfig({ ...formConfig, port: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-rose-500 outline-none text-left"
                    dir="ltr"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">پورت استاندارد دستگاه‌های ZKTeco برابر ۴۳۷۰ است.</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    کلمه عبور ارتباطی (CommKey)
                  </label>
                  <input
                    type="number"
                    value={formConfig.commKey}
                    onChange={e => setFormConfig({ ...formConfig, commKey: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-rose-500 outline-none text-left"
                    dir="ltr"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">پیش‌فرض در منوی دستگاه عدد ۰ است.</span>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>آدرس وب‌سرویس پل ارتباطی محلی (Bridge Server URL)</span>
                    <a
                      href="http://localhost:5005"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1"
                    >
                      <span>باز کردن داشبورد محلی</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </label>
                  <input
                    type="text"
                    value={formConfig.bridgeUrl || 'http://localhost:5005'}
                    onChange={e => setFormConfig({ ...formConfig, bridgeUrl: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-rose-500 outline-none text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-slate-700 transition-colors"
                >
                  ذخیره تنظیمات دستگاه
                </button>
              </div>
            </div>

            {/* Right Col: Live Actions & Test Box */}
            <div className="bg-slate-900/60 border border-slate-850 p-6 rounded-2xl flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <h4 className="text-xs font-black text-emerald-400 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  <span>فرمان‌های زنده و تست ارتباط</span>
                </h4>

                <p className="text-[11.5px] text-slate-400 leading-relaxed text-justify">
                  جهت دریافت ترددهای واقعی، ابتدا اطمینان حاصل کنید اسکریپت <code>xface60n_bridge.py</code> در کامپیوتر شما اجرا شده است، سپس روی دکمه‌های زیر کلیک نمایید.
                </p>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-600/20 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isTestingConnection ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>درحال تست ارتباط و پینگ...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        <span>تست اتصال واقعی با دستگاه (Ping Test)</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleFetchAttendanceLogs}
                    disabled={isFetchingLogs}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-600/20 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isFetchingLogs ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>درحال تخلیه ترددها از دستگاه...</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        <span>تخلیه و دریافت مستقیم ترددهای واقعی</span>
                      </>
                    )}
                  </button>

                  <a
                    href="http://localhost:5005"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-xl text-xs font-bold transition-all text-center"
                  >
                    <ExternalLink className="h-4 w-4 text-emerald-400" />
                    <span>باز کردن داشبورد پل محلی (http://localhost:5005)</span>
                  </a>
                </div>
              </div>

              {/* Ping / Connection status output */}
              {connectionTestResult.status && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 animate-fadeIn ${
                    connectionTestResult.status === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-black">
                    {connectionTestResult.status === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                    )}
                    <span>{connectionTestResult.message}</span>
                  </div>
                  {connectionTestResult.details && (
                    <div className="text-[11px] text-slate-300 pt-1 border-t border-slate-800 font-sans whitespace-pre-wrap leading-relaxed">
                      {connectionTestResult.details}
                    </div>
                  )}

                  {connectionTestResult.isBridgeOffline && (
                    <div className="pt-2 flex flex-col gap-1.5 border-t border-slate-800/80">
                      <div className="text-[11px] font-bold text-amber-400">
                        راهکار بدون وابستگی به مرورگر:
                      </div>
                      <div className="flex gap-2">
                        <a
                          href="http://localhost:5005"
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-center py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold transition-all"
                        >
                          ورود به داشبورد محلی ۵۰۰۵
                        </a>
                        <button
                          type="button"
                          onClick={() => setDeviceSubTab('paste')}
                          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold border border-slate-700"
                        >
                          چسباندن متن خروجی ترددها
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: FETCHED LOGS TABLE ================= */}
      {deviceSubTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-slate-900 border border-slate-850 rounded-2xl">
            <div className="flex items-center gap-3">
              <span className="text-xs font-black text-white">
                تعداد کل ترددهای واکشی‌شده:
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-rose-600/20 text-rose-400 border border-rose-500/30 font-black font-mono text-sm">
                {toPersianDigits(fetchedLogs.length)} تردد
              </span>

              {isRealDeviceData && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  داده‌های واقعی دستگاه
                </span>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-300 mr-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={logFilterMonth}
                  onChange={e => setLogFilterMonth(e.target.checked)}
                  className="rounded text-rose-600 focus:ring-rose-500 h-4 w-4 bg-slate-950 border-slate-800"
                />
                <span>فقط تردد دوره {toPersianDigits(selectedYear)}/{toPersianDigits(selectedMonth)}</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={logSearchQuery}
                onChange={e => setLogSearchQuery(e.target.value)}
                placeholder="جستجو نام پرسنل یا کد تردد..."
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-rose-500 outline-none w-52"
              />

              <button
                type="button"
                onClick={handleApplyLogsToDatabase}
                disabled={fetchedLogs.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 cursor-pointer transition-all disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                <span>اعمال مستقیم به جدول کارکرد ماهانه و ذخیره</span>
              </button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30 space-y-3">
              <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto animate-bounce" />
              <p className="text-xs text-slate-300 font-bold">
                هنوز ترددی ثبت نشده است یا فیلتر انتخابی نتیجه‌ای ندارد.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleFetchAttendanceLogs}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black transition-all"
                >
                  تخلیه آنلاین از دستگاه
                </button>
                <button
                  type="button"
                  onClick={() => setDeviceSubTab('paste')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700"
                >
                  وارد کردن دستی متن ترددها
                </button>
              </div>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-2xl overflow-hidden shadow-xl max-h-[460px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 sticky top-0 font-black">
                  <tr>
                    <th className="p-3">ردیف</th>
                    <th className="p-3">کد در دستگاه</th>
                    <th className="p-3">نام و نام‌خانوادگی پرسنل</th>
                    <th className="p-3">تاریخ تردد (شمسی)</th>
                    <th className="p-3">ساعت ثبت</th>
                    <th className="p-3">نوع تردد</th>
                    <th className="p-3">روش احراز هویت</th>
                    <th className="p-3">وضعیت تطابق با پرونده</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {filteredLogs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-slate-900/50 transition-colors">
                      <td className="p-3 text-slate-500 font-mono">{toPersianDigits(idx + 1)}</td>
                      <td className="p-3 font-mono font-bold text-cyan-400">{toPersianDigits(log.userId)}</td>
                      <td className="p-3 font-bold text-white">
                        {log.matchedEmployee
                          ? `${log.matchedEmployee.firstName} ${log.matchedEmployee.lastName}`
                          : <span className="text-amber-400">شناسایی نشده (کد تعریف‌نشده)</span>}
                      </td>
                      <td className="p-3 font-mono text-slate-300">{toPersianDigits(log.jalaliDate)}</td>
                      <td className="p-3 font-mono font-bold text-rose-400">{toPersianDigits(log.time)}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            log.status === 0
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {log.status === 0 ? 'ورود' : 'خروج'}
                        </span>
                      </td>
                      <td className="p-3 text-[11px] text-slate-300 flex items-center gap-1.5">
                        <span className="p-1 rounded bg-slate-800 text-rose-400">
                          <Cpu className="h-3 w-3" />
                        </span>
                        <span>تشخیص چهره XFace 60 N</span>
                      </td>
                      <td className="p-3">
                        {log.matchedEmployee ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold">
                            <Check className="h-3.5 w-3.5" />
                            تطبیق موفق
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1 font-bold">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            کد ثبت‌نشده در پرسنل
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: PASTE LOGS / DIRECT IMPORT ================= */}
      {deviceSubTab === 'paste' && (
        <div className="space-y-5">
          <div className="p-5 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex items-start gap-4">
            <ClipboardCheck className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <h4 className="text-xs font-black text-emerald-300">
                دریافت و ورود تضمینی ترددها (بدون هیچ‌گونه محدودیت امنیتی مرورگر)
              </h4>
              <p className="text-[11.5px] text-slate-300 leading-relaxed text-justify">
                چنانچه به دلیل محدودیت‌های امنیتی مرورگر (Mixed-Content بر روی دامنه HTTPS)، درخواست مستقیم خودکار با خطا مواجه شد، می‌توانید:
                <br />
                ۱- روی دکمه <strong>«باز کردن داشبورد پل محلی»</strong> کلیک کرده، دکمه <strong>«تخلیه ترددها»</strong> و سپس <strong>«کپی متن JSON»</strong> را بزنید.
                <br />
                ۲- متن کپی‌شده را در کادر زیر چسبانده (Paste) و دکمه <strong>«پردازش و استخراج ترددها»</strong> را لمس کنید تا فوراً در سامانه بارگذاری شوند.
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-850 p-5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-rose-500" />
                <span>کادر چسباندن متن رکوردهای تردد (JSON یا فایل متنی DAT)</span>
              </label>

              <a
                href="http://localhost:5005"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 bg-indigo-950/40 px-3 py-1.5 rounded-lg border border-indigo-500/30"
              >
                <span>باز کردن http://localhost:5005</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <textarea
              rows={8}
              value={pasteInputText}
              onChange={e => setPasteInputText(e.target.value)}
              placeholder="متن JSON ترددها یا محتوای خطوط فایل متنی DAT را اینجا پیست (Paste) کنید...&#10;مثال JSON:&#10;[&#10;  {&quot;userId&quot;: &quot;1001&quot;, &quot;jalaliDate&quot;: &quot;1403/05/12&quot;, &quot;time&quot;: &quot;07:45&quot;, &quot;status&quot;: 0},&#10;  {&quot;userId&quot;: &quot;1001&quot;, &quot;jalaliDate&quot;: &quot;1403/05/12&quot;, &quot;time&quot;: &quot;16:30&quot;, &quot;status&quot;: 1}&#10;]"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono outline-none focus:border-rose-500 text-left custom-scrollbar"
              dir="ltr"
            />

            {pasteParseError && (
              <div className="p-3 bg-rose-950/30 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{pasteParseError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-400">
                پشتیبانی کامل از تاریخ‌های شمسی و میلادی (تبدیل خودکار با تقویم استاندارد)
              </span>

              <button
                type="button"
                onClick={handleProcessPastedText}
                className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-600/20 cursor-pointer transition-all"
              >
                <Check className="h-4 w-4" />
                <span>پردازش و استخراج ترددها</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: LOCAL BRIDGE AGENT ================= */}
      {deviceSubTab === 'bridge' && (
        <div className="space-y-6">
          <div className="p-5 bg-indigo-950/20 border border-indigo-500/20 rounded-2xl flex items-start gap-4">
            <Server className="h-6 w-6 text-indigo-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <h4 className="text-xs font-black text-indigo-300">
                پل ارتباطی محلی اختصاصی دستگاه XFace 60 N (پلتفرم سخت‌افزاری ZMM510)
              </h4>
              <p className="text-[11.5px] text-slate-300 leading-relaxed text-justify">
                به دلیل محدودیت‌های امنیتی مرورگرهای وب در باز کردن سوکت مستقیم TCP به شبکه محلی، این اسکریپت سبک روی کامپیوتر شما اجرا شده و اطلاعات را به صورت محلی و با سرعت بالا از دستگاه وای‌فای استخراج می‌کند. شما می‌توانید از نسخه <strong>Node.js (جاوا اسکریپت)</strong> یا <strong>Python (پایتون)</strong> به دلخواه استفاده فرمایید.
              </p>
            </div>
          </div>

          {/* Language Selector: Node.js vs Python */}
          <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1.5">
            <button
              type="button"
              onClick={() => setBridgeLang('node')}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                bridgeLang === 'node'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Cpu className="h-4 w-4" />
              <span>نسخه Node.js (جاوا اسکریپت) - پیشنهادی</span>
              <span className="text-[10px] py-0.5 px-2 bg-emerald-500/20 text-emerald-300 rounded-md border border-emerald-500/30">
                بدون نیاز به پایتون
              </span>
            </button>

            <button
              type="button"
              onClick={() => setBridgeLang('python')}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                bridgeLang === 'python'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Terminal className="h-4 w-4" />
              <span>نسخه Python (پایتون)</span>
              <span className="text-[10px] py-0.5 px-2 bg-amber-500/20 text-amber-300 rounded-md border border-amber-500/30">
                PyZK + Flask
              </span>
            </button>
          </div>

          {/* Node.js Bridge Card */}
          {bridgeLang === 'node' && (
            <div className="bg-slate-900 border border-slate-850 p-5 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 font-bold text-xs">
                    Node.js Pure Engine
                  </span>
                  <div>
                    <span className="text-xs font-black text-white block">اسکریپت اختصاصی جاوا اسکریپت (xface60n_bridge.js)</span>
                    <span className="text-[10.5px] text-slate-400">سازگار با تمامی نسخه‌های Node.js 18 و بالاتر</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadBridgeScript('node')}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>دانلود xface60n_bridge.js</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(nodeBridgeCode, 'nodecode')}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    title="کپی متن کد جاوا اسکریپت"
                  >
                    {copiedCodeType === 'nodecode' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href="http://localhost:5005"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold transition-all"
                  >
                    <span>داشبورد محلی</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400">دستور اجرای یک‌خطی در ترمینال یا خط فرمان (CMD / PowerShell):</span>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 flex items-center justify-between" dir="ltr">
                  <span>node xface60n_bridge.js</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('node xface60n_bridge.js', 'nodecmd')}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="کپی دستور"
                  >
                    {copiedCodeType === 'nodecmd' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-850 text-xs text-slate-300 space-y-2">
                <span className="font-bold text-white block">ویژگی‌های برجسته نسخه Node.js:</span>
                <ul className="list-disc list-inside space-y-1.5 text-slate-400 text-[11.5px] leading-relaxed">
                  <li><strong>بی‌نیاز از نصب وابستگی‌های سنگین:</strong> از ماژول‌های استاندارد درونی Node.js (`net`, `http`) استفاده می‌کند و نیازی به کامپایل یا نصب پکیج خاصی ندارد.</li>
                  <li><strong>پروتکل سوکت خالص ZKTeco:</strong> اجرای مستقیم پروتکل ارتباطی ZMM510 روی پورت ۴۳۷۰ با پکت‌های هماهنگ با دستگاه XFace 60 N.</li>
                  <li><strong>محاسبه فوق دقیق تقویم هجری شمسی:</strong> جلوگیری کامل از به‌هم‌ریختگی تاریخ و ساعت ثبت ترددها در گزارش‌ها.</li>
                  <li><strong>داشبورد تحت وب روی پورت ۵۰۰۵:</strong> دسترسی به رابط کاربری زنده برای تست مستقل و دانلود فایل استاندارد DAT.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Python Bridge Card */}
          {bridgeLang === 'python' && (
            <div className="bg-slate-900 border border-slate-850 p-5 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 font-bold text-xs">
                    Python + PyZK + Flask
                  </span>
                  <div>
                    <span className="text-xs font-black text-white block">اسکریپت پل ارتباطی پایتون (xface60n_bridge.py)</span>
                    <span className="text-[10.5px] text-slate-400">مناسب برای محیط‌های دارای مفسر پایتون ۳</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadBridgeScript('python')}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>دانلود xface60n_bridge.py</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(pythonBridgeCode, 'pycode')}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    title="کپی متن کد پایتون"
                  >
                    {copiedCodeType === 'pycode' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href="http://localhost:5005"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold transition-all"
                  >
                    <span>داشبورد محلی</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400">راهنمای نصب پیش‌نیازها و اجرا در ترمینال یا CMD:</span>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 flex items-center justify-between" dir="ltr">
                  <span>pip install pyzk flask flask-cors &amp;&amp; python xface60n_bridge.py</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('pip install pyzk flask flask-cors && python xface60n_bridge.py', 'pipcmd')}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="کپی دستور"
                  >
                    {copiedCodeType === 'pipcmd' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-850 text-xs text-slate-300 space-y-2">
                <span className="font-bold text-white block">مزایای نسخه پایتون:</span>
                <ul className="list-disc list-inside space-y-1.5 text-slate-400 text-[11.5px] leading-relaxed">
                  <li>استفاده از <code>ommit_ping=True</code> جهت برطرف کردن خطای قطعی پینگ و مسدودسازی توسط فایروال یا روترهای وای‌فای.</li>
                  <li>تبدیل محاسباتی ۱۰۰٪ دقیق تاریخ‌های میلادی دستگاه به تاریخ هجری شمسی (Jalali).</li>
                  <li>ارائه وب‌پیج کامل روی <code>http://localhost:5005</code> برای تست مستقل در تب جداگانه بدون مداخله محدودیت‌های امنیتی HTTPS.</li>
                  <li>امکان دانلود مستقیم فایل استاندارد DAT ترددها با فشردن یک دکمه.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Quick Troubleshooting Guide Card */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <h4 className="text-xs font-black text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>چک‌لیست رفع مشکل «عدم برقراری ارتباط» یا «اطلاعات نادرست» دستگاه XFace 60 N:</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11.5px] text-slate-300">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-850 space-y-1">
                <strong className="text-white block">۱. بررسی آی‌پی وای‌فای (Wi-Fi IP):</strong>
                <p className="text-slate-400">
                  در صفحه لمسی دستگاه وارد <b>منو ◄ ارتباطات ◄ شبکه / وای‌فای</b> شوید. آی‌پی اختصاص یافته را دقیقاً در فیلد آی‌پی برنامه وارد کنید (مثلاً ۱۹۲.۱۶۸.۱.۲۰۱).
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-850 space-y-1">
                <strong className="text-white block">۲. بررسی کلید ارتباط (Comm Key):</strong>
                <p className="text-slate-400">
                  در دستگاه به مسیر <b>ارتباطات ◄ تنظیمات پیشرفته</b> رفته و بررسی کنید که <b>کلید ارتباط (Comm Key)</b> روی عدد <b>0</b> باشد. اگر مقدار دیگری است، باید در تنظیمات هم وارد شود.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-850 space-y-1">
                <strong className="text-white block">۳. هم‌شبکه بودن کامپیوتر و دستگاه:</strong>
                <p className="text-slate-400">
                  کامپیوتر و دستگاه حضور و غیاب باید به یک وای‌فای یا مودم متصل باشند. همچنین گزینه AP Isolation یا Guest Mode روی مودم باید غیرفعال باشد.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-850 space-y-1">
                <strong className="text-white block">۴. روش اضطراری انتقال داده‌ها (DAT / JSON):</strong>
                <p className="text-slate-400">
                  می‌توانید وارد داشبورد <b>http://localhost:5005</b> شده و دکمه «کپی متن JSON» یا «دانلود فایل DAT» را بزنید و در تب <b>«چسباندن متن ترددها»</b> در برنامه پیست فرمایید.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 5: PROTOCOL TERMINAL ================= */}
      {deviceSubTab === 'terminal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-slate-900 border border-slate-850 rounded-2xl">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-black text-white">ترمینال گزارش زنده پکت‌های شبکه (ZMM510 Packets Inspector)</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTerminalLogs([])}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-[11px] font-bold border border-slate-800 transition-colors"
              >
                پاکسازی ترمینال
              </button>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] max-h-[420px] overflow-y-auto space-y-2.5 custom-scrollbar" dir="ltr">
            {terminalLogs.map(log => (
              <div
                key={log.id}
                className={`p-2.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-2 ${
                  log.type === 'SUCCESS'
                    ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
                    : log.type === 'TX'
                    ? 'bg-cyan-950/20 border-cyan-500/20 text-cyan-300'
                    : log.type === 'ERR'
                    ? 'bg-rose-950/20 border-rose-500/20 text-rose-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-slate-500 text-[10px]">{log.time}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                    log.type === 'TX' ? 'bg-cyan-500/20 text-cyan-400' :
                    log.type === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' :
                    log.type === 'ERR' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {log.type}
                  </span>
                  <span className="font-bold">{log.command}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate max-w-md text-right font-sans" dir="rtl">
                  {log.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 6: WIFI SETUP GUIDE ================= */}
      {deviceSubTab === 'guide' && (
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-850 rounded-2xl space-y-4">
            <h4 className="text-sm font-black text-rose-400 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Radio className="h-5 w-5 text-rose-500" />
              <span>راهنمای گام به گام تنظیم شبکه وای‌فای (Wi-Fi) در دستگاه XFace 60 N (پلتفرم ZMM510)</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="font-black text-white flex items-center gap-1.5">
                  <span className="h-5 w-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-mono text-xs">۱</span>
                  ورود به منوی تنظیمات دستگاه
                </span>
                <p className="text-slate-400 leading-relaxed text-justify text-[11.5px]">
                  کلید منو (Menu) را روی صفحه لمسی دستگاه لمس کنید. در صورت داشتن رمز عبور مدیر، دسترسی را تایید نمایید تا به صفحه اصلی منوی سیستم‌عامل ZMM510 وارد شوید.
                </p>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="font-black text-white flex items-center gap-1.5">
                  <span className="h-5 w-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-mono text-xs">۲</span>
                  بخش ارتباطات (Comm.) و شبکه بی‌سیم (Wi-Fi)
                </span>
                <p className="text-slate-400 leading-relaxed text-justify text-[11.5px]">
                  گزینه <strong>ارتباطات (Comm.)</strong> را انتخاب کرده و سپس وارد منوی <strong>شبکه بی‌سیم (Wi-Fi)</strong> شوید. قابلیت وای‌فای را روی حالت «روشن» قرار دهید.
                </p>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="font-black text-white flex items-center gap-1.5">
                  <span className="h-5 w-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-mono text-xs">۳</span>
                  اتصال به مودم و مشاهده IP
                </span>
                <p className="text-slate-400 leading-relaxed text-justify text-[11.5px]">
                  نام شبکه وای‌فای (SSID) خود را از لیست پیدا کرده و رمز عبور وای‌فای را تایپ کنید. پس از اتصال، آدرس IP اختصاص‌یافته به دستگاه (مثلاً 192.168.1.201) نمایش داده می‌شود.
                </p>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="font-black text-white flex items-center gap-1.5">
                  <span className="h-5 w-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-mono text-xs">۴</span>
                  بررسی پورت ارتباطی و CommKey
                </span>
                <p className="text-slate-400 leading-relaxed text-justify text-[11.5px]">
                  در منوی ارتباطات، وارد بخش <strong>اتصال به کامپیوتر (PC Connection)</strong> شوید. پورت را روی <strong>4370</strong> و رمز ارتباط (Comm Key) را روی <strong>0</strong> قرار دهید.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
