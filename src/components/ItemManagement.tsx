/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  AppDatabase, Item, ItemCategory, Supplier, PurchaseInvoice, 
  StockCountAudit, StockCount, PurchaseInvoiceItem, UnitOfMeasurement 
} from '../types';
import { 
  toPersianDigits, toEnglishDigits, formatWithCommas, parseNumber, downloadCSV, printElement, getTodayJalali, matchPersianString,
  getMaterialFormulaKey, doesIngredientMatchMaterial
} from '../utils/persianUtils';
import { decodeFileBuffer, parseCSVText } from '../utils/csvUtils';
import { 
  Plus, Search, Edit2, Edit3, Trash2, CheckCircle, XCircle, FileSpreadsheet, 
  Printer, ArrowRight, Save, Calendar, FileText, Check, AlertTriangle, RefreshCw, Download, Upload,
  Ruler, Scale, Folder, Layers, Tag, ChevronDown, ChevronUp, Eye, Filter, Settings, X, Package, 
  SlidersHorizontal, ArrowUpDown, Sparkles, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';

// Utility to round numbers to at most 2 decimal places
export function roundTo2Decimals(val: number | undefined | null): number {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

// Intelligent item code generator: takes the last item's code, increments by +1, and ensures uniqueness
export function generateNextItemCode(existingItems: Item[]): string {
  if (!existingItems || existingItems.length === 0) {
    return '1001';
  }

  const existingCodes = new Set(
    existingItems
      .map(i => (i.code || '').trim().toLowerCase())
      .filter(Boolean)
  );

  // Take the last registered item in the list
  const lastItem = existingItems[existingItems.length - 1];
  const lastCode = (lastItem?.code || '').trim();

  if (lastCode) {
    // 1. If purely numeric: add 1 directly
    if (/^\d+$/.test(lastCode)) {
      const num = parseInt(lastCode, 10);
      if (!isNaN(num)) {
        let candidateNum = num + 1;
        let candidate = String(candidateNum).padStart(lastCode.length, '0');
        while (existingCodes.has(candidate.toLowerCase())) {
          candidateNum++;
          candidate = String(candidateNum).padStart(lastCode.length, '0');
        }
        return candidate;
      }
    }

    // 2. If code has a prefix and ends with digits (e.g. "R-101", "ITM-005", "K-10")
    const match = lastCode.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const digits = match[2];
      const num = parseInt(digits, 10);
      if (!isNaN(num)) {
        let candidateNum = num + 1;
        let candidate = `${prefix}${String(candidateNum).padStart(digits.length, '0')}`;
        while (existingCodes.has(candidate.toLowerCase())) {
          candidateNum++;
          candidate = `${prefix}${String(candidateNum).padStart(digits.length, '0')}`;
        }
        return candidate;
      }
    }
  }

  // 3. Fallback if last item has no numeric part: find highest numeric code or fallback
  const numericCodes = existingItems
    .map(i => (i.code || '').trim())
    .filter(c => /^\d+$/.test(c))
    .map(c => parseInt(c, 10))
    .filter(n => !isNaN(n) && n > 0);

  if (numericCodes.length > 0) {
    let nextNum = Math.max(...numericCodes) + 1;
    while (existingCodes.has(String(nextNum).toLowerCase())) {
      nextNum++;
    }
    return String(nextNum);
  }

  let fallbackNum = Math.max(1001, existingItems.length + 1001);
  while (existingCodes.has(String(fallbackNum).toLowerCase())) {
    fallbackNum++;
  }
  return String(fallbackNum);
}

// Reusable Persian Pagination Bar Component
interface PaginationControlProps {
  currentPage: number;
  totalItems: number;
  pageSize: number | 'all';
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number | 'all') => void;
  pageSizeOptions?: number[];
  itemName?: string;
}

function PaginationControl({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200, 500],
  itemName = 'مورد'
}: PaginationControlProps) {
  if (totalItems === 0) return null;

  const isAll = pageSize === 'all';
  const numericPageSize = isAll ? totalItems : pageSize;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalItems / numericPageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startRecord = isAll ? 1 : (safeCurrentPage - 1) * numericPageSize + 1;
  const endRecord = isAll ? totalItems : Math.min(safeCurrentPage * numericPageSize, totalItems);

  // Generate visible page numbers
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (safeCurrentPage <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (safeCurrentPage >= totalPages - 3) {
      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, '...', totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-zinc-950/90 border-t border-zinc-850 rounded-b-2xl text-xs text-zinc-400">
      {/* Right side: item counts & page size selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 font-bold text-zinc-300">
          <span>نمایش</span>
          <span className="font-mono text-rose-400 font-bold">{toPersianDigits(startRecord)}</span>
          <span>تا</span>
          <span className="font-mono text-rose-400 font-bold">{toPersianDigits(endRecord)}</span>
          <span>از مجموع</span>
          <span className="font-mono text-zinc-100 font-extrabold">{toPersianDigits(totalItems)}</span>
          <span>{itemName}</span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="text-[11px] font-bold">تعداد در صفحه:</span>
          <select
            className="px-2.5 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-rose-350 focus:outline-none focus:border-rose-500 cursor-pointer font-bold font-mono"
            value={isAll ? 'all' : pageSize}
            onChange={(e) => {
              const val = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
              onPageSizeChange(val);
              onPageChange(1);
            }}
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>
                {toPersianDigits(opt)} {opt === 100 ? '(پیش‌فرض)' : ''}
              </option>
            ))}
            <option value="all">همه موارد</option>
          </select>
        </div>
      </div>

      {/* Left side: Page Navigation */}
      {!isAll && totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage === 1}
            className="p-1 px-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            title="صفحه اول"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>

          {/* Prev page */}
          <button
            type="button"
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage === 1}
            className="p-1 px-2 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center gap-1"
            title="صفحه قبلی"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-[11px] hidden sm:inline">قبلی</span>
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`dots-${idx}`} className="px-1 text-zinc-600 font-mono">...</span>
                );
              }
              const pageNum = p as number;
              const isActive = pageNum === safeCurrentPage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => onPageChange(pageNum)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer flex items-center justify-center ${
                    isActive
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800 hover:text-white'
                  }`}
                >
                  {toPersianDigits(pageNum)}
                </button>
              );
            })}
          </div>

          {/* Next page */}
          <button
            type="button"
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage === totalPages}
            className="p-1 px-2 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center gap-1"
            title="صفحه بعدی"
          >
            <span className="text-[11px] hidden sm:inline">بعدی</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* Last page */}
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={safeCurrentPage === totalPages}
            className="p-1 px-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            title="صفحه آخر"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface ItemManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

export default function ItemManagement({ db, onUpdateDb, activePeriodId }: ItemManagementProps) {
  // Navigation tabs under Item Management
  const [activeTab, setActiveTab] = useState<'items' | 'categories' | 'units' | 'purchases' | 'inventory' | 'warehouses'>('items');

  // Custom confirmation modal state
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

  // --- Common Helper ---
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // Filter lists scoped with activePeriodId
  const items = useMemo(() => {
    const list = db.items.filter(i => i.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.filter(i => {
      const id = String(i.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [db.items, activePeriodId]);
  const normCat = (s?: string): string =>
    String(s || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');

  const categories = useMemo(() => {
    const list = db.itemCategories.filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.filter(c => {
      const n = normCat(c.name);
      const dup = seen.has(`id:${c.id}`) || (Boolean(n) && seen.has(`name:${n}`));
      seen.add(`id:${c.id}`);
      if (n) seen.add(`name:${n}`);
      return !dup;
    });
  }, [db.itemCategories, activePeriodId]);
  const suppliers = useMemo(() => db.suppliers.filter(s => s.periodId === activePeriodId && s.isActive), [db.suppliers, activePeriodId]);
  const purchases = useMemo(() => db.purchaseInvoices.filter(p => p.periodId === activePeriodId), [db.purchaseInvoices, activePeriodId]);
  const audits = useMemo(() => db.stockCountAudits.filter(a => a.periodId === activePeriodId), [db.stockCountAudits, activePeriodId]);
  const counts = useMemo(() => {
    const list = db.stockCounts.filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.map((c, idx) => {
      const id = String(c.id || '');
      if (!id || seen.has(id)) {
        const uniqueId = `sc-${c.itemId || 'rec'}-${idx}-${Date.now().toString(36)}`;
        seen.add(uniqueId);
        return { ...c, id: uniqueId };
      }
      seen.add(id);
      return c;
    });
  }, [db.stockCounts, activePeriodId]);

  // Map category names
  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach(c => map[c.id] = c.name);
    return map;
  }, [categories]);

  // Map item details
  const itemMap = useMemo(() => {
    const map: Record<string, Item> = {};
    db.items.forEach(i => {
      map[i.id] = i;
      if (i.accountId) {
        map[i.accountId.trim()] = i;
        map[i.accountId.trim().toLowerCase()] = i;
      }
      if (i.code) {
        map[i.code.trim()] = i;
        map[i.code.trim().toLowerCase()] = i;
      }
    });
    return map;
  }, [db.items]);

  // Active items mapping for selectors (only active items displayed in purchases/counts)
  const activeItemsList = useMemo(() => items.filter(i => i.isActive), [items]);


  // ==========================================
  // TAB 1: DEFINING ITEMS (تعریف کالا)
  // ==========================================
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('all');
  const [itemViewGroupMode, setItemViewGroupMode] = useState<'flat' | 'grouped'>('flat');
  const [catalogPageSize, setCatalogPageSize] = useState<number | 'all'>(100);
  const [catalogPage, setCatalogPage] = useState<number>(1);

  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [newItem, setNewItem] = useState<Partial<Item>>({
    code: '',
    accountId: '',
    name: '',
    categoryId: categories[0]?.id || '',
    unit: 'کیلوگرم',
    barcode: '',
    packageType: 'کارتن',
    qtyPerPackage: 1,
    weightPerPackage: 1,
    reorderThreshold: 10,
    price: 0,
    isActive: true,
    warehouse: ''
  });

  // Keep newItem.categoryId synced when categories or activePeriodId change
  React.useEffect(() => {
    if (!editingItem) {
      setNewItem(prev => {
        const isValid = Boolean(prev.categoryId) && categories.some(c => c.id === prev.categoryId);
        if (isValid) return prev;
        return { ...prev, categoryId: categories[0]?.id || '' };
      });
    }
  }, [categories, activePeriodId, editingItem]);

  // Auto-fill suggested code when adding a new item if code is not set
  React.useEffect(() => {
    if (!editingItem && (!newItem.code || newItem.code.trim() === '')) {
      const suggested = generateNextItemCode(items);
      setNewItem(prev => ({ ...prev, code: suggested }));
    }
  }, [items, editingItem]);

  // Real-time check for duplicate item code
  const activeItemCode = (editingItem ? editingItem.code : newItem.code) || '';
  const isCurrentCodeDuplicate = useMemo(() => {
    const trimmed = activeItemCode.trim().toLowerCase();
    if (!trimmed) return false;
    return items.some(i => 
      (!editingItem || i.id !== editingItem.id) && 
      (i.code || '').trim().toLowerCase() === trimmed
    );
  }, [activeItemCode, items, editingItem]);

  // Reset pagination page on search or category filter change
  React.useEffect(() => {
    setCatalogPage(1);
  }, [itemSearch, itemCategoryFilter]);

  // Units of Measurement list state
  const unitsOfMeasurementList = useMemo(() => {
    return db.unitsOfMeasurement && db.unitsOfMeasurement.length > 0
      ? db.unitsOfMeasurement
      : [
          { id: 'unit-1', name: 'کیلوگرم', symbol: 'kg', description: 'واحد سنجش وزنی اصلی انبار', isActive: true },
          { id: 'unit-2', name: 'عدد', symbol: 'pcs', description: 'واحد شمارش عددی محصولات و کالاها', isActive: true },
          { id: 'unit-3', name: 'لیتر', symbol: 'L', description: 'واحد سنجش حجم مایعات روغن و اسانس', isActive: true },
          { id: 'unit-4', name: 'بسته', symbol: 'pack', description: 'بسته‌بندی‌های چندتایی و پک', isActive: true },
          { id: 'unit-5', name: 'گرم', symbol: 'g', description: 'واحد مصرفی جزئی فرمولاسیون تولید', isActive: true },
          { id: 'unit-6', name: 'متر', symbol: 'm', description: 'طول نایلون و لفاف', isActive: true },
          { id: 'unit-7', name: 'کارتن', symbol: 'box', description: 'کارتن‌های مادر تحویلی', isActive: true },
          { id: 'unit-8', name: 'گونی', symbol: 'sack', description: 'گونی و کیسه مواد اولیه خام', isActive: true }
        ];
  }, [db.unitsOfMeasurement]);

  const [unitSearch, setUnitSearch] = useState('');
  const [editingUnit, setEditingUnit] = useState<UnitOfMeasurement | null>(null);
  const [newUnit, setNewUnit] = useState<{ name: string; symbol: string; description: string }>({
    name: '',
    symbol: '',
    description: ''
  });

  const searchedUnits = useMemo(() => {
    if (!unitSearch) return unitsOfMeasurementList;
    return unitsOfMeasurementList.filter(u => 
      matchPersianString(u.name, unitSearch) || 
      (u.symbol && matchPersianString(u.symbol, unitSearch)) ||
      (u.description && matchPersianString(u.description, unitSearch))
    );
  }, [unitsOfMeasurementList, unitSearch]);

  const handleAddOrUpdateUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnit.name.trim() && !editingUnit?.name.trim()) {
      alert('لطفاً عنوان واحد سنجش اصلی را وارد کنید.');
      return;
    }

    let updatedUnits = [...unitsOfMeasurementList];
    if (editingUnit) {
      updatedUnits = updatedUnits.map(u => u.id === editingUnit.id ? { ...editingUnit, name: editingUnit.name.trim() } : u);
      setEditingUnit(null);
    } else {
      const newObj: UnitOfMeasurement = {
        id: `unit-${Date.now()}`,
        name: newUnit.name.trim(),
        symbol: newUnit.symbol.trim() || 'واحد',
        description: newUnit.description.trim() || 'واحد سنجش انبار',
        isActive: true
      };
      updatedUnits.push(newObj);
      setNewUnit({ name: '', symbol: '', description: '' });
    }

    onUpdateDb({ ...db, unitsOfMeasurement: updatedUnits });
    alert('اطلاعات واحد سنجش با موفقیت ذخیره گردید.');
  };

  const handleDeleteUnit = (unitId: string) => {
    const targetUnit = unitsOfMeasurementList.find(u => u.id === unitId);
    if (!targetUnit) return;
    askConfirm(
      'حذف واحد سنجش اصلی',
      `آیا از حذف واحد سنجش "${targetUnit.name}" اطمینان دارید؟`,
      () => {
        const updated = unitsOfMeasurementList.filter(u => u.id !== unitId);
        onUpdateDb({ ...db, unitsOfMeasurement: updated });
        alert('واحد سنجش با موفقیت حذف گردید.');
      }
    );
  };

  const handleResetDefaultUnits = () => {
    askConfirm(
      'بازنشانی واحدهای سنجش پیش‌فرض',
      'آیا مایل به بازنشانی واحدهای سنجش به حالت اولیه استاندارد انبار هستید؟',
      () => {
        const defaultUnits = [
          { id: 'unit-1', name: 'کیلوگرم', symbol: 'kg', description: 'واحد سنجش وزنی اصلی انبار', isActive: true },
          { id: 'unit-2', name: 'عدد', symbol: 'pcs', description: 'واحد شمارش عددی محصولات و کالاها', isActive: true },
          { id: 'unit-3', name: 'لیتر', symbol: 'L', description: 'واحد سنجش حجم مایعات روغن و اسانس', isActive: true },
          { id: 'unit-4', name: 'بسته', symbol: 'pack', description: 'بسته‌بندی‌های چندتایی و پک', isActive: true },
          { id: 'unit-5', name: 'گرم', symbol: 'g', description: 'واحد مصرفی جزئی فرمولاسیون تولید', isActive: true },
          { id: 'unit-6', name: 'متر', symbol: 'm', description: 'طول نایلون و لفاف', isActive: true },
          { id: 'unit-7', name: 'کارتن', symbol: 'box', description: 'کارتن‌های مادر تحویلی', isActive: true },
          { id: 'unit-8', name: 'گونی', symbol: 'sack', description: 'گونی و کیسه مواد اولیه خام', isActive: true }
        ];
        onUpdateDb({ ...db, unitsOfMeasurement: defaultUnits });
        alert('واحدهای سنجش با موفقیت بازنشانی شدند.');
      }
    );
  };

  const handleBatchDeleteItems = () => {
    if (selectedItemIds.length === 0) {
      alert('لطفاً ابتدا حداقل یک کالا را برای حذف انتخاب کنید.');
      return;
    }
    askConfirm(
      'حذف گروهی کالاها',
      `آیا از حذف گروهی ${toPersianDigits(selectedItemIds.length)} کالا اطمینان دارید؟ تمامی سوابق خرید و فروش پیشین پابرجا می‌مانند اما نام این کالاها از فرآیندهای آتی کسر می‌گردد.`,
      () => {
        onUpdateDb({
          ...db,
          items: db.items.filter(i => !selectedItemIds.includes(i.id))
        });
        setSelectedItemIds([]);
        alert('کالاهای انتخاب شده با موفقیت حذف شدند.');
      }
    );
  };

  const searchedItems = useMemo(() => {
    let list = items;
    if (itemCategoryFilter && itemCategoryFilter !== 'all') {
      list = list.filter(i => i.categoryId === itemCategoryFilter);
    }
    if (itemSearch) {
      list = list.filter(i => 
        matchPersianString(i.name, itemSearch) || 
        matchPersianString(i.accountId, itemSearch) || 
        matchPersianString(i.code, itemSearch) || 
        matchPersianString(i.barcode, itemSearch)
      );
    }
    return list;
  }, [items, itemSearch, itemCategoryFilter]);

  // Paginated items for catalog table
  const paginatedSearchedItems = useMemo(() => {
    if (catalogPageSize === 'all') return searchedItems;
    const start = (catalogPage - 1) * catalogPageSize;
    return searchedItems.slice(start, start + catalogPageSize);
  }, [searchedItems, catalogPage, catalogPageSize]);

  const handleCreateOrUpdateItem = (e: React.FormEvent) => {
    e.preventDefault();
    const isEdit = !!editingItem;
    const stableId = isEdit 
      ? editingItem.id 
      : (newItem.accountId?.trim() || newItem.code?.trim() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const rawCatId = isEdit ? editingItem!.categoryId : newItem.categoryId;
    const hasValidCat = Boolean(rawCatId) && categories.some(c => c.id === rawCatId);
    if (isEdit && categories.length > 0 && !hasValidCat) {
      alert('لطفاً دسته‌بندی کالا را از فهرست انتخاب نمایید.');
      return;
    }
    const resolvedCategoryId = hasValidCat ? String(rawCatId) : (categories[0]?.id || '');
    const targetItem = isEdit
      ? { ...editingItem!, categoryId: resolvedCategoryId }
      : { ...newItem, categoryId: resolvedCategoryId, id: stableId, periodId: activePeriodId } as Item;

    const currentCode = (targetItem.code || '').trim();
    // Validate required fields
    if (!targetItem.name || !currentCode) {
      alert('لطفا فیلدهای کد کالا و نام کالا را به صورت کامل تکمیل کنید.');
      return;
    }

    // Check duplicate product code
    const isDuplicate = items.some(i => 
      (!isEdit || i.id !== editingItem?.id) && 
      (i.code || '').trim().toLowerCase() === currentCode.toLowerCase()
    );

    if (isDuplicate) {
      alert(`کد اختصاصی کالا "${currentCode}" تکراری است و قبلاً برای کالای دیگری ثبت شده است.\nلطفاً یک کد اختصاصی یکتا وارد کنید یا از دکمه «کد پیشنهادی سیستم» استفاده فرمایید.`);
      return;
    }

    let updatedItems = [...db.items];
    let updatedStockCounts = db.stockCounts;
    let updatedFormulas = db.productFormulas;
    if (isEdit) {
      const prevItem = db.items.find(i => i.id === editingItem.id);
      updatedItems = updatedItems.map(i => i.id === editingItem.id ? targetItem : i);
      if (prevItem) {
        const oldKey = getMaterialFormulaKey(prevItem);
        const newKey = getMaterialFormulaKey(targetItem);
        if (newKey && oldKey !== newKey && Array.isArray(db.productFormulas)) {
          updatedFormulas = db.productFormulas.map(f => {
            if (f.periodId !== activePeriodId) return f;
            let changed = false;
            const nextIngs = (f.ingredients || []).map(ing => {
              if (doesIngredientMatchMaterial(ing.rawMaterialId, prevItem)) {
                changed = true;
                return { ...ing, rawMaterialId: newKey };
              }
              return ing;
            });
            return changed ? { ...f, ingredients: nextIngs } : f;
          });
        }
      }
      const pkgWeight = (targetItem.weightPerPackage && targetItem.weightPerPackage > 0) ? targetItem.weightPerPackage : 1;
      updatedStockCounts = db.stockCounts.map(c => {
        if (c.itemId === targetItem.id) {
          const newQty = roundTo2Decimals(((c.fullPackages || 0) * pkgWeight) + (c.looseQty || 0));
          const newVal = roundTo2Decimals(newQty * (targetItem.price || 0));
          return {
            ...c,
            totalCalculatedQty: newQty,
            value: newVal
          };
        }
        return c;
      });
      setEditingItem(null);
    } else {
      updatedItems.push(targetItem);
      // Reset builder with newly computed next available code
      const nextSuggestedCode = generateNextItemCode(updatedItems);
      setNewItem({
        code: nextSuggestedCode,
        accountId: '',
        name: '',
        categoryId: categories[0]?.id || '',
        unit: 'کیلویی',
        barcode: '',
        packageType: 'کارتن',
        qtyPerPackage: 1,
        weightPerPackage: 1,
        reorderThreshold: 10,
        price: 0,
        isActive: true,
        warehouse: ''
      });
    }

    onUpdateDb({ ...db, items: updatedItems, stockCounts: updatedStockCounts, productFormulas: updatedFormulas });
  };

  const deleteItem = (id: string) => {
    askConfirm(
      'حذف کالا',
      'آیا از حذف این کالا اطمینان دارید؟ تمامی سوابق خرید و فروش پیشین پابرجا می‌مانند اما نام این کالا از فرآیندهای آتی کسر می‌گردد.',
      () => {
        onUpdateDb({
          ...db,
          items: db.items.filter(i => i.id !== id)
        });
      }
    );
  };

  const exportItemsCSV = () => {
    const headers = ['کد کالا', 'کد حسابداری', 'نام کالا', 'دسته‌بندی', 'واحد سنجش', 'بارکد', 'بسته‌بندی', 'تعداد در بسته', 'وزن هر بسته', 'آستانه هشدار موجودی', 'قیمت ریالی', 'وضعیت فعال', 'انبار'];
    const rows = items.map(i => [
      i.code,
      i.accountId,
      i.name,
      categoryMap[i.categoryId] || 'مشترک',
      i.unit,
      i.barcode,
      i.packageType,
      i.qtyPerPackage,
      i.weightPerPackage,
      i.reorderThreshold,
      i.price,
      i.isActive ? 'فعال' : 'غیرفعال',
      i.warehouse || ''
    ]);
    downloadCSV('Gatan_Catalog_Items', headers, rows);
  };

  const importItemsCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updatedItems = [...db.items];
      let importCount = 0;
      let updatedCount = 0;

      rows.forEach((row, index) => {
        if (index === 0 || row.length === 0) return; // headers / empty
        const codeVal = (row[0] || '').toString().trim();
        const accountIdVal = (row[1] || '').toString().trim();
        if (!codeVal && !accountIdVal) return;

        // Try mapping category
        const catName = normCat(row[3] || 'مشترک');
        let matchedCat = categories.find(c => normCat(c.name) === catName);
        if (!matchedCat && categories.length > 0) {
          matchedCat = categories[0];
        }

        const priceVal = parseNumber(row[10]) || 0;
        const warehouseVal = row[12] ? row[12].trim() : '';

        // Compare using accountId (if present). If accountId is empty, we fall back to code.
        const duplicateIndex = updatedItems.findIndex(ui => 
          ui.periodId === activePeriodId && 
          (
            (accountIdVal && ui.accountId && ui.accountId.trim() === accountIdVal) ||
            (!accountIdVal && ui.code === codeVal)
          )
        );

        if (duplicateIndex >= 0) {
          // If already registered, update ONLY the base price (قیمت ریالی / price)
          updatedItems[duplicateIndex] = {
            ...updatedItems[duplicateIndex],
            price: priceVal
          };
          if (warehouseVal) {
            updatedItems[duplicateIndex].warehouse = warehouseVal;
          }
          updatedCount++;
        } else {
          // Otherwise, insert as new item
          const tempId = accountIdVal || codeVal || `item-${Date.now()}-${index}`;
          const item: Item = {
            id: tempId,
            periodId: activePeriodId,
            code: codeVal,
            accountId: accountIdVal,
            name: row[2] || 'کالای وارداتی',
            categoryId: matchedCat?.id || '',
            unit: row[4]?.includes('عددی') ? 'عددی' : 'کیلویی',
            barcode: row[5] || '',
            packageType: (row[6] || 'کارتن') as any,
            qtyPerPackage: parseNumber(row[7]) || 1,
            weightPerPackage: parseNumber(row[8]) || 1,
            reorderThreshold: parseNumber(row[9]) || 10,
            price: priceVal,
            isActive: row[11]?.includes('غیر') ? false : true,
            warehouse: warehouseVal
          };
          updatedItems.push(item);
          importCount++;
        }
      });

      onUpdateDb({ ...db, items: updatedItems });
      alert(`عملیات بارگذاری اکسل پایان یافت:\nتعداد ${toPersianDigits(updatedCount)} کالا (به علت تشابه کد حسابداری) قیمت پایه به‌روزرسانی شد.\nتعداد ${toPersianDigits(importCount)} کالا جدید به سامانه افزوده گشت.`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadSampleItemsCSV = () => {
    const headers = ['کد کالا', 'کد حسابداری', 'نام کالا', 'دسته‌بندی', 'واحد سنجش', 'بارکد', 'بسته‌بندی', 'تعداد در بسته', 'وزن هر بسته', 'آستانه هشدار موجودی', 'قیمت ریالی', 'وضعیت فعال', 'انبار'];
    const rows = [
      ['R-101', '102030', 'آرد نول شیرینی', 'آردها', 'کیلویی', '100000000001', 'گونی', '1', '40', '10', '420000', 'فعال', 'انبار مرکزی آرد'],
      ['R-102', '102031', 'روغن مارگارین قنادی', 'روغن‌ها', 'کیلویی', '100000000002', 'کارتن', '1', '10', '5', '950000', 'فعال', 'سردخانه شماره ۱'],
      ['R-103', '102032', 'سلفون بسته‌بندی نهایی', 'لفاف و نایلون', 'عددی', '100000000003', 'رول', '1', '1', '50', '250000', 'فعال', 'سوله ملزومات']
    ];
    downloadCSV('Sample_Gatan_Catalog_Items', headers, rows);
  };

  interface PendingPriceUpdateItem {
    id: string;
    accountId: string;
    code: string;
    name: string;
    categoryId: string;
    unit: 'عددی' | 'کیلویی';
    packageType: 'کارتن' | 'گونی' | 'سطل' | 'حلب';
    qtyPerPackage: number;
    weightPerPackage: number;
    reorderThreshold: number;
    price: number;
    warehouse: string;
  }

  const [unmatchedCatalogPriceItems, setUnmatchedCatalogPriceItems] = useState<PendingPriceUpdateItem[]>([]);

  const handleImportCatalogPrices = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) return;

        const data = new Uint8Array(buffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

        if (rows.length < 2) {
          alert('فایل اکسل تهی است یا سطر داده ندارد.');
          return;
        }

        // Detect column indices based on headers
        const headers = (rows[0] as any[]).map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, ''));
        
        let accountIdIdx = -1;
        let nameIdx = -1;
        let priceIdx = -1;

        headers.forEach((h, idx) => {
          const cleanH = h.replace(/_/, '');
          if (cleanH.includes('حسابداری') || cleanH.includes('معین') || cleanH.includes('account') || cleanH.includes('کدحساب')) {
            accountIdIdx = idx;
          } else if (cleanH.includes('نامکالا') || cleanH.includes('ناممحصول') || cleanH.includes('شرح') || cleanH.includes('عنوان') || cleanH.includes('product') || cleanH === 'نام' || cleanH === 'کالا') {
            if (nameIdx === -1 || cleanH.includes('نامکالا') || cleanH.includes('شرح')) {
              nameIdx = idx;
            }
          } else if (cleanH.includes('قیمت') || cleanH.includes('فی') || cleanH.includes('نرخ') || cleanH.includes('ارزش') || cleanH.includes('مبلغ') || cleanH.includes('price')) {
            if (priceIdx === -1 || cleanH.includes('قیمتواحد') || cleanH.includes('فی') || cleanH.includes('فیخرید') || cleanH.includes('قیمتخرید')) {
              priceIdx = idx;
            }
          }
        });

        // Fallbacks by position
        if (accountIdIdx === -1) accountIdIdx = 0;
        if (nameIdx === -1) nameIdx = 1;
        if (priceIdx === -1) priceIdx = 2;

        let matchedCount = 0;
        const unmatchedList: PendingPriceUpdateItem[] = [];
        const updatedCatalogItems = [...db.items];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as any[];
          if (!row || row.length === 0 || row.every(cell => cell === null || cell === undefined || cell === '')) continue;

          const rawAccountId = (row[accountIdIdx] !== undefined ? String(row[accountIdIdx]).trim() : '');
          const rawName = (row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '');
          const rawPrice = parseNumber(row[priceIdx]) || 0;

          if (!rawAccountId) continue;

          // Check if an item exists with this accounting code (accountId) in catalog
          const existingItemIndex = updatedCatalogItems.findIndex(item => 
            item.periodId === activePeriodId && 
            item.accountId && 
            item.accountId.trim() === rawAccountId
          );

          if (existingItemIndex >= 0) {
            // Update standard price to the imported price
            updatedCatalogItems[existingItemIndex] = {
              ...updatedCatalogItems[existingItemIndex],
              price: rawPrice
            };
            matchedCount++;
          } else {
            // Unmatched item: "در غیر اینصورت اطلاعات کالای جدید را به کاربر نشان بده"
            unmatchedList.push({
              id: `catalog-new-${Date.now()}-${i}`,
              accountId: rawAccountId,
              code: `R-${rawAccountId}`,
              name: rawName || 'کالای جدید اکسل',
              categoryId: categories[0]?.id || '',
              unit: 'کیلویی',
              packageType: 'کارتن',
              qtyPerPackage: 1,
              weightPerPackage: 1,
              reorderThreshold: 10,
              price: rawPrice,
              warehouse: ''
            });
          }
        }

        if (matchedCount > 0) {
          onUpdateDb({
            ...db,
            items: updatedCatalogItems
          });
        }

        setUnmatchedCatalogPriceItems(unmatchedList);

        if (unmatchedList.length === 0) {
          alert(`بروزرسانی قیمت‌ها پایان یافت:\nتعداد ${toPersianDigits(matchedCount)} کالا با کدهای حسابداری تعریف‌شده تطبیق داده شد و آخرین قیمت خرید مرجع آن‌ها اصلاح گردید.`);
        } else {
          alert(`پردازش اکسل انجام شد:\nتعداد ${toPersianDigits(matchedCount)} کلا بروزرسانی شد.\nتعداد ${toPersianDigits(unmatchedList.length)} کالا در کاتالوگ یافت نشد. مقتضی است اطلاعات کسری آن‌ها را جهت تعریف و درج در کاتالوگ تکمیل کنید.`);
        }

      } catch (err) {
        console.error(err);
        alert('خطایی در پردازش رخ داد. لطفاً فرمت اکسل یا CSV را بازبینی فرمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleUnmatchedCatalogItemChange = (index: number, key: keyof PendingPriceUpdateItem, value: any) => {
    const updated = [...unmatchedCatalogPriceItems];
    updated[index] = {
      ...updated[index],
      [key]: value
    } as PendingPriceUpdateItem;
    setUnmatchedCatalogPriceItems(updated);
  };

  const handleCreateUnmatchedCatalogItems = () => {
    const hasEmpty = unmatchedCatalogPriceItems.some(item => !item.code.trim() || !item.name.trim());
    if (hasEmpty) {
      alert('وارد کردن کد کالا و نام کالا برای تمامی ردیف‌ها الزامی است.');
      return;
    }

    const newCatalogList: Item[] = unmatchedCatalogPriceItems.map(item => ({
      id: item.id,
      periodId: activePeriodId,
      code: item.code.trim(),
      accountId: item.accountId.trim(),
      name: item.name.trim(),
      categoryId: item.categoryId || categories[0]?.id || '',
      unit: item.unit,
      barcode: '',
      packageType: item.packageType,
      qtyPerPackage: item.qtyPerPackage,
      weightPerPackage: item.weightPerPackage,
      reorderThreshold: item.reorderThreshold,
      price: item.price,
      isActive: true,
      warehouse: item.warehouse || ''
    }));

    onUpdateDb({
      ...db,
      items: [...db.items, ...newCatalogList]
    });

    setUnmatchedCatalogPriceItems([]);
    alert('کالاهای جدید با موفقیت به بخش تعریف کالاها افزوده شدند.');
  };


  // ==========================================
  // TAB 2: PACKAGING / CATEGORIES (دسته‌بندی کالا)
  // ==========================================
  const [catSearch, setCatSearch] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catNameInput, setCatNameInput] = useState('');
  const [newCatName, setNewCatName] = useState('');

  const searchedCategories = useMemo(() => {
    if (!catSearch) return categories;
    return categories.filter(c => matchPersianString(c.name, catSearch));
  }, [categories, catSearch]);

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) {
      alert('لطفاً نام دسته‌بندی کالا را وارد نمایید.');
      return;
    }
    const normNew = normCat(trimmed);
    if (db.itemCategories.some(c => c.periodId === activePeriodId && normCat(c.name) === normNew)) {
      alert(`دسته‌بندی «${trimmed}» قبلاً در این دوره ثبت شده است.`);
      return;
    }

    const newCatObj: ItemCategory = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      periodId: activePeriodId,
      name: trimmed
    };

    onUpdateDb({
      ...db,
      itemCategories: [...db.itemCategories, newCatObj]
    });
    setNewCatName('');
  };

  const saveCategoryEdit = (id: string) => {
    const trimmed = catNameInput.trim();
    if (!trimmed) {
      alert('نام دسته‌بندی نمی‌تواند خالی باشد.');
      return;
    }
    const normEdited = normCat(trimmed);
    if (db.itemCategories.some(c => c.id !== id && c.periodId === activePeriodId && normCat(c.name) === normEdited)) {
      alert(`دسته‌بندی دیگری با نام «${trimmed}» در این دوره وجود دارد.`);
      return;
    }
    onUpdateDb({
      ...db,
      itemCategories: db.itemCategories.map(c => c.id === id ? { ...c, name: trimmed } : c)
    });
    setEditingCatId(null);
  };

  const deleteCategory = (id: string) => {
    askConfirm(
      'حذف دسته‌بندی کالا',
      'در صورت حذف دسته‌بندی، کالاهای زیرمجموعه آن به دسته‌بندی اول ارجاع داده خواهند شد. آیا ادامه میدهید؟',
      () => {
        const remainingCategories = db.itemCategories.filter(c => c.id !== id);
        const fallbackCatId = remainingCategories.find(c => c.periodId === activePeriodId)?.id || '';
        const reassignedItems = db.items.map(item =>
          item.periodId === activePeriodId && item.categoryId === id
            ? { ...item, categoryId: fallbackCatId }
            : item
        );
        onUpdateDb({
          ...db,
          itemCategories: remainingCategories,
          items: reassignedItems
        });
      }
    );
  };

  const exportCategoryCSV = () => {
    const headers = ['شناسه ردیف', 'دسته‌بندی مواد اولیه کالا'];
    const rows = categories.map(c => [c.id, c.name]);
    downloadCSV('Gatan_Item_Categories', headers, rows);
  };

  const importCategoryCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updatedCats = [...db.itemCategories];
      let importCount = 0;

      rows.forEach((row, index) => {
        if (index === 0 || row.length === 0) return;
        const nameVal = String(row[1] || row[0] || '').trim();
        const normName = normCat(nameVal);
        if (!normName) return;

        // Ensure no duplicate name in current period
        if (!updatedCats.some(c => c.periodId === activePeriodId && normCat(c.name) === normName)) {
          updatedCats.push({
            id: `cat-imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
            periodId: activePeriodId,
            name: nameVal
          });
          importCount++;
        }
      });

      onUpdateDb({ ...db, itemCategories: updatedCats });
      alert(`${toPersianDigits(importCount)} دسته‌بندی جدید با موفقیت اضافه شد.`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadSampleCategoriesCSV = () => {
    const headers = ['شناسه ردیف', 'دسته‌بندی مواد اولیه کالا'];
    const rows = [
      ['', 'آردها'],
      ['', 'روغن‌ها'],
      ['', 'لفاف و نایلون']
    ];
    downloadCSV('Sample_Gatan_Item_Categories', headers, rows);
  };

  const clearAllItems = () => {
    askConfirm(
      'حذف گروهی کالاها',
      'آیا از حذف کلی تمامی کالاها و مواد اولیه ثبت شده در این دوره مالی گاتان اطمینان کامل دارید؟ این عملیات غیرقابل بازگشت است و تمام رکوردهای کالا پاک می‌گردد.',
      () => {
        const remainingItems = db.items.filter(i => i.periodId !== activePeriodId);
        onUpdateDb({ ...db, items: remainingItems });
      }
    );
  };

  const clearAllCategories = () => {
    askConfirm(
      'حذف کلی دسته‌بندی‌ها',
      'آیا از حذف کلی تمامی دسته‌بندی‌های مواد اولیه ثبت شده در این بازه اطمینان کامل دارید؟ تمام دسته‌های تعریف شده کالا در این دوره حذف خواهند شد.',
      () => {
        const remainingCats = db.itemCategories.filter(c => c.periodId !== activePeriodId);
        const clearedItems = db.items.map(i => i.periodId === activePeriodId ? { ...i, categoryId: '' } : i);
        onUpdateDb({ ...db, itemCategories: remainingCats, items: clearedItems });
      }
    );
  };


  // ==========================================
  // TAB 3: PURCHASE INVOICES (ثبت فاکتور خرید)
  // ==========================================
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayJalali());
  const [invoiceNo, setInvoiceNo] = useState('');
  
  // Builder state for adding items to current active invoice
  const [invoiceItems, setInvoiceItems] = useState<PurchaseInvoiceItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [invoiceItemQty, setInvoiceItemQty] = useState(1);
  const [invoiceItemPrice, setInvoiceItemPrice] = useState(0);
  const [packCountInput, setPackCountInput] = useState(0);

  interface PendingUnmatchedItem {
    id: string;
    accountId: string;
    code: string;
    name: string;
    categoryId: string;
    unit: 'عددی' | 'کیلویی';
    packageType: 'کارتن' | 'گونی' | 'سطل' | 'حلب';
    qtyPerPackage: number;
    weightPerPackage: number;
    reorderThreshold: number;
    qty: number;
    price: number;
  }

  const [unmatchedPurchasedItems, setUnmatchedPurchasedItems] = useState<PendingUnmatchedItem[]>([]);

  const handleUnmatchedItemChange = (index: number, key: keyof PendingUnmatchedItem, value: any) => {
    const updated = [...unmatchedPurchasedItems];
    updated[index] = {
      ...updated[index],
      [key]: value
    } as PendingUnmatchedItem;
    setUnmatchedPurchasedItems(updated);
  };

  const handleImportPurchaseInvoiceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) return;

        const data = new Uint8Array(buffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

        if (rows.length < 2) {
          alert('فایل اکسل تهی است یا سطر داده ندارد.');
          return;
        }

        // Detect column indices based on headers
        const headers = (rows[0] as any[]).map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, ''));
        
        let accountIdIdx = -1;
        let nameIdx = -1;
        let qtyIdx = -1;
        let priceIdx = -1;
        let codeIdx = -1;

        headers.forEach((h, idx) => {
          const cleanH = h.replace(/_/, '');
          if (cleanH.includes('حسابداری') || cleanH.includes('معین') || cleanH.includes('account') || cleanH.includes('کدحساب')) {
            accountIdIdx = idx;
          } else if (cleanH.includes('نامکالا') || cleanH.includes('ناممحصول') || cleanH.includes('شرح') || cleanH.includes('عنوان') || cleanH.includes('product') || cleanH === 'نام' || cleanH === 'کالا') {
            if (nameIdx === -1 || cleanH.includes('نامکالا') || cleanH.includes('شرح')) {
              nameIdx = idx;
            }
          } else if (cleanH.includes('تعداد') || cleanH.includes('مقدار') || cleanH.includes('حجم') || cleanH.includes('وزن') || cleanH.includes('qty') || cleanH.includes('quantity')) {
            qtyIdx = idx;
          } else if (cleanH.includes('قیمت') || cleanH.includes('فی') || cleanH.includes('نرخ') || cleanH.includes('ارزش') || cleanH.includes('مبلغ') || cleanH.includes('price')) {
            if (priceIdx === -1 || cleanH.includes('قیمتواحد') || cleanH.includes('فی')) {
              priceIdx = idx;
            }
          } else if (cleanH.includes('کدکالا') || cleanH.includes('کدمحصول') || cleanH.includes('code') || cleanH === 'کد') {
            codeIdx = idx;
          }
        });

        // Fallbacks by position if headers are not detected
        if (accountIdIdx === -1) accountIdIdx = 0;
        if (nameIdx === -1) nameIdx = 1;
        if (qtyIdx === -1) qtyIdx = 2;
        if (priceIdx === -1) priceIdx = 3;

        let matchedCount = 0;
        const unmatchedList: PendingUnmatchedItem[] = [];
        const updatedCatalogItems = [...db.items];
        const newlyAddedInvoiceItems: PurchaseInvoiceItem[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as any[];
          if (!row || row.length === 0 || row.every(cell => cell === null || cell === undefined || cell === '')) continue;

          const rawAccountId = (row[accountIdIdx] !== undefined ? String(row[accountIdIdx]).trim() : '');
          const rawName = (row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '');
          const rawQty = parseNumber(row[qtyIdx]) || 1;
          const rawPrice = parseNumber(row[priceIdx]) || 0;
          const rawCode = (codeIdx !== -1 && row[codeIdx] !== undefined) ? String(row[codeIdx]).trim() : `R-${rawAccountId}`;

          if (!rawAccountId) continue;

          // Check if an item exists with this accounting code (accountId) in catalog
          const existingItemIndex = updatedCatalogItems.findIndex(item => 
            item.periodId === activePeriodId && 
            item.accountId && 
            item.accountId.trim() === rawAccountId
          );

          if (existingItemIndex >= 0) {
            // Update standard price to the imported price: "فقط قیمت خرید را در بخش تعریف کالا اصلاح کن"
            updatedCatalogItems[existingItemIndex] = {
              ...updatedCatalogItems[existingItemIndex],
              price: rawPrice
            };
            matchedCount++;

            // Push to current invoice builder items list
            newlyAddedInvoiceItems.push({
              itemId: updatedCatalogItems[existingItemIndex].id,
              qty: rawQty,
              price: rawPrice,
              packageCount: Math.ceil(rawQty / (updatedCatalogItems[existingItemIndex].qtyPerPackage || 1))
            });
          } else {
            // Unmatched item: "کالای جدید را به کاربر نشان بده و اطلاعات مورد نیاز تعریف کالا را از کاربر بگیر"
            unmatchedList.push({
              id: `unmatched-${Date.now()}-${i}`,
              accountId: rawAccountId,
              code: rawCode || `K-${rawAccountId}`,
              name: rawName || 'کالای وارداتی تدارک',
              categoryId: categories[0]?.id || '',
              unit: 'کیلویی',
              packageType: 'کارتن',
              qtyPerPackage: 1,
              weightPerPackage: 1,
              reorderThreshold: 10,
              qty: rawQty,
              price: rawPrice
            });
          }
        }

        if (matchedCount > 0) {
          onUpdateDb({
            ...db,
            items: updatedCatalogItems
          });

          setInvoiceItems(prev => {
            const merged = [...prev];
            newlyAddedInvoiceItems.forEach(newItem => {
              const idx = merged.findIndex(mi => mi.itemId === newItem.itemId);
              if (idx >= 0) {
                merged[idx] = newItem;
              } else {
                merged.push(newItem);
              }
            });
            return merged;
          });
        }

        setUnmatchedPurchasedItems(unmatchedList);

        if (unmatchedList.length === 0) {
          alert(`تعداد ${toPersianDigits(matchedCount)} کالا با کدهای حسابداری تعریف‌شده تطبیق داده شد و قیمت مرجع آن‌ها اصلاح و به فاکتور خرید افزوده شد.`);
        } else {
          alert(`فایل پردازش شد:\nتعداد ${toPersianDigits(matchedCount)} کالا تطبیق داده شد و قیمت آن‌ها اصلاح شد.\nتعداد ${toPersianDigits(unmatchedList.length)} کالا با این کدهای حسابداری یافت نشدند که باید مشخصات آن‌ها را برای ثبت در سامانه تکمیل نمایید.`);
        }

      } catch (err) {
        console.error(err);
        alert('خطایی در پردازش رخ داد. لطفاً فرمت اکسل یا CSV را بازبینی فرمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset file input value so same file can be selected again
    e.target.value = '';
  };

  const handleAddUnmatchedItemsToCatalog = () => {
    const hasEmpty = unmatchedPurchasedItems.some(item => !item.code.trim() || !item.name.trim());
    if (hasEmpty) {
      alert('وارد کردن کد کالا و نام کالا برای تمامی ردیف‌ها الزامی است.');
      return;
    }

    const newCatalogItems: Item[] = unmatchedPurchasedItems.map(item => ({
      id: item.id,
      periodId: activePeriodId,
      code: item.code.trim(),
      accountId: item.accountId.trim(),
      name: item.name.trim(),
      categoryId: item.categoryId,
      unit: item.unit,
      barcode: '',
      packageType: item.packageType,
      qtyPerPackage: item.qtyPerPackage,
      weightPerPackage: item.weightPerPackage,
      reorderThreshold: item.reorderThreshold,
      price: item.price,
      isActive: true,
      warehouse: ''
    }));

    const updatedItems = [...db.items, ...newCatalogItems];
    onUpdateDb({
      ...db,
      items: updatedItems
    });

    const newInvoiceRows: PurchaseInvoiceItem[] = unmatchedPurchasedItems.map(item => ({
      itemId: item.id,
      qty: item.qty,
      price: item.price,
      packageCount: Math.ceil(item.qty / (item.qtyPerPackage || 1))
    }));

    setInvoiceItems(prev => [...prev, ...newInvoiceRows]);
    setUnmatchedPurchasedItems([]);
    alert('کالاهای جدید با موفقیت به بخش تعریف کالاها افزوده شدند و در فاکتور خرید در حال ویرایش ثبت گردیدند.');
  };

  const selectedItemData = useMemo(() => {
    return activeItemsList.find(i => i.id === selectedItemId);
  }, [activeItemsList, selectedItemId]);

  const handleSupplierChange = (e: any) => {
    setSelectedSupplierId(e.target.value);
    setInvoiceItems([]);
  };

  const handleItemSelectChanges = (id: string) => {
    setSelectedItemId(id);
    const item = activeItemsList.find(i => i.id === id);
    if (item) {
      setInvoiceItemPrice(item.price);
    }
  };

  const addPurchaseItemToCurrentSession = () => {
    if (!selectedItemId) {
      alert('لطفا کالا را انتخاب کنید.');
      return;
    }
    
    const existingIndex = invoiceItems.findIndex(i => i.itemId === selectedItemId);
    const finalPackCount = packCountInput || Math.ceil(invoiceItemQty / (selectedItemData?.qtyPerPackage || 1));
    const newItemRow: PurchaseInvoiceItem = {
      itemId: selectedItemId,
      qty: invoiceItemQty,
      price: invoiceItemPrice,
      packageCount: finalPackCount
    };

    if (existingIndex >= 0) {
      const updated = [...invoiceItems];
      updated[existingIndex] = newItemRow;
      setInvoiceItems(updated);
    } else {
      setInvoiceItems([...invoiceItems, newItemRow]);
    }

    // Reset single row state
    setSelectedItemId('');
    setInvoiceItemQty(1);
    setInvoiceItemPrice(0);
    setPackCountInput(0);
  };

  const saveFullInvoice = () => {
    if (!selectedSupplierId) {
      alert('انتخاب تامین کننده اجباری است.');
      return;
    }
    if (invoiceItems.length === 0) {
      alert('باید حداقل یک ردیف کالا به صورت خرید در فاکتور ثبت شده باشد.');
      return;
    }

    const newInvoice: PurchaseInvoice = {
      id: `inv-${Date.now()}`,
      periodId: activePeriodId,
      supplierId: selectedSupplierId,
      date: invoiceDate,
      invoiceNumber: invoiceNo || `F-${Date.now().toString().slice(-4)}`,
      items: invoiceItems
    };

    // Update standard base pricing for items registered in the invoice
    // "قیمت ریالی" updates to the latest buy price
    const itemUpdates = db.items.map(item => {
      const invoiceRow = invoiceItems.find(i => i.itemId === item.id);
      if (invoiceRow) {
        return { ...item, price: invoiceRow.price };
      }
      return item;
    });

    onUpdateDb({
      ...db,
      purchaseInvoices: [...db.purchaseInvoices, newInvoice],
      items: itemUpdates
    });

    // Clear builder states
    setInvoiceItems([]);
    setInvoiceNo('');
    alert('فاکتور خرید کالا با موفقیت ثبت گردید و آخرین قیمت خرید مرجع کالاها به‌روزرسانی شد.');
  };

  const removeInvoice = (id: string) => {
    askConfirm(
      'حذف فاکتور خرید',
      'آیا از حذف این فاکتور مطمئن هستید؟ این فرآیند رکوردهای این فاکتور فیزیکی را به صورت معکوس از انبار برمی‌گرداند.',
      () => {
        onUpdateDb({
          ...db,
          purchaseInvoices: db.purchaseInvoices.filter(p => p.id !== id)
        });
      }
    );
  };

  const exportPurchasesCSV = () => {
    const headers = ['کد فاکتور', 'تاریخ فاکتور', 'نام تامین کننده', 'کد حسابداری کالا', 'نام کالا', 'تعداد خرید', 'قیمت واحد', 'مجموع ریالی'];
    const rows: any[][] = [];
    
    purchases.forEach(p => {
      const supplierName = db.suppliers.find(s => s.id === p.supplierId)?.name || 'ناشناس';
      p.items.forEach(it => {
        const itemInfo = itemMap[it.itemId];
        if (!itemInfo) return;
        rows.push([
          p.invoiceNumber,
          p.date,
          supplierName,
          itemInfo.accountId,
          itemInfo.name,
          it.qty,
          it.price,
          it.qty * it.price
        ]);
      });
    });

    downloadCSV('Gatan_Purchase_Invoices_Detailed', headers, rows);
  };


  // ==========================================
  // TAB 5: WAREHOUSE DEFINITIONS (تعریف انبارها)
  // ==========================================
  const warehouses = useMemo(() => (db.warehouses || []).filter(w => w.periodId === activePeriodId), [db.warehouses, activePeriodId]);
  const [newWhName, setNewWhName] = useState('');
  const [newWhCode, setNewWhCode] = useState('');
  const [newWhLocation, setNewWhLocation] = useState('');
  const [whSearch, setWhSearch] = useState('');
  const [editingWhId, setEditingWhId] = useState<string | null>(null);

  const searchedWarehouses = useMemo(() => {
    return warehouses.filter(w => 
      matchPersianString(w.name, whSearch) || 
      matchPersianString(w.code || '', whSearch) || 
      matchPersianString(w.location || '', whSearch)
    );
  }, [warehouses, whSearch]);

  const handleAddOrUpdateWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim()) {
      alert('لطفاً نام انبار را وارد کنید.');
      return;
    }

    const currentWhs = db.warehouses || [];
    let updatedWhs = [...currentWhs];

    if (editingWhId) {
      updatedWhs = updatedWhs.map(w => w.id === editingWhId ? {
        ...w,
        name: newWhName.trim(),
        code: newWhCode.trim(),
        location: newWhLocation.trim()
      } : w);
      setEditingWhId(null);
    } else {
      const codeToUse = newWhCode.trim() || `WH-${Date.now().toString().slice(-4)}`;
      if (currentWhs.some(w => w.periodId === activePeriodId && w.code?.trim().toLowerCase() === codeToUse.toLowerCase())) {
        alert('کد انبار وارد شده تکراری است.');
        return;
      }

      const newWh = {
        id: `wh-${Date.now()}`,
        periodId: activePeriodId,
        name: newWhName.trim(),
        code: codeToUse,
        location: newWhLocation.trim(),
        isActive: true
      };
      updatedWhs.push(newWh);
    }

    onUpdateDb({
      ...db,
      warehouses: updatedWhs
    });

    setNewWhName('');
    setNewWhCode('');
    setNewWhLocation('');
  };

  const handleDeleteWarehouse = (id: string, name: string) => {
    askConfirm(
      'حذف انبار',
      `آیا از حذف انبار "${name}" اطمینان دارید؟ کالاها در این انبار ممکن است فاقد انبار تعریف شده گردند.`,
      () => {
        const currentWhs = db.warehouses || [];
        const updatedWhs = currentWhs.filter(w => w.id !== id);
        onUpdateDb({
          ...db,
          warehouses: updatedWhs
        });
      }
    );
  };

  const handleEditWarehouse = (w: any) => {
    setEditingWhId(w.id);
    setNewWhName(w.name);
    setNewWhCode(w.code || '');
    setNewWhLocation(w.location || '');
  };

  const handleCancelWhEdit = () => {
    setEditingWhId(null);
    setNewWhName('');
    setNewWhCode('');
    setNewWhLocation('');
  };


  // ==========================================
  // TAB 4: INVENTORY AUDITS (انبارگردانی و شمارش)
  // ==========================================
  const [selectedAuditId, setSelectedAuditId] = useState(audits[0]?.id || '');
  const [newAuditTitle, setNewAuditTitle] = useState('');
  const [newAuditDate, setNewAuditDate] = useState(getTodayJalali());

  // Input states for counting inside selected audit cycle
  const [countWarehouseFilter, setCountWarehouseFilter] = useState<string>('all');
  const [countingWarehouse, setCountingWarehouse] = useState<string>('all');
  const [countSearchQuery, setCountSearchQuery] = useState<string>('');
  const [countViewMode, setCountViewMode] = useState<'detailed' | 'aggregated'>('detailed');
  const [countPageSize, setCountPageSize] = useState<number | 'all'>(100);
  const [countPage, setCountPage] = useState<number>(1);
  
  // Specific count recording states
  const [countItemId, setCountItemId] = useState('');
  const [countPacks, setCountPacks] = useState(0);
  const [countLoose, setCountLoose] = useState(0);
  const [countRecordWarehouse, setCountRecordWarehouse] = useState<string>('');
  const [countShelfLocation, setCountShelfLocation] = useState<string>('');
  const [countNotes, setCountNotes] = useState<string>('');
  const [editingCountId, setEditingCountId] = useState<string | null>(null);

  // Quick Edit Item Master Modal states
  const [isQuickEditItemModalOpen, setIsQuickEditItemModalOpen] = useState(false);
  const [quickEditItem, setQuickEditItem] = useState<Item | null>(null);

  const countableItemsList = useMemo(() => {
    if (countingWarehouse === 'all') return activeItemsList;
    if (countingWarehouse === 'none') return activeItemsList.filter(i => !i.warehouse);
    return activeItemsList.filter(i => i.warehouse === countingWarehouse);
  }, [activeItemsList, countingWarehouse]);

  const activeAuditData = useMemo(() => {
    return audits.find(a => a.id === selectedAuditId);
  }, [audits, selectedAuditId]);

  const activeCounts = useMemo(() => {
    return counts.filter(c => c.auditId === selectedAuditId);
  }, [counts, selectedAuditId]);

  const countedWarehouses = useMemo(() => {
    const set = new Set<string>();
    activeCounts.forEach(c => {
      const raw = itemMap[c.itemId];
      const wh = (c.warehouse || raw?.warehouse || '').trim();
      if (wh) {
        set.add(wh);
      } else {
        set.add('فاقد انبار مشخص');
      }
    });
    return Array.from(set);
  }, [activeCounts, itemMap]);

  // Aggregated counts per item: sums fullPackages, looseQty, totalCalculatedQty, and value into a single row per item
  const aggregatedCounts = useMemo(() => {
    const map = new Map<string, {
      itemId: string;
      itemObj: Item | undefined;
      totalPackages: number;
      totalLooseQty: number;
      totalCalculatedQty: number;
      totalValue: number;
      warehouses: string[];
      recordsCount: number;
      countIds: string[];
    }>();

    activeCounts.forEach(c => {
      const itemObj = itemMap[c.itemId];
      const wh = (c.warehouse || itemObj?.warehouse || 'فاقد انبار مشخص').trim();
      
      const existing = map.get(c.itemId);
      if (existing) {
        existing.totalPackages += (c.fullPackages || 0);
        existing.totalLooseQty += (c.looseQty || 0);
        existing.totalCalculatedQty += (c.totalCalculatedQty || 0);
        existing.totalValue += (c.value || 0);
        if (wh && !existing.warehouses.includes(wh)) {
          existing.warehouses.push(wh);
        }
        existing.recordsCount += 1;
        existing.countIds.push(c.id);
      } else {
        map.set(c.itemId, {
          itemId: c.itemId,
          itemObj,
          totalPackages: c.fullPackages || 0,
          totalLooseQty: c.looseQty || 0,
          totalCalculatedQty: c.totalCalculatedQty || 0,
          totalValue: c.value || 0,
          warehouses: wh ? [wh] : [],
          recordsCount: 1,
          countIds: [c.id]
        });
      }
    });

    const result = Array.from(map.values());
    result.forEach(item => {
      item.totalValue = roundTo2Decimals(item.totalValue);
      item.totalCalculatedQty = roundTo2Decimals(item.totalCalculatedQty);
    });
    return result;
  }, [activeCounts, itemMap]);

  // Filtered detailed counts for active table view
  const filteredActiveCounts = useMemo(() => {
    let result = activeCounts;

    if (countWarehouseFilter !== 'all') {
      result = result.filter(c => {
        const raw = itemMap[c.itemId];
        const wh = (c.warehouse || raw?.warehouse || 'فاقد انبار مشخص').trim();
        return wh === countWarehouseFilter;
      });
    }

    if (countSearchQuery.trim()) {
      const q = countSearchQuery.trim();
      result = result.filter(c => {
        const raw = itemMap[c.itemId];
        const wh = c.warehouse || raw?.warehouse || '';
        const cat = raw ? categoryMap[raw.categoryId] || '' : '';
        return (
          matchPersianString(raw?.name || '', q) ||
          matchPersianString(raw?.code || '', q) ||
          matchPersianString(raw?.accountId || '', q) ||
          matchPersianString(raw?.barcode || '', q) ||
          matchPersianString(wh, q) ||
          matchPersianString(cat, q) ||
          matchPersianString(c.shelfLocation || '', q) ||
          matchPersianString(c.notes || '', q)
        );
      });
    }

    return result;
  }, [activeCounts, countWarehouseFilter, countSearchQuery, itemMap, categoryMap]);

  // Filtered aggregated counts for aggregated table view
  const filteredAggregatedCounts = useMemo(() => {
    let result = aggregatedCounts;

    if (countWarehouseFilter !== 'all') {
      result = result.filter(item => item.warehouses.includes(countWarehouseFilter));
    }

    if (countSearchQuery.trim()) {
      const q = countSearchQuery.trim();
      result = result.filter(item => {
        const raw = item.itemObj;
        const whStr = item.warehouses.join(' ');
        const cat = raw ? categoryMap[raw.categoryId] || '' : '';
        return (
          matchPersianString(raw?.name || '', q) ||
          matchPersianString(raw?.code || '', q) ||
          matchPersianString(raw?.accountId || '', q) ||
          matchPersianString(raw?.barcode || '', q) ||
          matchPersianString(whStr, q) ||
          matchPersianString(cat, q)
        );
      });
    }

    return result;
  }, [aggregatedCounts, countWarehouseFilter, countSearchQuery, categoryMap]);

  // Reset count page on search, view mode or audit change
  React.useEffect(() => {
    setCountPage(1);
  }, [countSearchQuery, countViewMode, selectedAuditId]);

  // Paginated detailed counts
  const paginatedActiveCounts = useMemo(() => {
    if (countPageSize === 'all') return filteredActiveCounts;
    const start = (countPage - 1) * countPageSize;
    return filteredActiveCounts.slice(start, start + countPageSize);
  }, [filteredActiveCounts, countPage, countPageSize]);

  // Paginated aggregated counts
  const paginatedAggregatedCounts = useMemo(() => {
    if (countPageSize === 'all') return filteredAggregatedCounts;
    const start = (countPage - 1) * countPageSize;
    return filteredAggregatedCounts.slice(start, start + countPageSize);
  }, [filteredAggregatedCounts, countPage, countPageSize]);

  const auditValuation = useMemo(() => {
    let tot = 0;
    activeCounts.forEach(c => tot += (c.value || 0));
    return roundTo2Decimals(tot);
  }, [activeCounts]);

  const selectedCountItemData = useMemo(() => {
    return activeItemsList.find(i => i.id === countItemId);
  }, [activeItemsList, countItemId]);

  const calculatedLiveCountVal = useMemo(() => {
    if (!selectedCountItemData) return { qty: 0, val: 0 };
    const packageWeight = (selectedCountItemData.weightPerPackage && selectedCountItemData.weightPerPackage > 0)
      ? selectedCountItemData.weightPerPackage
      : 1;
    const qty = (countPacks * packageWeight) + countLoose;
    const roundedQty = roundTo2Decimals(qty);
    const val = roundTo2Decimals(roundedQty * (selectedCountItemData.price || 0));
    return { qty: roundedQty, val };
  }, [selectedCountItemData, countPacks, countLoose]);

  const createNewAudit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAuditTitle.trim()) return;

    const newAuditObj: StockCountAudit = {
      id: `aud-${Date.now()}`,
      periodId: activePeriodId,
      title: newAuditTitle.trim(),
      date: newAuditDate
    };

    onUpdateDb({
      ...db,
      stockCountAudits: [...db.stockCountAudits, newAuditObj]
    });
    setNewAuditTitle('');
    setSelectedAuditId(newAuditObj.id);
  };

  const handleStartEditCount = (count: StockCount) => {
    const raw = itemMap[count.itemId];
    setEditingCountId(count.id);
    setCountItemId(count.itemId);
    setCountPacks(count.fullPackages || 0);
    setCountLoose(count.looseQty || 0);
    setCountRecordWarehouse(count.warehouse || raw?.warehouse || '');
    setCountShelfLocation(count.shelfLocation || '');
    setCountNotes(count.notes || '');

    // Scroll smoothly to counting form
    const formCard = document.getElementById('stock-count-form-card');
    if (formCard) {
      formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleCancelEditCount = () => {
    setEditingCountId(null);
    setCountItemId('');
    setCountPacks(0);
    setCountLoose(0);
    setCountRecordWarehouse('');
    setCountShelfLocation('');
    setCountNotes('');
  };

  const handleAddOrUpdateCount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuditId) {
      alert('ابتدا یک دوره انبارگردانی معتبر را انتخاب یا ایجاد نمایید.');
      return;
    }
    if (!countItemId) {
      alert('نام کالا را جهت شمارش انتخاب کنید.');
      return;
    }

    const { qty, val } = calculatedLiveCountVal;
    const roundedQty = roundTo2Decimals(qty);
    const roundedVal = roundTo2Decimals(val);
    let updatedCounts = [...db.stockCounts];
    const resolvedWarehouse = countRecordWarehouse.trim() || selectedCountItemData?.warehouse || (countingWarehouse !== 'all' && countingWarehouse !== 'none' ? countingWarehouse : '');

    if (editingCountId) {
      // Update specific existing count record
      updatedCounts = updatedCounts.map(c => c.id === editingCountId ? {
        ...c,
        itemId: countItemId,
        fullPackages: countPacks,
        looseQty: countLoose,
        totalCalculatedQty: roundedQty,
        value: roundedVal,
        warehouse: resolvedWarehouse,
        shelfLocation: countShelfLocation.trim(),
        notes: countNotes.trim()
      } : c);
      setEditingCountId(null);
    } else {
      // Add a distinct record for this count (allows recording same item in different warehouses or locations without overwriting)
      updatedCounts.push({
        id: `sc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        auditId: selectedAuditId,
        periodId: activePeriodId,
        itemId: countItemId,
        fullPackages: countPacks,
        looseQty: countLoose,
        totalCalculatedQty: roundedQty,
        value: roundedVal,
        warehouse: resolvedWarehouse,
        shelfLocation: countShelfLocation.trim(),
        notes: countNotes.trim(),
        countDate: getTodayJalali()
      });
    }

    onUpdateDb({ ...db, stockCounts: updatedCounts });
    
    // Clear item selector and inputs
    setCountItemId('');
    setCountPacks(0);
    setCountLoose(0);
    setCountRecordWarehouse('');
    setCountShelfLocation('');
    setCountNotes('');
  };

  const deleteCount = (id: string) => {
    askConfirm(
      'حذف شمارش کالا',
      'آیا مایل به حذف این رکورد شمارش کالا در انبارگردانی هستید؟',
      () => {
        onUpdateDb({
          ...db,
          stockCounts: db.stockCounts.filter(c => c.id !== id)
        });
        if (editingCountId === id) {
          handleCancelEditCount();
        }
      }
    );
  };

  // Quick edit item master handlers
  const openQuickEditItem = (item: Item) => {
    setQuickEditItem({ ...item });
    setIsQuickEditItemModalOpen(true);
  };

  const handleSaveQuickEditItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickEditItem) return;
    if (!quickEditItem.name.trim() || !quickEditItem.code.trim()) {
      alert('لطفاً نام کالا و کد سیستم کالا را به طور کامل وارد نمایید.');
      return;
    }

    const updatedItem: Item = {
      ...quickEditItem,
      name: quickEditItem.name.trim(),
      code: quickEditItem.code.trim(),
      accountId: (quickEditItem.accountId || '').trim(),
      barcode: (quickEditItem.barcode || '').trim(),
      qtyPerPackage: Math.max(1, parseNumber(quickEditItem.qtyPerPackage) || 1),
      weightPerPackage: Math.max(0.001, parseNumber(quickEditItem.weightPerPackage) || 1),
      price: Math.max(0, parseNumber(quickEditItem.price) || 0),
      reorderThreshold: Math.max(0, parseNumber(quickEditItem.reorderThreshold) || 0)
    };

    // 1. Update items in catalog
    const updatedItems = db.items.map(i => i.id === updatedItem.id ? updatedItem : i);

    // 2. Synchronize all existing stock counts for this item so quantities and values update automatically
    const packageWeight = (updatedItem.weightPerPackage && updatedItem.weightPerPackage > 0) ? updatedItem.weightPerPackage : 1;
    const updatedStockCounts = db.stockCounts.map(c => {
      if (c.itemId === updatedItem.id) {
        const newQty = roundTo2Decimals(((c.fullPackages || 0) * packageWeight) + (c.looseQty || 0));
        const newVal = roundTo2Decimals(newQty * updatedItem.price);
        return {
          ...c,
          totalCalculatedQty: newQty,
          value: newVal
        };
      }
      return c;
    });

    onUpdateDb({
      ...db,
      items: updatedItems,
      stockCounts: updatedStockCounts
    });

    setIsQuickEditItemModalOpen(false);
    setQuickEditItem(null);
  };

  const clearAllPurchases = () => {
    askConfirm(
      'حذف گروهی فاکتورها',
      'آیا از حذف کلی تمامی فاکتورهای خرید ثبت شده در این دوره جاری انبار کالاها اطمینان دارید؟ این فرآیند تمام رکوردهای خرید را پاک می‌کند.',
      () => {
        const remainingPurchases = db.purchaseInvoices.filter(p => p.periodId !== activePeriodId);
        onUpdateDb({ ...db, purchaseInvoices: remainingPurchases });
      }
    );
  };

  const clearAllCounts = () => {
    if (!selectedAuditId) {
      alert('لطفاً ابتدا یک چرخه یا دوره انبارگردانی انتخاب کنید.');
      return;
    }
    askConfirm(
      'حذف همگانی شمارش‌ها',
      'آیا مایلید تمامی رکوردهای شمارش کالا در این چرخه انبارگردانی به صورت یکجا حذف شوند؟',
      () => {
        const remainingCounts = db.stockCounts.filter(c => c.auditId !== selectedAuditId);
        onUpdateDb({ ...db, stockCounts: remainingCounts });
        handleCancelEditCount();
      }
    );
  };

  const clearAllAudits = () => {
    askConfirm(
      'حذف کلی چرخه‌های انبارگردانی',
      'آیا از حذف کلی تمام چرخه‌ها و رکوردهای انبارگردانی و شمارش‌های تابعه آن‌ها در این دوره مالی اطمینان دارید؟',
      () => {
        const remainingAudits = db.stockCountAudits.filter(a => a.periodId !== activePeriodId);
        const remainingCounts = db.stockCounts.filter(c => c.periodId !== activePeriodId);
        onUpdateDb({
          ...db,
          stockCountAudits: remainingAudits,
          stockCounts: remainingCounts
        });
        handleCancelEditCount();
      }
    );
  };

  // Export CSV: aggregates counts for same item across count instances into a single row
  const exportAuditsCSV = () => {
    const headers = ['کد کالا', 'کد حسابداری', 'نام کالا', 'دسته‌بندی', 'دفعات ثبت شمارش', 'نوع بسته‌بندی', 'واحد سنجش', 'جمع بسته‌های کامل', 'جمع مقدار فله', 'مجموع حجم شمارش شده', 'قیمت پایه (ریال)', 'ارزش ریالی نهایی'];
    const rows = aggregatedCounts.map(agg => {
      const itemObj = agg.itemObj || { code: '-', accountId: '-', name: 'ناشناخته', price: 0, packageType: '-', unit: 'عدد', categoryId: '' };
      return [
        itemObj.code,
        itemObj.accountId || '-',
        itemObj.name,
        categoryMap[itemObj.categoryId] || 'مشترک',
        `${agg.recordsCount} نوبت ثبت`,
        itemObj.packageType || 'بسته',
        itemObj.unit || 'عدد',
        agg.totalPackages,
        agg.totalLooseQty,
        roundTo2Decimals(agg.totalCalculatedQty),
        itemObj.price,
        roundTo2Decimals(agg.totalValue || 0)
      ];
    });
    downloadCSV('Gatan_Audit_Report_Aggregated', headers, rows);
  };

  // Export XLSX: native Excel workbook with aggregated values per item
  const exportAuditsXLSX = () => {
    if (aggregatedCounts.length === 0) {
      alert('هیچ اطلاعات شمارشی جهت خروجی اکسل در این دوره یافت نشد.');
      return;
    }
    const wb = XLSX.utils.book_new();
    const data = aggregatedCounts.map((agg, idx) => {
      const itemObj = agg.itemObj || { code: '-', accountId: '-', name: 'ناشناخته', price: 0, packageType: '-', unit: 'عدد', categoryId: '', warehouse: 'انبار اصلی' };
      return {
        'ردیف': idx + 1,
        'کد کالا': itemObj.code,
        'کد حسابداری': itemObj.accountId || '',
        'نام کالا / مواد اولیه': itemObj.name,
        'دسته‌بندی': categoryMap[itemObj.categoryId] || 'عمومی',
        'انبار': agg.warehouses.length > 0 ? agg.warehouses.join('، ') : (itemObj.warehouse || 'انبار اصلی'),
        'قفسه / جایگاه': '',
        'تعداد بسته‌های کامل': agg.totalPackages,
        'مقدار جزئی / فله': agg.totalLooseQty,
        'مجموع حجم شمارش شده': roundTo2Decimals(agg.totalCalculatedQty),
        'قیمت واحد (ریال)': itemObj.price,
        'ارزش ریالی نهایی': roundTo2Decimals(agg.totalValue),
        'توضیحات': `${agg.recordsCount} نوبت ثبت`
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'انبارگردانی تجمیعی');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const todayStr = getTodayJalali().replace(/\//g, '-');
    link.download = `Gatan_Stock_Count_Audit_Aggregated_${todayStr}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const auditFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Export Stock Count Template for Excel
  const exportStockCountTemplateXLSX = () => {
    const wb = XLSX.utils.book_new();
    const periodItems = db.items.filter(i => i.periodId === activePeriodId && i.isActive !== false);
    const data = (periodItems.length > 0 ? periodItems : db.items).map((item, idx) => ({
      'ردیف': idx + 1,
      'کد کالا': item.code || '',
      'کد حسابداری': item.accountId || '',
      'نام کالا / مواد اولیه': item.name || '',
      'انبار': item.warehouse || '',
      'تعداد بسته‌های کامل': 0,
      'مقدار جزئی / فله': 0,
      'قفسه / جایگاه': '',
      'توضیحات': ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'قالب انبارگردانی');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Stock_Count_Audit_Template_${activePeriodId}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import Stock Counts from Excel / CSV
  const importAuditsExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedAuditId) {
      alert('لطفاً ابتدا یک دوره انبارگردانی فعال را انتخاب یا ایجاد نمایید.');
      if (e.target) e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      try {
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          alert('فایل اکسل فاقد شیت معتبر می‌باشد.');
          return;
        }
        const sheet = wb.Sheets[sheetName];
        const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);
        if (!rawRows || rawRows.length === 0) {
          alert('هیچ سطری در فایل اکسل یافت نشد.');
          return;
        }

        const items = db.items.filter(i => i.periodId === activePeriodId || !i.periodId);
        const existingCounts = [...(db.stockCounts || [])];
        let importCount = 0;
        let updateCount = 0;

        rawRows.forEach((r, idx) => {
          const codeVal = String(r['کد کالا'] || r['کد'] || r['code'] || r['itemCode'] || '').trim();
          const accountIdVal = String(r['کد حسابداری'] || r['accountId'] || '').trim();
          const itemNameVal = String(r['نام کالا / مواد اولیه'] || r['نام کالا'] || r['نام'] || r['name'] || '').trim();
          
          if (!codeVal && !accountIdVal && !itemNameVal) return;

          let matchedItem = items.find(i => 
            (codeVal && i.code && toEnglishDigits(i.code).trim() === toEnglishDigits(codeVal).trim()) ||
            (accountIdVal && i.accountId && toEnglishDigits(i.accountId).trim() === toEnglishDigits(accountIdVal).trim())
          );
          if (!matchedItem && itemNameVal) {
            matchedItem = items.find(i => i.name && matchPersianString(i.name, itemNameVal));
          }
          if (!matchedItem) return;

          const fullPacks = parseNumber(
            r['تعداد بسته‌های کامل'] ?? 
            r['جمع بسته‌های کامل'] ?? 
            r['تعداد بسته'] ?? 
            r['fullPackages'] ?? 
            r['packages'] ?? 
            r['بسته'] ?? 
            0
          );

          const loose = parseNumber(
            r['مقدار جزئی / فله'] ?? 
            r['جمع فله / جزئی'] ?? 
            r['مقدار جزئی'] ?? 
            r['مقدار فله'] ?? 
            r['looseQty'] ?? 
            r['loose'] ?? 
            r['فله'] ?? 
            r['جزئی'] ?? 
            0
          );

          const wh = String(r['انبار'] || r['warehouse'] || matchedItem.warehouse || '').trim();
          const shelf = String(r['قفسه / جایگاه'] || r['shelfLocation'] || r['shelf'] || '').trim();
          const notes = String(r['توضیحات'] || r['notes'] || '').trim();

          const qtyPerPack = matchedItem.qtyPerPackage || 1;
          const totalCalc = (fullPacks * qtyPerPack) + loose;
          const price = matchedItem.price || 0;
          const val = totalCalc * price;

          const existingIdx = existingCounts.findIndex(c => c.auditId === selectedAuditId && c.periodId === activePeriodId && c.itemId === matchedItem.id && (!wh || c.warehouse === wh));

          if (existingIdx >= 0) {
            existingCounts[existingIdx] = {
              ...existingCounts[existingIdx],
              fullPackages: fullPacks,
              looseQty: loose,
              totalCalculatedQty: totalCalc,
              value: val,
              warehouse: wh || existingCounts[existingIdx].warehouse,
              shelfLocation: shelf || existingCounts[existingIdx].shelfLocation,
              notes: notes || existingCounts[existingIdx].notes,
              countDate: getTodayJalali()
            };
            updateCount++;
          } else {
            const newCount: StockCount = {
              id: `sc-imp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}-${idx}`,
              auditId: selectedAuditId,
              periodId: activePeriodId,
              itemId: matchedItem.id,
              fullPackages: fullPacks,
              looseQty: loose,
              totalCalculatedQty: totalCalc,
              value: val,
              warehouse: wh || 'انبار اصلی',
              shelfLocation: shelf,
              countDate: getTodayJalali(),
              notes: notes
            };
            existingCounts.push(newCount);
            importCount++;
          }
        });

        onUpdateDb({
          ...db,
          stockCounts: existingCounts
        });

        alert(`عملیات ورود از اکسل انبارگردانی با موفقیت انجام شد:\n- ${toPersianDigits(importCount)} رکورد شمارش جدید ثبت گردید.\n- ${toPersianDigits(updateCount)} رکورد شمارش موجود به‌روزرسانی شد.`);
        if (auditFileInputRef.current) auditFileInputRef.current.value = '';
      } catch (err) {
        console.error('Error importing stock counts Excel:', err);
        alert('خطا در خواندن فایل اکسل. لطفاً از صحت فرمت فایل اطمینان حاصل فرمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Professional Print Report: aggregates multiple warehouse counts for the same item into ONE single row with maximum paper utilization
  const printAuditReport = () => {
    const auditObj = db.stockCountAudits.find(a => a.id === selectedAuditId);
    const auditTitle = auditObj ? auditObj.title : 'گزارش تجمیعی شمارش فیزیکی انبارگردانی';
    const periodObj = db.periods.find(p => p.id === activePeriodId);
    const periodName = periodObj ? periodObj.name : 'دوره جاری';

    // Support printing filtered warehouse or full inventory
    const itemsToPrint = countWarehouseFilter === 'all' ? aggregatedCounts : filteredAggregatedCounts;

    if (itemsToPrint.length === 0) {
      alert('هیچ کالایی برای چاپ بر اساس فیلتر انتخابی در این دوره انبارگردانی ثبت نشده است.');
      return;
    }

    const todayJalali = getTodayJalali();
    const curTime = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const totalPackagesSum = itemsToPrint.reduce((s, a) => s + (a.totalPackages || 0), 0);
    const totalLooseSum = itemsToPrint.reduce((s, a) => s + (a.totalLooseQty || 0), 0);
    const totalQtySum = roundTo2Decimals(itemsToPrint.reduce((s, a) => s + (a.totalCalculatedQty || 0), 0));
    const totalValSum = roundTo2Decimals(itemsToPrint.reduce((s, a) => s + (a.totalValue || 0), 0));
    const totalRecordsSum = itemsToPrint.reduce((s, a) => s + (a.recordsCount || 0), 0);

    const warehouseLabel = countWarehouseFilter === 'all' 
      ? 'تمامی انبارها (گزارش جامع)' 
      : `انبار: ${countWarehouseFilter}`;

    const rowsHtml = itemsToPrint.map((agg, idx) => {
      const itemObj = agg.itemObj || { code: '-', accountId: '-', name: 'ناشناخته', price: 0, packageType: '-', unit: 'عدد' };
      const warehousesStr = agg.warehouses.length > 0 ? agg.warehouses.join('، ') : 'فاقد انبار';

      return `
        <tr>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 8.5pt; font-weight: 600; color: #475569;">${toPersianDigits(idx + 1)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 9pt; font-weight: 800; color: #0f172a;">${toPersianDigits(itemObj.code)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 8.5pt; font-weight: 600; color: #475569;">${toPersianDigits(itemObj.accountId || '-')}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 6px; text-align: right; font-weight: 800; font-size: 9pt; color: #0f172a; line-height: 1.35;">${itemObj.name}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 8.5pt; color: #334155;">${warehousesStr}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 3px; text-align: center; font-size: 8.5pt; font-weight: 700; color: #1e293b;">${toPersianDigits(agg.recordsCount)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 3px; text-align: center; font-size: 8.5pt; color: #334155;">${itemObj.packageType || 'بسته'}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 9pt; font-weight: 700; color: #0f172a;">${toPersianDigits(agg.totalPackages)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-size: 9pt; font-weight: 700; color: #0f172a;">${toPersianDigits(agg.totalLooseQty)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 4px; text-align: center; font-weight: 900; font-size: 9.5pt; color: #991b1b; background-color: #fef2f2 !important;">${toPersianDigits(roundTo2Decimals(agg.totalCalculatedQty))} <span style="font-size: 7.5pt; font-weight: 600; color: #64748b;">${itemObj.unit === 'کیلویی' ? 'کیلو' : 'عدد'}</span></td>
          <td style="border: 1px solid #94a3b8; padding: 3px 5px; text-align: left; font-size: 8.5pt; font-weight: 600; color: #1e293b;">${formatWithCommas(itemObj.price)}</td>
          <td style="border: 1px solid #94a3b8; padding: 3px 5px; text-align: left; font-weight: 900; font-size: 9.5pt; color: #065f46; background-color: #f0fdf4 !important;">${formatWithCommas(roundTo2Decimals(agg.totalValue))}</td>
        </tr>
      `;
    }).join('');

    const printHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="fa">
        <head>
          <meta charset="utf-8">
          <title>${auditTitle} - گزارش رسمی تجمیعی انبارگردانی</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&display=swap');
            
            @page {
              size: A4 portrait;
              margin: 5mm 6mm 5mm 6mm;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              font-family: 'Vazirmatn', 'IRANSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif !important;
              font-feature-settings: "ss05" 1, "locl" 1, "tnum" 1;
              font-variant-numeric: tabular-nums;
              -webkit-font-smoothing: antialiased;
              -moz-osx-font-smoothing: grayscale;
              padding: 0;
              margin: 0;
              color: #0f172a;
              background: #ffffff;
              direction: rtl;
              text-align: right;
              font-size: 8.5pt;
              line-height: 1.35;
            }
            .header-table {
              width: 100%;
              border: 1.5px solid #0f172a;
              margin-bottom: 4px;
              border-collapse: collapse;
              background-color: #ffffff;
            }
            .header-table td {
              padding: 4px 6px;
              border: none;
              vertical-align: middle;
            }
            table.main-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 2px;
              font-size: 8.5pt;
            }
            table.main-table thead {
              display: table-header-group;
            }
            table.main-table tfoot {
              display: table-footer-group;
            }
            table.main-table th {
              background-color: #f1f5f9 !important;
              border: 1.2px solid #334155;
              padding: 4.5px 3px;
              font-weight: 800;
              text-align: center;
              color: #0f172a;
              font-size: 8.5pt;
              line-height: 1.2;
            }
            table.main-table td {
              border: 1px solid #94a3b8;
              padding: 3px 4px;
              vertical-align: middle;
              font-size: 8.5pt;
            }
            table.main-table tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            table.main-table tr:nth-child(even) td {
              background-color: #f8fafc !important;
            }
            .total-row td {
              background-color: #e2e8f0 !important;
              font-weight: 900;
              font-size: 9pt;
              border-top: 1.8px solid #0f172a !important;
              border-bottom: 1.8px solid #0f172a !important;
            }
            .sign-table {
              width: 100%;
              border: 1px solid #0f172a;
              margin-top: 5px;
              border-collapse: collapse;
              text-align: center;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .sign-table td {
              width: 33.33%;
              padding: 4px 5px;
              border-left: 1px solid #0f172a;
              height: 42px;
              vertical-align: top;
              font-size: 8.5pt;
            }
            .sign-table td:last-child {
              border-left: none;
            }
          </style>
        </head>
        <body>
          <table class="header-table">
            <tr>
              <td style="width: 33%;">
                <div style="font-size: 12pt; font-weight: 900; color: #b91c1c; letter-spacing: -0.2px;">کارگاه تولیدی صنعتی گاتان</div>
                <div style="font-size: 9.5pt; font-weight: 800; margin-top: 2px; color: #0f172a;">${auditTitle}</div>
                <div style="font-size: 8pt; color: #475569; margin-top: 2px;">دوره مالی: <strong style="color: #0f172a;">${periodName}</strong> | ${warehouseLabel}</div>
              </td>
              <td style="width: 38%; text-align: center;">
                <div style="font-size: 10.5pt; font-weight: 900; color: #0f172a; border-bottom: 2px solid #b91c1c; display: inline-block; padding-bottom: 1px;">گزارش تجمیعی شمارش فیزیکی اقلام انبارگردانی</div>
                <div style="font-size: 8.5pt; color: #334155; margin-top: 3px;">
                  تعداد کل اقلام تجمیعی: <strong style="color: #0f172a;">${toPersianDigits(itemsToPrint.length)} قلم کالا</strong> (${toPersianDigits(totalRecordsSum)} نوبت ثبت)
                </div>
              </td>
              <td style="width: 29%; text-align: left;">
                <div style="font-size: 8pt; color: #475569;">تاریخ چاپ: <strong style="color: #0f172a;">${todayJalali} - ${curTime}</strong></div>
                <div style="font-size: 9.5pt; font-weight: 900; color: #047857; margin-top: 2px;">
                  ارزش کل: <strong style="color: #047857;">${formatWithCommas(totalValSum)} ریال</strong>
                </div>
              </td>
            </tr>
          </table>

          <table class="main-table">
            <thead>
              <tr>
                <th style="width: 26px;">ردیف</th>
                <th style="width: 50px;">کد کالا</th>
                <th style="width: 50px;">کد معین</th>
                <th>نام کالا / مواد اولیه</th>
                <th style="width: 65px;">انبار</th>
                <th style="width: 36px;">نوبت</th>
                <th style="width: 44px;">بسته‌بندی</th>
                <th style="width: 44px;">جمع بسته</th>
                <th style="width: 44px;">جمع فله</th>
                <th style="width: 78px;">شمارش نهایی</th>
                <th style="width: 72px;">قیمت واحد (ریال)</th>
                <th style="width: 86px;">ارزش کل ریالی</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="total-row">
                <td colspan="7" style="text-align: right; padding: 5px 8px; font-weight: 900; color: #0f172a; font-size: 9pt;">
                  جمع کل ارقام تجمیعی کارنامه انبارگردانی (${toPersianDigits(itemsToPrint.length)} قلم کالا):
                </td>
                <td style="text-align: center; font-weight: 900; font-size: 9pt; color: #0f172a;">${toPersianDigits(totalPackagesSum)}</td>
                <td style="text-align: center; font-weight: 900; font-size: 9pt; color: #0f172a;">${toPersianDigits(totalLooseSum)}</td>
                <td style="text-align: center; font-weight: 900; color: #991b1b; font-size: 9.5pt; background-color: #fee2e2 !important;">${toPersianDigits(totalQtySum)}</td>
                <td style="text-align: left; font-size: 8pt; font-weight: 900; color: #334155;">جمع ارزش:</td>
                <td style="text-align: left; font-weight: 900; color: #047857; font-size: 9.5pt; background-color: #dcfce7 !important;">${formatWithCommas(roundTo2Decimals(totalValSum))}</td>
              </tr>
            </tbody>
          </table>

          <table class="sign-table">
            <tr>
              <td>
                <div style="font-weight: 800; color: #0f172a;">۱. ناظر امین و مجری انبارگردانی</div>
                <div style="margin-top: 18px; color: #64748b; font-size: 8pt;">امضاء و تاریخ: .................................</div>
              </td>
              <td>
                <div style="font-weight: 800; color: #0f172a;">۲. مدیریت انبارها و لجستیک گاتان</div>
                <div style="margin-top: 18px; color: #64748b; font-size: 8pt;">امضاء و تاریخ: .................................</div>
              </td>
              <td>
                <div style="font-weight: 800; color: #0f172a;">۳. مدیر مالی و تاییدکننده نهایی</div>
                <div style="margin-top: 18px; color: #64748b; font-size: 8pt;">امضاء و تاریخ: .................................</div>
              </td>
            </tr>
          </table>

          <script>
            function triggerPrint() {
              if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function() {
                  setTimeout(function() {
                    window.focus();
                    window.print();
                  }, 250);
                });
              } else {
                setTimeout(function() {
                  window.focus();
                  window.print();
                }, 400);
              }
            }
            if (document.readyState === 'complete') {
              triggerPrint();
            } else {
              window.addEventListener('load', triggerPrint);
            }
          </script>
        </body>
      </html>
    `;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(printHtml);
      frameDoc.close();

      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 60000);
    }
  };

  // ==========================================
  // CORE STOCK ALERTS & SUMMARY OF VALUATION
  // ==========================================
  const totalSystemValue = useMemo(() => {
    let sum = 0;
    activeCounts.forEach(c => {
      sum += (c.value || 0);
    });
    return roundTo2Decimals(sum);
  }, [activeCounts]);

  const totalItemStockQtyCount = useMemo(() => {
    return roundTo2Decimals(activeCounts.reduce((acc, current) => acc + (current.totalCalculatedQty || 0), 0));
  }, [activeCounts]);

  const alertItems = useMemo(() => {
    return activeCounts.filter(c => {
      const raw = itemMap[c.itemId];
      return raw ? c.totalCalculatedQty < raw.reorderThreshold : false;
    }).map(c => ({
      countObj: c,
      itemObj: itemMap[c.itemId]!
    }));
  }, [activeCounts, itemMap]);

  return (
    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl min-h-[600px] shadow-2xl font-sans p-6 text-right" dir="rtl">
      {/* Tab Controls */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-4 mb-6 gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            id="tab-btn-items"
            type="button"
            onClick={() => setActiveTab('items')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'items' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            تعریف و شناسنامه کالا
          </button>
          <button
            id="tab-btn-categories"
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'categories' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            دسته‌بندی مواد اولیه
          </button>
          <button
            id="tab-btn-units"
            type="button"
            onClick={() => setActiveTab('units')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'units' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            تعریف واحدهای سنجش اصلی
          </button>
          <button
            id="tab-btn-purchases"
            type="button"
            onClick={() => setActiveTab('purchases')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'purchases' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            ثبت فاکتور خرید کالا
          </button>
          <button
            id="tab-btn-inventory"
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'inventory' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            شمارش کالا و انبارگردانی
          </button>
          <button
            id="tab-btn-warehouses"
            type="button"
            onClick={() => setActiveTab('warehouses')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              activeTab === 'warehouses' 
                ? 'bg-rose-600 text-white border-rose-500 shadow-md' 
                : 'bg-slate-950 text-zinc-400 border-slate-800 hover:text-zinc-200 hover:bg-slate-900'
            }`}
          >
            تنظیم و مدیریت انبارها
          </button>
        </div>

        <div className="text-xs bg-rose-950/20 text-rose-400 px-3.5 py-2 rounded-xl border border-rose-500/20 font-bold">
          دوره فعال: <strong className="font-semibold text-rose-300">{db.periods.find(p => p.id === activePeriodId)?.name}</strong>
        </div>
      </div>

      {/* ==================== TAB 1: DEFINE ITEMS ==================== */}
      {activeTab === 'items' && (
        <div className="space-y-6">
          {/* Form Side - Placed on Top */}
          <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl space-y-4 shadow-xl">
            <h3 className="text-sm font-extrabold text-[#fafafa] flex items-center gap-2 mb-1.5 border-b border-zinc-800 pb-3">
              {editingItem ? <Edit2 className="h-4.5 w-4.5 text-rose-500 animate-pulse" /> : <Plus className="h-4.5 w-4.5 text-rose-500" />}
              {editingItem ? 'ویرایش شناسنامه کالا' : 'تعریف کالای جدید خط تولید'}
            </h3>
            
            <form onSubmit={handleCreateOrUpdateItem} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Item Code */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="item-code-input" className="block text-[11px] font-bold text-zinc-400">
                      کد اختصاصی کالا <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const nextCode = generateNextItemCode(items);
                        if (editingItem) {
                          setEditingItem({ ...editingItem, code: nextCode });
                        } else {
                          setNewItem(prev => ({ ...prev, code: nextCode }));
                        }
                      }}
                      className="text-[10px] text-rose-350 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-900/50 px-2 py-0.5 rounded-lg border border-rose-800/60 flex items-center gap-1 font-bold transition-all cursor-pointer shadow-xs"
                      title="تولید خودکار کد پیشنهادی بعدی سیستم (آخرین کد + ۱)"
                    >
                      <Sparkles className="h-3 w-3 text-rose-400" />
                      <span>کد پیشنهادی</span>
                    </button>
                  </div>
                  <input
                    id="item-code-input"
                    type="text"
                    className={`w-full px-3.5 py-2 text-xs bg-zinc-950 border rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 font-mono transition-all ${
                      isCurrentCodeDuplicate 
                        ? 'border-rose-500 focus:ring-rose-500/30 bg-rose-955/10' 
                        : 'border-zinc-800 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700'
                    }`}
                    value={editingItem ? editingItem.code : (newItem.code || '')}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, code: e.target.value}) : setNewItem({...newItem, code: e.target.value})}
                    required
                    placeholder="مثال: 1001 یا R-101"
                  />
                  {isCurrentCodeDuplicate && (
                    <div className="text-[10.5px] text-rose-400 font-bold flex items-center gap-1 mt-1 animate-pulse">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span>این کد قبلاً ثبت شده است (تکراری)</span>
                    </div>
                  )}
                  {!isCurrentCodeDuplicate && activeItemCode.trim() && (
                    <div className="text-[10px] text-emerald-400/90 font-medium flex items-center gap-1 mt-1">
                      <Check className="h-3 w-3 shrink-0" />
                      <span>کد یکتا و معتبر است</span>
                    </div>
                  )}
                </div>

                {/* 2. Item Name - Spans 2 cols on lg */}
                <div className="lg:col-span-2">
                  <label htmlFor="item-name-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">
                    نام دقیق کالا / مواد اولیه <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="item-name-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-medium"
                    value={editingItem ? editingItem.name : newItem.name}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, name: e.target.value}) : setNewItem({...newItem, name: e.target.value})}
                    required
                    placeholder="مثال: شکر گلاسیه گونی ۵۰ کیلویی"
                  />
                </div>

                {/* 3. Accounting ID */}
                <div>
                  <label htmlFor="item-acct-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">کد معین حسابداری</label>
                  <input
                    id="item-acct-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={editingItem ? editingItem.accountId : newItem.accountId}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, accountId: e.target.value}) : setNewItem({...newItem, accountId: e.target.value})}
                    placeholder="کد مالی کالا"
                  />
                </div>

                {/* 4. Warehouse */}
                <div>
                  <label htmlFor="item-warehouse-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">انبار (محل دپوی کالا)</label>
                  <select
                    id="item-warehouse-select"
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all cursor-pointer"
                    value={editingItem ? (editingItem.warehouse || '') : (newItem.warehouse || '')}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, warehouse: e.target.value}) : setNewItem({...newItem, warehouse: e.target.value})}
                  >
                    <option value="" className="bg-zinc-950 text-zinc-400">--- فاقد انبار (تعیین نشده) ---</option>
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.name} className="bg-zinc-950 text-zinc-100">
                        {wh.name} {wh.code ? `(${wh.code})` : ''}
                      </option>
                    ))}
                  </select>
                  {warehouses.length === 0 && (
                    <div className="text-[10px] text-amber-500 flex items-center gap-1 mt-1 font-bold">
                      ⚠️ هیچ انباری تعریف نشده است. جهت تعریف به تب «تنظیم و مدیریت انبارها» رجوع کنید.
                    </div>
                  )}
                </div>

                {/* 5. Packaging Category */}
                <div>
                  <label htmlFor="item-cat-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">دسته‌بندی انبار</label>
                  <select
                    id="item-cat-select"
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all cursor-pointer"
                    value={categories.some(c => c.id === (editingItem ? editingItem.categoryId : (newItem.categoryId || ''))) ? (editingItem ? editingItem.categoryId : (newItem.categoryId || '')) : ''}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, categoryId: e.target.value}) : setNewItem({...newItem, categoryId: e.target.value})}
                  >
                    <option value="" className="bg-zinc-950 text-zinc-400">-- انتخاب دسته‌بندی --</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id} className="bg-zinc-950 text-zinc-100">{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* 6. Primary Unit */}
                <div>
                  <label htmlFor="item-unit-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">واحد سنجش اصلی</label>
                  <select
                    id="item-unit-select"
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all cursor-pointer font-bold"
                    value={editingItem ? editingItem.unit : newItem.unit}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, unit: e.target.value as any}) : setNewItem({...newItem, unit: e.target.value as any})}
                  >
                    {unitsOfMeasurementList.map(u => (
                      <option key={u.id} value={u.name} className="bg-zinc-950 text-zinc-100">
                        {u.name} {u.symbol ? `(${u.symbol})` : ''}
                      </option>
                    ))}
                    {!unitsOfMeasurementList.some(u => u.name === 'کیلوگرم') && <option value="کیلوگرم" className="bg-zinc-950 text-zinc-100">کیلوگرم</option>}
                    {!unitsOfMeasurementList.some(u => u.name === 'عدد') && <option value="عدد" className="bg-zinc-950 text-zinc-100">عدد</option>}
                  </select>
                </div>

                {/* 7. Barcode */}
                <div>
                  <label htmlFor="item-barcode-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">شناسه بارکد کالا</label>
                  <input
                    id="item-barcode-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={editingItem ? editingItem.barcode : newItem.barcode}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, barcode: e.target.value}) : setNewItem({...newItem, barcode: e.target.value})}
                    placeholder="۶۲۶..."
                  />
                </div>

                {/* 8. Package Type */}
                <div>
                  <label htmlFor="item-pkg-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">نوع بسته‌بندی تحویلی</label>
                  <select
                    id="item-pkg-select"
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all cursor-pointer"
                    value={editingItem ? editingItem.packageType : newItem.packageType}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, packageType: e.target.value as any}) : setNewItem({...newItem, packageType: e.target.value as any})}
                  >
                    <option value="کارتن" className="bg-zinc-950 text-zinc-100">کارتن</option>
                    <option value="گونی" className="bg-zinc-950 text-zinc-100">گونی</option>
                    <option value="سطل" className="bg-zinc-950 text-zinc-100">سطل</option>
                    <option value="حلب" className="bg-zinc-950 text-zinc-100">حلب</option>
                  </select>
                </div>

                {/* 9. Quantity Per Package */}
                <div>
                  <label htmlFor="item-qpack-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">تعداد در هر بسته‌بندی</label>
                  <input
                    id="item-qpack-input"
                    type="number"
                    onFocus={handleFocus}
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={editingItem ? editingItem.qtyPerPackage : newItem.qtyPerPackage}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, qtyPerPackage: parseNumber(e.target.value)}) : setNewItem({...newItem, qtyPerPackage: parseNumber(e.target.value)})}
                    min={1}
                  />
                </div>

                {/* 10. Weight Per Package */}
                <div>
                  <label htmlFor="item-wpack-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">وزن بسته (کیلوگرم)</label>
                  <input
                    id="item-wpack-input"
                    type="number"
                    step="any"
                    onFocus={handleFocus}
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={editingItem ? editingItem.weightPerPackage : newItem.weightPerPackage}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, weightPerPackage: parseNumber(e.target.value)}) : setNewItem({...newItem, weightPerPackage: parseNumber(e.target.value)})}
                    min={0.01}
                  />
                </div>

                {/* 11. Reorder Threshold */}
                <div>
                  <label htmlFor="item-threshold-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">حد هشدار کمبود موجودی</label>
                  <input
                    id="item-threshold-input"
                    type="number"
                    onFocus={handleFocus}
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={editingItem ? editingItem.reorderThreshold : newItem.reorderThreshold}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, reorderThreshold: parseNumber(e.target.value)}) : setNewItem({...newItem, reorderThreshold: parseNumber(e.target.value)})}
                    min={0}
                  />
                </div>

                {/* 12. Purchasing Price */}
                <div>
                  <label htmlFor="item-price-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">قیمت خرید فرضی (ریال)</label>
                  <input
                    id="item-price-input"
                    type="text"
                    onFocus={handleFocus}
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    value={formatWithCommas(editingItem ? editingItem.price : newItem.price)}
                    onChange={(e) => {
                      const val = parseNumber(e.target.value);
                      if (editingItem) setEditingItem({...editingItem, price: val});
                      else setNewItem({...newItem, price: val});
                    }}
                  />
                </div>
              </div>

              {/* Bottom Row: Active Checkbox & Actions */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-3 border-t border-zinc-800/80">
                <div className="flex items-center gap-2 select-none">
                  <input
                    id="item-active-checkbox"
                    type="checkbox"
                    className="rounded border-zinc-800 text-rose-600 focus:ring-rose-500/25 h-4 w-4 bg-zinc-950 cursor-pointer focus:ring-offset-zinc-900"
                    checked={editingItem ? editingItem.isActive : newItem.isActive}
                    onChange={(e) => editingItem ? setEditingItem({...editingItem, isActive: e.target.checked}) : setNewItem({...newItem, isActive: e.target.checked})}
                  />
                  <label htmlFor="item-active-checkbox" className="text-xs text-zinc-300 font-medium cursor-pointer leading-tight">
                    کالا فعال و قابل بکارگیری در فاکتورهای تدارکاتی و خرید باشد
                  </label>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  {editingItem && (
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                    >
                      انصراف
                    </button>
                  )}
                  <button
                    type="submit"
                    className="flex-1 sm:flex-initial px-6 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 rounded-xl shadow-lg hover:shadow-rose-600/10 cursor-pointer flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Save className="h-4 w-4" />
                    {editingItem ? 'اعمال اصلاحات کالا' : 'ثبت و تعریف کالا'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* List Section - Placed Below Form */}
          <div className="space-y-4">
            <div className="flex flex-col xl:flex-row items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-2xl border border-zinc-800 backdrop-blur-md">
                <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
                  <div className="relative w-full sm:w-64">
                    <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-zinc-500" />
                    </span>
                    <input
                      id="item-search-input"
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="جستجو بر اساس نام، گروه، کد کالا..."
                      className="w-full pl-3 pr-10 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-medium"
                    />
                  </div>

                  {/* Category Filter Dropdown */}
                  <div className="w-full sm:w-auto">
                    <select
                      id="item-category-filter-select"
                      value={itemCategoryFilter}
                      onChange={(e) => setItemCategoryFilter(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-rose-500 cursor-pointer font-bold"
                    >
                      <option value="all">همه دسته‌بندی‌های مواد اولیه</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* View Mode Toggle: List vs Grouped */}
                  <div className="flex items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs font-bold shadow-inner">
                    <button
                      type="button"
                      onClick={() => setItemViewGroupMode('flat')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${itemViewGroupMode === 'flat' ? 'bg-rose-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                      title="نمایش یکپارچه و لیستی"
                    >
                      لیستی
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemViewGroupMode('grouped')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${itemViewGroupMode === 'grouped' ? 'bg-rose-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                      title="تفکیک کالا بر اساس دسته‌بندی مواد اولیه"
                    >
                      تفکیک دسته‌بندی
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={downloadSampleItemsCSV}
                    className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 rounded-xl text-xs font-bold cursor-pointer transition-all"
                    title="دانلود فایل اکسل نمونه برای وارد کردن کالاها"
                  >
                    <Download className="h-4 w-4 text-zinc-400" />
                    نمونه اکسل
                  </button>
                  <button
                    onClick={exportItemsCSV}
                    className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-700/20 border border-emerald-500/20 hover:bg-emerald-700 hover:text-white text-emerald-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    خروجی اکسل
                  </button>
                  <label className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-700/20 border border-blue-500/20 hover:bg-blue-700 hover:text-white text-blue-400 rounded-xl text-xs font-bold cursor-pointer transition-all">
                    <Plus className="h-4 w-4" />
                    واردات کالا
                    <input
                      id="item-import-file"
                      type="file"
                      accept=".csv, .txt, .xlsx"
                      onChange={importItemsCSV}
                      className="hidden"
                    />
                  </label>
                  <label className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-rose-700/20 border border-rose-500/20 hover:bg-rose-700 hover:text-white text-rose-400 rounded-xl text-xs font-bold cursor-pointer transition-all" title="بروزرسانی قیمت‌های خرید و شناسایی ردیف‌های جدید بر اساس فایل اکسل">
                    <RefreshCw className="h-4 w-4" />
                    بروزرسانی قیمت خرید (اکسل)
                    <input
                      id="item-price-updater-file"
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleImportCatalogPrices}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={clearAllItems}
                    className="flex-grow sm:flex-initial flex items-center justify-center gap-1 px-3 py-2 bg-rose-950/45 text-rose-400 border border-rose-900/60 hover:bg-rose-900/40 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    title="حذف کلی تمامی رکوردهای کالا"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف کلی اقلام
                  </button>
                  {selectedItemIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBatchDeleteItems}
                      className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 bg-rose-650 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-lg shadow-rose-600/10"
                      title="حذف کارهای انتخاب شده به صورت گروهی"
                    >
                      <Trash2 className="h-4 w-4" />
                      حذف دسته‌ای ({toPersianDigits(selectedItemIds.length)})
                    </button>
                  )}
                </div>
              </div>

              {unmatchedCatalogPriceItems.length > 0 && (
                <div className="bg-amber-950/25 border-2 border-amber-500/30 p-5 rounded-2xl space-y-4 shadow-xl animate-fade-in my-4">
                  <div className="flex items-center gap-2 text-amber-500 border-b border-amber-900 pb-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 animate-bounce" />
                    <span className="text-xs font-black text-amber-400">تعریف و تنظیم شناسنامه کالاهای جدید شناسایی‌شده در فایل اکسل</span>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    تعداد <strong className="text-amber-300">{toPersianDigits(unmatchedCatalogPriceItems.length)} کالا</strong> با کدهای معین حسابداری زیر در کاتالوگ شما موجود نیستند. لطفاً مشخصات تکمیلی زیر را بررسی یا ثبت کرده تا به عنوان کالا یا مواد اولیه تعریف شوند:
                  </p>

                  <div className="overflow-x-auto border border-amber-500/20 rounded-xl bg-zinc-950/40">
                    <table className="min-w-full text-right text-xs">
                      <thead className="bg-amber-950/30 text-amber-300 border-b border-amber-905/30">
                        <tr>
                          <th className="px-3 py-2 font-bold text-right text-2xs">کد حسابداری</th>
                          <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">کد کالا <span className="text-rose-500">*</span></th>
                          <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">نام دقیق کالا <span className="text-rose-500">*</span></th>
                          <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">گروه / دسته‌بندی</th>
                          <th className="px-1 py-2 font-bold text-center text-2xs text-[#fafafa]">واحد اصلی</th>
                          <th className="px-1 py-2 font-bold text-center text-2xs text-[#fafafa]">بسته‌بندی</th>
                          <th className="px-1 py-2 font-bold text-center text-2xs text-[#fafafa]">تعداد/بسته</th>
                          <th className="px-1 py-2 font-bold text-center text-2xs text-[#fafafa]">وزن/بسته</th>
                          <th className="px-1 py-2 font-bold text-center text-2xs text-[#fafafa]">هشدار کمبود</th>
                          <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">انبار دپو</th>
                          <th className="px-3 py-2 font-bold text-left text-2xs text-amber-300">قیمت خرید (ریال)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-900/20 text-zinc-300">
                        {unmatchedCatalogPriceItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-amber-955/10">
                            <td className="px-3 py-3 font-mono text-amber-200 font-bold">{toPersianDigits(item.accountId)}</td>
                            <td className="px-1 py-2">
                              <input 
                                type="text" 
                                className="w-20 px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono font-bold focus:outline-none focus:border-amber-500"
                                value={item.code} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'code', e.target.value)} 
                              />
                            </td>
                            <td className="px-1 py-2">
                              <input 
                                type="text" 
                                className="w-32 sm:w-48 px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-right text-zinc-100 font-bold focus:outline-none focus:border-amber-500"
                                value={item.name} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'name', e.target.value)} 
                              />
                            </td>
                            <td className="px-1 py-2 text-right">
                              <select 
                                className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-100 focus:outline-none focus:border-amber-500 text-[10px]"
                                value={item.categoryId}
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'categoryId', e.target.value)}
                              >
                                <option value="">-- انتخاب گروه --</option>
                                {categories.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-2 text-center">
                              <select 
                                className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-200 focus:outline-none focus:border-amber-500 text-[10px]"
                                value={item.unit}
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'unit', e.target.value as any)}
                              >
                                <option value="کیلویی">کیلویی</option>
                                <option value="عددی">عددی</option>
                              </select>
                            </td>
                            <td className="px-1 py-2 text-center">
                              <select 
                                className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-200 focus:outline-none focus:border-amber-500 text-[10px]"
                                value={item.packageType}
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'packageType', e.target.value as any)}
                              >
                                <option value="کارتن">کارتن</option>
                                <option value="گونی">گونی</option>
                                <option value="سطل">سطل</option>
                                <option value="حلب">حلب</option>
                              </select>
                            </td>
                            <td className="px-1 py-2 text-center">
                              <input 
                                type="number" 
                                className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                                value={item.qtyPerPackage} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'qtyPerPackage', parseNumber(e.target.value) || 1)} 
                              />
                            </td>
                            <td className="px-1 py-2 text-center">
                              <input 
                                type="number" 
                                className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                                value={item.weightPerPackage} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'weightPerPackage', parseNumber(e.target.value) || 1)} 
                              />
                            </td>
                            <td className="px-1 py-2 text-center">
                              <input 
                                type="number" 
                                className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                                value={item.reorderThreshold} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'reorderThreshold', parseNumber(e.target.value) || 10)} 
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <select 
                                className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-200 focus:outline-none focus:border-amber-500 text-[10px]"
                                value={item.warehouse}
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'warehouse', e.target.value)}
                              >
                                <option value="">-- انتخاب انبار دپو --</option>
                                {warehouses.map(wh => (
                                  <option key={wh.id} value={wh.name}>{wh.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-3 font-mono font-bold text-amber-400 text-left">
                              <input 
                                type="text" 
                                className="w-24 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-left text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                                value={formatWithCommas(item.price)} 
                                onChange={(e) => handleUnmatchedCatalogItemChange(idx, 'price', parseNumber(e.target.value) || 0)} 
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleCreateUnmatchedCatalogItems}
                      className="flex items-center gap-1.5 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-600/10 cursor-pointer transition-all"
                    >
                      <Check className="h-4 w-4" /> ثبت و تعریف کدهای جدید کاتالوگ و اعمال تغییرات
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        askConfirm(
                          'لغو تعاریف کالاها',
                          'آیا مایل به لغو و عدم ذخیره کدهای کالای جدید اکسل هستید؟',
                          () => setUnmatchedCatalogPriceItems([])
                        );
                      }}
                      className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-350 hover:text-white border border-zinc-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      انصراف و پاکسازی
                    </button>
                  </div>
                </div>
              )}

              {/* Items Table container */}
              <div className="border border-zinc-800/80 rounded-2xl bg-zinc-950/20 backdrop-blur-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-zinc-850 text-right">
                    <thead className="bg-zinc-900/60 text-zinc-400">
                      <tr>
                        <th className="px-3.5 py-3 text-center" style={{ width: '40px' }}>
                          <input
                            type="checkbox"
                            className="rounded border-zinc-800 text-rose-600 focus:ring-rose-500/25 h-3.5 w-3.5 bg-zinc-950 cursor-pointer"
                            checked={paginatedSearchedItems.length > 0 && paginatedSearchedItems.every(i => selectedItemIds.includes(i.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedItemIds(prev => {
                                  const newIds = [...prev];
                                  paginatedSearchedItems.forEach(i => {
                                    if (!newIds.includes(i.id)) newIds.push(i.id);
                                  });
                                  return newIds;
                                });
                              } else {
                                const pageIds = paginatedSearchedItems.map(i => i.id);
                                setSelectedItemIds(prev => prev.filter(id => !pageIds.includes(id)));
                              }
                            }}
                          />
                        </th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">کد کالا</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">کد معین</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">شرح شناسنامه کالا</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">گروه کالا</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">انبار</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400">بسته‌بندی سنجش</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-left">قیمت پایه (ریال)</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">وضعیت فعال</th>
                        <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">عملیات مدیریت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/40 text-xs text-zinc-300">
                      {searchedItems.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center text-zinc-500">
                            <AlertTriangle className="h-8 w-8 mx-auto text-zinc-650 mb-2.5 opacity-40" />
                            هیچ ردیف کالایی منطبق یافت نشد. از فرم سمت راست محصول یا ماده خام جدیدی بیافزایید.
                          </td>
                        </tr>
                      ) : itemViewGroupMode === 'grouped' ? (
                        /* Grouped View by Category */
                        (() => {
                          // Group paginated items by categoryId
                          const categoryGroupMap: Record<string, Item[]> = {};
                          paginatedSearchedItems.forEach(item => {
                            const catKey = item.categoryId || 'uncategorized';
                            if (!categoryGroupMap[catKey]) categoryGroupMap[catKey] = [];
                            categoryGroupMap[catKey].push(item);
                          });

                          // Get present categories
                          const sortedCatKeys = Object.keys(categoryGroupMap);

                          return sortedCatKeys.map(catKey => {
                            const catObj = categories.find(c => c.id === catKey);
                            const catName = catObj ? catObj.name : (catKey === 'uncategorized' ? 'بدون دسته‌بندی' : 'سایر');
                            const groupItems = categoryGroupMap[catKey] || [];
                            const totalPrice = groupItems.reduce((sum, item) => sum + (item.price || 0), 0);

                            return (
                              <React.Fragment key={`cat-group-section-${catKey}`}>
                                {/* Category Section Header Row */}
                                <tr className="bg-rose-950/25 border-y border-rose-900/40">
                                  <td colSpan={10} className="px-4 py-2.5 bg-gradient-to-r from-rose-950/40 via-zinc-900/80 to-zinc-950">
                                    <div className="flex items-center justify-between text-xs font-black">
                                      <div className="flex items-center gap-2 text-rose-300">
                                        <Folder className="h-4 w-4 text-rose-500 fill-rose-500/20" />
                                        <span className="text-sm font-extrabold text-white">{catName}</span>
                                        <span className="bg-rose-900/60 text-rose-200 border border-rose-500/30 text-[11px] px-2.5 py-0.5 rounded-full font-bold">
                                          {toPersianDigits(groupItems.length)} کالا
                                        </span>
                                      </div>
                                      <div className="text-zinc-400 text-xs font-mono">
                                        مجموع قیمت پایه: <span className="font-bold text-rose-400">{formatWithCommas(totalPrice)}</span> ریال
                                      </div>
                                    </div>
                                  </td>
                                </tr>

                                {/* Item rows under this category */}
                                {groupItems.map((i, iIdx) => (
                                  <tr key={`${i.id}-${iIdx}`} className="hover:bg-zinc-900/20 transition-all">
                                    <td className="px-3.5 py-4 text-center">
                                      <input
                                        type="checkbox"
                                        className="rounded border-zinc-800 text-rose-600 focus:ring-rose-500/25 h-3.5 w-3.5 bg-zinc-950 cursor-pointer"
                                        checked={selectedItemIds.includes(i.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedItemIds(prev => [...prev, i.id]);
                                          } else {
                                            setSelectedItemIds(prev => prev.filter(id => id !== i.id));
                                          }
                                        }}
                                      />
                                    </td>
                                    <td className="px-3.5 py-4 font-mono font-black text-rose-500">{i.code}</td>
                                    <td className="px-3.5 py-4 font-mono text-zinc-500">{i.accountId || '-'}</td>
                                    <td className="px-3.5 py-4 font-bold text-zinc-100" style={{ color: '#fafafa' }}>{i.name}</td>
                                    <td className="px-3.5 py-4 text-zinc-400 text-xs">
                                      <span className="bg-rose-950/40 border border-rose-900/40 px-2.5 py-1 rounded-full text-rose-300 font-bold text-[10px]">
                                        {categoryMap[i.categoryId] || catName}
                                      </span>
                                    </td>
                                    <td className="px-3.5 py-4 text-zinc-400 text-xs font-semibold">{i.warehouse || '-'}</td>
                                    <td className="px-3.5 py-4 text-xs text-zinc-400">{i.unit} <span className="text-zinc-500">({i.packageType})</span></td>
                                    <td className="px-3.5 py-4 text-left font-mono font-extrabold text-[#fafafa]">{formatWithCommas(i.price)}</td>
                                    <td className="px-3.5 py-4 text-center">
                                      {i.isActive ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 px-2.5 py-0.5 rounded-full font-bold">
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                          فعال
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 rounded-full">
                                          غیرفعال
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3.5 py-4 text-center">
                                      <div className="flex justify-center gap-2">
                                        <button
                                          onClick={() => setEditingItem(i)}
                                          className="p-1 px-2 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer"
                                          title="ویرایش کالا"
                                        >
                                          <Edit2 className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          onClick={() => deleteItem(i.id)}
                                          className="p-1 px-2 border border-rose-950/40 bg-rose-950/20 hover:bg-rose-900/35 text-rose-450 rounded-lg transition-all cursor-pointer"
                                          title="حذف کالا"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          });
                        })()
                      ) : (
                        /* Flat View */
                        paginatedSearchedItems.map((i, iIdx) => (
                          <tr key={`${i.id}-${iIdx}`} className="hover:bg-zinc-900/20 transition-all">
                            <td className="px-3.5 py-4.5 text-center">
                              <input
                                type="checkbox"
                                className="rounded border-zinc-800 text-rose-600 focus:ring-rose-500/25 h-3.5 w-3.5 bg-zinc-950 cursor-pointer"
                                checked={selectedItemIds.includes(i.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedItemIds(prev => [...prev, i.id]);
                                  } else {
                                    setSelectedItemIds(prev => prev.filter(id => id !== i.id));
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3.5 py-4.5 font-mono font-black text-rose-500">{i.code}</td>
                            <td className="px-3.5 py-4.5 font-mono text-zinc-500">{i.accountId || '-'}</td>
                            <td className="px-3.5 py-4.5 font-bold text-zinc-105" style={{ color: '#fafafa' }}>{i.name}</td>
                            <td className="px-3.5 py-4.5 text-zinc-400 text-xs">
                              <span className="bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full text-zinc-300 font-medium">
                                {categoryMap[i.categoryId] || 'مشترک'}
                              </span>
                            </td>
                            <td className="px-3.5 py-4.5 text-zinc-400 text-xs font-semibold">{i.warehouse || '-'}</td>
                            <td className="px-3.5 py-4.5 text-xs text-zinc-400">{i.unit} <span className="text-zinc-500">({i.packageType})</span></td>
                            <td className="px-3.5 py-4.5 text-left font-mono font-extrabold text-[#fafafa]">{formatWithCommas(i.price)}</td>
                            <td className="px-3.5 py-4.5 text-center">
                              {i.isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 px-2.5 py-0.5 rounded-full font-bold">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                  فعال
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 rounded-full">
                                  غیرفعال
                                </span>
                              )}
                            </td>
                            <td className="px-3.5 py-4.5 text-center">
                              <div className="flex justify-center gap-2">
                                <button
                                  onClick={() => setEditingItem(i)}
                                  className="p-1 px-2 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer"
                                  title="ویرایش کالا"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteItem(i.id)}
                                  className="p-1 px-2 border border-rose-950/40 bg-rose-950/20 hover:bg-rose-900/35 text-rose-450 rounded-lg transition-all cursor-pointer"
                                  title="حذف کالا"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls for Catalog */}
                <PaginationControl
                  currentPage={catalogPage}
                  totalItems={searchedItems.length}
                  pageSize={catalogPageSize}
                  onPageChange={setCatalogPage}
                  onPageSizeChange={setCatalogPageSize}
                  pageSizeOptions={[25, 50, 100, 200, 500]}
                  itemName="کالا"
                />
              </div>
            </div>
        </div>
      )}

      {/* ==================== TAB 2: PACKAGING CATEGORIES ==================== */}
      {activeTab === 'categories' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Create form */}
            <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-zinc-100 flex items-center gap-2 border-b border-zinc-800 pb-3">
                <Plus className="h-4.5 w-4.5 text-rose-500" />
                تعریف دسته‌بندی جدید انبار
              </h3>
              <form onSubmit={handleAddCategory} className="space-y-4.5">
                <div>
                  <label htmlFor="cat-name-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">عنوان گروه مواد اولیه</label>
                  <input
                    id="cat-name-input"
                    type="text"
                    className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    placeholder="مثال: آردها، ادویه‌جات، محصولات مایع"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 rounded-xl shadow-lg transition-all cursor-pointer"
                >
                  ثبت گروه محصول
                </button>
              </form>
            </div>

            {/* List */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-2xl border border-zinc-800 backdrop-blur-md">
                <div className="relative w-full sm:w-72">
                  <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    id="cat-search-input"
                    type="text"
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="جستجو در فولدربندی و دسته‌ها..."
                    className="w-full pl-3 pr-10 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={downloadSampleCategoriesCSV}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    title="دانلود فایل اکسل نمونه برای وارد کردن دسته‌بندی‌ها"
                  >
                    <Download className="h-4 w-4 text-zinc-400" /> نمونه اکسل
                  </button>
                  <button
                    onClick={exportCategoryCSV}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700/20 border border-emerald-500/20 hover:bg-emerald-700 hover:text-white text-emerald-400 rounded-xl text-xs font-bold cursor-pointer transition-all"
                  >
                    <FileSpreadsheet className="h-4 w-4" /> خروجی اکسل
                  </button>
                  <label className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-700/20 border border-blue-500/20 hover:bg-blue-700 hover:text-white text-blue-400 rounded-xl text-xs font-bold cursor-pointer transition-all">
                    <Plus className="h-4 w-4" /> وارد کردن داده
                    <input
                      id="cat-import-file"
                      type="file"
                      accept=".csv"
                      onChange={importCategoryCSV}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={clearAllCategories}
                    className="flex items-center gap-1.5 px-3 py-2 bg-rose-950/45 text-rose-400 border border-rose-900/60 hover:bg-rose-900/40 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" /> حذف کلی دسته‌ها
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-zinc-800/80 rounded-2xl bg-zinc-950/20 backdrop-blur-md">
                <table className="min-w-full divide-y divide-zinc-850 text-right">
                  <thead className="bg-zinc-900/60 text-zinc-400">
                    <tr>
                      <th className="px-5 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">عنوان دسته‌بندی انبار</th>
                      <th className="px-5 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-center">عملیات مدیریت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/45 text-xs text-zinc-300">
                    {searchedCategories.map(c => (
                      <tr key={c.id} className="hover:bg-zinc-900/10 transition-colors">
                        <td className="px-5 py-4">
                          {editingCatId === c.id ? (
                            <div className="flex gap-2.5">
                              <input
                                id={`cat-edit-input-${c.id}`}
                                type="text"
                                className="border border-zinc-800 rounded-xl px-3 py-1.5 text-xs bg-zinc-950 text-zinc-100 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                                value={catNameInput}
                                onChange={(e) => setCatNameInput(e.target.value)}
                              />
                              <button
                                onClick={() => saveCategoryEdit(c.id)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all"
                              >
                                ثبت
                              </button>
                              <button
                                onClick={() => setEditingCatId(null)}
                                className="border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3.5 py-1.5 rounded-xl text-xs text-zinc-300 transition-all"
                              >
                                لغو
                              </button>
                            </div>
                          ) : (
                            <span className="font-extrabold text-zinc-100" style={{ color: '#fafafa' }}>{c.name}</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => {
                                setEditingCatId(c.id);
                                setCatNameInput(c.name);
                              }}
                              className="text-zinc-400 hover:text-white text-xs border border-zinc-850 bg-zinc-900/50 hover:bg-zinc-800 p-1 px-3 rounded-lg transition-all"
                            >
                              ویرایش
                            </button>
                            <button
                              onClick={() => deleteCategory(c.id)}
                              className="text-rose-450 hover:text-rose-400 text-xs border border-rose-955/20 bg-rose-955/10 p-1 px-3 rounded-lg transition-all"
                            >
                              حذف
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ==================== TAB: UNITS OF MEASUREMENT ==================== */}
      {activeTab === 'units' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Create/Edit Unit Form */}
            <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-zinc-100 flex items-center gap-2 border-b border-zinc-800 pb-3">
                <Ruler className="h-4.5 w-4.5 text-rose-500" />
                {editingUnit ? 'ویرایش واحد سنجش اصلی' : 'تعریف واحد سنجش اصلی جدید'}
              </h3>
              <form onSubmit={handleAddOrUpdateUnit} className="space-y-4.5">
                <div>
                  <label htmlFor="unit-name-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">نام واحد سنجش (الزامی)</label>
                  <input
                    id="unit-name-input"
                    type="text"
                    className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-bold"
                    placeholder="مثال: کیلوگرم، عدد، لیتر، بسته"
                    value={editingUnit ? editingUnit.name : newUnit.name}
                    onChange={(e) => editingUnit ? setEditingUnit({ ...editingUnit, name: e.target.value }) : setNewUnit({ ...newUnit, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="unit-symbol-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">نماد اختصاری لاتین / تجاری</label>
                  <input
                    id="unit-symbol-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-mono"
                    placeholder="مثال: kg, pcs, L, pack"
                    value={editingUnit ? (editingUnit.symbol || '') : newUnit.symbol}
                    onChange={(e) => editingUnit ? setEditingUnit({ ...editingUnit, symbol: e.target.value }) : setNewUnit({ ...newUnit, symbol: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="unit-desc-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">توضیحات و کاربرد در انبار</label>
                  <textarea
                    id="unit-desc-input"
                    rows={3}
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                    placeholder="توضیحات درباره نحوه انبارگردانی یا سنجش مواد اولیه..."
                    value={editingUnit ? (editingUnit.description || '') : newUnit.description}
                    onChange={(e) => editingUnit ? setEditingUnit({ ...editingUnit, description: e.target.value }) : setNewUnit({ ...newUnit, description: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {editingUnit ? 'ثبت تغییرات واحد' : 'ثبت واحد سنجش جدید'}
                  </button>
                  {editingUnit && (
                    <button
                      type="button"
                      onClick={() => setEditingUnit(null)}
                      className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>

              <div className="pt-3 border-t border-zinc-800/80">
                <button
                  type="button"
                  onClick={handleResetDefaultUnits}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> بازنشانی واحدهای سنجش پیش‌فرض
                </button>
              </div>
            </div>

            {/* Units List Side */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-2xl border border-zinc-800 backdrop-blur-md">
                <div className="relative w-full sm:w-72">
                  <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    id="unit-search-input"
                    type="text"
                    value={unitSearch}
                    onChange={(e) => setUnitSearch(e.target.value)}
                    placeholder="جستجو در واحدهای سنجش انبار..."
                    className="w-full pl-3 pr-10 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-medium"
                  />
                </div>

                <div className="text-xs text-zinc-400 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 font-bold">
                  تعداد واحدهای سنجش: <span className="text-rose-400">{toPersianDigits(searchedUnits.length)}</span>
                </div>
              </div>

              <div className="overflow-x-auto border border-zinc-800/80 rounded-2xl bg-zinc-950/20 backdrop-blur-md">
                <table className="min-w-full divide-y divide-zinc-850 text-right">
                  <thead className="bg-zinc-900/60 text-zinc-400">
                    <tr>
                      <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">نام واحد سنجش اصلی</th>
                      <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">نماد اختصاری</th>
                      <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">توضیحات و کاربرد</th>
                      <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-center">کالاهای تخصیصی</th>
                      <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-center">عملیات مدیریت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/45 text-xs text-zinc-300">
                    {searchedUnits.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                          هیچ واحد سنجشی تعریف یا یافت نشده است.
                        </td>
                      </tr>
                    ) : (
                      searchedUnits.map(unit => {
                        const linkedItemsCount = db.items.filter(i => i.unit === unit.name).length;
                        return (
                          <tr key={unit.id} className="hover:bg-zinc-900/10 transition-colors">
                            <td className="px-4 py-4 font-bold text-white text-xs flex items-center gap-2">
                              <Scale className="h-4 w-4 text-rose-500" />
                              {unit.name}
                            </td>
                            <td className="px-4 py-4 font-mono text-rose-400 text-xs font-semibold">
                              {unit.symbol || '-'}
                            </td>
                            <td className="px-4 py-4 text-zinc-400 text-xs max-w-xs truncate">
                              {unit.description || '-'}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px] px-2.5 py-1 rounded-full font-bold">
                                {toPersianDigits(linkedItemsCount)} کالا
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <div className="flex justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingUnit(unit)}
                                  className="text-zinc-400 hover:text-white text-xs border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 p-1 px-3 rounded-lg transition-all cursor-pointer"
                                  title="ویرایش واحد"
                                >
                                  ویرایش
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUnit(unit.id)}
                                  className="text-rose-400 hover:text-rose-300 text-xs border border-rose-950/40 bg-rose-950/20 hover:bg-rose-900/30 p-1 px-3 rounded-lg transition-all cursor-pointer"
                                  title="حذف واحد"
                                >
                                  حذف
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

          </div>
        </div>
      )}

      {/* ==================== TAB 3: REGISTER PURCHASE FACTOR ==================== */}
      {activeTab === 'purchases' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl space-y-4 shadow-xl">
            <h3 className="text-xs font-black text-zinc-100 border-b border-zinc-800 pb-3 flex items-center gap-1.5">
              <Plus className="h-4.5 w-4.5 text-rose-500" />
              ثبت و الحاق فاکتور خرید تدارکات و مواد اولیه
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="purch-supplier-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">انتخاب تامین کننده فعال</label>
                <select
                  id="purch-supplier-select"
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer"
                  value={selectedSupplierId}
                  onChange={handleSupplierChange}
                >
                  <option value="" className="bg-zinc-950 text-zinc-400">-- انتخاب شرکت تامین‌کننده کالا --</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id} className="bg-zinc-950 text-zinc-100">{s.name} ({toPersianDigits(s.phone)})</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="purch-date-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">تاریخ ثبت فاکتور تدارکات (شمسی)</label>
                <input
                  id="purch-date-input"
                  type="text"
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  placeholder="۱۴۰۵/۰۱/۱۵"
                />
              </div>

              <div>
                <label htmlFor="purch-id-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">شماره فاکتور فیزیکی خرید</label>
                <input
                  id="purch-id-input"
                  type="text"
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono font-bold placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="مانند F-4309"
                />
              </div>
            </div>

            {/* In-Factor Item Builder */}
            {selectedSupplierId && (
              <div className="bg-zinc-950/40 p-5 rounded-2xl border border-zinc-850 space-y-4.5 mt-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-850 pb-2.5 mb-1.5 gap-2">
                  <h4 className="text-xs font-extrabold text-[#fafafa] flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                    افزودن اقلام به این فاکتور:
                  </h4>
                  <div className="flex items-center gap-2">
                    <label 
                      htmlFor="purch-excel-import" 
                      className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-350 hover:text-white border border-zinc-700 rounded-lg text-3xs sm:text-2xs font-extrabold transition-all cursor-pointer shadow-md"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
                      بارگذاری اقلام فاکتور از اکسل / CSV
                    </label>
                    <input 
                      id="purch-excel-import" 
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      className="hidden" 
                      onChange={handleImportPurchaseInvoiceFile} 
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                  
                  <div className="sm:col-span-2 text-zinc-100">
                    <label htmlFor="purch-item-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">اکانتینگ و کاتالوگ کالا</label>
                    <SearchableSelect
                      id="purch-item-select"
                      value={selectedItemId}
                      onChange={(val) => handleItemSelectChanges(val)}
                      options={activeItemsList.map(i => ({
                        value: i.id,
                        label: `${i.code} | ${i.name} (آخرین قیمت: ${formatWithCommas(i.price)} ریال)`
                      }))}
                      placeholder="-- جستجو در نام یا کد کالا بابت بارگیری در فاکتور --"
                    />
                  </div>

                  <div>
                    <label htmlFor="purch-item-qty" className="block text-[11px] font-bold text-zinc-400 mb-1.5">مقدار کل خرید (عدد/کیلو)</label>
                    <input
                      id="purch-item-qty"
                      type="number"
                      step="any"
                      onFocus={handleFocus}
                      className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      value={invoiceItemQty}
                      onChange={(e) => setInvoiceItemQty(parseNumber(e.target.value))}
                    />
                  </div>

                  <div>
                    <label htmlFor="purch-item-price" className="block text-[11px] font-bold text-zinc-400 mb-1.5">قیمت خرید نهایی بابت هر واحد (ریال)</label>
                    <input
                      id="purch-item-price"
                      type="text"
                      onFocus={handleFocus}
                      className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 font-mono font-bold text-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      value={formatWithCommas(invoiceItemPrice)}
                      onChange={(e) => setInvoiceItemPrice(parseNumber(e.target.value))}
                    />
                  </div>
                </div>

                {selectedItemData && (
                  <div className="text-2xs bg-zinc-950 border border-zinc-850 p-3 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-2 text-zinc-400">
                    <div>نوع بسته‌بندی مبدا: <strong className="font-semibold text-zinc-200">{selectedItemData.packageType}</strong></div>
                    <div>ضریب تعداد کالا در بسته: <strong className="font-semibold text-zinc-200">{toPersianDigits(selectedItemData.qtyPerPackage)}</strong></div>
                    <div>ضریب وزن در بسته: <strong className="font-semibold text-zinc-200">{toPersianDigits(selectedItemData.weightPerPackage)} کیلو</strong></div>
                    <div>واحد سنجش کالا: <strong className="font-semibold text-zinc-200">{selectedItemData.unit}</strong></div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={addPurchaseItemToCurrentSession}
                    className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl border border-zinc-700 hover:shadow-lg transition-all cursor-pointer"
                  >
                    افزودن به لیست فاکتور
                  </button>
                </div>
              </div>
            )}

            {unmatchedPurchasedItems.length > 0 && (
              <div className="bg-amber-950/20 border-2 border-amber-500/30 p-5 rounded-2xl space-y-4 shadow-xl animate-fade-in my-4">
                <div className="flex items-center gap-2 text-amber-500 border-b border-amber-900 pb-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 animate-bounce" />
                  <span className="text-xs font-black text-amber-400">تعریف و تنظیم کاتالوگ کالاهای جدید شناسایی‌شده در فایل اکسل</span>
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  تعداد <strong className="text-amber-300">{toPersianDigits(unmatchedPurchasedItems.length)} کالا</strong> با کدهای حسابداری زیر در سیستم تعریف نشده‌اند. لطفاً اطلاعات کسری را مشخص ساخته تا کالاها همگی تعریف و همزمان به فاکتور خرید تدارکات جاری پیوست گردند:
                </p>

                <div className="overflow-x-auto border border-amber-500/20 rounded-xl bg-zinc-950/40">
                  <table className="min-w-full text-right text-xs">
                    <thead className="bg-amber-950/30 text-amber-300 border-b border-amber-900/50">
                      <tr>
                        <th className="px-3 py-2 font-bold text-right text-2xs">کد حسابداری</th>
                        <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">کد کالا <span className="text-rose-500">*</span></th>
                        <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">نام کالا <span className="text-rose-500">*</span></th>
                        <th className="px-3 py-2 font-bold text-right text-2xs text-[#fafafa]">گروه / دسته‌بندی</th>
                        <th className="px-3 py-2 font-bold text-center text-2xs text-[#fafafa]">واحد</th>
                        <th className="px-3 py-2 font-bold text-center text-2xs text-[#fafafa]">بسته‌بندی</th>
                        <th className="px-3 py-2 font-bold text-center text-2xs text-[#fafafa]">تعداد/بسته</th>
                        <th className="px-3 py-2 font-bold text-center text-2xs text-[#fafafa]">وزن/بسته</th>
                        <th className="px-3 py-2 font-bold text-center text-2xs text-[#fafafa]">هشدار ری‌اوردر</th>
                        <th className="px-3 py-2 font-bold text-left text-2xs text-amber-300">تعداد خرید</th>
                        <th className="px-3 py-2 font-bold text-left text-2xs text-amber-300">فی خرید (ریال)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-900/20 text-zinc-300">
                      {unmatchedPurchasedItems.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-amber-955/10">
                          <td className="px-3 py-3 font-mono text-amber-200 font-bold">{toPersianDigits(item.accountId)}</td>
                          <td className="px-1.5 py-2">
                            <input 
                              type="text" 
                              className="w-20 px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono font-bold focus:outline-none focus:border-amber-500"
                              value={item.code} 
                              onChange={(e) => handleUnmatchedItemChange(idx, 'code', e.target.value)} 
                            />
                          </td>
                          <td className="px-1.5 py-2">
                            <input 
                              type="text" 
                              className="w-32 sm:w-48 px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-right text-zinc-100 font-bold focus:outline-none focus:border-amber-500"
                              value={item.name} 
                              onChange={(e) => handleUnmatchedItemChange(idx, 'name', e.target.value)} 
                            />
                          </td>
                          <td className="px-1.5 py-2 text-right">
                            <select 
                              className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-100 focus:outline-none focus:border-amber-500 text-[10px]"
                              value={item.categoryId}
                              onChange={(e) => handleUnmatchedItemChange(idx, 'categoryId', e.target.value)}
                            >
                              <option value="">-- انتخاب گروه --</option>
                              {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1.5 py-2 text-center">
                            <select 
                              className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-200 focus:outline-none focus:border-amber-500 text-[10px]"
                              value={item.unit}
                              onChange={(e) => handleUnmatchedItemChange(idx, 'unit', e.target.value as any)}
                            >
                              <option value="کیلویی">کیلویی</option>
                              <option value="عددی">عددی</option>
                            </select>
                          </td>
                          <td className="px-1.5 py-2 text-center">
                            <select 
                              className="px-2 py-1 bg-zinc-900 border border-amber-500/30 rounded text-zinc-200 focus:outline-none focus:border-amber-500 text-[10px]"
                              value={item.packageType}
                              onChange={(e) => handleUnmatchedItemChange(idx, 'packageType', e.target.value as any)}
                            >
                              <option value="کارتن">کارتن</option>
                              <option value="گونی">گونی</option>
                              <option value="سطل">سطل</option>
                              <option value="حلب">حلب</option>
                            </select>
                          </td>
                          <td className="px-1.5 py-2 text-center">
                            <input 
                              type="number" 
                              className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                              value={item.qtyPerPackage} 
                              onChange={(e) => handleUnmatchedItemChange(idx, 'qtyPerPackage', parseNumber(e.target.value) || 1)} 
                            />
                          </td>
                          <td className="px-1.5 py-2 text-center">
                            <input 
                              type="number" 
                              className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                              value={item.weightPerPackage} 
                              onChange={(e) => handleUnmatchedItemChange(idx, 'weightPerPackage', parseNumber(e.target.value) || 1)} 
                            />
                          </td>
                          <td className="px-1.5 py-2 text-center">
                            <input 
                              type="number" 
                              className="w-12 px-1 py-1 bg-zinc-900 border border-amber-500/30 rounded text-center text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                              value={item.reorderThreshold} 
                              onChange={(e) => handleUnmatchedItemChange(idx, 'reorderThreshold', parseNumber(e.target.value) || 10)} 
                            />
                          </td>
                          <td className="px-3 py-3 font-mono text-zinc-350 text-left">{toPersianDigits(item.qty)}</td>
                          <td className="px-3 py-3 font-mono font-bold text-amber-400 text-left">{formatWithCommas(item.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleAddUnmatchedItemsToCatalog}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-600/10 cursor-pointer transition-all"
                  >
                    <Check className="h-4 w-4" /> ذخیره کالاها در کاتالوگ و انتقال به فاکتور
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      askConfirm(
                        'لغو تعاریف کالاهای جدید',
                        'آیا مایل به حذف لیست موارد نامشخص اکسل هستید؟ با لغو این بخش، اقلام غیرمتناظر نادیده گرفته می‌شوند.',
                        () => setUnmatchedPurchasedItems([])
                      );
                    }}
                    className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-350 hover:text-white border border-zinc-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    لغو و پاکسازی نامشخص‌ها
                  </button>
                </div>
              </div>
            )}

            {/* Current Invoice List of items added */}
            {invoiceItems.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-zinc-850">
                <h4 className="text-xs font-black text-zinc-100 flex items-center gap-1.5 mb-1">اقلام پیش‌نویس فاکتور جاری تدارکات</h4>
                <div className="overflow-x-auto border border-zinc-800 rounded-2xl bg-zinc-950/20">
                  <table className="min-w-full text-right text-xs">
                    <thead className="bg-zinc-900/40 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="px-4 py-3 text-2xs font-bold border-none text-zinc-405">شرح کاندید کالا</th>
                        <th className="px-4 py-3 text-2xs font-bold text-center text-zinc-405">حجم خرید</th>
                        <th className="px-4 py-3 text-2xs font-bold text-center text-zinc-405">بسته‌بندی کانتینر</th>
                        <th className="px-4 py-3 text-2xs font-bold text-left text-zinc-405">نرخ واحد (ریال)</th>
                        <th className="px-4 py-3 text-2xs font-bold text-left text-zinc-405">مجموع ریالی ردیف</th>
                        <th className="px-4 py-3 text-2xs font-bold text-center text-zinc-405">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-zinc-350">
                      {invoiceItems.map((it, idx) => {
                        const raw = itemMap[it.itemId];
                        return (
                          <tr key={idx} className="hover:bg-zinc-900/10">
                            <td className="px-4 py-4.5 font-bold" style={{ color: '#fafafa' }}>{raw?.name} <span className="text-2xs font-mono text-zinc-500">[{raw?.code}]</span></td>
                            <td className="px-4 py-3 text-center font-mono font-medium text-zinc-200">{toPersianDigits(it.qty)} {raw?.unit}</td>
                            <td className="px-4 py-3 text-center font-mono text-zinc-400">{toPersianDigits(it.packageCount)} {raw?.packageType}</td>
                            <td className="px-4 py-3 text-left font-mono">{formatWithCommas(it.price)}</td>
                            <td className="px-4 py-3 text-left font-mono font-black text-[#fafafa]">{formatWithCommas(it.qty * it.price)}</td>
                            <td className="px-4 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => setInvoiceItems(invoiceItems.filter((_, i) => i !== idx))}
                                className="text-rose-450 hover:text-rose-400 text-xs font-bold bg-rose-950/10 border border-rose-950/20 px-2.5 py-1 rounded-lg"
                              >
                                حذف
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={saveFullInvoice}
                    className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/10 cursor-pointer transition-all"
                  >
                    ثبت نهایی و بستانکاری فاکتور خرید در حساب کاربری
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      askConfirm(
                        'پاکسازی پیش‌نویس فاکتور',
                        'آیا از ریست فاکتور پیش‌نویس اطمینان دارید؟ تمام اقلام اضافه شده موقت شما حذف خواهند شد.',
                        () => setInvoiceItems([])
                      );
                    }}
                    className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl text-xs transition-colors"
                  >
                    انصراف و پاکسازی ردیف‌ها
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* List of Registered Purchases in Gatan */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <h3 className="text-xs font-black text-zinc-100 flex items-center gap-1.5">
                <FileText className="h-4.5 w-4.5 text-rose-500 animate-pulse" />
                آرشیو فاکتورهای فیزیکی ثبت‌شده کالا در این دوره
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={exportPurchasesCSV}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700/20 border border-emerald-500/20 hover:bg-emerald-700 hover:text-white text-emerald-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="h-4 w-4" /> خروجی اکسل
                </button>
                <button
                  type="button"
                  onClick={clearAllPurchases}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-955/30 text-rose-455 border border-rose-900 rounded-xl text-xs font-bold hover:text-rose-450 hover:bg-rose-900/20 transition-all cursor-pointer animate-pulse"
                >
                  <Trash2 className="h-4 w-4" /> حذف گروهی فاکتورها
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-zinc-800 rounded-xl bg-zinc-950/20 backdrop-blur-md">
              <table className="min-w-full divide-y divide-zinc-850 text-right text-xs">
                <thead className="bg-zinc-900/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">شماره فاکتور خرید</th>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">تاریخ ثبتی</th>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400">تامین کننده کالا</th>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-center">تعداد اقلام پیوستی</th>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-left">مجموع ارزش ریالی خرید</th>
                    <th className="px-4 py-3.5 text-2xs font-bold tracking-wider text-zinc-400 text-center">لغو</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/50 text-xs text-zinc-300">
                  {purchases.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                        <AlertTriangle className="h-8 w-8 mx-auto text-zinc-650 opacity-40 mb-2.5" />
                        هیچ فاکتور خرید کالا ثبت شده در این دوره وجود ندارد.
                      </td>
                    </tr>
                  ) : (
                    purchases.map(p => {
                      const sup = db.suppliers.find(s => s.id === p.supplierId);
                      const itemsCount = p.items.reduce((acc, curr) => acc + curr.qty, 0);
                      const totalSum = p.items.reduce((acc, curr) => acc + (curr.qty * curr.price), 0);
                      return (
                        <tr key={p.id} className="hover:bg-zinc-900/15 transition-all">
                          <td className="px-4 py-4.5 font-black font-mono text-rose-500">{p.invoiceNumber}</td>
                          <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{p.date}</td>
                          <td className="px-4 py-3 font-bold text-zinc-200" style={{ color: '#fafafa' }}>{sup?.name || 'تولیدکننده متفرقه'}</td>
                          <td className="px-4 py-3 text-center font-mono text-zinc-400">{toPersianDigits(p.items.length)} ردیف ({toPersianDigits(itemsCount)} کالا)</td>
                          <td className="px-4 py-3 text-left font-mono font-extrabold text-[#fafafa]">{formatWithCommas(totalSum)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => removeInvoice(p.id)}
                              className="text-rose-450 hover:text-rose-405 text-2xs font-bold bg-rose-955/10 border border-rose-955/25 px-2.5 py-1 rounded-lg transition-all"
                            >
                              لغو ثبتی خرید
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: STOCK COUNT AUDITING ==================== */}
      {activeTab === 'inventory' && (
        <div className="space-y-6 animate-fade-in">
          {/* Auditing Setup Panel - Full Width on Top */}
          <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-5 sm:p-6 rounded-2xl shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-zinc-800 pb-3 gap-2">
              <h3 className="text-sm font-extrabold text-[#fafafa] flex items-center gap-2">
                <Calendar className="h-4.5 w-4.5 text-rose-500" />
                <span>تعریف یا گزینش انبارگردانی فیزیکی</span>
              </h3>
              {selectedAuditId && (
                <div className="text-xs bg-rose-955/20 text-rose-400 px-3.5 py-1.5 rounded-xl border border-rose-500/20 font-bold flex items-center gap-2">
                  <span>انبارگردانی فعال:</span>
                  <strong className="text-rose-300 font-extrabold">{activeAuditData?.title}</strong>
                  <span className="font-mono text-zinc-400">({toPersianDigits(activeAuditData?.date || '')})</span>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Select Active Audit */}
              <div className="lg:col-span-5 space-y-3 bg-zinc-950/40 p-4 rounded-xl border border-zinc-850">
                <label htmlFor="audit-cycle-select" className="block text-[11px] font-bold text-zinc-400">
                  دوره انبارگردانی فعال در سیستم
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="audit-cycle-select"
                    className="flex-1 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer font-bold"
                    value={selectedAuditId}
                    onChange={(e) => setSelectedAuditId(e.target.value)}
                  >
                    <option value="" className="bg-zinc-950 text-zinc-400">-- گزینش انبارگردانی فعال --</option>
                    {audits.map(a => (
                      <option key={a.id} value={a.id} className="bg-zinc-950 text-zinc-100">{a.title} ({toPersianDigits(a.date)})</option>
                    ))}
                  </select>
                  {audits.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAllAudits}
                      className="p-2.5 bg-rose-955/15 text-rose-400 hover:text-rose-300 border border-rose-955/30 hover:bg-rose-955/30 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
                      title="حذف تمامی دوره‌های انبارگردانی"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {activeAuditData && (
                  <div className="flex items-center justify-between text-2xs text-zinc-400 pt-1">
                    <span>تعداد ردیف‌های ثبت‌شده: <strong className="text-zinc-200 font-mono font-bold">{toPersianDigits(activeCounts.length)}</strong></span>
                    <span>ارزش لحظه‌ای: <strong className="text-emerald-400 font-mono font-bold">{formatWithCommas(roundTo2Decimals(auditValuation))} ریال</strong></span>
                  </div>
                )}
              </div>

              {/* Create New Audit Inline Form */}
              <div className="lg:col-span-7 bg-zinc-950/40 p-4 rounded-xl border border-zinc-850 space-y-3">
                <h4 className="text-[11px] font-extrabold text-zinc-300 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-rose-500" />
                  <span>ایجاد انبارگردانی جدید برای این دوره مالی:</span>
                </h4>
                <form onSubmit={createNewAudit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6">
                    <label htmlFor="audit-title-input" className="block text-[10px] font-bold text-zinc-400 mb-1">
                      عنوان انبارگردانی <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="audit-title-input"
                      type="text"
                      className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 placeholder-zinc-650"
                      placeholder="مانند: انبارگردانی پایان سال یا میاندوره"
                      value={newAuditTitle}
                      onChange={(e) => setNewAuditTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="audit-date-input" className="block text-[10px] font-bold text-zinc-400 mb-1">
                      تاریخ ثبتی <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="audit-date-input"
                      type="text"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 placeholder-zinc-650 text-center"
                      placeholder="۱۴۰۴/۱۲/۲۸"
                      value={newAuditDate}
                      onChange={(e) => setNewAuditDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl text-xs transition-all shadow-md shadow-rose-600/10 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      <span>ثبت دوره</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* Counts Recording and Live calculation */}
          <div className="space-y-6">
              {selectedAuditId ? (
                <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-zinc-800 pb-3 mb-2 gap-2">
                    <div>
                      <h4 className="text-xs font-black text-[#fafafa] flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping"></span>
                        اجرای عملیات شمارش کالا: {activeAuditData?.title} 
                      </h4>
                      <p className="text-2xs text-zinc-500 mt-1 font-mono">تاریخ ثبت تاریخچه فیزیکی: {activeAuditData?.date}</p>
                    </div>

                    <div className="bg-emerald-950/30 text-emerald-400 p-2.5 text-2xs rounded-xl border border-emerald-900/50 font-bold">
                      ارزش ریالی شمارش در لحظه: {formatWithCommas(roundTo2Decimals(auditValuation))} ریال
                    </div>
                  </div>

                  <form id="stock-count-form-card" onSubmit={handleAddOrUpdateCount} className={`p-5 rounded-2xl border transition-all ${editingCountId ? 'bg-amber-950/20 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-zinc-950/40 border-zinc-850'}`}>
                    {/* Notice banner when editing an existing count */}
                    {editingCountId && (
                      <div className="mb-4 bg-amber-500/15 border border-amber-500/30 p-3 rounded-xl flex items-center justify-between flex-wrap gap-2 text-amber-300 text-xs font-bold">
                        <div className="flex items-center gap-2">
                          <Edit2 className="h-4 w-4 text-amber-400 shrink-0" />
                          <span>در حال ویرایش ردیف شمارش: <strong>{selectedCountItemData?.name || 'کالای انتخابی'}</strong> ({selectedCountItemData?.code})</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelEditCount}
                          className="text-[11px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white px-3 py-1 rounded-lg border border-zinc-700 transition-all cursor-pointer flex items-center gap-1"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>انصراف از ویرایش</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                      {/* Item Selector */}
                      <div className="sm:col-span-2 text-zinc-100">
                        <label htmlFor="cnt-item-select" className="block text-[11px] font-bold text-zinc-400 mb-1.5">
                          انتخاب کالا / ماده اولیه جهت شمارش (امکان ثبت مکرر و چندباره فراهم است)
                        </label>
                        <SearchableSelect
                          id="cnt-item-select"
                          value={countItemId}
                          onChange={(val) => setCountItemId(val)}
                          options={activeItemsList.map(i => ({
                            value: i.id,
                            label: `${i.code} | ${i.name} ${i.accountId ? `(${i.accountId})` : ''}`
                          }))}
                          placeholder="-- جستجو در نام، کد کالا یا کد حسابداری جهت شمارش --"
                        />
                      </div>

                      {/* Package Count */}
                      <div>
                        <label htmlFor="cnt-packs" className="block text-[11px] font-bold text-zinc-400 mb-1.5">
                          تعداد بسته کامل ({selectedCountItemData?.packageType || 'کارتن'})
                        </label>
                        <input
                          id="cnt-packs"
                          type="number"
                          onFocus={handleFocus}
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                          value={countPacks}
                          onChange={(e) => setCountPacks(parseNumber(e.target.value))}
                          min={0}
                        />
                      </div>

                      {/* Loose Quantity */}
                      <div>
                        <label htmlFor="cnt-loose" className="block text-[11px] font-bold text-zinc-400 mb-1.5">
                          مقدار جزئی / فله ({selectedCountItemData?.unit === 'کیلویی' ? 'کیلوگرم' : 'عدد'})
                        </label>
                        <input
                          id="cnt-loose"
                          type="number"
                          step="any"
                          onFocus={handleFocus}
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                          value={countLoose}
                          onChange={(e) => setCountLoose(parseNumber(e.target.value))}
                          min={0}
                        />
                      </div>

                      {/* Optional note or shelf/batch */}
                      <div className="sm:col-span-2">
                        <label htmlFor="cnt-shelf-location" className="block text-[11px] font-bold text-zinc-400 mb-1.5">
                          یادداشت یا برچسب نوبت شمارش (اختیاری)
                        </label>
                        <input
                          id="cnt-shelf-location"
                          type="text"
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 placeholder-zinc-650"
                          placeholder="مثلاً: پارت ۲، شمارش مجدد، یا توضیحات اختیاری..."
                          value={countShelfLocation}
                          onChange={(e) => setCountShelfLocation(e.target.value)}
                        />
                      </div>

                      {/* Selected Item Master Info and Quick Edit Button */}
                      {selectedCountItemData && (
                        <div className="sm:col-span-2 lg:col-span-4 bg-zinc-950 border border-zinc-850 p-3.5 rounded-xl text-2xs text-zinc-400 font-mono mt-1">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                            <div>کد کالا: <strong className="font-semibold text-zinc-200">{selectedCountItemData.code}</strong></div>
                            <div>واحد سنجش: <strong className="font-semibold text-zinc-200">{selectedCountItemData.unit}</strong></div>
                            <div>بسته‌بندی انبار: <strong className="font-semibold text-zinc-200">{selectedCountItemData.packageType}</strong></div>
                            <div>ضریب در بسته: <strong className="font-semibold text-zinc-200">{toPersianDigits(selectedCountItemData.qtyPerPackage)}</strong></div>
                            <div>وزن بسته: <strong className="font-semibold text-zinc-200">{toPersianDigits(selectedCountItemData.weightPerPackage)} کیلو</strong></div>
                            <div>قیمت واحد: <strong className="font-semibold text-emerald-400">{formatWithCommas(selectedCountItemData.price)} ریال</strong></div>
                          </div>
                          
                          <div className="border-t border-zinc-850 pt-2.5 mt-2 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div className="flex flex-wrap items-center gap-3 font-bold text-rose-400 text-xs">
                              <span>مجموع حجم شمارش شده این ردیف: <strong className="text-white font-mono">{toPersianDigits(roundTo2Decimals(calculatedLiveCountVal.qty))}</strong> {selectedCountItemData.unit}</span>
                              <span className="text-zinc-400 text-2xs font-normal font-mono bg-zinc-900/80 px-2 py-0.5 rounded-md border border-zinc-800">
                                ({toPersianDigits(countPacks)} بسته × {toPersianDigits(selectedCountItemData.weightPerPackage || 1)} وزن بسته + {toPersianDigits(countLoose)} جزئی)
                              </span>
                              <span className="text-emerald-400">ارزش ریالی: <strong className="font-mono">{formatWithCommas(calculatedLiveCountVal.val)}</strong> ریال</span>
                            </div>

                            {/* Quick edit item master button */}
                            <button
                              type="button"
                              onClick={() => openQuickEditItem(selectedCountItemData)}
                              className="px-3 py-1.5 bg-zinc-900 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 border border-zinc-700 hover:border-rose-600 rounded-lg text-2xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shrink-0"
                              title="ویرایش سریع قیمت، بسته‌بندی، نام و مشخصات کالا در همین بخش بدون نیاز به خروج از انبارگردانی"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>ویرایش سریع مشخصات کالا</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Submit and Action Buttons */}
                      <div className="sm:col-span-2 lg:col-span-4 flex justify-end items-center gap-2 pt-2 border-t border-zinc-850/60">
                        {editingCountId && (
                          <button
                            type="button"
                            onClick={handleCancelEditCount}
                            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                          >
                            انصراف
                          </button>
                        )}
                        <button
                          type="submit"
                          className={`px-5 py-2.5 text-white text-xs font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                            editingCountId 
                              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20' 
                              : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                          }`}
                        >
                          {editingCountId ? (
                            <>
                              <Save className="h-4 w-4" />
                              <span>ذخیره تغییرات ردیف شمارش</span>
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              <span>ثبت و ارزش‌گذاری فوری ردیف شمارش</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* List of counts */}
                  <div className="space-y-3 pt-3">
                    <div className="flex flex-col gap-3 border-b border-zinc-850 pb-3">
                      {/* Top bar: title + warehouse filter + search + view mode switch */}
                      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h5 className="text-2xs font-bold text-zinc-300 flex items-center gap-1.5">
                            <Layers className="h-4 w-4 text-rose-500" />
                            تاریخچه لیست شمارش شده جاری:
                          </h5>
                          <span className="text-[11px] bg-zinc-800 text-zinc-300 px-2.5 py-0.5 rounded-full font-mono font-bold">
                            {countViewMode === 'detailed' ? `${toPersianDigits(activeCounts.length)} ردیف انبار` : `${toPersianDigits(aggregatedCounts.length)} قلم کالا تجمیعی`}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
                          {/* Warehouse Filter Dropdown */}
                          <div className="flex items-center gap-1.5 w-full sm:w-auto">
                            <span className="text-2xs font-bold text-zinc-400 whitespace-nowrap">تفکیک انبار:</span>
                            <select
                              id="count-warehouse-filter-select"
                              value={countWarehouseFilter}
                              onChange={(e) => {
                                setCountWarehouseFilter(e.target.value);
                                setCountPage(1);
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-rose-350 font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                            >
                              <option value="all">همه انبارها (نمایش تجمیعی)</option>
                              {warehouses.map(w => (
                                <option key={w.id} value={w.name}>
                                  {w.name} {w.code ? `(${w.code})` : ''}
                                </option>
                              ))}
                              {countedWarehouses.filter(w => w !== 'فاقد انبار مشخص' && !warehouses.some(wh => wh.name === w)).map(w => (
                                <option key={w} value={w}>{w}</option>
                              ))}
                              <option value="فاقد انبار مشخص">فاقد انبار مشخص</option>
                            </select>
                          </div>

                          {/* Search in counted items */}
                          <div className="relative w-full sm:w-56">
                            <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                            <input
                              type="text"
                              value={countSearchQuery}
                              onChange={(e) => setCountSearchQuery(e.target.value)}
                              placeholder="جستجو در کالاهای شمارش شده..."
                              className="w-full pr-8.5 pl-7 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                            />
                            {countSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setCountSearchQuery('')}
                                className="absolute left-2.5 top-2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
                                title="پاک کردن جستجو"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {/* View Mode Toggle: Detailed vs Aggregated */}
                          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
                            <button
                              type="button"
                              onClick={() => setCountViewMode('detailed')}
                              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                                countViewMode === 'detailed'
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="نمایش تمامی نوبت‌ها و ردیف‌های ثبت شده شمارش کالاها (امکان ثبت مکرر)"
                            >
                              <span>ریز ردیف‌ها ({toPersianDigits(filteredActiveCounts.length)})</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setCountViewMode('aggregated')}
                              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                                countViewMode === 'aggregated'
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                              title="نمایش تجمیعی: جمع خودکار مقادیر کالاهای مشابه در تمام نوبت‌های شمارش در یک سطر"
                            >
                              <span>تجمیعی کالاها ({toPersianDigits(filteredAggregatedCounts.length)})</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Secondary toolbar: export buttons */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
                        <div className="text-2xs text-zinc-400 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span>
                            {countWarehouseFilter === 'all' 
                              ? 'نمایش تمامی انبارها | شمارش آزاد بدون الزام انبار' 
                              : `فیلتر فعال: انبار ${countWarehouseFilter}`}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
                          <button
                            type="button"
                            onClick={printAuditReport}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs"
                            title="چاپ بهینه و فشرده گزارش تجمیعی انبارگردانی (A4 با حداقل مصرف کاغذ)"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>چاپ گزارش تجمیعی (A4 بهینه)</span>
                          </button>
                          <button
                            type="button"
                            onClick={exportStockCountTemplateXLSX}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs border border-indigo-600"
                            title="دانلود قالب خالی اکسل جهت درج و ورود اطلاعات انبارگردانی"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>دانلود قالب اکسل</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => auditFileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs border border-amber-500"
                            title="بارگذاری و ورود اطلاعات شمارش انبارگردانی از فایل اکسل یا CSV"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            <span>ورود از اکسل</span>
                          </button>
                          <input
                            type="file"
                            ref={auditFileInputRef}
                            onChange={importAuditsExcel}
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={exportAuditsXLSX}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs border border-emerald-600"
                            title="دانلود فایل اکسل رسمی (.xlsx) تجمیعی انبارگردانی"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>خروجی Excel (.xlsx)</span>
                          </button>
                          <button
                            type="button"
                            onClick={exportAuditsCSV}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all cursor-pointer border border-zinc-700"
                            title="دانلود فایل CSV تجمیعی"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>CSV</span>
                          </button>
                          {activeCounts.length > 0 && (
                            <button
                              type="button"
                              onClick={clearAllCounts}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-955/15 text-rose-450 border border-rose-900/40 hover:bg-rose-900/30 rounded-xl text-xs font-bold cursor-pointer transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>حذف کل شمارش‌ها</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Table View */}
                    <div id="inventory-countable-table" className="border border-zinc-800/80 rounded-2xl bg-zinc-950/20 backdrop-blur-md overflow-hidden">
                      <div className="overflow-x-auto">
                        {countViewMode === 'detailed' ? (
                          // DETAILED RECORD VIEW (MULTIPLE COUNTS PER ITEM)
                          <table className="min-w-full text-right text-xs">
                            <thead className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800">
                              <tr>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400">کالا</th>
                                <th className="px-3 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">انبار</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">شناسه / نوبت ثبت</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">جزئیات بسته‌بندی</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">شمارش فیزیکی ردیف</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">مجموع حجم شمارش شده</th>
                                <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-left">قیمت واحد (ریال)</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-left">ارزش کل شمارش</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center no-print">عملیات</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900/40 text-xs text-zinc-300">
                              {filteredActiveCounts.length === 0 ? (
                                <tr>
                                  <td colSpan={9} className="px-4 py-12 text-center text-zinc-500">
                                    <AlertTriangle className="h-8 w-8 mx-auto text-zinc-650 opacity-40 mb-2.5" />
                                    {countSearchQuery ? 'هیچ کالای شمارش شده‌ای با عبارت جستجو مطابقت ندارد.' : 'هیچ رکوردی در این دوره شمارش فیزیکی نشده است.'}
                                  </td>
                                </tr>
                              ) : (
                                paginatedActiveCounts.map((c, idx) => {
                                  const raw = itemMap[c.itemId];
                                  const isBeingEdited = editingCountId === c.id;
                                  const overallIdx = countPageSize === 'all' ? idx : (countPage - 1) * countPageSize + idx;
                                  const itemWarehouse = c.warehouse || raw?.warehouse || 'فاقد انبار';

                                  return (
                                    <tr key={`${c.id}-${idx}`} className={`hover:bg-zinc-900/10 transition-colors ${isBeingEdited ? 'bg-amber-950/20 border-l-4 border-l-amber-500' : ''}`}>
                                      <td className="px-4 py-4.5 font-bold" style={{ color: '#fafafa' }}>
                                        <div className="font-extrabold text-[#fafafa] flex items-center gap-1.5">
                                          <span>{raw?.name || 'کالای نامشخص'}</span>
                                          {isBeingEdited && (
                                            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold">در حال ویرایش</span>
                                          )}
                                        </div>
                                        <div className="text-2xs text-zinc-500 font-mono mt-0.5">
                                          کد: {raw?.code} {raw?.accountId ? `| حسابداری: ${raw.accountId}` : ''}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3 text-center text-xs">
                                        <span className="inline-block px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 font-bold text-zinc-300 text-2xs">
                                          {itemWarehouse}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-center text-xs text-zinc-300">
                                        <span className="inline-block px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 font-bold text-rose-350 font-mono">
                                          نوبت {toPersianDigits(overallIdx + 1)}
                                        </span>
                                        {c.shelfLocation && (
                                          <div className="text-[10px] text-zinc-400 mt-1 font-mono">{c.shelfLocation}</div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 text-center text-2xs text-zinc-450">
                                        {raw?.unit} | {raw?.packageType}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-zinc-300">
                                        {toPersianDigits(c.fullPackages)} {raw?.packageType || 'بسته'} + {toPersianDigits(c.looseQty)} جزئی
                                      </td>
                                      <td className="px-4 py-3 text-center font-bold font-mono text-[#fafafa]">
                                        {toPersianDigits(roundTo2Decimals(c.totalCalculatedQty))} {raw?.unit === 'کیلویی' ? 'کیلوگرم' : 'عدد'}
                                      </td>
                                      <td className="px-3.5 py-3 text-left font-mono font-bold text-zinc-300">
                                        {formatWithCommas(raw?.price || 0)}
                                      </td>
                                      <td className="px-4 py-3 text-left font-mono font-extrabold text-emerald-400">
                                        {formatWithCommas(roundTo2Decimals(c.value))}
                                      </td>
                                      <td className="px-4 py-3 text-center no-print">
                                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                          {/* Edit count quantities */}
                                          <button
                                            type="button"
                                            onClick={() => handleStartEditCount(c)}
                                            className="text-amber-400 hover:text-amber-300 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 p-1 px-2.5 rounded-lg text-2xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                            title="ویرایش مقادیر این نوبت شمارش"
                                          >
                                            <Edit2 className="h-3 w-3" />
                                            <span>ویرایش شمارش</span>
                                          </button>

                                          {/* Quick edit item master details */}
                                          {raw && (
                                            <button
                                              type="button"
                                              onClick={() => openQuickEditItem(raw)}
                                              className="text-sky-400 hover:text-sky-300 border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 p-1 px-2 rounded-lg text-2xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                              title="ویرایش شناسنامه، بسته‌بندی و قیمت کالا"
                                            >
                                              <Settings className="h-3 w-3" />
                                              <span>شناسنامه</span>
                                            </button>
                                          )}

                                          {/* Delete count */}
                                          <button
                                            type="button"
                                            onClick={() => deleteCount(c.id)}
                                            className="text-rose-450 hover:text-rose-400 border border-rose-955/20 bg-rose-955/10 hover:bg-rose-900/20 p-1 px-2.5 rounded-lg text-2xs font-bold transition-all cursor-pointer"
                                            title="حذف ردیف شمارش"
                                          >
                                            حذف
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        ) : (
                          // AGGREGATED SINGLE-ROW PER ITEM VIEW
                          <table className="min-w-full text-right text-xs">
                            <thead className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800">
                              <tr>
                                <th className="px-4 py-3 text-2xs font-bold text-center w-12 text-zinc-400">ردیف</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400">کالا</th>
                                <th className="px-3 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">انبار</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">دفعات ثبت شمارش</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">بسته‌بندی</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">جمع بسته کامل</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">جمع فله</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center">مجموع حجم شمارش شده تجمیعی</th>
                                <th className="px-3.5 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-left">قیمت واحد (ریال)</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-left">ارزش کل تجمیعی</th>
                                <th className="px-4 py-3 text-2xs font-bold tracking-wider text-zinc-400 text-center no-print">عملیات</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900/40 text-xs text-zinc-300">
                              {filteredAggregatedCounts.length === 0 ? (
                                <tr>
                                  <td colSpan={11} className="px-4 py-12 text-center text-zinc-500">
                                    <AlertTriangle className="h-8 w-8 mx-auto text-zinc-650 opacity-40 mb-2.5" />
                                    {countSearchQuery ? 'هیچ کالای تجمیعی با عبارت جستجو مطابقت ندارد.' : 'هیچ کالایی در این دوره شمارش نشده است.'}
                                  </td>
                                </tr>
                              ) : (
                                paginatedAggregatedCounts.map((agg, idx) => {
                                  const raw = agg.itemObj;
                                  const overallIdx = countPageSize === 'all' ? idx : (countPage - 1) * countPageSize + idx;
                                  const warehousesStr = agg.warehouses.length > 0 ? agg.warehouses.join('، ') : 'فاقد انبار';

                                  return (
                                    <tr key={`${agg.itemId}-${idx}`} className="hover:bg-zinc-900/10 transition-colors">
                                      <td className="px-4 py-3 text-center font-mono text-zinc-500">
                                        {toPersianDigits(overallIdx + 1)}
                                      </td>
                                      <td className="px-4 py-4 font-bold" style={{ color: '#fafafa' }}>
                                        <div className="font-extrabold text-[#fafafa]">{raw?.name || 'کالای نامشخص'}</div>
                                        <div className="text-2xs text-zinc-500 font-mono mt-0.5">
                                          کد: {raw?.code} {raw?.accountId ? `| حسابداری: ${raw.accountId}` : ''}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3 text-center text-xs">
                                        <span className="inline-block px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 font-bold text-zinc-300 text-2xs">
                                          {warehousesStr}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <span className="inline-block px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-bold text-rose-350 font-mono">
                                          {toPersianDigits(agg.recordsCount)} نوبت ثبت
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-center text-2xs text-zinc-400">
                                        {raw?.packageType || 'بسته'} ({raw?.unit})
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono font-bold text-zinc-200">
                                        {toPersianDigits(agg.totalPackages)}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-zinc-300">
                                        {toPersianDigits(agg.totalLooseQty)}
                                      </td>
                                      <td className="px-4 py-3 text-center font-extrabold font-mono text-[#fafafa]">
                                        {toPersianDigits(roundTo2Decimals(agg.totalCalculatedQty))} {raw?.unit === 'کیلویی' ? 'کیلوگرم' : 'عدد'}
                                      </td>
                                      <td className="px-3.5 py-3 text-left font-mono font-bold text-zinc-300">
                                        {formatWithCommas(raw?.price || 0)}
                                      </td>
                                      <td className="px-4 py-3 text-left font-mono font-extrabold text-emerald-400">
                                        {formatWithCommas(roundTo2Decimals(agg.totalValue))}
                                      </td>
                                      <td className="px-4 py-3 text-center no-print">
                                        <div className="flex items-center justify-center gap-1.5">
                                          {raw && (
                                            <button
                                              type="button"
                                              onClick={() => openQuickEditItem(raw)}
                                              className="text-sky-400 hover:text-sky-300 border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 p-1 px-2.5 rounded-lg text-2xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                              title="ویرایش سریع شناسنامه و مشخصات کالا"
                                            >
                                              <Edit3 className="h-3 w-3" />
                                              <span>ویرایش کالا</span>
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCountSearchQuery(raw?.code || raw?.name || '');
                                              setCountViewMode('detailed');
                                            }}
                                            className="text-zinc-400 hover:text-zinc-200 border border-zinc-700 bg-zinc-900 p-1 px-2.5 rounded-lg text-2xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                            title="مشاهده ریز رکوردهای شمارش این کالا"
                                          >
                                            <Eye className="h-3 w-3" />
                                            <span>ریز ردیف‌ها</span>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* Pagination Controls for Inventory Stock Counts */}
                      <PaginationControl
                        currentPage={countPage}
                        totalItems={countViewMode === 'detailed' ? filteredActiveCounts.length : filteredAggregatedCounts.length}
                        pageSize={countPageSize}
                        onPageChange={setCountPage}
                        onPageSizeChange={setCountPageSize}
                        pageSizeOptions={[25, 50, 100, 200, 500]}
                        itemName={countViewMode === 'detailed' ? 'ردیف شمارش' : 'قلم کالا'}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-950/40 border border-zinc-800 text-zinc-400 p-12 text-center rounded-2xl">
                  <AlertTriangle className="h-10 w-10 mx-auto text-rose-500 mb-2.5" />
                  لطفا ابتدا یک دوره انبارگردانی فعال را انتخاب یا ایجاد نمایید تا شمارش و ارزش‌گذاری فعال شود.
                </div>
              )}
            </div>
        </div>
      )}

      {/* ==================== TAB 5: WAREHOUSE MANAGEMENT ==================== */}
      {activeTab === 'warehouses' && (
        <div className="space-y-6 animate-fade-in text-right" dir="rtl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Form side */}
            <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-sm font-extrabold text-[#fafafa] flex items-center gap-2 mb-1.5 border-b border-zinc-800 pb-3">
                <Plus className="h-4.5 w-4.5 text-rose-500" />
                {editingWhId ? 'اصلاح مشخصات انبار' : 'تعریف انبار جدید'}
              </h3>
              
              <form onSubmit={handleAddOrUpdateWarehouse} className="space-y-4">
                <div>
                  <label htmlFor="wh-name-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">عنوان فارسی انبار</label>
                  <input
                    id="wh-name-input"
                    type="text"
                    required
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all"
                    placeholder="مثال: انبار مرکزی / سردخانه گوشت"
                    value={newWhName}
                    onChange={(e) => setNewWhName(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="wh-code-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">کد انبار (اختیاری)</label>
                  <input
                    id="wh-code-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all font-mono"
                    placeholder="مثال: WH01 / 101"
                    value={newWhCode}
                    onChange={(e) => setNewWhCode(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="wh-location-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">موقعیت فیزیکی یا نشانی (اختیاری)</label>
                  <input
                    id="wh-location-input"
                    type="text"
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 hover:border-zinc-700 transition-all"
                    placeholder="مثال: طبقه همکف، انتهای راهرو سمت راست"
                    value={newWhLocation}
                    onChange={(e) => setNewWhLocation(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-grow bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 rounded-xl shadow-lg transition-all cursor-pointer"
                  >
                    {editingWhId ? 'اعمال تغییرات انبار' : 'ثبت غرفه‌ای انبار جدید'}
                  </button>
                  {editingWhId && (
                    <button
                      type="button"
                      onClick={handleCancelWhEdit}
                      className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl text-xs transition-colors cursor-pointer"
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* List side */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-2xl border border-zinc-850 backdrop-blur-md">
                <div className="relative w-full sm:w-72">
                  <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    id="wh-search-input"
                    type="text"
                    value={whSearch}
                    onChange={(e) => setWhSearch(e.target.value)}
                    placeholder="جستجو در انبارها..."
                    className="w-full pl-3 pr-10 py-2 text-xs bg-zinc-950 border border-zinc-805 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-right"
                  />
                </div>
                <div className="text-2xs text-zinc-400 font-bold">
                  تعداد انبارهای فعال دوره جاری: <span className="font-mono text-rose-450">{toPersianDigits(warehouses.length)} انبار</span>
                </div>
              </div>

              <div className="overflow-x-auto border border-zinc-800 rounded-2xl bg-zinc-950/20 backdrop-blur-md">
                <table className="min-w-full text-right text-xs">
                  <thead className="bg-zinc-900/40 text-zinc-400 border-b border-zinc-800/80">
                    <tr>
                      <th className="px-4 py-3.5 font-bold tracking-wider">کد انبار</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider">نام انبار</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider">موقعیت فیزیکی</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider text-center no-print">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/50 text-zinc-350">
                    {searchedWarehouses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-zinc-500">
                          <AlertTriangle className="h-8 w-8 mx-auto text-zinc-650 mb-2.5 opacity-40" />
                          هیچ انباری یافت نشد یا ثبت نشده است. از فرم سمت راست انبار جدید اضافه نمائید.
                        </td>
                      </tr>
                    ) : (
                      searchedWarehouses.map(wh => (
                        <tr key={wh.id} className="hover:bg-zinc-900/10 transition-colors">
                          <td className="px-4 py-4 font-black font-mono text-rose-500">{toPersianDigits(wh.code || '-')}</td>
                          <td className="px-4 py-4 font-bold text-zinc-200" style={{ color: '#fafafa' }}>{wh.name}</td>
                          <td className="px-4 py-4 text-xs text-zinc-400">{wh.location || '-'}</td>
                          <td className="px-4 py-4 text-center no-print">
                            <div className="flex justify-center gap-1.5">
                              <button
                                onClick={() => handleEditWarehouse(wh)}
                                className="text-2xs text-zinc-200 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                              >
                                ویرایش
                              </button>
                              <button
                                onClick={() => handleDeleteWarehouse(wh.id, wh.name)}
                                className="text-2xs text-rose-450 hover:text-rose-450 border border-rose-955/25 bg-rose-955/15 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                              >
                                حذف
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ==================== BOTTOM SYSTEM HIGHLIGHTS: SUMMARY REPORT ==================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-zinc-800/80 mt-8">
        <div className="p-4.5 bg-zinc-900/40 rounded-2xl border border-zinc-800 backdrop-blur-md shadow-lg">
          <span className="block text-[11px] font-bold text-zinc-400">ارزش ریالی موجود در آخرین انبارگردانی فعال</span>
          <strong className="block text-lg font-black text-zinc-100 font-mono mt-1">{formatWithCommas(totalSystemValue)} ریال</strong>
        </div>
        
        <div className="p-4.5 bg-zinc-900/40 rounded-2xl border border-zinc-800 backdrop-blur-md shadow-lg">
          <span className="block text-[11px] font-bold text-zinc-400">تعداد کل شمارش فیزیکی کالاها</span>
          <strong className="block text-lg font-black text-zinc-100 font-mono mt-1">{toPersianDigits(totalItemStockQtyCount)} کالا</strong>
        </div>

        <div className="p-4.5 bg-rose-955/15 rounded-2xl border border-rose-500/25 backdrop-blur-md shadow-lg">
          <span className="block text-[11px] text-rose-450 flex items-center gap-1.5 font-black">
            <AlertTriangle className="h-4 w-4 text-rose-500 animate-bounce" /> موجودی بحرانی (زیر آستانه هشدار)
          </span>
          <strong className="block text-lg font-black text-rose-400 font-mono mt-1">{toPersianDigits(alertItems.length)} کالا</strong>
          
          {alertItems.length > 0 && (
            <div className="mt-2.5 text-2xs border-t border-rose-955/20 pt-2 space-y-1">
              {alertItems.slice(0, 3).map((al, idx) => (
                <div key={idx} className="flex justify-between font-bold text-rose-300">
                  <span>{al.itemObj.name}</span>
                  <span>موجودی: {toPersianDigits(roundTo2Decimals(al.countObj.totalCalculatedQty))} <span className="font-medium text-rose-450">(حد: {toPersianDigits(al.itemObj.reorderThreshold)})</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ==================== QUICK EDIT ITEM MASTER MODAL (IN AUDIT) ==================== */}
      {isQuickEditItemModalOpen && quickEditItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn animate-duration-200" dir="rtl">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-3xl p-6 max-w-2xl w-full shadow-2xl text-right animate-scaleIn my-8 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-sky-500/10 border border-sky-500/25 rounded-2xl text-sky-400">
                  <Edit3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">ویرایش سریع مشخصات کالا در انبارگردانی</h3>
                  <p className="text-2xs text-zinc-400 mt-0.5">
                    اصلاح آنی شناسنامه، ضرایب بسته‌بندی و نرخ پایه بدون ترک صفحه انبارگردانی
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickEditItemModalOpen(false);
                  setQuickEditItem(null);
                }}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveQuickEditItem} className="space-y-4 pt-4 flex-grow overflow-y-auto pr-1">
              <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 text-2xs text-sky-300 leading-relaxed">
                💡 <span className="font-bold">نکته مهم:</span> با ذخیره مشخصات، ضریب بسته‌بندی و قیمت کالا بلافاصله در تمامی رکوردهای شمارش‌شده این کالا در دوره انبارگردانی اعمال شده و ارزش ریالی کل مجدداً به صورت دقیق محاسبه خواهد شد.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Item Name */}
                <div className="sm:col-span-2">
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">
                    نام کامل کالا <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    value={quickEditItem.name}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, name: e.target.value })}
                  />
                </div>

                {/* System Code */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">
                    کد سیستم کالا <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    value={quickEditItem.code}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, code: e.target.value })}
                  />
                </div>

                {/* Accounting Code */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">کد حسابداری کالا</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    placeholder="اختیاری"
                    value={quickEditItem.accountId || ''}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, accountId: e.target.value })}
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">بارکد کالا</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    placeholder="اختیاری"
                    value={quickEditItem.barcode || ''}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, barcode: e.target.value })}
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">گروه کالا</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 cursor-pointer"
                    value={quickEditItem.categoryId}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, categoryId: e.target.value })}
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Main Unit */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">واحد سنجش اصلی</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 cursor-pointer"
                    value={quickEditItem.unit}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, unit: e.target.value as 'کیلویی' | 'عددی' })}
                  >
                    <option value="کیلویی">کیلویی (کیلوگرم)</option>
                    <option value="عددی">عددی</option>
                  </select>
                </div>

                {/* Package Type */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">نوع بسته‌بندی ظرف</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 cursor-pointer"
                    value={quickEditItem.packageType}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, packageType: e.target.value as any })}
                  >
                    <option value="کارتن">کارتن</option>
                    <option value="گونی">گونی</option>
                    <option value="سطل">سطل</option>
                    <option value="حلب">حلب</option>
                  </select>
                </div>

                {/* Qty Per Package */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">
                    تعداد در هر بسته <span className="text-zinc-500 font-normal">(برای کالای عددی)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    value={quickEditItem.qtyPerPackage}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, qtyPerPackage: parseNumber(e.target.value) || 1 })}
                  />
                </div>

                {/* Weight Per Package */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">
                    وزن ناخالص هر بسته (کیلوگرم) <span className="text-zinc-500 font-normal">(برای کالای کیلویی)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    value={quickEditItem.weightPerPackage}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, weightPerPackage: parseNumber(e.target.value) || 1 })}
                  />
                </div>

                {/* Price */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">
                    قیمت واحد پایه (ریال) <span className="text-emerald-400 font-mono text-3xs">({formatWithCommas(quickEditItem.price || 0)} ریال)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    value={quickEditItem.price}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, price: parseNumber(e.target.value) || 0 })}
                  />
                </div>

                {/* Default Warehouse */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">انبار پیش‌فرض کالا</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 cursor-pointer"
                    value={quickEditItem.warehouse || ''}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, warehouse: e.target.value })}
                  >
                    <option value="">بدون انبار پیش‌فرض</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.name}>{w.name} {w.code ? `(${w.code})` : ''}</option>
                    ))}
                  </select>
                </div>

                {/* Reorder Threshold */}
                <div>
                  <label className="block text-2xs font-bold text-zinc-300 mb-1">حد آستانه هشدار کسری موجودی</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    value={quickEditItem.reorderThreshold}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, reorderThreshold: parseNumber(e.target.value) || 0 })}
                  />
                </div>

                {/* Status Active */}
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id="quickEditItemActive"
                    checked={quickEditItem.isActive}
                    onChange={(e) => setQuickEditItem({ ...quickEditItem, isActive: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-zinc-700 bg-zinc-950 cursor-pointer"
                  />
                  <label htmlFor="quickEditItemActive" className="text-2xs font-bold text-zinc-200 cursor-pointer">
                    کالا در چرخه عملیات فعال است
                  </label>
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-zinc-800 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsQuickEditItemModalOpen(false);
                    setQuickEditItem(null);
                  }}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-600/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  <span>ذخیره تغییرات شناسنامه کالا</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn animate-duration-200" dir="rtl">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-right animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-500 mb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                <AlertTriangle className="h-6 w-6 text-rose-500 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-slate-100">{confirmModal.title}</h3>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed font-medium mb-6">
              {confirmModal.message}
            </p>
            
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg border border-rose-500/15 transition-all cursor-pointer"
              >
                تایید و حذف دائمی
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
