/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Supplier, SupplierBankAccount } from '../types';
import { 
  Search, Phone, MapPin, CreditCard, Banknote, ListPlus, X, Trash2, Users2, Save, Plus, Copy, ArrowUpDown
} from 'lucide-react';
import { 
  toPersianDigits, downloadCSV, printElement, matchPersianString 
} from '../utils/persianUtils';
import { createSimpleIdGenerator, nextSimpleId } from '../utils/simpleId';
import {
  downloadTemplateExcel,
  exportRowsToExcel,
  readSpreadsheetRows,
  pickRowField
} from '../utils/tableIoUtils';
import {
  ERP_BUTTON_LABELS,
  EmptyPeriodState,
  ErpButton,
  KpiStrip,
  ModuleHeader,
  StatusText,
  UnifiedFilterBar,
  UNIFIED_FILTER_SELECT_CLASS,
  UNIFIED_FILTER_LABEL_CLASS,
  UnifiedToolbar,
} from './ui/UnifiedErpUi';
import { CopyFromPeriodModal } from './ui/CopyFromPeriodModal';
import { useErpFeedback } from './ui/ToastContext';

interface SupplierManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

export default function SupplierManagement({ db, onUpdateDb, activePeriodId }: SupplierManagementProps) {
  const feedback = useErpFeedback();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [bankFilter, setBankFilter] = useState<'all' | 'has_bank' | 'no_bank'>('all');
  const [itemsFilter, setItemsFilter] = useState<'all' | 'has_items' | 'no_items'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'itemsCount' | 'banksCount'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isSupplierFormOpen, setIsSupplierFormOpen] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);

  const activePeriodName = useMemo(
    () => (db.periods || []).find(p => p.id === activePeriodId)?.name || activePeriodId,
    [db.periods, activePeriodId]
  );

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

  // Focus Helper
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // Lists scoped to current active period
  const suppliers = useMemo(() => db.suppliers.filter(s => s.periodId === activePeriodId), [db.suppliers, activePeriodId]);
  const activeItems = useMemo(() => db.items.filter(i => i.periodId === activePeriodId && i.isActive), [db.items, activePeriodId]);

  const itemMap = useMemo(() => {
    const map: Record<string, string> = {};
    activeItems.forEach(i => map[i.id] = i.name);
    return map;
  }, [activeItems]);

  const supplierStats = useMemo(() => {
    const total = suppliers.length;
    const activeCount = suppliers.filter(s => s.isActive).length;
    const withBankCount = suppliers.filter(s => (s.bankAccounts || []).length > 0).length;
    const totalLinkedItems = suppliers.reduce((sum, s) => sum + (s.suppliedItemIds || []).length, 0);
    return { total, activeCount, withBankCount, totalLinkedItems };
  }, [suppliers]);

  const searchedSuppliers = useMemo(() => {
    const filtered = suppliers.filter(s => {
      if (searchQuery) {
        const matches =
          matchPersianString(s.name, searchQuery) ||
          matchPersianString(s.phone, searchQuery) ||
          matchPersianString(s.address, searchQuery);
        if (!matches) return false;
      }
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (bankFilter === 'has_bank' && (s.bankAccounts || []).length === 0) return false;
      if (bankFilter === 'no_bank' && (s.bankAccounts || []).length > 0) return false;
      if (itemsFilter === 'has_items' && (s.suppliedItemIds || []).length === 0) return false;
      if (itemsFilter === 'no_items' && (s.suppliedItemIds || []).length > 0) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'itemsCount') {
        cmp = (a.suppliedItemIds || []).length - (b.suppliedItemIds || []).length;
      } else if (sortBy === 'banksCount') {
        cmp = (a.bankAccounts || []).length - (b.bankAccounts || []).length;
      } else {
        cmp = (a.name || '').localeCompare(b.name || '', 'fa');
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [suppliers, searchQuery, statusFilter, bankFilter, itemsFilter, sortBy, sortOrder]);


  // --- SUPPLIER STATE BUILDERS ---
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supActive, setSupActive] = useState(true);
  const [supItems, setSupItems] = useState<string[]>([]); // supplied items ids
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  const filteredActiveItems = useMemo(() => {
    if (!itemSearchQuery) return activeItems;
    return activeItems.filter(item => 
      matchPersianString(item.name, itemSearchQuery) || 
      matchPersianString(item.code, itemSearchQuery)
    );
  }, [activeItems, itemSearchQuery]);

  // Dynamic nested Bank Accounts list builder
  const [bankAccounts, setBankAccounts] = useState<SupplierBankAccount[]>([]);
  const [bankName, setBankName] = useState('بانک ملی');
  const [accountNo, setAccountNo] = useState('');
  const [shaba, setShaba] = useState('');
  const [cardNo, setCardNo] = useState('');

  const addBankAccountToDraft = () => {
    if (!accountNo) {
      feedback.warning('لطفاً شماره حساب بانکی را وارد نمایید.');
      return;
    }
    const newAcc: SupplierBankAccount = {
      bankName,
      accountNo,
      shaba,
      cardNo
    };
    setBankAccounts([...bankAccounts, newAcc]);
    
    // reset builder
    setAccountNo('');
    setShaba('');
    setCardNo('');
  };

  const removeBankAccountFromDraft = (index: number) => {
    setBankAccounts(bankAccounts.filter((_, idx) => idx !== index));
  };

  const toggleItemSupply = (itemId: string) => {
    if (supItems.includes(itemId)) {
      setSupItems(supItems.filter(id => id !== itemId));
    } else {
      setSupItems([...supItems, itemId]);
    }
  };


  // --- ACTIONS ---
  const handleSaveSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) {
      feedback.warning('وارد کردن نام تامین‌کننده الزامی است.');
      return;
    }

    const isEdit = !!editingSupplier;
    const targetSupplier: Supplier = isEdit
      ? {
          ...editingSupplier!,
          name: supName.trim(),
          phone: supPhone.trim(),
          address: supAddress.trim(),
          isActive: supActive,
          bankAccounts,
          suppliedItemIds: supItems
        }
      : {
          id: nextSimpleId(db.suppliers || [], 'sup'),
          periodId: activePeriodId,
          name: supName.trim(),
          phone: supPhone.trim(),
          address: supAddress.trim(),
          isActive: supActive,
          bankAccounts,
          suppliedItemIds: supItems
        };

    let updatedList = [...db.suppliers];
    if (isEdit) {
      updatedList = updatedList.map(s => s.id === editingSupplier.id ? targetSupplier : s);
      setEditingSupplier(null);
    } else {
      updatedList.push(targetSupplier);
    }

    onUpdateDb({
      ...db,
      suppliers: updatedList
    });

    feedback.success(isEdit ? 'تغییرات تامین‌کننده ذخیره شد.' : 'تامین‌کننده جدید با موفقیت ثبت شد.');

    // Reset Form states
    setSupName('');
    setSupPhone('');
    setSupAddress('');
    setSupActive(true);
    setBankAccounts([]);
    setSupItems([]);
    setItemSearchQuery('');
    setIsSupplierFormOpen(false);
  };

  const resetSupplierForm = () => {
    setEditingSupplier(null);
    setSupName('');
    setSupPhone('');
    setSupAddress('');
    setSupActive(true);
    setBankAccounts([]);
    setSupItems([]);
    setItemSearchQuery('');
  };

  const startNewSupplier = () => {
    resetSupplierForm();
    setIsSupplierFormOpen(true);
  };

  const startEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setSupName(supplier.name);
    setSupPhone(supplier.phone);
    setSupAddress(supplier.address);
    setSupActive(supplier.isActive);
    setBankAccounts(supplier.bankAccounts || []);
    setSupItems(supplier.suppliedItemIds || []);
    setIsSupplierFormOpen(true);
  };

  const deleteSupplier = (id: string) => {
    askConfirm(
      'حذف تامین‌کننده کالا',
      'آیا مایل به حذف این تامین‌کننده هستید؟ تمامی رکوردهای خریدهای قبلی به قوت خود باقی می‌مانند.',
      () => {
        onUpdateDb({
          ...db,
          suppliers: db.suppliers.filter(s => s.id !== id)
        });
        feedback.success('تامین‌کننده حذف شد.');
      }
    );
  };

  const exportSuppliersCSV = () => {
    const rows = searchedSuppliers.map(s => ({
      'نام تامین کننده': s.name,
      'تلفن تماس': s.phone || '',
      'آدرس فیزیکی': s.address || '',
      'وضعیت همکاری': s.isActive ? 'فعال' : 'غیرفعال',
      'تعداد حساب‌های متصل': (s.bankAccounts || []).length,
      'شماره حساب‌ها': (s.bankAccounts || []).map(a => `${a.bankName}: ${a.accountNo}`).join(' ; '),
      'شماره شبا‌ها': (s.bankAccounts || []).map(a => a.shaba).join(' ; '),
      'شماره کارت‌ها': (s.bankAccounts || []).map(a => a.cardNo).join(' ; '),
      'کالاهای ارائه شونده': (s.suppliedItemIds || []).map(id => itemMap[id] || '').filter(Boolean).join(' | ')
    }));
    exportRowsToExcel(rows, 'تامین‌کنندگان', 'لیست_تامین_کنندگان_گاتان.xlsx');
  };

  const downloadSampleSuppliersCSV = () => {
    downloadTemplateExcel(
      ['نام تامین کننده', 'تلفن تماس', 'آدرس فیزیکی', 'وضعیت همکاری'],
      [
        { 'نام تامین کننده': 'کارخانه آرد سپهر یزد', 'تلفن تماس': '03531234567', 'آدرس فیزیکی': 'یزد، شهرک صنعتی، بلوار گلستان', 'وضعیت همکاری': 'فعال' },
        { 'نام تامین کننده': 'مجتمع صنایع قند و شکر پیروز', 'تلفن تماس': '02188887777', 'آدرس فیزیکی': 'تهران، خیابان ولیعصر، برج نیلوفر', 'وضعیت همکاری': 'فعال' }
      ],
      'تامین‌کنندگان',
      'نمونه_تامین_کنندگان_گاتان.xlsx'
    );
  };

  const importSuppliersFile = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) {
        feedback.warning('فایل انتخابی خالی است یا ساختار معتبری ندارد.');
        return;
      }
      const updatedSuppliers = [...db.suppliers];
      const nextSupId = createSimpleIdGenerator(updatedSuppliers, 'sup');
      let importCount = 0;

      rows.forEach((row) => {
        const nameVal = pickRowField(row, ['نام تامین کننده', 'نام تامین‌کننده', 'نام', 'name']);
        if (!nameVal) return;
        if (updatedSuppliers.some(s => s.periodId === activePeriodId && s.name === nameVal)) return;

        const statusVal = pickRowField(row, ['وضعیت همکاری', 'وضعیت کلاینت فاکتور', 'وضعیت', 'status']);
        const importedSupplier: Supplier = {
          id: nextSupId(),
          periodId: activePeriodId,
          name: nameVal,
          phone: pickRowField(row, ['تلفن تماس', 'تلفن', 'شماره تماس', 'phone']) || '',
          address: pickRowField(row, ['آدرس فیزیکی', 'آدرس', 'نشانی', 'address']) || 'ثبت نشده',
          isActive: statusVal.includes('غیر') ? false : true,
          bankAccounts: [],
          suppliedItemIds: []
        };

        updatedSuppliers.push(importedSupplier);
        importCount++;
      });

      onUpdateDb({ ...db, suppliers: updatedSuppliers });
      feedback.success(`${toPersianDigits(importCount)} تامین‌کننده با موفقیت وارد شد.`);
    } catch (err) {
      console.error(err);
      feedback.error('خطا در خواندن فایل اکسل/CSV تامین‌کنندگان.');
    }
  };

  const clearAllSuppliers = () => {
    askConfirm(
      'حذف تمامی تامین‌کنندگان دوره',
      'آیا از حذف کلی تمامی تامین‌کنندگان ثبت‌شده در این دوره مالی اطمینان دارید؟',
      () => {
        const remainingSuppliers = db.suppliers.filter(s => s.periodId !== activePeriodId);
        onUpdateDb({ ...db, suppliers: remainingSuppliers });
        feedback.success('تامین‌کنندگان این دوره حذف شدند.');
      }
    );
  };

  const printSuppliersReport = () => {
    const el = document.getElementById('suppliers-printable-grid');
    if (el) {
      printElement('دفترچه تلفن و حساب‌های تامین‌کنندگان گاتان', el.outerHTML);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12 text-right font-sans" dir="rtl">
      {/* UNIFIED MODULE HEADER (Matching CustomerManagement) */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <ModuleHeader
          icon={<Users2 className="w-5 h-5" />}
          title="تامین‌کنندگان و حساب‌های بانکی"
          subtitle="مدیریت مشخصات تامین‌کنندگان، حساب‌های بانکی، شبا و اقلام تحت تامین هر دوره"
          periodName={activePeriodName}
          recordCount={suppliers.length}
          recordLabel="تامین‌کننده"
          actions={
            <ErpButton
              variant="secondary"
              size="sm"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => setShowCopyModal(true)}
            >
              {ERP_BUTTON_LABELS.copyFromPeriod}
            </ErpButton>
          }
        />
      </div>

      {/* MAIN CONTENT CARD (Matching CustomerProductionOrders / CustomerManagement) */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right" dir="rtl">
        {!isSupplierFormOpen ? (
          <>
            <KpiStrip
              items={[
                { label: 'کل تامین‌کنندگان ثبت‌شده', value: toPersianDigits(supplierStats.total), sublabel: 'پرونده', tone: 'default' },
                { label: 'تامین‌کنندگان فعال', value: toPersianDigits(supplierStats.activeCount), sublabel: 'در حال همکاری', tone: 'success' },
                { label: 'دارای حساب بانکی', value: toPersianDigits(supplierStats.withBankCount), sublabel: 'حساب ثبت‌شده', tone: 'info' },
                { label: 'اقلام تحت تامین', value: toPersianDigits(supplierStats.totalLinkedItems), sublabel: 'کالا / ماده اولیه', tone: 'warning' }
              ]}
            />

            <div className="space-y-3">
              <UnifiedToolbar
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="جستجو در نام، تلفن یا آدرس تامین‌کننده..."
                hasActiveFilters={Boolean(searchQuery || statusFilter !== 'all' || bankFilter !== 'all' || itemsFilter !== 'all')}
                onClearFilters={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setBankFilter('all');
                  setItemsFilter('all');
                }}
                onDownloadTemplate={downloadSampleSuppliersCSV}
                onImportExcel={importSuppliersFile}
                importAccept=".xlsx,.xls,.csv"
                onExportExcel={exportSuppliersCSV}
                onPrint={printSuppliersReport}
                extraSecondaryActions={
                  suppliers.length > 0 ? (
                    <ErpButton
                      variant="danger-subtle"
                      size="sm"
                      onClick={clearAllSuppliers}
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      حذف همه
                    </ErpButton>
                  ) : undefined
                }
                onAdd={startNewSupplier}
                addLabel={ERP_BUTTON_LABELS.add}
              />

              <UnifiedFilterBar>
                <div>
                  <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت همکاری</label>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as any)}
                    className={UNIFIED_FILTER_SELECT_CLASS}
                  >
                    <option value="all">همه وضعیت‌ها ({toPersianDigits(suppliers.length)})</option>
                    <option value="active">فعال ({toPersianDigits(supplierStats.activeCount)})</option>
                    <option value="inactive">غیرفعال ({toPersianDigits(suppliers.length - supplierStats.activeCount)})</option>
                  </select>
                </div>
                <div>
                  <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت حساب بانکی</label>
                  <select
                    value={bankFilter}
                    onChange={e => setBankFilter(e.target.value as any)}
                    className={UNIFIED_FILTER_SELECT_CLASS}
                  >
                    <option value="all">همه موارد</option>
                    <option value="has_bank">دارای حساب بانکی</option>
                    <option value="no_bank">بدون حساب بانکی</option>
                  </select>
                </div>
                <div>
                  <label className={UNIFIED_FILTER_LABEL_CLASS}>اقلام تحت تامین</label>
                  <select
                    value={itemsFilter}
                    onChange={e => setItemsFilter(e.target.value as any)}
                    className={UNIFIED_FILTER_SELECT_CLASS}
                  >
                    <option value="all">همه موارد</option>
                    <option value="has_items">دارای کالای متصل</option>
                    <option value="no_items">بدون کالای متصل</option>
                  </select>
                </div>
                <div>
                  <label className={UNIFIED_FILTER_LABEL_CLASS}>مرتب‌سازی</label>
                  <div className="flex gap-1">
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as any)}
                      className={`flex-grow ${UNIFIED_FILTER_SELECT_CLASS}`}
                    >
                      <option value="name">نام تامین‌کننده</option>
                      <option value="itemsCount">تعداد کالاها</option>
                      <option value="banksCount">تعداد حساب بانکی</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
                      title={sortOrder === 'asc' ? 'صعودی' : 'نزولی'}
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </UnifiedFilterBar>
            </div>

            {/* ================= DIRECTORY OF SUPPLIERS (FULL WIDTH) ================= */}
            <div id="suppliers-printable-grid" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchedSuppliers.length === 0 ? (
                <div className="md:col-span-2 xl:col-span-3">
                  <EmptyPeriodState
                    title={
                      suppliers.length === 0
                        ? 'در این دوره مالی تامین‌کننده‌ای ثبت نشده است'
                        : 'تامین‌کننده‌ای با عبارت جستجو یافت نشد'
                    }
                    description={
                      suppliers.length === 0
                        ? 'با زدن دکمه افزودن، تامین‌کننده جدید ثبت کنید یا لیست تامین‌کنندگان را از دوره‌های قبلی کپی کنید.'
                        : 'عبارت جستجو را تغییر دهید یا فیلتر را پاک کنید.'
                    }
                    onAdd={startNewSupplier}
                    addLabel="افزودن تامین‌کننده جدید"
                    onCopyFromPeriod={suppliers.length === 0 ? () => setShowCopyModal(true) : undefined}
                  />
                </div>
              ) : (
                searchedSuppliers.map(s => (
                  <div 
                    key={s.id} 
                    className={`border p-5 rounded-2xl transition-all relative ${
                      s.isActive 
                        ? 'bg-slate-950 border-slate-800 hover:border-slate-700' 
                        : 'border-slate-900 bg-slate-950/40 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <strong className="text-base font-black text-slate-100 block">{s.name}</strong>
                      <StatusText tone={s.isActive ? 'success' : 'neutral'}>
                        {s.isActive ? 'فعال' : 'غیرفعال'}
                      </StatusText>
                    </div>

                    {/* General details */}
                    <div className="space-y-2 text-xs text-slate-400 mb-4 border-b border-slate-900 pb-3">
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-slate-500" />
                        <span>شماره تماس: <strong className="font-bold font-mono text-slate-200">{s.phone || '-'}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-slate-500" />
                        <span className="truncate" title={s.address}>آدرس: <strong className="text-slate-200">{s.address || 'ثبت نشده'}</strong></span>
                      </div>
                    </div>

                    {/* Nested bank accounts */}
                    {s.bankAccounts && s.bankAccounts.length > 0 && (
                      <div className="space-y-2 mb-4">
                        <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wide">اطلاعات حساب بانکی متصل جهت حواله:</span>
                        {s.bankAccounts.map((ac, index) => (
                          <div key={index} className="bg-slate-900/50 border border-slate-850 p-3 rounded-2xl text-xs space-y-1 font-mono shadow-inner">
                            <div className="flex justify-between text-[11px] font-bold text-slate-350 border-b border-slate-950 pb-1">
                              <span className="flex items-center gap-1 text-rose-400"><Banknote className="h-3.5 w-3.5" /> {ac.bankName}</span>
                              <span>حساب: {ac.accountNo}</span>
                            </div>
                            {ac.shaba && (
                              <div className="text-[10px] text-slate-500 text-left" dir="ltr">
                                IBAN: <strong className="text-slate-400">{ac.shaba}</strong>
                              </div>
                            )}
                            {ac.cardNo && (
                              <div className="text-[10px] text-slate-500 text-left" dir="ltr">
                                CARD: <strong className="text-slate-400">{ac.cardNo}</strong>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Supplied Items indicators */}
                    {s.suppliedItemIds && s.suppliedItemIds.length > 0 && (
                      <div className="space-y-1.5 mb-4">
                        <span className="text-[10px] font-bold text-slate-550 block">مواد اولیه تحت تامین:</span>
                        <div className="flex flex-wrap gap-1">
                          {s.suppliedItemIds.map(id => {
                            const name = itemMap[id];
                            if (!name) return null;
                            return (
                              <span key={id} className="text-[10px] font-bold bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20">
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-900 mt-2">
                      <ErpButton
                        variant="secondary"
                        size="sm"
                        onClick={() => startEditSupplier(s)}
                      >
                        {ERP_BUTTON_LABELS.edit}
                      </ErpButton>
                      <ErpButton
                        variant="danger-subtle"
                        size="sm"
                        onClick={() => deleteSupplier(s.id)}
                      >
                        {ERP_BUTTON_LABELS.delete}
                      </ErpButton>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* ================= FULL-WIDTH FORM BUILDER FOR SUPPLIER (Matching CustomerManagement) ================= */
          <div className="bg-slate-950/60 p-5 sm:p-6 rounded-2xl border border-slate-800 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
                  {editingSupplier ? <Save className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-100">
                    {editingSupplier ? `ویرایش تامین‌کننده: ${editingSupplier.name}` : 'تعریف و ثبت تامین‌کننده جدید'}
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    اطلاعات تماس، نشانی، حساب‌های بانکی و کالاهای تحت تامین را وارد کنید.
                  </span>
                </div>
              </div>
              <ErpButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  resetSupplierForm();
                  setIsSupplierFormOpen(false);
                }}
                icon={<X className="h-4 w-4" />}
              >
                انصراف و بازگشت
              </ErpButton>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-5">
              <div>
                <label htmlFor="sup-name" className="block text-[10px] font-semibold text-slate-400 mb-1">نام شخص یا شرکت تامین کننده</label>
                <input
                  id="sup-name"
                  type="text"
                  className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-xs font-bold text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                  placeholder="تولیدی جهان آرد"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  required
                />
              </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sup-phone" className="block text-[10px] font-semibold text-slate-400 mb-1">تلفن یا شماره تماس</label>
                <input
                  id="sup-phone"
                  type="text"
                  className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-xs font-mono text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                  placeholder="۰۲۱..."
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">وضعیت همکاری</label>
                <div className="flex items-center gap-2 h-[42px]">
                  <input
                    id="sup-active-check"
                    type="checkbox"
                    className="rounded text-rose-600 focus:ring-rose-500 h-4 w-4 bg-slate-950 border-slate-800 cursor-pointer"
                    checked={supActive}
                    onChange={(e) => setSupActive(e.target.checked)}
                  />
                  <label htmlFor="sup-active-check" className="text-xs font-bold text-slate-450 cursor-pointer select-none">همکاری فعال باشد</label>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="sup-address" className="block text-[10px] font-semibold text-slate-400 mb-1">آدرس پستی یا فیزیکی دبارتمان</label>
              <input
                id="sup-address"
                type="text"
                className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-xs text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                placeholder="تهران / شهرک صنعتی غرب..."
                value={supAddress}
                onChange={(e) => setSupAddress(e.target.value)}
              />
            </div>

            {/* NESTED DYNAMIC BANKING INTERFACE */}
            <div className="border border-slate-850 p-4 rounded-2xl bg-slate-900/40 space-y-3">
              <h4 className="text-[11px] font-black text-slate-200 flex items-center gap-1.5 border-b border-slate-900 pb-2">
                <CreditCard className="h-4 w-4 text-emerald-400" /> گزینه‌های کارت و شبای بانکی پرداخت
              </h4>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="bank-name-select" className="text-[9px] font-semibold text-slate-400 block mb-1">نام بانک</label>
                  <select
                    id="bank-name-select"
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  >
                    <option value="بانک ملی">بانک ملی</option>
                    <option value="بانک رفاه">بانک رفاه</option>
                    <option value="بانک صادرات">بانک صادرات</option>
                    <option value="بانک تجارت">بانک تجارت</option>
                    <option value="بانک سامان">بانک سامان</option>
                    <option value="بانک ملت">بانک ملت</option>
                    <option value="بانک پاسارگاد">بانک پاسارگاد</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="bank-acc-no" className="text-[9px] font-semibold text-slate-400 block mb-1">شماره حساب</label>
                  <input
                    id="bank-acc-no"
                    type="text"
                    onFocus={handleFocus}
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs font-mono bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    placeholder="شماره حساب..."
                    value={accountNo}
                    onChange={(e) => setAccountNo(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="bank-shaba" className="text-[9px] font-semibold text-slate-400 block mb-1">شماره شبا (IR با ۲۴ رقم)</label>
                <input
                  id="bank-shaba"
                  type="text"
                  onFocus={handleFocus}
                  className="w-full p-2 border border-slate-800 rounded-xl text-xs font-mono tracking-wider bg-slate-950 text-white text-left outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  placeholder="IR..."
                  value={shaba}
                  onChange={(e) => setShaba(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="bank-card" className="text-[9px] font-semibold text-slate-400 block mb-1">شماره کارت ۱۶ رقمی بانکی</label>
                <input
                  id="bank-card"
                  type="text"
                  maxLength={19}
                  onFocus={handleFocus}
                  className="w-full p-2 border border-slate-800 rounded-xl text-xs font-mono tracking-widest bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  placeholder="---- ---- ---- ----"
                  value={cardNo}
                  onChange={(e) => setCardNo(e.target.value)}
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={addBankAccountToDraft}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-755 border border-slate-700 text-slate-300 hover:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer"
                >
                  افزودن حساب متصل
                </button>
              </div>

              {/* Added bank accounts listing indicator */}
              {bankAccounts.length > 0 && (
                <div className="border border-slate-850 rounded-2xl bg-slate-950 p-3 space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-400 pb-1 border-b border-slate-900">حساب‌های پرداخت موقت:</div>
                  {bankAccounts.map((ac, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-900/40 border border-slate-800/80 p-2 rounded-xl text-slate-200">
                      <span className="font-bold">{ac.bankName} - {ac.accountNo}</span>
                      <button
                        type="button"
                        onClick={() => removeBankAccountFromDraft(idx)}
                        className="text-rose-450 hover:text-rose-350 p-0.5 cursor-pointer transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SUPPLIED ITEMS LINKING SECTION */}
            <div className="border border-slate-850 p-4 rounded-2xl bg-slate-900/40 space-y-2">
              <h4 className="text-[11px] font-black text-slate-200 flex items-center gap-1.5">
                <ListPlus className="h-4 w-4 text-emerald-400" /> انتخاب کالاها/مواد اولیه عرضه شده
              </h4>
              <p className="text-[10px] text-slate-450">گزینه‌های ذیل با فعال‌سازی در انبار نمایش داده خواهند شد:</p>

              {activeItems.length > 0 && (
                <div className="relative mt-2 mb-1">
                  <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-slate-550" />
                  </span>
                  <input
                    type="text"
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    placeholder="جستجوی سریع کالا/رکورد..."
                    className="w-full pr-8 pl-8 py-1.5 text-[11px] border border-slate-800 rounded-xl bg-slate-950 text-slate-200 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-colors"
                  />
                  {itemSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setItemSearchQuery('')}
                      className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              <div className="max-h-40 overflow-y-auto divide-y divide-slate-900 pr-1.5 scrollbar-thin">
                {activeItems.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-4">کالای در انبار تعریف نشده است.</div>
                ) : filteredActiveItems.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-4">کالایی با این نام یافت نشد.</div>
                ) : (
                  filteredActiveItems.map((item, idx) => (
                     <label key={`${item.id}-${idx}`} className="flex items-center gap-2 py-2 cursor-pointer hover:bg-slate-900/30">
                      <input
                        type="checkbox"
                        className="rounded text-rose-600 focus:ring-rose-500 h-3.5 w-3.5 bg-slate-950 border-slate-800"
                        checked={supItems.includes(item.id)}
                        onChange={() => toggleItemSupply(item.id)}
                      />
                      <span className="text-xs font-medium text-slate-300">{item.name} ({item.code})</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Form actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <ErpButton
                type="button"
                variant="secondary"
                onClick={() => {
                  resetSupplierForm();
                  setIsSupplierFormOpen(false);
                }}
              >
                {ERP_BUTTON_LABELS.cancel}
              </ErpButton>
              <ErpButton
                type="submit"
                variant="primary"
                icon={editingSupplier ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              >
                {editingSupplier ? 'ذخیره تغییرات تامین‌کننده' : 'ثبت نهایی تامین‌کننده جدید'}
              </ErpButton>
            </div>
          </form>
        </div>
        )}
      </div>

      <CopyFromPeriodModal
        open={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        targetPeriodId={activePeriodId}
        section="suppliers"
        onUpdateDb={onUpdateDb}
      />

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-right">
            <h3 className="text-sm font-bold text-slate-100 mb-2">{confirmModal.title}</h3>
            <p className="text-xs text-slate-400 leading-6 mb-5">{confirmModal.message}</p>
            <div className="flex justify-end gap-2">
              <ErpButton variant="secondary" onClick={() => setConfirmModal(null)}>
                {ERP_BUTTON_LABELS.cancel}
              </ErpButton>
              <ErpButton
                variant="danger"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                {ERP_BUTTON_LABELS.delete}
              </ErpButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
