/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AppDatabase,
  Customer,
  CustomerProductionOrder,
  CustomerProductionOrderItem,
  CustomerProductionOrderStatus,
  Product,
  TreasuryReceipt
} from '../types';
import {
  toPersianDigits,
  toEnglishDigits,
  formatWithCommas,
  parseNumber,
  printThermalReceipt,
  matchPersianString,
  getTodayJalali
} from '../utils/persianUtils';
import ShamsiDatePicker from './ShamsiDatePicker';
import {
  Plus,
  Trash2,
  Pencil,
  Printer,
  Search,
  UserPlus,
  UserCheck,
  Phone,
  MapPin,
  Calendar,
  Clock,
  Camera,
  Image as ImageIcon,
  MessageSquareText,
  CheckCircle,
  AlertTriangle,
  Info,
  X,
  Truck,
  Store,
  Wallet,
  Building2,
  ClipboardList,
  Receipt,
  Sparkles,
  ChefHat,
  PackageCheck,
  Ban,
  Eye,
  Check,
  ChevronDown
} from 'lucide-react';

interface CustomerProductionOrdersProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  currentUserName?: string;
}

const DEFAULT_WORKSHOP_DEPARTMENTS = [
  { id: 'dept-pastry', name: 'قنادی و کیک سفارشی' },
  { id: 'dept-bakery', name: 'نانوایی و خمیر' },
  { id: 'dept-fingerfood', name: 'فینگرفود و پذیرایی' },
  { id: 'dept-cafe', name: 'کافه و نوشیدنی' }
];

const UNIT_OPTIONS = ['عدد', 'کیلوگرم', 'سینی', 'جعبه', 'بسته', 'پرس'];

const QUICK_DELIVERY_TIMES = ['09:00', '11:00', '13:00', '16:00', '18:00', '20:00'];

const STATUS_META: Record<
  CustomerProductionOrderStatus,
  {
    label: string;
    shortLabel: string;
    badgeClass: string;
    nextStatus?: CustomerProductionOrderStatus;
    nextLabel?: string;
  }
> = {
  registered: {
    label: 'ثبت‌شده',
    shortLabel: 'ثبت‌شده',
    badgeClass:
      'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
    nextStatus: 'in_production',
    nextLabel: 'شروع تولید'
  },
  in_production: {
    label: 'در حال تولید',
    shortLabel: 'در تولید',
    badgeClass:
      'bg-sky-50 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-500/30',
    nextStatus: 'ready',
    nextLabel: 'آماده تحویل'
  },
  ready: {
    label: 'آماده تحویل',
    shortLabel: 'آماده',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30',
    nextStatus: 'delivered',
    nextLabel: 'ثبت تحویل'
  },
  delivered: {
    label: 'تحویل‌شده',
    shortLabel: 'تحویل شد',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
  },
  cancelled: {
    label: 'لغو شده',
    shortLabel: 'لغو شده',
    badgeClass:
      'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30'
  }
};

function normalizeJalaliSortable(dateStr?: string): string {
  if (!dateStr) return '9999/99/99';
  const en = toEnglishDigits(String(dateStr)).trim();
  const parts = en.split(/[\/\-]/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    return `${parts[0].padStart(4, '0')}/${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}`;
  }
  return en;
}

function addDaysToJalaliSimple(dateStr: string, days: number): string {
  const en = toEnglishDigits(dateStr);
  const parts = en.split('/').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  let [y, m, d] = parts;
  d += days;
  while (true) {
    const maxDay = m <= 6 ? 31 : m <= 11 ? 30 : 29;
    if (d <= maxDay) break;
    d -= maxDay;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

function deriveOverallOrderStatus(items: CustomerProductionOrderItem[], currentStatus?: CustomerProductionOrderStatus): CustomerProductionOrderStatus {
  if (currentStatus === 'cancelled') return 'cancelled';
  if (!items || items.length === 0) return 'registered';
  const activeItems = items.filter(it => it.itemStatus !== 'cancelled');
  if (activeItems.length === 0) return 'cancelled';
  if (activeItems.every(it => it.itemStatus === 'delivered')) return 'delivered';
  if (activeItems.every(it => it.itemStatus === 'ready' || it.itemStatus === 'delivered')) return 'ready';
  if (activeItems.some(it => it.itemStatus === 'in_production' || it.itemStatus === 'ready' || it.itemStatus === 'delivered')) {
    return 'in_production';
  }
  return 'registered';
}

function generateLineId(): string {
  return `cpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Client-side Canvas image compression so sample photos stay crisp yet lightweight for VPS PostgreSQL storage
function compressImageFile(file: File, maxDimension = 920, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('خطا در خواندن فایل تصویر'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('فرمت تصویر نامعتبر است'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value?: string | null): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAYMENT_METHOD_LABELS: Record<'cash' | 'pos' | 'bank_transfer' | 'cheque', string> = {
  pos: 'کارتخوان (POS)',
  bank_transfer: 'کارت‌به‌کارت / واریز بانکی',
  cash: 'نقدی',
  cheque: 'چک'
};

interface SearchableProductPickerProps {
  products: Product[];
  selectedProductId?: string;
  categoryMap: Record<string, { name: string; departmentId?: string }>;
  departmentMap: Record<string, string>;
  onSelect: (productId: string) => void;
}

function SearchableProductPicker({
  products,
  selectedProductId,
  categoryMap,
  departmentMap,
  onSelect
}: SearchableProductPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedProduct = useMemo(
    () => (selectedProductId ? products.find(p => p.id === selectedProductId) : undefined),
    [products, selectedProductId]
  );

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filteredProducts = useMemo(() => {
    const q = query.trim();
    if (!q) return products.slice(0, 40);
    return products
      .filter(p => {
        const catName = categoryMap[p.categoryId]?.name || '';
        return (
          matchPersianString(p.name, q) ||
          matchPersianString(p.code || '', q) ||
          matchPersianString(catName, q)
        );
      })
      .slice(0, 40);
  }, [products, query, categoryMap]);

  const handleChoose = (productId: string) => {
    onSelect(productId);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <span className="absolute right-2.5 flex items-center pointer-events-none text-slate-400">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? query : selectedProduct ? `${selectedProduct.name} (${selectedProduct.code})` : ''}
          onFocus={() => {
            setIsOpen(true);
            setQuery('');
          }}
          onChange={e => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          placeholder="جستجوی نام محصول، کد یا دسته‌بندی..."
          className="w-full pr-8 pl-14 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 placeholder:font-normal placeholder:text-slate-400"
        />
        <div className="absolute left-1.5 flex items-center gap-0.5">
          {(selectedProductId || query) && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                setQuery('');
                onSelect('');
                inputRef.current?.focus();
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/15 cursor-pointer"
              title="پاک کردن انتخاب محصول"
              aria-label="پاک کردن محصول انتخابی"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsOpen(prev => !prev);
              if (!isOpen) inputRef.current?.focus();
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            aria-label="باز کردن لیست محصولات"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-40 mt-1.5 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl divide-y divide-slate-100 dark:divide-slate-800">
          <button
            type="button"
            onClick={() => handleChoose('')}
            className={`w-full text-right px-3 py-2 text-[11px] font-bold flex items-center justify-between cursor-pointer transition-colors ${
              !selectedProductId
                ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <span>-- محصول سفارشی / ورود دستی --</span>
            {!selectedProductId && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>

          {filteredProducts.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
              محصولی با عبارت «{query}» یافت نشد — می‌توانید نام را در فیلد مجاور دستی وارد کنید.
            </div>
          ) : (
            filteredProducts.map(p => {
              const catInfo = categoryMap[p.categoryId];
              const deptName = catInfo?.departmentId ? departmentMap[catInfo.departmentId] : '';
              const price = Number(p.approvedPrice || p.salePrice || 0);
              const isSelected = p.id === selectedProductId;

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleChoose(p.id)}
                  className={`w-full text-right px-3 py-2 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-emerald-50 dark:bg-emerald-500/15'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                      <span>{p.name}</span>
                      {p.code && (
                        <span className="font-mono text-[10px] font-bold text-slate-400 shrink-0">
                          ({toPersianDigits(p.code)})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {catInfo?.name && <span>{catInfo.name}</span>}
                      {deptName && (
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                          · {deptName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex items-center gap-1.5">
                    {price > 0 && (
                      <span className="font-mono text-[10.5px] font-bold text-slate-700 dark:text-slate-300">
                        {toPersianDigits(formatWithCommas(price))}
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function createEmptyOrderLine(defaultDept: { id: string; name: string }): CustomerProductionOrderItem {
  return {
    lineId: generateLineId(),
    productId: undefined,
    productName: '',
    productCategoryName: '',
    departmentId: defaultDept.id,
    departmentName: defaultDept.name,
    quantity: 1,
    unit: 'عدد',
    weightOrSize: '',
    flavorOrFilling: '',
    needsInscription: false,
    inscriptionText: '',
    inscriptionStyle: '',
    sampleImages: [],
    estimatedUnitPrice: 0,
    totalPrice: 0,
    itemStatus: 'registered',
    itemNotes: ''
  };
}

export default function CustomerProductionOrders({
  db,
  onUpdateDb,
  activePeriodId,
  currentUserName = ''
}: CustomerProductionOrdersProps) {
  const todayJalali = useMemo(() => getTodayJalali(), []);
  const tomorrowJalali = useMemo(() => addDaysToJalaliSimple(todayJalali, 1), [todayJalali]);
  const next7DaysJalali = useMemo(() => addDaysToJalaliSimple(todayJalali, 7), [todayJalali]);

  // Sub-view mode: 'board' (Department Workbench) or 'form' (Create / Edit Order)
  const [viewMode, setViewMode] = useState<'board' | 'form'>('board');

  // Inline toast notification (zero window.alert)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'warning' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  // ==================== MASTER DATA ====================
  const periodDepartments = useMemo(() => {
    const depts = (db.departments || []).filter(d => !d.periodId || d.periodId === activePeriodId);
    if (depts.length > 0) {
      return depts.map(d => ({ id: d.id, name: d.name }));
    }
    return DEFAULT_WORKSHOP_DEPARTMENTS;
  }, [db.departments, activePeriodId]);

  const defaultDepartment = periodDepartments[0] || DEFAULT_WORKSHOP_DEPARTMENTS[0];

  const periodProducts = useMemo(() => {
    return (db.products || []).filter(p => p.periodId === activePeriodId);
  }, [db.products, activePeriodId]);

  const categoryMap = useMemo(() => {
    const map: Record<string, { name: string; departmentId?: string }> = {};
    (db.productCategories || []).forEach(c => {
      map[c.id] = { name: c.name, departmentId: c.departmentId };
    });
    return map;
  }, [db.productCategories]);

  const departmentMap = useMemo(() => {
    const map: Record<string, string> = {};
    periodDepartments.forEach(d => {
      map[d.id] = d.name;
    });
    return map;
  }, [periodDepartments]);

  const periodCustomers = useMemo(() => {
    return (db.customers || []).filter(c => (!c.periodId || c.periodId === activePeriodId) && c.isActive !== false);
  }, [db.customers, activePeriodId]);

  const customerCategories = useMemo(() => {
    const cats = (db.customerCategories || []).filter(c => !c.periodId || c.periodId === activePeriodId);
    if (cats.length > 0) return cats;
    return [
      { id: 'cc-retail', name: 'مشتریان حضوری / خرده‌فروشی' },
      { id: 'cc-vip', name: 'مشتریان VIP و مناسبتی' },
      { id: 'cc-corporate', name: 'سازمانی و کافه‌ها' }
    ];
  }, [db.customerCategories, activePeriodId]);

  const bankAccounts = useMemo(
    () => (db.bankAccounts || []).filter(b => b.isActive !== false),
    [db.bankAccounts]
  );
  const posTerminals = useMemo(
    () => (db.posTerminals || []).filter(p => p.isActive !== false),
    [db.posTerminals]
  );
  const cashDrawers = useMemo(
    () => (db.cashDrawers || []).filter(c => c.isActive !== false),
    [db.cashDrawers]
  );

  // ==================== ORDERS DATA ====================
  const periodOrders = useMemo(() => {
    return (db.customerProductionOrders || [])
      .filter(o => o.periodId === activePeriodId)
      .sort((a, b) => {
        const da = `${normalizeJalaliSortable(a.deliveryDate)} ${a.deliveryTime || '23:59'}`;
        const dbStr = `${normalizeJalaliSortable(b.deliveryDate)} ${b.deliveryTime || '23:59'}`;
        return da.localeCompare(dbStr);
      });
  }, [db.customerProductionOrders, activePeriodId]);

  // All departments referenced across configured departments + orders
  const filterDepartments = useMemo(() => {
    const map = new Map<string, string>();
    periodDepartments.forEach(d => map.set(d.id, d.name));
    periodOrders.forEach(o =>
      (o.items || []).forEach(it => {
        if (it.departmentId && !map.has(it.departmentId)) {
          map.set(it.departmentId, it.departmentName || 'سایر');
        }
      })
    );
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [periodDepartments, periodOrders]);

  // ==================== BOARD FILTERS ====================
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'active' | 'all' | CustomerProductionOrderStatus>('active');
  const [selectedDateRange, setSelectedDateRange] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all');
  const [boardSearch, setBoardSearch] = useState('');

  // Lightbox & Delete Modal State
  const [lightboxImage, setLightboxImage] = useState<{ src: string; caption: string } | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<CustomerProductionOrder | null>(null);

  // ==================== ORDER FORM STATE ====================
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCategoryId, setCustomerCategoryId] = useState('');
  const [customerCategoryName, setCustomerCategoryName] = useState('');

  // Quick Add New Customer inline panel
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');
  const [quickCustCategoryId, setQuickCustCategoryId] = useState('');
  const [quickCustAddress, setQuickCustAddress] = useState('');

  // Delivery & Recipient fields
  const [orderDate, setOrderDate] = useState(todayJalali);
  const [deliveryDate, setDeliveryDate] = useState(tomorrowJalali);
  const [deliveryTime, setDeliveryTime] = useState('17:00');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');

  // Order lines
  const [orderItems, setOrderItems] = useState<CustomerProductionOrderItem[]>(() => [
    createEmptyOrderLine(defaultDepartment)
  ]);
  const [compressingLineId, setCompressingLineId] = useState<string | null>(null);

  // Financial & Optional Treasury Receipt fields
  const [prepaymentAmount, setPrepaymentAmount] = useState<number>(0);
  const [prepaymentMethod, setPrepaymentMethod] = useState<'pos' | 'bank_transfer' | 'cash' | 'cheque'>('pos');
  const [postToTreasury, setPostToTreasury] = useState<boolean>(false);
  const [treasuryBankId, setTreasuryBankId] = useState<string>('');
  const [treasuryPosId, setTreasuryPosId] = useState<string>('');
  const [treasuryCashId, setTreasuryCashId] = useState<string>('');
  const [treasuryTrackingRef, setTreasuryTrackingRef] = useState<string>('');
  const [existingTreasuryReceiptNo, setExistingTreasuryReceiptNo] = useState<string | undefined>(undefined);
  const [existingTreasuryReceiptId, setExistingTreasuryReceiptId] = useState<string | undefined>(undefined);
  const [orderNotes, setOrderNotes] = useState('');

  const handleFocusSelect = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const resetForm = useCallback(() => {
    setEditingOrderId(null);
    setSelectedCustomerId('');
    setCustomerSearch('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCategoryId('');
    setCustomerCategoryName('');
    setShowQuickAddCustomer(false);
    setQuickCustName('');
    setQuickCustPhone('');
    setQuickCustCategoryId(customerCategories[0]?.id || '');
    setQuickCustAddress('');
    setOrderDate(todayJalali);
    setDeliveryDate(tomorrowJalali);
    setDeliveryTime('17:00');
    setDeliveryType('pickup');
    setDeliveryAddress('');
    setRecipientName('');
    setRecipientPhone('');
    setOrderItems([createEmptyOrderLine(defaultDepartment)]);
    setPrepaymentAmount(0);
    setPrepaymentMethod('pos');
    setPostToTreasury(false);
    setTreasuryBankId(bankAccounts[0]?.id || '');
    setTreasuryPosId(posTerminals[0]?.id || '');
    setTreasuryCashId(cashDrawers[0]?.id || '');
    setTreasuryTrackingRef('');
    setExistingTreasuryReceiptNo(undefined);
    setExistingTreasuryReceiptId(undefined);
    setOrderNotes('');
  }, [todayJalali, tomorrowJalali, defaultDepartment, customerCategories, bankAccounts, posTerminals, cashDrawers]);

  const openNewOrderForm = () => {
    resetForm();
    setViewMode('form');
  };

  const openEditOrderForm = (order: CustomerProductionOrder) => {
    setEditingOrderId(order.id);
    setSelectedCustomerId(order.customerId || '');
    setCustomerSearch('');
    setCustomerName(order.customerName);
    setCustomerPhone(order.customerPhone);
    setCustomerCategoryId(order.customerCategoryId || '');
    setCustomerCategoryName(order.customerCategoryName || '');
    setShowQuickAddCustomer(false);
    setOrderDate(order.orderDate || todayJalali);
    setDeliveryDate(order.deliveryDate || tomorrowJalali);
    setDeliveryTime(order.deliveryTime || '17:00');
    setDeliveryType(order.deliveryType || 'pickup');
    setDeliveryAddress(order.deliveryAddress || '');
    setRecipientName(order.recipientName || '');
    setRecipientPhone(order.recipientPhone || '');
    setOrderItems(
      (order.items || []).length > 0
        ? order.items.map(it => ({ ...it, sampleImages: [...(it.sampleImages || [])] }))
        : [createEmptyOrderLine(defaultDepartment)]
    );
    setPrepaymentAmount(order.prepaymentAmount || 0);
    setPrepaymentMethod(order.prepaymentMethod || 'pos');
    setPostToTreasury(false);
    setTreasuryBankId(bankAccounts[0]?.id || '');
    setTreasuryPosId(posTerminals[0]?.id || '');
    setTreasuryCashId(cashDrawers[0]?.id || '');
    setTreasuryTrackingRef('');
    setExistingTreasuryReceiptId(order.treasuryReceiptId);
    setExistingTreasuryReceiptNo(order.treasuryReceiptNo);
    setOrderNotes(order.notes || '');
    setViewMode('form');
  };

  // ==================== CUSTOMER SELECTION & QUICK-CREATE ====================
  const filteredCustomersForPicker = useMemo(() => {
    if (!customerSearch.trim()) return periodCustomers.slice(0, 12);
    return periodCustomers
      .filter(
        c =>
          matchPersianString(c.name, customerSearch) ||
          matchPersianString(c.phone || '', customerSearch) ||
          matchPersianString(c.code || '', customerSearch)
      )
      .slice(0, 15);
  }, [periodCustomers, customerSearch]);

  const handleSelectExistingCustomer = (cust: Customer) => {
    const catName = customerCategories.find(cc => cc.id === cust.categoryId)?.name || '';
    setSelectedCustomerId(cust.id);
    setCustomerName(cust.name);
    setCustomerPhone(cust.phone || '');
    setCustomerCategoryId(cust.categoryId || '');
    setCustomerCategoryName(catName);
    if (cust.deliveryAddress || cust.address) {
      setDeliveryAddress(cust.deliveryAddress || cust.address || '');
    }
    setCustomerSearch('');
    setShowQuickAddCustomer(false);
  };

  const handleQuickCreateCustomer = () => {
    if (!quickCustName.trim()) {
      showToast('warning', 'لطفاً نام مشتری جدید را وارد کنید.');
      return;
    }
    if (!quickCustPhone.trim()) {
      showToast('warning', 'لطفاً شماره تلفن همراه مشتری را وارد کنید.');
      return;
    }

    const chosenCatId = quickCustCategoryId || customerCategories[0]?.id || '';
    const chosenCatName = customerCategories.find(c => c.id === chosenCatId)?.name || '';
    const existingCount = (db.customers || []).length;
    const newCust: Customer = {
      id: `cust-${Date.now()}`,
      periodId: activePeriodId,
      code: `C-${101 + existingCount}`,
      name: quickCustName.trim(),
      type: 'حقیقی',
      categoryId: chosenCatId || undefined,
      phone: toEnglishDigits(quickCustPhone.trim()),
      address: quickCustAddress.trim() || '',
      deliveryAddress: quickCustAddress.trim() || undefined,
      isActive: true,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    onUpdateDb({
      ...db,
      customers: [...(db.customers || []), newCust]
    });

    setSelectedCustomerId(newCust.id);
    setCustomerName(newCust.name);
    setCustomerPhone(newCust.phone);
    setCustomerCategoryId(chosenCatId);
    setCustomerCategoryName(chosenCatName);
    if (quickCustAddress.trim()) {
      setDeliveryAddress(quickCustAddress.trim());
    }
    setShowQuickAddCustomer(false);
    setQuickCustName('');
    setQuickCustPhone('');
    setQuickCustAddress('');
    showToast('success', `مشتری «${newCust.name}» در فهرست مشتریان ذخیره و برای این سفارش انتخاب شد.`);
  };

  // ==================== ORDER ITEM LINE HANDLERS ====================
  const updateLine = (lineId: string, updater: (line: CustomerProductionOrderItem) => CustomerProductionOrderItem) => {
    setOrderItems(prev => prev.map(line => (line.lineId === lineId ? updater(line) : line)));
  };

  const handleSelectCatalogProductForLine = (lineId: string, productId: string) => {
    if (!productId) {
      updateLine(lineId, line => ({ ...line, productId: undefined }));
      return;
    }
    const prod = periodProducts.find(p => p.id === productId);
    if (!prod) return;

    const catInfo = categoryMap[prod.categoryId];
    const mappedDept = catInfo?.departmentId
      ? periodDepartments.find(d => d.id === catInfo.departmentId)
      : undefined;
    const unitPrice = Number(prod.approvedPrice || prod.salePrice || 0);
    const mappedUnit = prod.unit === 'کیلو' ? 'کیلوگرم' : 'عدد';

    updateLine(lineId, line => ({
      ...line,
      productId: prod.id,
      productName: prod.name,
      productCategoryName: catInfo?.name || line.productCategoryName,
      departmentId: mappedDept ? mappedDept.id : line.departmentId,
      departmentName: mappedDept ? mappedDept.name : line.departmentName,
      unit: mappedUnit,
      estimatedUnitPrice: unitPrice > 0 ? unitPrice : line.estimatedUnitPrice,
      totalPrice: line.quantity * (unitPrice > 0 ? unitPrice : line.estimatedUnitPrice)
    }));
  };

  const handleSelectDepartmentForLine = (lineId: string, deptId: string) => {
    const dept = periodDepartments.find(d => d.id === deptId);
    updateLine(lineId, line => ({
      ...line,
      departmentId: deptId,
      departmentName: dept?.name || line.departmentName
    }));
  };

  const handleUploadSampleImages = async (lineId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const currentLine = orderItems.find(l => l.lineId === lineId);
    const remainingSlots = Math.max(0, 3 - (currentLine?.sampleImages?.length || 0));
    if (remainingSlots === 0) {
      showToast('warning', 'حداکثر ۳ تصویر نمونه برای هر ردیف محصول قابل ثبت است.');
      return;
    }

    setCompressingLineId(lineId);
    try {
      const selectedFiles = Array.from(files).slice(0, remainingSlots);
      const compressedList: string[] = [];
      for (const f of selectedFiles) {
        if (!f.type.startsWith('image/')) continue;
        const dataUrl = await compressImageFile(f);
        if (dataUrl) compressedList.push(dataUrl);
      }
      if (compressedList.length > 0) {
        updateLine(lineId, line => ({
          ...line,
          sampleImages: [...(line.sampleImages || []), ...compressedList].slice(0, 3)
        }));
      }
    } catch {
      showToast('warning', 'بارگذاری یا فشرده‌سازی یکی از تصاویر با خطا مواجه شد.');
    } finally {
      setCompressingLineId(null);
    }
  };

  const removeSampleImage = (lineId: string, imgIdx: number) => {
    updateLine(lineId, line => ({
      ...line,
      sampleImages: (line.sampleImages || []).filter((_, i) => i !== imgIdx)
    }));
  };

  const addOrderLine = () => {
    setOrderItems(prev => [...prev, createEmptyOrderLine(defaultDepartment)]);
  };

  const removeOrderLine = (lineId: string) => {
    if (orderItems.length <= 1) {
      showToast('warning', 'سفارش باید حداقل شامل یک ردیف محصول باشد.');
      return;
    }
    setOrderItems(prev => prev.filter(l => l.lineId !== lineId));
  };

  // ==================== FINANCIAL TOTALS ====================
  const itemsSubtotal = useMemo(
    () => orderItems.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0),
    [orderItems]
  );
  const grandTotalAmount = itemsSubtotal;
  const calculatedRemainingAmount = Math.max(0, grandTotalAmount - (Number(prepaymentAmount) || 0));

  // ==================== SAVE ORDER (+ OPTIONAL TREASURY RECEIPT) ====================
  const handleSaveOrder = (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      showToast('warning', 'لطفاً مشتری را انتخاب کنید یا نام مشتری را وارد نمایید.');
      return;
    }
    if (!customerPhone.trim()) {
      showToast('warning', 'لطفاً شماره تماس مشتری را جهت هماهنگی تحویل وارد نمایید.');
      return;
    }
    if (!deliveryDate.trim()) {
      showToast('warning', 'لطفاً تاریخ تحویل سفارش را انتخاب کنید.');
      return;
    }

    const sanitizedItems = orderItems.map(it => ({
      ...it,
      productName: it.productName.trim(),
      quantity: Math.max(0, Number(it.quantity) || 0),
      estimatedUnitPrice: Math.max(0, Number(it.estimatedUnitPrice) || 0),
      totalPrice: Math.max(0, Number(it.quantity) || 0) * Math.max(0, Number(it.estimatedUnitPrice) || 0),
      inscriptionText: it.needsInscription ? (it.inscriptionText || '').trim() : undefined,
      inscriptionStyle: it.needsInscription ? (it.inscriptionStyle || '').trim() || undefined : undefined
    }));

    const missingProduct = sanitizedItems.find(it => !it.productName || it.quantity <= 0);
    if (missingProduct) {
      showToast('warning', 'نام محصول و تعداد سفارش (بزرگ‌تر از صفر) در تمام ردیف‌ها الزامی است.');
      return;
    }
    const missingInscription = sanitizedItems.find(it => it.needsInscription && !it.inscriptionText);
    if (missingInscription) {
      showToast('warning', `برای «${missingInscription.productName}» گزینه نوشتن جمله فعال است؛ لطفاً متن جمله را وارد کنید.`);
      return;
    }

    const nowIso = new Date().toISOString();
    const existingOrders = db.customerProductionOrders || [];
    const existingEditing = editingOrderId ? existingOrders.find(o => o.id === editingOrderId) : undefined;
    const orderNumber =
      existingEditing?.orderNumber ||
      `PO-${activePeriodId.replace(/[^0-9]/g, '').slice(-4) || '1405'}-${String(periodOrders.length + 1).padStart(3, '0')}`;

    // Optional Treasury Receipt creation (only if checked, prepayment > 0, and not already linked)
    let linkedReceiptId = existingTreasuryReceiptId;
    let linkedReceiptNo = existingTreasuryReceiptNo;
    let updatedReceipts = db.treasuryReceipts || [];

    if (postToTreasury && prepaymentAmount > 0 && !linkedReceiptId) {
      const receiptSeq = String(updatedReceipts.length + 1).padStart(3, '0');
      const newReceiptNo = `REC-PO-${receiptSeq}`;
      const nowTime = new Date().toTimeString().slice(0, 5);
      const newReceipt: TreasuryReceipt = {
        id: `trec-${Date.now()}`,
        periodId: activePeriodId,
        receiptNo: newReceiptNo,
        date: orderDate || todayJalali,
        time: nowTime,
        counterpartyType: 'customer',
        counterpartyId: selectedCustomerId || undefined,
        counterpartyName: customerName.trim(),
        paymentMethod: prepaymentMethod,
        amount: prepaymentAmount,
        cashDrawerId: prepaymentMethod === 'cash' ? treasuryCashId || cashDrawers[0]?.id : undefined,
        posTerminalId: prepaymentMethod === 'pos' ? treasuryPosId || posTerminals[0]?.id : undefined,
        posTrackingNo: prepaymentMethod === 'pos' ? treasuryTrackingRef.trim() || undefined : undefined,
        bankAccountId:
          prepaymentMethod === 'bank_transfer' || prepaymentMethod === 'pos'
            ? treasuryBankId || bankAccounts[0]?.id
            : undefined,
        bankTransferRef: prepaymentMethod === 'bank_transfer' ? treasuryTrackingRef.trim() || undefined : undefined,
        linkedInvoiceNo: orderNumber,
        category: 'پیش‌دریافت',
        description: `پیش‌پرداخت سفارش تولید ${orderNumber} - ${customerName.trim()} (${sanitizedItems.map(i => i.productName).join('، ')})`,
        registeredBy: currentUserName || undefined,
        status: 'confirmed',
        createdAt: nowIso
      };
      updatedReceipts = [...updatedReceipts, newReceipt];
      linkedReceiptId = newReceipt.id;
      linkedReceiptNo = newReceipt.receiptNo;
    }

    const computedStatus = deriveOverallOrderStatus(sanitizedItems, existingEditing?.status);

    const savedOrder: CustomerProductionOrder = {
      id: editingOrderId || `cpo-${Date.now()}`,
      orderNumber,
      periodId: activePeriodId,
      customerId: selectedCustomerId || undefined,
      customerName: customerName.trim(),
      customerPhone: toEnglishDigits(customerPhone.trim()),
      customerCategoryId: customerCategoryId || undefined,
      customerCategoryName: customerCategoryName || undefined,
      orderDate: orderDate || todayJalali,
      deliveryDate,
      deliveryTime: deliveryTime || '17:00',
      deliveryType,
      deliveryAddress: deliveryType === 'delivery' ? deliveryAddress.trim() || undefined : undefined,
      recipientName: recipientName.trim() || undefined,
      recipientPhone: recipientPhone.trim() ? toEnglishDigits(recipientPhone.trim()) : undefined,
      items: sanitizedItems,
      totalAmount: grandTotalAmount,
      prepaymentAmount: Number(prepaymentAmount) || 0,
      remainingAmount: calculatedRemainingAmount,
      prepaymentMethod: prepaymentAmount > 0 ? prepaymentMethod : undefined,
      treasuryReceiptId: linkedReceiptId,
      treasuryReceiptNo: linkedReceiptNo,
      status: computedStatus,
      notes: orderNotes.trim() || undefined,
      registeredBy: existingEditing?.registeredBy || currentUserName || undefined,
      createdAt: existingEditing?.createdAt || nowIso,
      updatedAt: nowIso
    };

    const nextOrders = editingOrderId
      ? existingOrders.map(o => (o.id === editingOrderId ? savedOrder : o))
      : [...existingOrders, savedOrder];

    onUpdateDb({
      ...db,
      customerProductionOrders: nextOrders,
      treasuryReceipts: updatedReceipts
    });

    showToast(
      'success',
      linkedReceiptNo && postToTreasury && !existingTreasuryReceiptId
        ? `سفارش تولید ${orderNumber} ثبت شد و سند پیش‌دریافت ${linkedReceiptNo} در خزانه‌داری صادر گردید.`
        : editingOrderId
        ? `تغییرات سفارش تولید ${orderNumber} با موفقیت ذخیره شد.`
        : `سفارش تولید ${orderNumber} با ${toPersianDigits(sanitizedItems.length)} ردیف محصول با موفقیت ثبت شد.`
    );
    resetForm();
    setViewMode('board');
  };

  // ==================== STATUS TRANSITIONS & DELETE ====================
  const handleUpdateLineStatus = (orderId: string, lineId: string, nextStatus: CustomerProductionOrderStatus) => {
    const updatedOrders = (db.customerProductionOrders || []).map(o => {
      if (o.id !== orderId) return o;
      const updatedItems = (o.items || []).map(it =>
        it.lineId === lineId ? { ...it, itemStatus: nextStatus } : it
      );
      return {
        ...o,
        items: updatedItems,
        status: deriveOverallOrderStatus(updatedItems),
        updatedAt: new Date().toISOString()
      };
    });
    onUpdateDb({ ...db, customerProductionOrders: updatedOrders });
    showToast('info', `وضعیت ردیف به «${STATUS_META[nextStatus].label}» تغییر یافت.`);
  };

  const handleSetOrderStatus = (orderId: string, nextStatus: CustomerProductionOrderStatus) => {
    const updatedOrders = (db.customerProductionOrders || []).map(o => {
      if (o.id !== orderId) return o;
      const updatedItems = (o.items || []).map(it => ({ ...it, itemStatus: nextStatus }));
      return {
        ...o,
        items: updatedItems,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      };
    });
    onUpdateDb({ ...db, customerProductionOrders: updatedOrders });
    showToast('info', `وضعیت کل سفارش به «${STATUS_META[nextStatus].label}» تغییر یافت.`);
  };

  const confirmDeleteOrder = () => {
    if (!deleteTargetOrder) return;
    onUpdateDb({
      ...db,
      customerProductionOrders: (db.customerProductionOrders || []).filter(o => o.id !== deleteTargetOrder.id)
    });
    showToast('info', `سفارش تولید ${deleteTargetOrder.orderNumber} حذف شد.`);
    setDeleteTargetOrder(null);
  };

  // ==================== BOARD METRICS & FILTERING ====================
  const todayNorm = normalizeJalaliSortable(todayJalali);
  const tomorrowNorm = normalizeJalaliSortable(tomorrowJalali);
  const next7Norm = normalizeJalaliSortable(next7DaysJalali);

  const boardStats = useMemo(() => {
    const activeOrders = periodOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
    const dueToday = activeOrders.filter(o => normalizeJalaliSortable(o.deliveryDate) === todayNorm).length;
    const inProd = activeOrders.filter(o => o.status === 'in_production').length;
    const readyCount = activeOrders.filter(o => o.status === 'ready').length;
    const totalRemaining = activeOrders.reduce((s, o) => s + (o.remainingAmount || 0), 0);
    const totalPrepayments = activeOrders.reduce((s, o) => s + (o.prepaymentAmount || 0), 0);

    const activeLineCountByDept: Record<string, number> = {};
    activeOrders.forEach(o => {
      (o.items || []).forEach(it => {
        if (it.itemStatus !== 'delivered' && it.itemStatus !== 'cancelled') {
          activeLineCountByDept[it.departmentId] = (activeLineCountByDept[it.departmentId] || 0) + 1;
        }
      });
    });

    return {
      activeCount: activeOrders.length,
      dueToday,
      inProd,
      readyCount,
      totalRemaining,
      totalPrepayments,
      activeLineCountByDept
    };
  }, [periodOrders, todayNorm]);

  const filteredOrders = useMemo(() => {
    return periodOrders.filter(order => {
      // Status filter
      if (selectedStatusFilter === 'active') {
        if (order.status === 'delivered' || order.status === 'cancelled') return false;
      } else if (selectedStatusFilter !== 'all') {
        const hasStatus =
          order.status === selectedStatusFilter ||
          (order.items || []).some(it => it.itemStatus === selectedStatusFilter);
        if (!hasStatus) return false;
      }

      // Department filter
      if (selectedDepartmentFilter !== 'ALL') {
        const matchesDept = (order.items || []).some(it => it.departmentId === selectedDepartmentFilter);
        if (!matchesDept) return false;
      }

      // Delivery Date filter
      const dNorm = normalizeJalaliSortable(order.deliveryDate);
      if (selectedDateRange === 'today' && dNorm !== todayNorm) return false;
      if (selectedDateRange === 'tomorrow' && dNorm !== tomorrowNorm) return false;
      if (selectedDateRange === 'week' && (dNorm < todayNorm || dNorm > next7Norm)) return false;

      // Search text
      if (!boardSearch.trim()) return true;
      return (
        matchPersianString(order.orderNumber, boardSearch) ||
        matchPersianString(order.customerName, boardSearch) ||
        matchPersianString(order.customerPhone, boardSearch) ||
        matchPersianString(order.recipientName || '', boardSearch) ||
        matchPersianString(order.recipientPhone || '', boardSearch) ||
        matchPersianString(order.notes || '', boardSearch) ||
        (order.items || []).some(
          it =>
            matchPersianString(it.productName, boardSearch) ||
            matchPersianString(it.departmentName, boardSearch) ||
            matchPersianString(it.inscriptionText || '', boardSearch) ||
            matchPersianString(it.flavorOrFilling || '', boardSearch)
        )
      );
    });
  }, [periodOrders, selectedStatusFilter, selectedDepartmentFilter, selectedDateRange, boardSearch, todayNorm, tomorrowNorm, next7Norm]);

  // ==================== 80mm THERMAL RECEIPT TEMPLATES ====================
  // 1. Workshop Production Ticket (ZERO customer/recipient info, high-contrast 80mm thermal POS format)
  const printProductionTicket = (order: CustomerProductionOrder, onlyDeptId?: string) => {
    const itemsToPrint =
      onlyDeptId && onlyDeptId !== 'ALL'
        ? (order.items || []).filter(it => it.departmentId === onlyDeptId)
        : order.items || [];

    const printTimestamp = `${toPersianDigits(getTodayJalali())} — ${toPersianDigits(
      new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    )}`;

    const itemsHtml = itemsToPrint
      .map(
        (it, idx) => `
      <div class="t-box t-avoid-break" style="margin-top: 8px; padding: 0; overflow: hidden;">
        <div style="background: #000000; color: #ffffff; padding: 4px 7px; display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; font-weight: 900;">
          <span>دپارتمان: ${escapeHtml(it.departmentName)}</span>
          <span class="t-mono">ردیف ${toPersianDigits(idx + 1)} از ${toPersianDigits(itemsToPrint.length)}</span>
        </div>

        <div style="padding: 7px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; border-bottom: 1.5px solid #000000; padding-bottom: 5px; margin-bottom: 6px;">
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 900; line-height: 1.35;">${escapeHtml(it.productName)}</div>
              ${
                it.productCategoryName
                  ? `<div style="font-size: 9.5px; font-weight: 700; margin-top: 1px;">گروه: ${escapeHtml(it.productCategoryName)}</div>`
                  : ''
              }
            </div>
            <div style="border: 2px solid #000000; border-radius: 4px; padding: 3px 7px; text-align: center; white-space: nowrap;">
              <div style="font-size: 14px; font-weight: 900; line-height: 1.1;">${toPersianDigits(it.quantity)}</div>
              <div style="font-size: 9px; font-weight: 800;">${escapeHtml(it.unit)}</div>
            </div>
          </div>

          <div style="font-size: 10.5px; line-height: 1.65;">
            <div class="t-kv">
              <span>وزن / سایز / نفر:</span>
              <strong>${escapeHtml(it.weightOrSize) || 'استاندارد'}</strong>
            </div>
            <div class="t-kv">
              <span>طعم / فیلینگ / حساسیت:</span>
              <strong>${escapeHtml(it.flavorOrFilling) || 'استاندارد'}</strong>
            </div>
          </div>

          ${
            it.needsInscription
              ? `<div class="t-box-double t-center" style="margin-top: 7px; padding: 6px;">
                  <div style="font-size: 9.5px; font-weight: 900; letter-spacing: 0.2px;">★ متن نوشته روی محصول ★</div>
                  <div style="font-size: 13.5px; font-weight: 900; margin-top: 4px; line-height: 1.45;">« ${escapeHtml(it.inscriptionText)} »</div>
                  ${
                    it.inscriptionStyle
                      ? `<div style="font-size: 9.5px; font-weight: 700; margin-top: 3px; border-top: 1px dashed #000000; padding-top: 3px;">رنگ / سبک نوشتار: ${escapeHtml(it.inscriptionStyle)}</div>`
                      : ''
                  }
                </div>`
              : `<div style="font-size: 10px; font-weight: 700; margin-top: 5px; padding-top: 4px; border-top: 1px dashed #000000;">نوشته روی محصول: نیاز ندارد</div>`
          }

          ${
            it.itemNotes
              ? `<div class="t-box-dashed" style="margin-top: 6px; font-size: 10.5px; line-height: 1.55;">
                  <div style="font-weight: 900; font-size: 9.5px;">توضیحات فنی کارگاه:</div>
                  <div style="font-weight: 700; margin-top: 2px;">${escapeHtml(it.itemNotes)}</div>
                </div>`
              : ''
          }

          ${
            (it.sampleImages || []).length > 0
              ? `<div style="margin-top: 7px; padding-top: 5px; border-top: 1px dashed #000000;">
                  <div style="font-size: 9.5px; font-weight: 900; margin-bottom: 3px;">تصویر نمونه درخواستی (${toPersianDigits(it.sampleImages.length)} مورد):</div>
                  ${it.sampleImages
                    .map(
                      (src, imgIdx) => `
                    <div style="margin-bottom: 4px;">
                      <img src="${src}" alt="نمونه ${toPersianDigits(imgIdx + 1)}" class="t-photo" />
                    </div>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
      </div>
    `
      )
      .join('');

    const html = `
      <div class="t-center" style="margin-bottom: 6px;">
        <div style="font-size: 15px; font-weight: 900; letter-spacing: -0.3px;">کارگاه تولید گاتان</div>
        <div class="t-bar" style="font-size: 12px; margin-top: 4px;">برگه دستور تولید کارگاه</div>
      </div>

      <div class="t-box-double" style="padding: 7px 8px;">
        <div class="t-kv" style="border-bottom: 1px dashed #000000; padding-bottom: 4px; margin-bottom: 5px;">
          <span style="font-size: 10.5px; font-weight: 800;">شماره سفارش:</span>
          <strong class="t-mono" style="font-size: 14px; font-weight: 900;">${escapeHtml(order.orderNumber)}</strong>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <div style="flex: 1; text-align: center; border-left: 1.5px solid #000000; padding-left: 6px;">
            <div style="font-size: 9.5px; font-weight: 800;">تاریخ تحویل</div>
            <div class="t-mono" style="font-size: 13.5px; font-weight: 900; margin-top: 2px;">${toPersianDigits(order.deliveryDate)}</div>
          </div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 9.5px; font-weight: 800;">ساعت تحویل</div>
            <div class="t-mono" style="font-size: 16px; font-weight: 900; margin-top: 1px;">${toPersianDigits(order.deliveryTime)}</div>
          </div>
        </div>

        <div class="t-center" style="margin-top: 5px; padding-top: 4px; border-top: 1px dashed #000000; font-size: 10px; font-weight: 900;">
          ${order.deliveryType === 'delivery' ? 'نوع بسته‌بندی: ارسال با پیک (بسته‌بندی ایمن حمل)' : 'نوع بسته‌بندی: تحویل حضوری در فروشگاه'}
        </div>
      </div>

      ${itemsHtml}

      ${
        order.notes
          ? `<div class="t-box-dashed" style="margin-top: 8px; font-size: 10.5px; line-height: 1.55;">
              <div style="font-weight: 900; font-size: 9.5px;">نکات تکمیلی تولید:</div>
              <div style="font-weight: 700; margin-top: 2px;">${escapeHtml(order.notes)}</div>
            </div>`
          : ''
      }

      <div class="t-divider-dashed" style="margin-top: 9px;"></div>
      <div style="display: flex; justify-content: space-between; font-size: 9.5px; font-weight: 800; padding: 3px 0;">
        <span>☐ آماده‌سازی و پخت</span>
        <span>☐ تزئین و نوشتار</span>
        <span>☐ کنترل نهایی</span>
      </div>
      <div class="t-divider-solid"></div>
      <div class="t-kv" style="font-size: 9px; font-weight: 700;">
        <span>ثبت: ${toPersianDigits(order.orderDate)}</span>
        <span>چاپ: ${printTimestamp}</span>
      </div>
    `;

    printThermalReceipt(`برگه_کارگاه_${order.orderNumber}`, html, 80);
  };

  // 2. Customer Receipt (Professional 80mm thermal POS format — NO remaining balance displayed)
  const printCustomerReceipt = (order: CustomerProductionOrder) => {
    const printTimestamp = `${toPersianDigits(getTodayJalali())} — ${toPersianDigits(
      new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    )}`;

    const rowsHtml = (order.items || [])
      .map(
        (it, idx) => `
      <tr>
        <td style="width: 56%;">
          <div style="font-weight: 900; font-size: 10.5px;">${toPersianDigits(idx + 1)}. ${escapeHtml(it.productName)}</div>
          ${
            it.weightOrSize || it.flavorOrFilling
              ? `<div style="font-size: 9px; font-weight: 600; margin-top: 1px;">${[
                  it.weightOrSize ? escapeHtml(it.weightOrSize) : '',
                  it.flavorOrFilling ? escapeHtml(it.flavorOrFilling) : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}</div>`
              : ''
          }
          ${
            it.needsInscription && it.inscriptionText
              ? `<div style="font-size: 9px; font-weight: 800; margin-top: 2px;">نوشته: «${escapeHtml(it.inscriptionText)}»</div>`
              : ''
          }
        </td>
        <td style="width: 18%; text-align: center; font-weight: 800; white-space: nowrap;">
          ${toPersianDigits(it.quantity)} ${escapeHtml(it.unit)}
        </td>
        <td class="t-mono t-left" style="width: 26%; font-weight: 900; white-space: nowrap;">
          ${toPersianDigits(formatWithCommas(it.totalPrice))}
        </td>
      </tr>
    `
      )
      .join('');

    const hasRecipient = Boolean(order.recipientName || order.recipientPhone);
    const paymentMethodText = order.prepaymentMethod ? PAYMENT_METHOD_LABELS[order.prepaymentMethod] : '';

    const html = `
      <div class="t-center" style="padding-bottom: 4px;">
        <div style="font-size: 18px; font-weight: 900; letter-spacing: -0.5px; line-height: 1.2;">گـاتـان</div>
        <div style="font-size: 9.5px; font-weight: 800; margin-top: 2px;">نان · شیرینی · فینگرفود · کافه</div>
        <div class="t-bar" style="font-size: 11px; margin-top: 6px;">رسید ثبت سفارش اختصاصی مشتری</div>
      </div>

      <div class="t-box-double" style="margin-top: 7px;">
        <div class="t-kv" style="border-bottom: 1px dashed #000000; padding-bottom: 4px; margin-bottom: 4px;">
          <span style="font-size: 10.5px; font-weight: 800;">کد پیگیری سفارش:</span>
          <strong class="t-mono" style="font-size: 13.5px; font-weight: 900;">${escapeHtml(order.orderNumber)}</strong>
        </div>
        <div class="t-kv" style="font-size: 10.5px;">
          <span>تاریخ تحویل:</span>
          <strong class="t-mono" style="font-size: 12px; font-weight: 900;">${toPersianDigits(order.deliveryDate)}</strong>
        </div>
        <div class="t-kv" style="font-size: 10.5px;">
          <span>ساعت تحویل:</span>
          <strong class="t-mono" style="font-size: 12.5px; font-weight: 900;">${toPersianDigits(order.deliveryTime)}</strong>
        </div>
        <div class="t-kv" style="font-size: 9.5px; margin-top: 2px;">
          <span>تاریخ ثبت سفارش:</span>
          <span class="t-mono" style="font-weight: 700;">${toPersianDigits(order.orderDate)}</span>
        </div>
      </div>

      <div style="font-size: 10.5px; padding: 3px 1px;">
        <div class="t-kv">
          <span>سفارش‌دهنده:</span>
          <strong>${escapeHtml(order.customerName)}</strong>
        </div>
        <div class="t-kv">
          <span>تلفن تماس:</span>
          <strong class="t-mono">${toPersianDigits(order.customerPhone)}</strong>
        </div>
        ${
          hasRecipient
            ? `<div class="t-divider-dashed"></div>
              ${
                order.recipientName
                  ? `<div class="t-kv"><span>تحویل‌گیرنده:</span><strong>${escapeHtml(order.recipientName)}</strong></div>`
                  : ''
              }
              ${
                order.recipientPhone
                  ? `<div class="t-kv"><span>همراه تحویل‌گیرنده:</span><strong class="t-mono">${toPersianDigits(order.recipientPhone)}</strong></div>`
                  : ''
              }`
            : ''
        }
        <div class="t-divider-dashed"></div>
        <div class="t-kv">
          <span>نحوه تحویل:</span>
          <strong>${order.deliveryType === 'delivery' ? 'ارسال با پیک' : 'حضوری در فروشگاه'}</strong>
        </div>
        ${
          order.deliveryType === 'delivery' && order.deliveryAddress
            ? `<div style="font-size: 9.5px; font-weight: 700; margin-top: 2px; line-height: 1.45;">
                نشانی تحویل: ${escapeHtml(order.deliveryAddress)}
              </div>`
            : ''
        }
      </div>

      <table class="t-table" style="margin-top: 6px;">
        <thead>
          <tr>
            <th>شرح سفارش</th>
            <th style="text-align: center;">تعداد</th>
            <th style="text-align: left;">مبلغ (ریال)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="t-box" style="margin-top: 7px; padding: 6px 8px;">
        <div class="t-kv" style="font-size: 11px;">
          <span style="font-weight: 800;">جمع کل سفارش:</span>
          <strong class="t-mono" style="font-size: 12px; font-weight: 900;">${toPersianDigits(formatWithCommas(order.totalAmount))} ریال</strong>
        </div>
        <div class="t-divider-dashed"></div>
        <div class="t-kv" style="font-size: 11px;">
          <span style="font-weight: 800;">پیش‌پرداخت (بیعانه):</span>
          <strong class="t-mono" style="font-size: 12px; font-weight: 900;">${toPersianDigits(formatWithCommas(order.prepaymentAmount))} ریال</strong>
        </div>
        ${
          order.prepaymentAmount > 0 && (paymentMethodText || order.treasuryReceiptNo)
            ? `<div class="t-kv" style="font-size: 9px; font-weight: 700; margin-top: 2px;">
                <span>روش پرداخت: ${paymentMethodText || '-'}</span>
                ${order.treasuryReceiptNo ? `<span class="t-mono">سند: ${escapeHtml(order.treasuryReceiptNo)}</span>` : ''}
              </div>`
            : ''
        }
      </div>

      ${
        order.notes
          ? `<div class="t-box-dashed" style="font-size: 9.5px; line-height: 1.45;">
              <strong>توضیحات:</strong> ${escapeHtml(order.notes)}
            </div>`
          : ''
      }

      <div class="t-divider-double" style="margin-top: 8px;"></div>
      <div class="t-center" style="font-size: 9.5px; font-weight: 800; line-height: 1.55;">
        لطفاً هنگام تحویل سفارش، این رسید یا کد پیگیری را همراه داشته باشید.
      </div>
      <div class="t-center" style="font-size: 10.5px; font-weight: 900; margin-top: 4px;">
        با سپاس از انتخاب شما — گاتان
      </div>
      <div class="t-center t-mono" style="font-size: 8.5px; font-weight: 600; margin-top: 4px;">
        چاپ: ${printTimestamp}
      </div>
    `;

    printThermalReceipt(`رسید_مشتری_${order.orderNumber}`, html, 80);
  };

  // ==================== RENDER ====================
  return (
    <div
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right"
      dir="rtl"
    >
      {/* MODULE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 shrink-0">
            <ChefHat className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
              ثبت سفارش تولید و کارتابل دپارتمان‌ها
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              ثبت سفارش اختصاصی مشتریان (کیک، نان، شیرینی، فینگرفود) با عکس نمونه، جمله روی محصول، بیعانه و ارسال به دپارتمان تولید
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'form' ? (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setViewMode('board');
              }}
              className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardList className="h-4 w-4" />
              <span>بازگشت به کارتابل سفارش‌ها</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openNewOrderForm}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>ثبت سفارش تولید جدید</span>
            </button>
          )}
        </div>
      </div>

      {/* INLINE TOAST */}
      {toast && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs font-bold ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              : toast.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
              : 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30 text-sky-800 dark:text-sky-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : toast.type === 'warning' ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <Info className="h-4 w-4 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            aria-label="بستن پیام"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ==================== VIEW 1: DEPARTMENT WORKBENCH ==================== */}
      {viewMode === 'board' && (
        <div className="space-y-5">
          {/* 5-Metric Executive KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 block">سفارش‌های فعال</span>
              <strong className="text-lg font-mono font-black text-slate-900 dark:text-white block mt-1">
                {toPersianDigits(boardStats.activeCount)} <span className="text-[11px] font-sans font-bold text-slate-500">سفارش</span>
              </strong>
            </div>

            <div className="bg-rose-50/80 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-rose-700 dark:text-rose-300 block">تحویل امروز</span>
              <strong className="text-lg font-mono font-black text-rose-700 dark:text-rose-300 block mt-1">
                {toPersianDigits(boardStats.dueToday)} <span className="text-[11px] font-sans font-bold">سفارش</span>
              </strong>
            </div>

            <div className="bg-sky-50/80 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-sky-800 dark:text-sky-300 block">در حال تولید</span>
              <strong className="text-lg font-mono font-black text-sky-800 dark:text-sky-300 block mt-1">
                {toPersianDigits(boardStats.inProd)} <span className="text-[11px] font-sans font-bold">سفارش</span>
              </strong>
            </div>

            <div className="bg-emerald-50/80 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-emerald-800 dark:text-emerald-300 block">آماده تحویل</span>
              <strong className="text-lg font-mono font-black text-emerald-800 dark:text-emerald-300 block mt-1">
                {toPersianDigits(boardStats.readyCount)} <span className="text-[11px] font-sans font-bold">سفارش</span>
              </strong>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 block">مانده وصولی (تحویل)</span>
              <strong className="text-sm sm:text-base font-mono font-black text-amber-700 dark:text-amber-400 block mt-1.5">
                {toPersianDigits(formatWithCommas(boardStats.totalRemaining))} <span className="text-[10px] font-sans">ریال</span>
              </strong>
            </div>
          </div>

          {/* Department Filter Strip + Status & Date Controls */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4 space-y-3">
            {/* Department Filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-400 ml-1 flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                دپارتمان تولید:
              </span>
              <button
                type="button"
                onClick={() => setSelectedDepartmentFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                  selectedDepartmentFilter === 'ALL'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-400'
                }`}
              >
                همه دپارتمان‌ها ({toPersianDigits(boardStats.activeCount)})
              </button>
              {filterDepartments.map(dept => {
                const count = boardStats.activeLineCountByDept[dept.id] || 0;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setSelectedDepartmentFilter(dept.id)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                      selectedDepartmentFilter === dept.id
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-400'
                    }`}
                  >
                    <span>{dept.name}</span>
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                          selectedDepartmentFilter === dept.id
                            ? 'bg-white/20 text-white'
                            : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {toPersianDigits(count)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search, Status & Delivery Window */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800">
              <div className="relative lg:col-span-5">
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </span>
                <input
                  type="text"
                  value={boardSearch}
                  onChange={e => setBoardSearch(e.target.value)}
                  placeholder="جستجوی نام مشتری، تلفن، کد سفارش، نام محصول یا جمله روی محصول..."
                  className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="lg:col-span-4 flex flex-wrap bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                {(
                  [
                    { key: 'active', label: 'فعال‌ها' },
                    { key: 'registered', label: 'ثبت‌شده' },
                    { key: 'in_production', label: 'در تولید' },
                    { key: 'ready', label: 'آماده' },
                    { key: 'delivered', label: 'تحویل‌شده' },
                    { key: 'all', label: 'همه' }
                  ] as const
                ).map(st => (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setSelectedStatusFilter(st.key)}
                    className={`flex-1 px-2 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer whitespace-nowrap ${
                      selectedStatusFilter === st.key
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="lg:col-span-3 flex bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                {(
                  [
                    { key: 'all', label: 'همه تاریخ‌ها' },
                    { key: 'today', label: 'امروز' },
                    { key: 'tomorrow', label: 'فردا' },
                    { key: 'week', label: '۷ روز' }
                  ] as const
                ).map(dr => (
                  <button
                    key={dr.key}
                    type="button"
                    onClick={() => setSelectedDateRange(dr.key)}
                    className={`flex-1 px-2 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer whitespace-nowrap ${
                      selectedDateRange === dr.key
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {dr.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Orders List */}
          {filteredOrders.length === 0 ? (
            <div className="py-14 px-4 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
              <ChefHat className="h-10 w-10 mx-auto text-slate-400 dark:text-slate-600" />
              <div className="text-sm font-black text-slate-700 dark:text-slate-300">
                سفارش تولیدی با این فیلتر یافت نشد
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                برای ثبت سفارش کیک، نان، شیرینی یا فینگرفود اختصاصی مشتریان روی دکمه زیر کلیک کنید.
              </p>
              <button
                type="button"
                onClick={openNewOrderForm}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>ثبت اولین سفارش تولید</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map(order => {
                const dNorm = normalizeJalaliSortable(order.deliveryDate);
                const isDueToday = dNorm === todayNorm && order.status !== 'delivered' && order.status !== 'cancelled';
                const isDueTomorrow = dNorm === tomorrowNorm && order.status !== 'delivered' && order.status !== 'cancelled';
                const isOverdue = dNorm < todayNorm && order.status !== 'delivered' && order.status !== 'cancelled';
                const visibleItems =
                  selectedDepartmentFilter === 'ALL'
                    ? order.items || []
                    : (order.items || []).filter(it => it.departmentId === selectedDepartmentFilter);
                const statusInfo = STATUS_META[order.status] || STATUS_META.registered;

                return (
                  <div
                    key={order.id}
                    className={`rounded-2xl border bg-slate-50 dark:bg-slate-950 overflow-hidden ${
                      isOverdue
                        ? 'border-rose-300 dark:border-rose-500/40'
                        : isDueToday
                        ? 'border-amber-300 dark:border-amber-500/40'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {/* Order Header */}
                    <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-black px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                            {order.orderNumber}
                          </span>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white">{order.customerName}</h3>
                          {order.customerCategoryName && (
                            <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
                              ({order.customerCategoryName})
                            </span>
                          )}
                          <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-lg ${statusInfo.badgeClass}`}>
                            {statusInfo.label}
                          </span>
                          {isOverdue && (
                            <span className="text-[10.5px] font-extrabold text-rose-700 dark:text-rose-400">
                              · گذشته از موعد تحویل!
                            </span>
                          )}
                          {isDueToday && (
                            <span className="text-[10.5px] font-extrabold text-amber-700 dark:text-amber-400">
                              · تحویل امروز
                            </span>
                          )}
                          {isDueTomorrow && (
                            <span className="text-[10.5px] font-bold text-sky-700 dark:text-sky-400">
                              · تحویل فردا
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                          <span className="flex items-center gap-1 font-mono font-bold text-slate-800 dark:text-slate-200">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            {toPersianDigits(order.customerPhone)}
                          </span>
                          <span className="flex items-center gap-1 font-mono font-black text-rose-700 dark:text-rose-400">
                            <Calendar className="h-3.5 w-3.5" />
                            تحویل: {toPersianDigits(order.deliveryDate)}
                          </span>
                          <span className="flex items-center gap-1 font-mono font-black text-rose-700 dark:text-rose-400">
                            <Clock className="h-3.5 w-3.5" />
                            ساعت {toPersianDigits(order.deliveryTime)}
                          </span>
                          <span className="flex items-center gap-1 font-bold">
                            {order.deliveryType === 'delivery' ? (
                              <>
                                <Truck className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                                <span>ارسال با پیک{order.deliveryAddress ? `: ${order.deliveryAddress}` : ''}</span>
                              </>
                            ) : (
                              <>
                                <Store className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span>تحویل حضوری در فروشگاه</span>
                              </>
                            )}
                          </span>
                          {(order.recipientName || order.recipientPhone) && (
                            <span className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300">
                              <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>
                                تحویل‌گیرنده: {order.recipientName || '-'}
                                {order.recipientPhone ? ` (${toPersianDigits(order.recipientPhone)})` : ''}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Order Actions */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => printProductionTicket(order, selectedDepartmentFilter)}
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="چاپ برگه دستور تولید شامل عکس نمونه و جمله روی محصول"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>برگه کارگاه</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => printCustomerReceipt(order)}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          <span>رسید مشتری</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditOrderForm(order)}
                          className="p-2 rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 hover:bg-sky-600 hover:text-white cursor-pointer transition-colors"
                          title="ویرایش سفارش"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetOrder(order)}
                          className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white cursor-pointer transition-colors"
                          title="حذف سفارش"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Order Items (Each routed to its Department) */}
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {visibleItems.map((it, idx) => {
                        const lineMeta = STATUS_META[it.itemStatus] || STATUS_META.registered;
                        return (
                          <div
                            key={it.lineId || idx}
                            className="p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-start justify-between gap-3.5"
                          >
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                                  {it.productName}
                                </span>
                                <span className="font-mono text-xs font-black text-emerald-700 dark:text-emerald-400">
                                  × {toPersianDigits(it.quantity)} {it.unit}
                                </span>
                                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                                  دپارتمان: {it.departmentName}
                                </span>
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg ${lineMeta.badgeClass}`}>
                                  {lineMeta.label}
                                </span>
                              </div>

                              {(it.weightOrSize || it.flavorOrFilling || it.productCategoryName) && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                                  {it.productCategoryName && <span>نوع: <strong className="text-slate-800 dark:text-slate-200">{it.productCategoryName}</strong></span>}
                                  {it.weightOrSize && <span>وزن/سایز: <strong className="text-slate-800 dark:text-slate-200">{it.weightOrSize}</strong></span>}
                                  {it.flavorOrFilling && <span>طعم/فیلینگ: <strong className="text-slate-800 dark:text-slate-200">{it.flavorOrFilling}</strong></span>}
                                </div>
                              )}

                              {it.needsInscription && it.inscriptionText && (
                                <div className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-xs">
                                  <MessageSquareText className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                                  <span className="font-bold text-amber-900 dark:text-amber-200">
                                    جمله روی محصول: «{it.inscriptionText}»
                                  </span>
                                  {it.inscriptionStyle && (
                                    <span className="text-[10.5px] text-amber-700 dark:text-amber-400">
                                      ({it.inscriptionStyle})
                                    </span>
                                  )}
                                </div>
                              )}

                              {it.itemNotes && (
                                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                  توضیحات کارگاه: <strong className="text-slate-800 dark:text-slate-200">{it.itemNotes}</strong>
                                </div>
                              )}

                              {/* Sample Images Thumbnails */}
                              {(it.sampleImages || []).length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  {it.sampleImages.map((imgSrc, imgIdx) => (
                                    <button
                                      key={imgIdx}
                                      type="button"
                                      onClick={() =>
                                        setLightboxImage({
                                          src: imgSrc,
                                          caption: `${order.orderNumber} · ${it.productName} (${order.customerName})`
                                        })
                                      }
                                      className="group relative h-16 w-16 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer shrink-0"
                                      title="مشاهده تصویر نمونه در اندازه بزرگ"
                                    >
                                      <img
                                        src={imgSrc}
                                        alt={`نمونه ${it.productName}`}
                                        className="h-full w-full object-cover"
                                      />
                                      <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                        <Eye className="h-4 w-4" />
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Per-Line Department Status Controls */}
                            <div className="flex flex-wrap lg:flex-col items-center lg:items-end justify-between gap-2 shrink-0">
                              <div className="text-left font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                {toPersianDigits(formatWithCommas(it.totalPrice))}{' '}
                                <span className="text-[10px] font-sans text-slate-500">ریال</span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {lineMeta.nextStatus && (
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateLineStatus(order.id, it.lineId, lineMeta.nextStatus!)}
                                    className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
                                  >
                                    <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                                    <span>{lineMeta.nextLabel}</span>
                                  </button>
                                )}
                                <select
                                  value={it.itemStatus}
                                  onChange={e =>
                                    handleUpdateLineStatus(
                                      order.id,
                                      it.lineId,
                                      e.target.value as CustomerProductionOrderStatus
                                    )
                                  }
                                  aria-label="تغییر وضعیت ردیف"
                                  className="px-2 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                                >
                                  <option value="registered">ثبت‌شده</option>
                                  <option value="in_production">در حال تولید</option>
                                  <option value="ready">آماده تحویل</option>
                                  <option value="delivered">تحویل‌شده</option>
                                  <option value="cancelled">لغو شده</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Financial Summary Footer */}
                    <div className="px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-slate-500 dark:text-slate-400">
                          مبلغ کل:{' '}
                          <strong className="font-mono text-slate-900 dark:text-white">
                            {toPersianDigits(formatWithCommas(order.totalAmount))} ریال
                          </strong>
                        </span>
                        <span className="text-emerald-700 dark:text-emerald-400">
                          پیش‌پرداخت:{' '}
                          <strong className="font-mono">
                            {toPersianDigits(formatWithCommas(order.prepaymentAmount))} ریال
                          </strong>
                          {order.treasuryReceiptNo && (
                            <span className="text-[10px] mr-1 font-sans">
                              (سند خزانه: {order.treasuryReceiptNo})
                            </span>
                          )}
                        </span>
                        <span className="text-rose-700 dark:text-rose-400 font-bold">
                          مانده تحویل:{' '}
                          <strong className="font-mono">
                            {toPersianDigits(formatWithCommas(order.remainingAmount))} ریال
                          </strong>
                        </span>
                      </div>

                      {order.status !== 'delivered' && order.status !== 'cancelled' && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSetOrderStatus(order.id, 'delivered')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>تحویل کامل سفارش</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetOrderStatus(order.id, 'cancelled')}
                            className="px-2.5 py-1.5 rounded-xl text-slate-500 hover:text-rose-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            <span>لغو</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== VIEW 2: CREATE / EDIT PRODUCTION ORDER FORM ==================== */}
      {viewMode === 'form' && (
        <form onSubmit={handleSaveOrder} className="space-y-6">
          {/* STEP 1: CUSTOMER & DELIVERY SCHEDULE */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>۱. مشخصات مشتری و زمان تحویل</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowQuickAddCustomer(prev => !prev)}
                className="self-start sm:self-center px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>{showQuickAddCustomer ? 'بستن ثبت سریع مشتری' : 'ثبت سریع مشتری جدید'}</span>
              </button>
            </div>

            {/* Quick Create Customer Inline Drawer */}
            {showQuickAddCustomer && (
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-500/40 space-y-3">
                <div className="text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  <span>ثبت سریع مشتری جدید با اطلاعات حداقلی (ذخیره خودکار در لیست مشتریان)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      نام مشتری *
                    </label>
                    <input
                      type="text"
                      value={quickCustName}
                      onChange={e => setQuickCustName(e.target.value)}
                      placeholder="مثلاً: خانم رضایی"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      تلفن همراه *
                    </label>
                    <input
                      type="tel"
                      value={quickCustPhone}
                      onChange={e => setQuickCustPhone(e.target.value)}
                      placeholder="0912..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      گروه مشتری
                    </label>
                    <select
                      value={quickCustCategoryId}
                      onChange={e => setQuickCustCategoryId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
                    >
                      {customerCategories.map(cc => (
                        <option key={cc.id} value={cc.id}>
                          {cc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      آدرس (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={quickCustAddress}
                      onChange={e => setQuickCustAddress(e.target.value)}
                      placeholder="نشانی تحویل..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuickAddCustomer(false)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickCreateCustomer}
                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                  >
                    ذخیره و انتخاب این مشتری
                  </button>
                </div>
              </div>
            )}

            {/* Existing Customer Quick Search Picker */}
            {periodCustomers.length > 0 && (
              <div className="space-y-2">
                <div className="relative">
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </span>
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    placeholder="جستجو و انتخاب از مشتریان ثبت‌شده (نام، شماره تماس یا کد مشتری)..."
                    className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {customerSearch.trim() && (
                  <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    {filteredCustomersForPicker.length === 0 ? (
                      <div className="col-span-full py-3 text-center text-[11px] text-slate-500">
                        مشتری با این مشخصات یافت نشد — می‌توانید از دکمه «ثبت سریع مشتری جدید» استفاده کنید.
                      </div>
                    ) : (
                      filteredCustomersForPicker.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectExistingCustomer(c)}
                          className="text-right p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 cursor-pointer transition-colors"
                        >
                          <div className="text-xs font-black text-slate-900 dark:text-white truncate">{c.name}</div>
                          <div className="text-[10.5px] font-mono text-slate-500 mt-0.5">
                            {toPersianDigits(c.phone || '-')}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Customer Active Fields + Delivery Date/Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  نام و نام خانوادگی مشتری *
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="نام مشتری..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  شماره تلفن همراه *
                </label>
                <input
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="0912..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <ShamsiDatePicker
                  id="prod-order-delivery-date"
                  label="تاریخ تحویل *"
                  value={deliveryDate}
                  onChange={setDeliveryDate}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  ساعت تحویل *
                </label>
                <input
                  type="time"
                  required
                  value={deliveryTime}
                  onChange={e => setDeliveryTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-black text-center text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {QUICK_DELIVERY_TIMES.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDeliveryTime(t)}
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold cursor-pointer ${
                        deliveryTime === t
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
                      }`}
                    >
                      {toPersianDigits(t)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Delivery Method & Recipient Details */}
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    نحوه تحویل سفارش
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setDeliveryType('pickup')}
                      className={`py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                        deliveryType === 'pickup'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Store className="h-3.5 w-3.5" />
                      <span>تحویل حضوری</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryType('delivery')}
                      className={`py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                        deliveryType === 'delivery'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Truck className="h-3.5 w-3.5" />
                      <span>ارسال با پیک</span>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>نام تحویل‌گیرنده</span>
                    </label>
                    {customerName.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setRecipientName(customerName.trim());
                          setRecipientPhone(customerPhone.trim());
                        }}
                        className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        مشابه سفارش‌دهنده
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="نام شخص تحویل‌گیرنده سفارش..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    تلفن همراه تحویل‌گیرنده
                  </label>
                  <input
                    type="tel"
                    value={recipientPhone}
                    onChange={e => setRecipientPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {deliveryType === 'delivery' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    نشانی دقیق تحویل (ارسال با پیک)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                      placeholder="خیابان، کوچه، پلاک، واحد..."
                      className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP 2: MULTI-ROW PRODUCTION ITEMS (PER-ROW DEPARTMENT, INSCRIPTION, SAMPLE PHOTOS) */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <ChefHat className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>۲. اقلام سفارش، دپارتمان تولید، نوشته روی محصول و عکس نمونه ({toPersianDigits(orderItems.length)} ردیف)</span>
              </h3>
              <button
                type="button"
                onClick={addOrderLine}
                className="self-start sm:self-center px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>افزودن محصول دیگر به این سفارش</span>
              </button>
            </div>

            <div className="space-y-4">
              {orderItems.map((line, idx) => (
                <div
                  key={line.lineId}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
                >
                  {/* Line Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <span className="text-xs font-black text-slate-900 dark:text-white">
                      ردیف {toPersianDigits(idx + 1)} — ارسال به دپارتمان{' '}
                      <strong className="text-emerald-700 dark:text-emerald-400">{line.departmentName}</strong>
                    </span>
                    {orderItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOrderLine(line.lineId)}
                        className="px-2.5 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>حذف ردیف</span>
                      </button>
                    )}
                  </div>

                  {/* Row 1: Catalog Product Picker, Custom Product Title, Department */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        جستجو و انتخاب از محصولات سیستم (اختیاری)
                      </label>
                      <SearchableProductPicker
                        products={periodProducts}
                        selectedProductId={line.productId}
                        categoryMap={categoryMap}
                        departmentMap={departmentMap}
                        onSelect={productId => handleSelectCatalogProductForLine(line.lineId, productId)}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        نوع / عنوان محصول سفارشی *
                      </label>
                      <input
                        type="text"
                        required
                        value={line.productName}
                        onChange={e => updateLine(line.lineId, l => ({ ...l, productName: e.target.value }))}
                        placeholder="مثلاً: کیک تولد دوطبقه خامه‌ای، سینی فینگرفود..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        دپارتمان تولید مربوطه *
                      </label>
                      <select
                        value={line.departmentId}
                        onChange={e => handleSelectDepartmentForLine(line.lineId, e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/10 text-xs font-black text-slate-900 dark:text-white cursor-pointer"
                      >
                        {periodDepartments.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Qty, Unit, Weight/Size, Flavor/Filling, Unit Price */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        تعداد سفارش *
                      </label>
                      <input
                        type="number"
                        step="any"
                        min={0.1}
                        required
                        onFocus={handleFocusSelect}
                        value={line.quantity}
                        onChange={e => {
                          const qty = Math.max(0, parseNumber(e.target.value));
                          updateLine(line.lineId, l => ({
                            ...l,
                            quantity: qty,
                            totalPrice: qty * l.estimatedUnitPrice
                          }));
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-black text-center text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        واحد
                      </label>
                      <select
                        value={line.unit}
                        onChange={e => updateLine(line.lineId, l => ({ ...l, unit: e.target.value }))}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
                      >
                        {UNIT_OPTIONS.map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        وزن / سایز / نفر
                      </label>
                      <input
                        type="text"
                        value={line.weightOrSize || ''}
                        onChange={e => updateLine(line.lineId, l => ({ ...l, weightOrSize: e.target.value }))}
                        placeholder="مثلاً ۲ کیلو / ۱۲ نفره"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        طعم / فیلینگ / حساسیت
                      </label>
                      <input
                        type="text"
                        value={line.flavorOrFilling || ''}
                        onChange={e => updateLine(line.lineId, l => ({ ...l, flavorOrFilling: e.target.value }))}
                        placeholder="موز و گردو، نوتلا..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        قیمت واحد (ریال)
                      </label>
                      <input
                        type="text"
                        onFocus={handleFocusSelect}
                        value={formatWithCommas(line.estimatedUnitPrice)}
                        onChange={e => {
                          const price = Math.max(0, parseNumber(e.target.value));
                          updateLine(line.lineId, l => ({
                            ...l,
                            estimatedUnitPrice: price,
                            totalPrice: l.quantity * price
                          }));
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold text-left text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 mb-1">جمع این ردیف</span>
                      <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-mono font-black text-left text-xs text-emerald-700 dark:text-emerald-400">
                        {toPersianDigits(formatWithCommas(line.totalPrice))} ریال
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Inscription Toggle & Sample Photo Uploader */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {/* Special Inscription */}
                    <div className="space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={line.needsInscription}
                          onChange={e =>
                            updateLine(line.lineId, l => ({
                              ...l,
                              needsInscription: e.target.checked
                            }))
                          }
                          className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
                        />
                        <MessageSquareText className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                          مشتری نیاز به نوشتن جمله خاص روی محصول دارد
                        </span>
                      </label>

                      {line.needsInscription && (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
                          <div className="sm:col-span-8">
                            <input
                              type="text"
                              value={line.inscriptionText || ''}
                              onChange={e => updateLine(line.lineId, l => ({ ...l, inscriptionText: e.target.value }))}
                              placeholder="متن دقیق جمله (مثلاً: تولدت مبارک مریم جان)"
                              className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={line.inscriptionStyle || ''}
                              onChange={e => updateLine(line.lineId, l => ({ ...l, inscriptionStyle: e.target.value }))}
                              placeholder="رنگ / فونت (طلایی...)"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <input
                          type="text"
                          value={line.itemNotes || ''}
                          onChange={e => updateLine(line.lineId, l => ({ ...l, itemNotes: e.target.value }))}
                          placeholder="توضیحات فنی کارگاه برای این ردیف (تزئینات، رنگ خامه، بسته‌بندی خاص...)"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Customer Sample Photo Uploader */}
                    <div className="space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <ImageIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span>عکس نمونه درخواستی مشتری ({toPersianDigits((line.sampleImages || []).length)}/۳)</span>
                        </span>

                        {(line.sampleImages || []).length < 3 && (
                          <label className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-emerald-500 text-slate-800 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                            <Camera className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>{compressingLineId === line.lineId ? 'در حال بهینه‌سازی...' : 'انتخاب / گرفتن عکس'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={e => {
                                handleUploadSampleImages(line.lineId, e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {(line.sampleImages || []).length === 0 ? (
                        <div className="py-4 px-3 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400">
                          تصویر نمونه ارسالی مشتری (مثلاً مدل کیک یا دیزاین سینی) را آپلود کنید — فشرده‌سازی خودکار جهت سرعت بالا
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {line.sampleImages.map((src, imgIdx) => (
                            <div
                              key={imgIdx}
                              className="relative h-20 w-20 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              <img
                                src={src}
                                alt={`نمونه ${imgIdx + 1}`}
                                onClick={() => setLightboxImage({ src, caption: line.productName || 'عکس نمونه مشتری' })}
                                className="h-full w-full object-cover cursor-pointer"
                              />
                              <button
                                type="button"
                                onClick={() => removeSampleImage(line.lineId, imgIdx)}
                                className="absolute top-1 left-1 p-1 rounded-full bg-slate-950/75 text-white hover:bg-rose-600 cursor-pointer"
                                aria-label="حذف تصویر"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* STEP 3: PREPAYMENT, OPTIONAL TREASURY RECEIPT & SUBMIT */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>۳. مبلغ پیش‌پرداخت (بیعانه)، تسویه و توضیحات نهایی</span>
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Prepayment & Treasury Controls */}
              <div className="lg:col-span-7 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      مبلغ پیش‌پرداخت / بیعانه (ریال)
                    </label>
                    <input
                      type="text"
                      onFocus={handleFocusSelect}
                      value={formatWithCommas(prepaymentAmount)}
                      onChange={e => setPrepaymentAmount(Math.max(0, parseNumber(e.target.value)))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-black text-left text-sm text-emerald-700 dark:text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      روش پرداخت پیش‌پرداخت
                    </label>
                    <select
                      value={prepaymentMethod}
                      onChange={e => setPrepaymentMethod(e.target.value as any)}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
                    >
                      <option value="pos">کارتخوان (POS)</option>
                      <option value="bank_transfer">کارت‌به‌کارت / واریز بانکی</option>
                      <option value="cash">نقدی (صندوق)</option>
                      <option value="cheque">چک</option>
                    </select>
                  </div>
                </div>

                {/* Optional Treasury Link */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                  {existingTreasuryReceiptNo ? (
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      <span>
                        سند پیش‌دریافت در خزانه‌داری قبلاً با شماره <strong className="font-mono">{existingTreasuryReceiptNo}</strong> ثبت شده است.
                      </span>
                    </div>
                  ) : (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          disabled={prepaymentAmount <= 0}
                          checked={postToTreasury && prepaymentAmount > 0}
                          onChange={e => setPostToTreasury(e.target.checked)}
                          className="h-4 w-4 rounded accent-emerald-600 cursor-pointer disabled:opacity-40"
                        />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          ثبت اختیاری سند دریافت این پیش‌پرداخت در بخش خزانه‌داری (پیش‌دریافت مشتری)
                        </span>
                      </label>

                      {postToTreasury && prepaymentAmount > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          {prepaymentMethod === 'cash' && (
                            <select
                              value={treasuryCashId}
                              onChange={e => setTreasuryCashId(e.target.value)}
                              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white"
                            >
                              {cashDrawers.length === 0 ? (
                                <option value="">صندوق پیش‌فرض فروشگاه</option>
                              ) : (
                                cashDrawers.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))
                              )}
                            </select>
                          )}

                          {prepaymentMethod === 'pos' && (
                            <select
                              value={treasuryPosId}
                              onChange={e => setTreasuryPosId(e.target.value)}
                              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white"
                            >
                              {posTerminals.length === 0 ? (
                                <option value="">کارتخوان پیش‌فرض فروشگاه</option>
                              ) : (
                                posTerminals.map(p => (
                                  <option key={p.id} value={p.id}>{p.title || p.terminalId}</option>
                                ))
                              )}
                            </select>
                          )}

                          {(prepaymentMethod === 'bank_transfer' || prepaymentMethod === 'pos') && (
                            <select
                              value={treasuryBankId}
                              onChange={e => setTreasuryBankId(e.target.value)}
                              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white"
                            >
                              {bankAccounts.length === 0 ? (
                                <option value="">حساب بانکی پیش‌فرض</option>
                              ) : (
                                bankAccounts.map(b => (
                                  <option key={b.id} value={b.id}>{b.bankName} — {b.title}</option>
                                ))
                              )}
                            </select>
                          )}

                          <input
                            type="text"
                            value={treasuryTrackingRef}
                            onChange={e => setTreasuryTrackingRef(e.target.value)}
                            placeholder="شماره پیگیری / مرجع تراکنش (اختیاری)"
                            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    توضیحات کلی سفارش (اختیاری)
                  </label>
                  <textarea
                    rows={2}
                    value={orderNotes}
                    onChange={e => setOrderNotes(e.target.value)}
                    placeholder="نکات تکمیلی، شمع/کارد، هماهنگی پیش از ارسال و ..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Financial Summary Box & Submit */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-3">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <span>جمع اقلام سفارش ({toPersianDigits(orderItems.length)} ردیف):</span>
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {toPersianDigits(formatWithCommas(itemsSubtotal))} ریال
                    </strong>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="font-bold text-slate-800 dark:text-slate-200">مبلغ کل سفارش:</span>
                    <strong className="font-mono text-sm font-black text-slate-900 dark:text-white">
                      {toPersianDigits(formatWithCommas(grandTotalAmount))} ریال
                    </strong>
                  </div>
                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                    <span>پیش‌پرداخت (بیعانه):</span>
                    <strong className="font-mono font-black">
                      {toPersianDigits(formatWithCommas(prepaymentAmount))} ریال
                    </strong>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200 dark:border-slate-700 text-sm">
                    <span className="font-black text-rose-700 dark:text-rose-400">مانده قابل پرداخت هنگام تحویل:</span>
                    <strong className="font-mono font-black text-rose-700 dark:text-rose-400">
                      {toPersianDigits(formatWithCommas(calculatedRemainingAmount))} ریال
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setViewMode('board');
                    }}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="flex-[2] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>{editingOrderId ? 'ذخیره تغییرات سفارش تولید' : 'ثبت نهایی و ارسال به دپارتمان'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ==================== MODAL 1: FULLSCREEN SAMPLE IMAGE LIGHTBOX ==================== */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <span className="text-xs font-black text-slate-900 dark:text-white truncate">{lightboxImage.caption}</span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                aria-label="بستن تصویر"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-slate-100 dark:bg-slate-950 max-h-[75vh] overflow-auto">
              <img
                src={lightboxImage.src}
                alt={lightboxImage.caption}
                className="max-h-[68vh] max-w-full object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: DELETE CONFIRMATION ==================== */}
      {deleteTargetOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 text-right"
            dir="rtl"
          >
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h3 className="text-sm font-black text-slate-900 dark:text-white">حذف سفارش تولید</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              آیا از حذف کامل سفارش <strong className="font-mono">{deleteTargetOrder.orderNumber}</strong> متعلق به{' '}
              <strong>«{deleteTargetOrder.customerName}»</strong> اطمینان دارید؟
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteTargetOrder(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={confirmDeleteOrder}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer"
              >
                تایید و حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
