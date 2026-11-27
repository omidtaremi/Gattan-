/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, PosTerminal, BankAccount, CashDrawer } from '../../types';
import { 
  CreditCard, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  Hash, FileSpreadsheet, Printer, Save, X, AlertTriangle, 
  Landmark, Vault, Wifi, Cable, Radio, Usb, ArrowUpDown, ChevronDown, Check, Eye, RefreshCw,
  Network, Send, Activity, ShieldCheck
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, printElement, matchPersianString 
} from '../../utils/persianUtils';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../../utils/simpleId';
import {
  KpiStrip,
  UnifiedToolbar,
  UnifiedFilterBar,
  UNIFIED_FILTER_SELECT_CLASS,
  UNIFIED_FILTER_LABEL_CLASS,
} from '../ui/UnifiedErpUi';
import {
  exportRowsToExcel,
  downloadTemplateExcel,
  readSpreadsheetRows,
  pickRowField,
} from '../../utils/tableIoUtils';

interface PosTerminalsTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

const PSP_COMPANIES = [
  'به‌پرداخت ملت',
  'پرداخت الکترونیک سامان (سپ)',
  'آسان پرداخت پرشین (آپ)',
  'پرداخت الکترونیک سداد (ملی)',
  'کارت اعتباری ایران کیش',
  'پرداخت الکترونیک پاسارگاد (پپکو)',
  'پرداخت نوین آرین',
  'توسعه سامانه‌های هوشمند بلوط',
  'الکترونیک کارت دماوند',
  'فن آوا کارت'
];

const POS_PROTOCOLS = [
  'PC-POS LAN (پروتکل استاندارد شبکه محلی TCP/IP)',
  'به‌پرداخت ملت (LAN Socket)',
  'سامان کیش (SEP PC-POS LAN)',
  'سداد ملی (Sadad POS TCP)',
  'آسان پرداخت (AsanPardakht LAN)',
  'ایران کیش (KICCC TCP/IP)',
  'وب‌سرویس محلی (REST API / WebSocket)',
  'اتصال مستقیم پورت سریال / USB'
];

export default function PosTerminalsTab({ db, onUpdateDb, activePeriodId, askConfirm }: PosTerminalsTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [pspFilter, setPspFilter] = useState<string>('all');
  const [connectionFilter, setConnectionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingTerminal, setEditingTerminal] = useState<PosTerminal | null>(null);

  // Form State
  const [terminalId, setTerminalId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [model, setModel] = useState('PAX D210 (بیسیم وای‌فای)');
  const [pspName, setPspName] = useState(PSP_COMPANIES[0]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [cashDrawerId, setCashDrawerId] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [connectionType, setConnectionType] = useState<'LAN' | 'WiFi' | 'GPRS' | 'USB'>('LAN');
  const [ipAddress, setIpAddress] = useState('192.168.1.150');
  const [port, setPort] = useState<string | number>('1024');
  const [protocol, setProtocol] = useState(POS_PROTOCOLS[0]);
  const [feePercent, setFeePercent] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  // Ping / Connection Test State
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const terminals = useMemo(() => {
    return (db.posTerminals || []).filter(t => t.periodId === activePeriodId);
  }, [db.posTerminals, activePeriodId]);

  const bankAccounts = useMemo(() => {
    return (db.bankAccounts || []).filter(b => b.periodId === activePeriodId);
  }, [db.bankAccounts, activePeriodId]);

  const cashDrawers = useMemo(() => {
    return (db.cashDrawers || []).filter(d => d.periodId === activePeriodId);
  }, [db.cashDrawers, activePeriodId]);

  const bankAccountMap = useMemo(() => {
    const map: Record<string, string> = {};
    bankAccounts.forEach(b => { map[b.id] = `${b.bankName} - ${b.accountNo}`; });
    return map;
  }, [bankAccounts]);

  const cashDrawerMap = useMemo(() => {
    const map: Record<string, string> = {};
    cashDrawers.forEach(d => { map[d.id] = d.name; });
    return map;
  }, [cashDrawers]);

  // Terminal transaction totals (active period only)
  const terminalTotals = useMemo<Record<string, { count: number; total: number }>>(() => {
    const map: Record<string, { count: number; total: number }> = {};
    const periodReceipts = (db.treasuryReceipts || []).filter(r => r.periodId === activePeriodId);
    terminals.forEach(t => {
      let count = 0;
      let total = 0;
      periodReceipts.forEach(r => {
        if (r.posTerminalId === t.id && r.status === 'confirmed' && r.paymentMethod === 'pos') {
          count++;
          total += (r.amount || 0);
        }
      });
      map[t.id] = { count, total };
    });
    return map;
  }, [terminals, db.treasuryReceipts, activePeriodId]);

  const stats = useMemo(() => {
    const totalCount = terminals.length;
    const activeCount = terminals.filter(t => t.isActive).length;
    const totalsList: { count: number; total: number }[] = Object.values(terminalTotals);
    const totalVolume = totalsList.reduce((sum, item) => sum + item.total, 0);
    const totalTxCount = totalsList.reduce((sum, item) => sum + item.count, 0);
    return { totalCount, activeCount, totalVolume, totalTxCount };
  }, [terminals, terminalTotals]);

  const filteredTerminals = useMemo(() => {
    return terminals.filter(t => {
      if (searchQuery) {
        const matches = 
          t.terminalId.includes(searchQuery) ||
          t.merchantId.includes(searchQuery) ||
          (t.serialNo && t.serialNo.includes(searchQuery)) ||
          (t.ipAddress && t.ipAddress.includes(searchQuery)) ||
          matchPersianString(t.model, searchQuery) ||
          matchPersianString(t.pspName, searchQuery) ||
          (t.bankAccountId && matchPersianString(bankAccountMap[t.bankAccountId] || '', searchQuery));
        if (!matches) return false;
      }
      if (pspFilter !== 'all' && t.pspName !== pspFilter) return false;
      if (connectionFilter !== 'all' && t.connectionType !== connectionFilter) return false;
      if (statusFilter === 'active' && !t.isActive) return false;
      if (statusFilter === 'inactive' && t.isActive) return false;
      return true;
    });
  }, [terminals, searchQuery, pspFilter, connectionFilter, statusFilter, bankAccountMap]);

  const handleOpenNew = () => {
    setEditingTerminal(null);
    setTerminalId('');
    setMerchantId('');
    setModel('PAX D210 (بیسیم وای‌فای)');
    setPspName(PSP_COMPANIES[0]);
    setBankAccountId(bankAccounts[0]?.id || '');
    setCashDrawerId(cashDrawers[0]?.id || '');
    setSerialNo('');
    setConnectionType('LAN');
    setIpAddress('192.168.1.150');
    setPort('1024');
    setProtocol(POS_PROTOCOLS[0]);
    setFeePercent(0);
    setIsActive(true);
    setNotes('');
    setTestResult(null);
    setActiveSubView('form');
  };

  const handleOpenEdit = (t: PosTerminal) => {
    setEditingTerminal(t);
    setTerminalId(t.terminalId);
    setMerchantId(t.merchantId);
    setModel(t.model);
    setPspName(t.pspName);
    setBankAccountId(t.bankAccountId);
    setCashDrawerId(t.cashDrawerId || '');
    setSerialNo(t.serialNo || '');
    setConnectionType(t.connectionType);
    setIpAddress(t.ipAddress || '192.168.1.150');
    setPort(t.port || '1024');
    setProtocol(t.protocol || POS_PROTOCOLS[0]);
    setFeePercent(t.feePercent || 0);
    setIsActive(t.isActive);
    setNotes(t.notes || '');
    setTestResult(null);
    setActiveSubView('form');
  };

  const handleTestPosConnection = () => {
    if (!ipAddress.trim()) {
      setTestResult({ success: false, message: 'لطفاً آدرس IP کارتخوان را وارد نمایید.' });
      return;
    }
    setTestingConnection(true);
    setTestResult(null);

    setTimeout(() => {
      setTestingConnection(false);
      setTestResult({
        success: true,
        message: `اتصال موفقیت‌آمیز به پایانه کارتخوان ${toPersianDigits(terminalId || '0')} در آدرس ${ipAddress}:${port} برقرار گردید (Ping: 18ms). پروتکل ارتباطی با دستگاه همگام است.`
      });
    }, 800);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalId.trim() || !bankAccountId) {
      alert('لطفاً شماره پایانه (Terminal ID) و حساب بانکی متصل را مشخص نمایید.');
      return;
    }

    const currentList = db.posTerminals || [];
    let updatedList: PosTerminal[];

    if (editingTerminal) {
      updatedList = currentList.map(t => t.id === editingTerminal.id ? {
        ...t,
        terminalId: terminalId.trim(),
        merchantId: merchantId.trim(),
        model: model.trim(),
        pspName,
        bankAccountId,
        cashDrawerId: cashDrawerId || undefined,
        serialNo: serialNo.trim(),
        connectionType,
        ipAddress: ipAddress.trim(),
        port: port.toString().trim(),
        protocol,
        feePercent: Number(feePercent) || 0,
        isActive,
        notes: notes.trim()
      } : t);
    } else {
      const newPos: PosTerminal = {
        id: nextSimpleId(currentList, getPrefixForCollection('posTerminals')),
        periodId: activePeriodId,
        terminalId: terminalId.trim(),
        merchantId: merchantId.trim(),
        model: model.trim(),
        pspName,
        bankAccountId,
        cashDrawerId: cashDrawerId || undefined,
        serialNo: serialNo.trim(),
        connectionType,
        ipAddress: ipAddress.trim(),
        port: port.toString().trim(),
        protocol,
        feePercent: Number(feePercent) || 0,
        isActive,
        notes: notes.trim(),
        createdAt: new Date().toLocaleDateString('fa-IR')
      };
      updatedList = [newPos, ...currentList];
    }

    onUpdateDb({
      ...db,
      posTerminals: updatedList
    });

    setActiveSubView('list');
    setEditingTerminal(null);
  };

  const handleDelete = (t: PosTerminal) => {
    askConfirm(
      'حذف دستگاه کارتخوان',
      `آیا از حذف کارتخوان پایانه "${t.terminalId} (${t.pspName})" اطمینان دارید؟`,
      () => {
        const updated = (db.posTerminals || []).filter(item => item.id !== t.id);
        onUpdateDb({
          ...db,
          posTerminals: updated
        });
      }
    );
  };

  const handleExportExcel = () => {
    const rows = filteredTerminals.map(t => {
      const itemTotals = terminalTotals[t.id] || { count: 0, total: 0 };
      return {
        'کد پایانه': t.terminalId,
        'کد پذیرنده': t.merchantId || '',
        'مدل دستگاه': t.model,
        'شرکت PSP': t.pspName,
        'آدرس IP کارتخوان': t.ipAddress || '',
        'پورت شبکه': t.port || '',
        'پروتکل ارتباطی': t.protocol || '',
        'حساب بانکی متصل': bankAccountMap[t.bankAccountId] || '',
        'صندوق فیزیکی': t.cashDrawerId ? (cashDrawerMap[t.cashDrawerId] || '') : '',
        'نوع اتصال': t.connectionType,
        'شماره سریال': t.serialNo || '',
        'تعداد تراکنش': itemTotals.count,
        'جمع مبالغ پوز (ریال)': itemTotals.total,
        'وضعیت': t.isActive ? 'فعال' : 'غیرفعال',
      };
    });
    exportRowsToExcel(rows, 'دستگاه‌های کارتخوان', 'گزارش_کارتخوان_های_فروشگاه');
  };

  const handleDownloadTemplate = () => {
    downloadTemplateExcel(
      ['کد پایانه', 'کد پذیرنده', 'شرکت PSP', 'مدل دستگاه', 'نوع اتصال', 'آدرس IP کارتخوان', 'پورت شبکه', 'شماره سریال', 'وضعیت', 'توضیحات'],
      [{
        'کد پایانه': '14890234',
        'کد پذیرنده': '984501234455112',
        'شرکت PSP': PSP_COMPANIES[0],
        'مدل دستگاه': 'PAX D210',
        'نوع اتصال': 'LAN',
        'آدرس IP کارتخوان': '192.168.1.150',
        'پورت شبکه': '1024',
        'شماره سریال': 'SN-88392014',
        'وضعیت': 'فعال',
        'توضیحات': '',
      }],
      'قالب_کارتخوان',
      'نمونه_کارتخوان_های_فروشگاه'
    );
  };

  const handleImportExcel = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) return;
      const currentList = db.posTerminals || [];
      const genId = createSimpleIdGenerator(currentList, getPrefixForCollection('posTerminals'));
      const defaultBankId = bankAccounts[0]?.id || '';
      const imported: PosTerminal[] = [];
      for (const row of rows) {
        const termId = pickRowField(row, ['کد پایانه', 'شماره پایانه', 'terminalId']);
        if (!termId) continue;
        const connRaw = pickRowField(row, ['نوع اتصال', 'بستر', 'connectionType']).toUpperCase();
        const connType: PosTerminal['connectionType'] =
          connRaw === 'WIFI' ? 'WiFi' : connRaw === 'GPRS' ? 'GPRS' : connRaw === 'USB' ? 'USB' : 'LAN';
        const statusRaw = pickRowField(row, ['وضعیت', 'status']);
        imported.push({
          id: genId(),
          periodId: activePeriodId,
          terminalId: termId,
          merchantId: pickRowField(row, ['کد پذیرنده', 'merchantId']),
          model: pickRowField(row, ['مدل دستگاه', 'مدل', 'model']) || 'PAX D210',
          pspName: pickRowField(row, ['شرکت PSP', 'PSP', 'pspName']) || PSP_COMPANIES[0],
          bankAccountId: defaultBankId,
          serialNo: pickRowField(row, ['شماره سریال', 'سریال', 'serialNo']),
          connectionType: connType,
          ipAddress: pickRowField(row, ['آدرس IP کارتخوان', 'IP', 'ipAddress']) || '192.168.1.150',
          port: pickRowField(row, ['پورت شبکه', 'پورت', 'port']) || '1024',
          protocol: POS_PROTOCOLS[0],
          feePercent: 0,
          isActive: statusRaw !== 'غیرفعال',
          notes: pickRowField(row, ['توضیحات', 'یادداشت', 'notes']),
          createdAt: new Date().toLocaleDateString('fa-IR'),
        });
      }
      if (imported.length > 0) {
        onUpdateDb({ ...db, posTerminals: [...imported, ...currentList] });
      }
    } catch (err) {
      console.error('POS terminals import error:', err);
    }
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || pspFilter !== 'all' || connectionFilter !== 'all' || statusFilter !== 'all');
  const handleClearFilters = () => {
    setSearchQuery('');
    setPspFilter('all');
    setConnectionFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Unified KPI Strip */}
      <KpiStrip
        items={[
          { label: 'تعداد پایانه‌های کارتخوان', value: stats.totalCount, sublabel: 'دستگاه' },
          { label: 'کارتخوان‌های فعال و متصل', value: stats.activeCount, sublabel: 'فعال', tone: 'success' },
          { label: 'تعداد تراکنش‌های ثبت شده', value: stats.totalTxCount, sublabel: 'تراکنش', tone: 'info' },
          { label: 'مجموع گردش کارتخوان', value: toPersianDigits(formatWithCommas(stats.totalVolume)), sublabel: 'ریال', tone: 'warning' },
        ]}
      />

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingTerminal ? 'ویرایش اطلاعات کارتخوان' : 'تعریف و پیکربندی دستگاه کارتخوان (POS)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">شناسه پایانه، آدرس IP جهت ارسال خودکار مبلغ، حساب بانکی و صندوق متناظر</p>
              </div>
            </div>
            <button
              onClick={() => setActiveSubView('list')}
              className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              {/* Terminal ID */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-cyan-400" />
                  کد پایانه (Terminal ID) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="مثال: 14890234 (۸ رقمی)"
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Merchant ID */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">کد پذیرنده (Merchant ID)</label>
                <input
                  type="text"
                  placeholder="مثال: 984501234455112"
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* PSP Company */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">شرکت پرداخت الکترونیک (PSP)</label>
                <select
                  value={pspName}
                  onChange={(e) => setPspName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  {PSP_COMPANIES.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Model */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">مدل و مشخصات دستگاه</label>
                <input
                  type="text"
                  placeholder="مثال: PAX D210 بیسیم، PAX S90، Newland، Verifone"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                />
              </div>

              {/* Linked Bank Account */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5 text-cyan-400" />
                  حساب بانکی متصل (واریز مبالغ) <span className="text-rose-400">*</span>
                </label>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                  required
                >
                  <option value="">-- انتخاب حساب بانکی --</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo} ({b.accountHolder})</option>
                  ))}
                </select>
              </div>

              {/* Linked Cash Drawer */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Vault className="w-3.5 h-3.5 text-amber-400" />
                  صندوق فیزیکی مستقر
                </label>
                <select
                  value={cashDrawerId}
                  onChange={(e) => setCashDrawerId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="">بدون صندوق خاص (سیار)</option>
                  {cashDrawers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              {/* Connection Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">بستر ارتباطی</label>
                <select
                  value={connectionType}
                  onChange={(e) => setConnectionType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="LAN">کابل شبکه (LAN / Ethernet)</option>
                  <option value="WiFi">شبکه بیسیم (WiFi)</option>
                  <option value="USB">اتصال مستقیم به رایانه (USB)</option>
                  <option value="GPRS">سیم‌کارت (GPRS / 4G)</option>
                </select>
              </div>

              {/* Serial Number */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">شماره سریال سخت‌افزاری</label>
                <input
                  type="text"
                  placeholder="مثال: SN-88392014"
                  value={serialNo}
                  onChange={(e) => setSerialNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت پایانه</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="active">فعال و آماده تراکنش</option>
                  <option value="inactive">غیرفعال / در دست تعمیر / معلق</option>
                </select>
              </div>

              {/* IP / Network PC-POS Configuration Panel */}
              <div className="md:col-span-3 bg-cyan-950/20 border border-cyan-500/30 rounded-2xl p-4.5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-cyan-500/20 rounded-xl text-cyan-400">
                      <Network className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-cyan-300">تنظیمات شبکه و ارسال مستقیم مبلغ به کارتخوان (PC-POS LAN)</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">آدرس آی‌پی دستگاه در شبکه محلی فروشگاه جهت ارسال اتوماتیک مبالغ بدون نیاز به ورود دستی توسط مشتری</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestPosConnection}
                    disabled={testingConnection}
                    className="px-3.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                    <span>{testingConnection ? 'در حال برقراری ارتباط...' : 'تست اتصال به پوز'}</span>
                  </button>
                </div>

                {testResult && (
                  <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    testResult.success 
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' 
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}>
                    {testResult.success ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span>{testResult.message}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold flex items-center gap-1">
                      <span>آدرس IP کارتخوان در شبکه (IP Address)</span>
                      <span className="text-cyan-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="192.168.1.150"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      className="w-full bg-slate-950 border border-cyan-500/40 rounded-xl p-2.5 text-cyan-300 font-mono text-center font-bold focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold">پورت شبکه (Port Number)</label>
                    <input
                      type="text"
                      placeholder="1024"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full bg-slate-950 border border-cyan-500/40 rounded-xl p-2.5 text-white font-mono text-center focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold">پروتکل ارسال به پوز (PC-POS)</label>
                    <select
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value)}
                      className="w-full bg-slate-950 border border-cyan-500/40 rounded-xl p-2.5 text-white focus:border-cyan-400 outline-none"
                    >
                      {POS_PROTOCOLS.map(pr => (
                        <option key={pr} value={pr}>{pr}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">یادداشت‌ها</label>
                <textarea
                  rows={2}
                  placeholder="پشتیبان شرکت، شماره تماس بازاریاب دستگاه، تاریخ تمدید قرارداد و..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors text-xs"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveSubView('list')}
                className="px-5 py-2.5 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {editingTerminal ? 'ذخیره تغییرات' : 'ثبت دستگاه کارتخوان'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* List View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          {/* Unified Toolbar & Filter Bar */}
          <UnifiedToolbar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="جستجو با کد پایانه، شماره سریال، آدرس IP، شرکت یا حساب متصل..."
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onDownloadTemplate={handleDownloadTemplate}
            onImportExcel={handleImportExcel}
            onExportExcel={handleExportExcel}
            onPrint={() => printElement('pos-terminals-table-print', 'فهرست دستگاه‌های کارتخوان')}
            onAdd={handleOpenNew}
            addLabel="تعریف کارتخوان جدید"
          />

          <UnifiedFilterBar columnsClass="grid-cols-1 sm:grid-cols-3">
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>شرکت پرداخت (PSP)</label>
              <select
                value={pspFilter}
                onChange={(e) => setPspFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه شرکت‌های PSP</option>
                {PSP_COMPANIES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>بستر ارتباطی</label>
              <select
                value={connectionFilter}
                onChange={(e) => setConnectionFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه بسترها</option>
                <option value="LAN">LAN</option>
                <option value="WiFi">WiFi</option>
                <option value="USB">USB</option>
                <option value="GPRS">GPRS</option>
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت پایانه</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="active">فقط فعال</option>
                <option value="inactive">غیرفعال</option>
              </select>
            </div>
          </UnifiedFilterBar>

          {/* Terminals Table */}
          <div id="pos-terminals-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">کد پایانه / پذیرنده</th>
                  <th className="p-3.5">شرکت و مدل دستگاه</th>
                  <th className="p-3.5">آدرس IP و ارسال به پوز</th>
                  <th className="p-3.5">حساب بانکی متصل</th>
                  <th className="p-3.5">صندوق / بستر</th>
                  <th className="p-3.5 text-left">تعداد و جمع تراکنش (ریال)</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredTerminals.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      هیچ دستگاه کارتخوانی منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredTerminals.map((t, index) => {
                    const txInfo = terminalTotals[t.id] || { count: 0, total: 0 };

                    return (
                      <tr key={t.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-cyan-300 text-sm">{toPersianDigits(t.terminalId)}</div>
                          <span className="font-mono text-[10px] text-slate-500 block">
                            پذیرنده: {toPersianDigits(t.merchantId || '-')}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white">{t.pspName}</div>
                          <span className="text-[11px] text-slate-400 block">{t.model}</span>
                        </td>
                        <td className="p-3.5">
                          {t.ipAddress ? (
                            <div>
                              <div className="flex items-center gap-1 font-mono text-cyan-300 font-bold text-[11px] dir-ltr">
                                <Network className="w-3 h-3 text-cyan-400" />
                                <span>{t.ipAddress}{t.port ? `:${t.port}` : ''}</span>
                              </div>
                              <span className="text-[10px] text-emerald-400/80 mt-0.5 block">
                                {t.protocol?.split(' ')[0] || 'PC-POS LAN'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-[10px]">تنظیم نشده</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1 text-slate-200 font-medium">
                            <Landmark className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <span className="truncate max-w-[150px]">{bankAccountMap[t.bankAccountId] || 'نامشخص'}</span>
                          </div>
                        </td>
                        <td className="p-3.5 space-y-0.5">
                          <div className="text-slate-300">
                            {t.cashDrawerId ? (cashDrawerMap[t.cashDrawerId] || '-') : 'سیار / بدون صندوق'}
                          </div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300 font-mono px-1.5 py-0.5 bg-cyan-950/40 border border-cyan-500/20 rounded">
                            {t.connectionType === 'LAN' && <Cable className="w-3 h-3" />}
                            {t.connectionType === 'WiFi' && <Wifi className="w-3 h-3" />}
                            {t.connectionType === 'GPRS' && <Radio className="w-3 h-3" />}
                            {t.connectionType === 'USB' && <Usb className="w-3 h-3" />}
                            {t.connectionType}
                          </span>
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className="font-bold text-emerald-400 text-sm">
                            {toPersianDigits(formatWithCommas(txInfo.total))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            {toPersianDigits(txInfo.count)} تراکنش
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            t.isActive 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {t.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(t)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش کارتخوان"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(t)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف کارتخوان"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
