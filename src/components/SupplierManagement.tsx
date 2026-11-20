/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Supplier, SupplierBankAccount, Item } from '../types';
import { 
  Plus, Search, Edit2, Trash2, CheckCircle, XCircle, FileSpreadsheet, 
  Printer, Save, Phone, MapPin, CreditCard, Banknote, ListPlus, X, AlertTriangle, Download 
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
} from '../utils/persianUtils';
import { decodeFileBuffer, parseCSVText } from '../utils/csvUtils';

interface SupplierManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

export default function SupplierManagement({ db, onUpdateDb, activePeriodId }: SupplierManagementProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

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

  const searchedSuppliers = useMemo(() => {
    if (!searchQuery) return suppliers;
    return suppliers.filter(s => 
      matchPersianString(s.name, searchQuery) || 
      matchPersianString(s.phone, searchQuery) || 
      matchPersianString(s.address, searchQuery)
    );
  }, [suppliers, searchQuery]);


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
      alert('لطفا شماره حساب بانکی را وارد نمایید.');
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
      alert('وارد کردن نام تامین‌کننده الزامی است.');
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
          id: `sup-${Date.now()}`,
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

    // Reset Form states
    setSupName('');
    setSupPhone('');
    setSupAddress('');
    setSupActive(true);
    setBankAccounts([]);
    setSupItems([]);
    setItemSearchQuery('');
  };

  const startEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setSupName(supplier.name);
    setSupPhone(supplier.phone);
    setSupAddress(supplier.address);
    setSupActive(supplier.isActive);
    setBankAccounts(supplier.bankAccounts || []);
    setSupItems(supplier.suppliedItemIds || []);
  };

  const deleteSupplier = (id: string) => {
    askConfirm(
      'حذف تامین‌کننده کالا',
      'آیا مایل به حذف این تامین‌کننده هستید؟ تمامی رکوردهای خریدهای قبلی از ایشان به قوت خود باقی خواهند ماند اما نام ایشان از لیست تامین کارهای جدید برداشته می‌شود.',
      () => {
        onUpdateDb({
          ...db,
          suppliers: db.suppliers.filter(s => s.id !== id)
        });
      }
    );
  };

  const exportSuppliersCSV = () => {
    const headers = [
      'نام تامین کننده', 'تلفن تماس', 'آدرس فیزیکی', 'وضعیت کلاینت فاکتور', 
      'تعداد حساب‌های متصل', 'شماره حساب‌ها', 'شماره شبا‌ها', 'شماره کارت‌ها', 'کالاهای ارائه شونده'
    ];
    const rows = suppliers.map(s => {
      const suppliedInString = s.suppliedItemIds.map(id => itemMap[id] || '').filter(Boolean).join(' | ');
      const accountsStr = s.bankAccounts.map(a => `${a.bankName}: ${a.accountNo}`).join(' ; ');
      const shabaStr = s.bankAccounts.map(a => a.shaba).join(' ; ');
      const cardsStr = s.bankAccounts.map(a => a.cardNo).join(' ; ');
      
      return [
        s.name,
        s.phone,
        s.address,
        s.isActive ? 'فعال' : 'غیرفعال',
        s.bankAccounts.length,
        accountsStr,
        shabaStr,
        cardsStr,
        suppliedInString
      ];
    });

    downloadCSV('Gatan_Suppliers_Directory', headers, rows);
  };

  const downloadSampleSuppliersCSV = () => {
    const headers = ['نام تامین کننده', 'تلفن تماس', 'آدرس فیزیکی', 'وضعیت کلاینت فاکتور'];
    const rows = [
      ['کارخانه آرد سپهر یزد', '03531234567', 'یزد، شهرک صنعتی، بلوار گلستان', 'فعال'],
      ['مجتمع صنایع قند و شکر پیروز', '02188887777', 'تهران، خیابان ولیعصر، برج نیلوفر', 'فعال'],
      ['بازرگانی پلاستیک جم', '02155554444', 'تهران، بازار پله نوروزخان', 'فعال']
    ];
    downloadCSV('Sample_Gatan_Suppliers', headers, rows);
  };

  const importSuppliersCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updatedSuppliers = [...db.suppliers];
      let importCount = 0;

      rows.forEach((row, index) => {
        if (index === 0 || row.length === 0) return;
        const nameVal = row[0];
        if (!nameVal) return;

        // Skip duplicate name in same period
        if (updatedSuppliers.some(s => s.periodId === activePeriodId && s.name === nameVal)) return;

        const importedSupplier: Supplier = {
          id: `sup-import-${Date.now()}-${index}`,
          periodId: activePeriodId,
          name: nameVal,
          phone: row[1] || '۰',
          address: row[2] || 'ثبت نشده',
          isActive: row[3]?.includes('غیر') ? false : true,
          bankAccounts: [], // Custom blank bank setup
          suppliedItemIds: []
        };

        updatedSuppliers.push(importedSupplier);
        importCount++;
      });

      onUpdateDb({ ...db, suppliers: updatedSuppliers });
      alert(`${importCount} تامین کننده با موفقیت به انبار سامانه گاتان ملحق شد.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const clearAllSuppliers = () => {
    askConfirm(
      'حذف عمومی تمای تامین‌کنندگان',
      'آیا از حذف کلی تمامی تامین‌کنندگان ثبت شده در این دوره مالی اطمینان دارید؟ تمام رکوردهای بانکی و آدرس‌ها حذف خواهند شد.',
      () => {
        const remainingSuppliers = db.suppliers.filter(s => s.periodId !== activePeriodId);
        onUpdateDb({ ...db, suppliers: remainingSuppliers });
      }
    );
  };

  const printSuppliersReport = () => {
    const el = document.getElementById('suppliers-printable-grid');
    if (el) {
      printElement('دفترچه تلفن و حساب‌های تامین کنندگان گاتان', el.outerHTML);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl min-h-[600px] shadow-2xl font-sans p-3 sm:p-6 animate-fade-in text-right selection:bg-rose-500 selection:text-white" dir="rtl">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 sm:pb-4 mb-4 sm:mb-6 gap-2.5 sm:gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 text-emerald-400 p-2 sm:p-2.5 rounded-2xl border border-emerald-500/15 shrink-0">
            <Plus className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base sm:text-xl font-black text-white">
              دفترچه و حساب‌های بانکی تامین کنندگان
            </h2>
            <p className="hidden sm:block text-xs text-slate-400 mt-1">مدیریت مشخصات خریداران کالا، شماره حساب کارت‌ها، شباهای متصل و کالاهای تحت تملک</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={printSuppliersReport}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750 hover:text-white rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98 shadow-sm"
          >
            <Printer className="h-4 w-4 text-slate-400" /> چاپ لیست ملحقی
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* ================= FORM BUILDER FOR SUPPLIER ================= */}
        <div className="bg-slate-950 p-6 rounded-3xl border border-slate-850 h-fit space-y-4 shadow-md">
          <h3 className="text-xs font-black text-slate-250 uppercase tracking-wider border-b border-slate-900 pb-2">
            {editingSupplier ? `ویرایش تامین‌کننده: ${editingSupplier.name}` : 'افزودن تامین‌کننده جدید'}
          </h3>

          <form onSubmit={handleSaveSupplier} className="space-y-4">
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
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-gradient-to-r from-rose-600 to-rose-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-rose-600/10 hover:from-rose-500 hover:to-rose-400 cursor-pointer text-xs transition-all active:scale-98"
              >
                {editingSupplier ? 'اعمال ویرایش‌ها' : 'افزودن تامین‌کننده'}
              </button>
              {editingSupplier && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSupplier(null);
                    setSupName('');
                    setSupPhone('');
                    setSupAddress('');
                    setBankAccounts([]);
                    setSupItems([]);
                    setItemSearchQuery('');
                  }}
                  className="px-4 py-3 border border-slate-800 text-slate-300 rounded-xl bg-slate-900 text-xs transition-colors hover:bg-slate-800 hover:text-white cursor-pointer font-bold"
                >
                  انصراف
                </button>
              )}
            </div>
          </form>
        </div>


        {/* ================= DIRECTORY OF SUPPLIERS ================= */}
        <div className="xl:col-span-2 space-y-4">
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-4 rounded-3xl border border-slate-850 shadow-sm">
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                id="supplier-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو تامین‌کننده (نام، تلفن، آدرس)..."
                className="w-full pr-10 pl-3 py-2.5 text-xs border border-slate-800 rounded-xl bg-slate-900/60 text-slate-200 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={downloadSampleSuppliersCSV}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98"
                title="دانلود فایل اکسل نمونه برای وارد کردن تامین‌کنندگان"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" /> نمونه اکسل
              </button>
              <button
                onClick={exportSuppliersCSV}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600/10 border border-emerald-500/20 hover:bg-emerald-600 hover:text-white text-emerald-400 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-98"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" /> خروجی اکسل
              </button>
              <label className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600 hover:text-white text-blue-400 rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98">
                <Plus className="h-3.5 w-3.5 text-blue-400" /> واردات اکسل
                <input
                  id="supplier-import-file"
                  type="file"
                  accept=".csv"
                  onChange={importSuppliersCSV}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={clearAllSuppliers}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-950/20 text-rose-400 border border-rose-900/30 rounded-xl text-xs font-bold transition-all cursor-pointer hover:bg-rose-900 hover:text-white active:scale-98"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400" /> حذف کلی
              </button>
            </div>
          </div>

          <div id="suppliers-printable-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {searchedSuppliers.length === 0 ? (
              <div className="md:col-span-2 text-center p-12 text-slate-500 bg-slate-950 border border-slate-850 rounded-3xl">
                اطلاعات تامین‌کننده‌ای با فیلتر شما مطابقت ندارد.
              </div>
            ) : (
              searchedSuppliers.map(s => (
                <div 
                  key={s.id} 
                  className={`border p-5 rounded-3xl transition-all relative shadow-sm ${
                    s.isActive 
                      ? 'bg-slate-950 border-slate-850 hover:border-slate-800' 
                      : 'border-slate-900 bg-slate-950/40 text-slate-550'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <strong className="text-base font-black text-slate-100 block">{s.name}</strong>
                    
                    {s.isActive ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/25">
                        <CheckCircle className="h-3 w-3" /> فعال
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-900 px-2.5 py-0.5 rounded-full border border-slate-800/80">
                        <XCircle className="h-3 w-3" /> غیرفعال
                      </span>
                    )}
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
                    <button
                      onClick={() => startEditSupplier(s)}
                      className="p-1.5 px-3 border border-slate-800 text-slate-300 rounded-xl hover:bg-slate-800 hover:text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Edit2 className="h-3.5 w-3.5" /> ویرایش ردیف
                    </button>
                    <button
                      onClick={() => deleteSupplier(s.id)}
                      className="p-1.5 px-3 border border-rose-950/40 text-rose-400 rounded-xl hover:bg-rose-950/20 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 animate-pulse" /> حذف تامین‌کننده
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn animate-duration-200" dir="rtl">
          <div className="bg-slate-950 border border-slate-850 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-right animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-500 mb-4">
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/25 rounded-2xl">
                <AlertTriangle className="h-6 w-6 text-rose-500 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-slate-100">{confirmModal.title}</h3>
            </div>
            
            <p className="text-xs text-slate-350 leading-relaxed font-semibold mb-6">
              {confirmModal.message}
            </p>
            
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-850 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg border border-rose-500/20 transition-all cursor-pointer"
              >
                تایید و حذف قطعی
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
