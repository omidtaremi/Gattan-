/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AppDatabase,
  Supplier,
  Item,
  Product,
  ProcurementOrder,
  ProcurementOrderItem,
  ProcurementItemStatus
} from '../types';
import {
  toPersianDigits,
  toEnglishDigits,
  formatWithCommas,
  parseNumber,
  downloadCSV,
  printElement,
  matchPersianString,
  getTodayJalali
} from '../utils/persianUtils';
import ShamsiDatePicker from './ShamsiDatePicker';
import { nextSimpleId } from '../utils/simpleId';
import { ModuleHeader, ModulePrimaryTabs, ErpButton, ERP_BUTTON_LABELS } from './ui/UnifiedErpUi';
import CopyFromPeriodModal from './ui/CopyFromPeriodModal';
import {
  FileText,
  Search,
  Plus,
  Trash2,
  Printer,
  CheckCircle,
  Phone,
  MapPin,
  CreditCard,
  Calendar,
  Truck,
  Download,
  Check,
  X,
  ShoppingCart,
  Layers,
  Info,
  Pencil,
  Package,
  ArrowRightLeft,
  ShoppingBag,
  ClipboardCheck,
  AlertTriangle,
  RotateCcw,
  List,
  LayoutGrid,
  UserCheck,
  Lock
} from 'lucide-react';

interface ProcurementManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  currentUserName?: string;
}

interface LastPriceInfo {
  price: number;
  source: 'invoice' | 'catalog';
  date?: string;
  supplierId?: string;
  supplierName?: string;
}

interface EnrichedReportRow {
  orderId: string;
  orderTitle: string;
  orderDate: string;
  expectedDeliveryDate: string;
  requestedBy: string;
  orderStatus: string;
  isFromPreviousOrder: boolean;
  isOrderActive: boolean;
  orderInactiveReason?: 'new_order' | 'deadline_passed';
  itemIndex: number;
  lineId: string;
  itemId: string;
  isProduct: boolean;
  name: string;
  code: string;
  unit: string;
  qtyProposed: number;
  estimatedCostPerUnit: number;
  totalEstimatedCost: number;
  lastPurchasePrice: number;
  lastPurchasePriceSource: 'invoice' | 'catalog';
  lastPurchaseDate?: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  supplierAddress: string;
  supplierBank?: string;
  itemStatus: ProcurementItemStatus;
  purchasedAt?: string;
  receivedQty?: number;
  receivedBy?: string;
  receivedAt?: string;
  receiptNotes?: string;
  carriedOverFromTitle?: string;
  carriedOverToOrderId?: string;
  qtyPerPackage: number;
  weightPerPackage: number;
  packageType: string;
  estimatedWeightKg: number;
  rawLine: ProcurementOrderItem;
}

interface ReceiptModalState {
  orderId: string;
  itemIndex: number;
  itemName: string;
  unit: string;
  qtyProposed: number;
  supplierName: string;
  packagingSummary: string;
  receivedQty: string;
  receivedBy: string;
  receivedAt: string;
  receiptNotes: string;
  alreadyReceived: boolean;
  isOrderActive: boolean;
}

function normalizeJalaliSortable(dateStr?: string): string {
  if (!dateStr) return '0000/00/00';
  const en = toEnglishDigits(String(dateStr)).trim();
  const parts = en.split(/[\/\-]/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    return `${parts[0].padStart(4, '0')}/${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}`;
  }
  return en;
}

function resolveLineStatus(it: ProcurementOrderItem): ProcurementItemStatus {
  if (it.itemStatus === 'pending' || it.itemStatus === 'purchased' || it.itemStatus === 'received' || it.itemStatus === 'carried_over') {
    return it.itemStatus;
  }
  return it.isReceived ? 'received' : 'pending';
}

function computeOrderStatus(items: ProcurementOrderItem[]): string {
  if (!items || items.length === 0) return 'ثبت شده';
  const statuses = items.map(resolveLineStatus);
  const activeStatuses = statuses.filter(s => s !== 'carried_over');
  if (activeStatuses.length === 0) return 'منتقل شده';
  if (activeStatuses.every(s => s === 'received')) return 'تکمیل شده';
  if (activeStatuses.some(s => s === 'received')) return 'تحویل جزئی';
  if (activeStatuses.some(s => s === 'purchased')) return 'در حال خرید';
  return 'ثبت شده';
}

let procLineSeq = 0;
function generateLineId(): string {
  procLineSeq += 1;
  return `line-${procLineSeq}`;
}

function calcEstimatedRowWeightKg(
  qty: number,
  unit: string,
  qtyPerPackage: number,
  weightPerPackage: number
): number {
  if (!qty || qty <= 0) return 0;
  if (unit === 'کیلویی' || unit === 'کیلوگرم' || unit === 'kg') {
    return Math.round(qty * 100) / 100;
  }
  if (weightPerPackage > 0) {
    const perPack = qtyPerPackage > 0 ? qtyPerPackage : 1;
    return Math.round((qty / perPack) * weightPerPackage * 100) / 100;
  }
  return 0;
}

function addDaysToJalaliSimple(dateStr: string, days: number): string {
  const en = toEnglishDigits(dateStr);
  const parts = en.split('/').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  let [y, m, d] = parts;
  d += days;
  const maxDay = m <= 6 ? 31 : m <= 11 ? 30 : 29;
  if (d > maxDay) {
    d -= maxDay;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

function resolveOrderActiveState(
  order: ProcurementOrder,
  latestOrderId: string | null,
  todayJalali: string
): { isActive: boolean; reason?: 'new_order' | 'deadline_passed' } {
  const deadlinePassed = Boolean(
    order.expectedDeliveryDate &&
      normalizeJalaliSortable(todayJalali) > normalizeJalaliSortable(order.expectedDeliveryDate)
  );
  if (deadlinePassed) {
    return { isActive: false, reason: 'deadline_passed' };
  }
  const superseded = order.isActive === false || (latestOrderId !== null && order.id !== latestOrderId);
  if (superseded) {
    return { isActive: false, reason: order.deactivationReason || 'new_order' };
  }
  return { isActive: true };
}

export default function ProcurementManagement({
  db,
  onUpdateDb,
  activePeriodId,
  currentUserName = ''
}: ProcurementManagementProps) {
  const todayJalali = useMemo(() => getTodayJalali(), []);

  // Navigation Tabs (Default: Buyer Workbench)
  const [activeTab, setActiveTab] = useState<'report' | 'backlog' | 'history' | 'create'>('report');
  const [showCopyModal, setShowCopyModal] = useState(false);

  // Notification toast inside module (no window.alert)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'warning' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  // Order Editor State (Create & Edit)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderTitle, setOrderTitle] = useState(`درخواست هفتگی کالا - ${toPersianDigits(todayJalali)}`);
  const [orderDate, setOrderDate] = useState(todayJalali);
  const [expectedDate, setExpectedDate] = useState(() => addDaysToJalaliSimple(todayJalali, 6));
  const [requestedBy, setRequestedBy] = useState(currentUserName);
  const [notes, setNotes] = useState('');
  const [basketItems, setBasketItems] = useState<ProcurementOrderItem[]>([]);

  // Direct Focus Management for Quantity Inputs & Catalog Search
  const desktopQtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const mobileQtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const catalogSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFocusLineId, setPendingFocusLineId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFocusLineId) return;
    const timer = window.setTimeout(() => {
      const desktopEl = desktopQtyInputRefs.current[pendingFocusLineId];
      const mobileEl = mobileQtyInputRefs.current[pendingFocusLineId];
      const target = desktopEl && desktopEl.offsetParent !== null ? desktopEl : mobileEl || desktopEl;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();
        target.select();
      }
      setPendingFocusLineId(null);
    }, 45);
    return () => window.clearTimeout(timer);
  }, [pendingFocusLineId, basketItems.length]);

  // Catalog Picker State in Create Tab (Default: All items & products)
  const [checklistSearch, setChecklistSearch] = useState('');
  const [creationSelectTab, setCreationSelectTab] = useState<'all' | 'items' | 'products'>('all');

  // Report (Tab 1) Filters & View Mode (Default: Active order, Pending purchase & Grouped by Supplier)
  const [reportOrderFilter, setReportOrderFilter] = useState<string>('ACTIVE');
  const [reportStatusFilter, setReportStatusFilter] = useState<'all' | 'pending' | 'purchased' | 'received'>('pending');
  const [reportSupplierFilter, setReportSupplierFilter] = useState<string>('ALL');
  const [reportSearch, setReportSearch] = useState('');
  const [reportViewMode, setReportViewMode] = useState<'table' | 'bySupplier'>('bySupplier');

  // Backlog (Tab 2) State
  const [backlogScope, setBacklogScope] = useState<'previous' | 'allPending'>('previous');
  const [selectedBacklogKeys, setSelectedBacklogKeys] = useState<Record<string, boolean>>({});

  // History (Tab 3) Search
  const [historySearch, setHistorySearch] = useState('');

  // In-App Modals (Receipt Confirmation & Delete Confirmation)
  const [receiptModal, setReceiptModal] = useState<ReceiptModalState | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<ProcurementOrder | null>(null);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // ==================== MASTER DATA & LOOKUPS ====================
  const activeSuppliers = useMemo(() => {
    return (db.suppliers || []).filter(s => s.periodId === activePeriodId && s.isActive);
  }, [db.suppliers, activePeriodId]);

  const rawItems = useMemo(() => {
    return (db.items || []).filter(i => i.periodId === activePeriodId);
  }, [db.items, activePeriodId]);

  const supplierMap = useMemo(() => {
    const map: Record<string, Supplier> = {};
    (db.suppliers || [])
      .filter(s => s.periodId === activePeriodId)
      .forEach(s => {
        map[s.id] = s;
      });
    return map;
  }, [db.suppliers, activePeriodId]);

  const rawItemMap = useMemo(() => {
    const map: Record<string, Item> = {};
    rawItems.forEach(i => {
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
  }, [rawItems]);

  const productMap = useMemo(() => {
    const map: Record<string, Product> = {};
    (db.products || [])
      .filter(p => p.periodId === activePeriodId)
      .forEach(p => {
        map[p.id] = p;
        if (p.accountId) {
          map[p.accountId.trim()] = p;
          map[p.accountId.trim().toLowerCase()] = p;
        }
        if (p.code) {
          map[p.code.trim()] = p;
          map[p.code.trim().toLowerCase()] = p;
        }
      });
    return map;
  }, [db.products, activePeriodId]);

  const purchasedProducts = useMemo(() => {
    const categoriesWithPurchaseKeyword = (db.productCategories || []).filter(
      cat =>
        cat.periodId === activePeriodId &&
        (cat.name.includes('خرید') ||
          cat.name.includes('خریداری') ||
          cat.name.includes('پیمانکاری') ||
          cat.name.includes('آماده'))
    );
    const categoryIds = categoriesWithPurchaseKeyword.map(c => c.id);
    const filtered = (db.products || []).filter(
      p =>
        p.periodId === activePeriodId &&
        (categoryIds.includes(p.categoryId) ||
          p.code.toLowerCase().includes('purch') ||
          p.categoryId === 'purchased')
    );
    if (filtered.length === 0) {
      return (db.products || []).filter(p => p.periodId === activePeriodId);
    }
    return filtered;
  }, [db.products, db.productCategories, activePeriodId]);

  // Personnel & Users list for quick picker (Requester & Receiver)
  const personnelNames = useMemo(() => {
    const names = new Set<string>();
    if (currentUserName.trim()) names.add(currentUserName.trim());
    (db.users || []).forEach((u: any) => {
      const n = String(u?.fullName || u?.name || u?.username || '').trim();
      if (n) names.add(n);
    });
    (db.personnel || [])
      .filter(p => p.periodId === activePeriodId)
      .forEach(p => {
        const full = `${p.firstName || ''} ${p.lastName || ''}`.trim() || String((p as any).name || (p as any).fullName || '').trim();
        if (full) names.add(full);
      });
    return Array.from(names);
  }, [db.users, db.personnel, activePeriodId, currentUserName]);

  // ==================== LAST PURCHASE PRICE & MULTI-SUPPLIER ENGINE ====================
  // Strictly isolated to active period's purchase invoices
  const invoiceHistoryIndex = useMemo(() => {
    const allInvoices = [...(db.purchaseInvoices || [])]
      .filter(inv => inv.periodId === activePeriodId)
      .sort((a, b) => {
        const da = normalizeJalaliSortable(a.date);
        const dbStr = normalizeJalaliSortable(b.date);
        if (dbStr !== da) return dbStr.localeCompare(da);
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

    const latestByItem: Record<string, { price: number; date: string; supplierId: string }> = {};
    const latestByItemSupplier: Record<string, { price: number; date: string; supplierId: string }> = {};
    const suppliersByItem: Record<string, Set<string>> = {};

    const registerKey = (key: string, inv: { date: string; supplierId: string }, price: number) => {
      if (!key) return;
      const norm = key.trim().toLowerCase();
      if (!latestByItem[norm] && price > 0) {
        latestByItem[norm] = { price, date: inv.date, supplierId: inv.supplierId };
      }
      if (inv.supplierId) {
        const pairKey = `${norm}::${inv.supplierId}`;
        if (!latestByItemSupplier[pairKey] && price > 0) {
          latestByItemSupplier[pairKey] = { price, date: inv.date, supplierId: inv.supplierId };
        }
        if (!suppliersByItem[norm]) suppliersByItem[norm] = new Set();
        suppliersByItem[norm].add(inv.supplierId);
      }
    };

    allInvoices.forEach(inv => {
      (inv.items || []).forEach(it => {
        const price = Number(it.price) || 0;
        const rawRef = rawItemMap[it.itemId] || rawItemMap[String(it.itemId || '').trim().toLowerCase()];
        const prodRef = productMap[it.itemId] || productMap[String(it.itemId || '').trim().toLowerCase()];
        registerKey(it.itemId, inv, price);
        if (rawRef) {
          registerKey(rawRef.id, inv, price);
          if (rawRef.code) registerKey(rawRef.code, inv, price);
          if (rawRef.accountId) registerKey(rawRef.accountId, inv, price);
        }
        if (prodRef) {
          registerKey(prodRef.id, inv, price);
          if (prodRef.code) registerKey(prodRef.code, inv, price);
          if (prodRef.accountId) registerKey(prodRef.accountId, inv, price);
        }
      });
    });

    return { latestByItem, latestByItemSupplier, suppliersByItem };
  }, [db.purchaseInvoices, rawItemMap, productMap]);

  const getSuggestedSuppliersForItem = useCallback(
    (itemId: string, isProduct: boolean): Supplier[] => {
      const refObj = isProduct ? productMap[itemId] : rawItemMap[itemId];
      const keys = new Set<string>(
        [itemId, refObj?.id, refObj?.code, refObj?.accountId]
          .filter(Boolean)
          .map(k => String(k).trim().toLowerCase())
      );

      const matchedIds = new Set<string>();
      activeSuppliers.forEach(s => {
        if ((s.suppliedItemIds || []).some(sid => keys.has(String(sid).trim().toLowerCase()))) {
          matchedIds.add(s.id);
        }
      });

      keys.forEach(k => {
        const invSups = invoiceHistoryIndex.suppliersByItem[k];
        if (invSups) {
          invSups.forEach(sid => {
            if (activeSuppliers.some(s => s.id === sid)) {
              matchedIds.add(sid);
            }
          });
        }
      });

      return activeSuppliers.filter(s => matchedIds.has(s.id));
    },
    [activeSuppliers, invoiceHistoryIndex, productMap, rawItemMap]
  );

  const getLastPurchaseInfo = useCallback(
    (itemId: string, isProduct: boolean, preferredSupplierId?: string): LastPriceInfo => {
      const refObj = isProduct ? productMap[itemId] : rawItemMap[itemId];
      const keys = [itemId, refObj?.id, refObj?.code, refObj?.accountId]
        .filter(Boolean)
        .map(k => String(k).trim().toLowerCase());

      // 1. Prefer latest invoice from the chosen supplier
      if (preferredSupplierId) {
        for (const k of keys) {
          const hit = invoiceHistoryIndex.latestByItemSupplier[`${k}::${preferredSupplierId}`];
          if (hit && hit.price > 0) {
            return {
              price: hit.price,
              source: 'invoice',
              date: hit.date,
              supplierId: hit.supplierId,
              supplierName: supplierMap[hit.supplierId]?.name
            };
          }
        }
      }

      // 2. Fallback to latest invoice across any supplier
      for (const k of keys) {
        const hit = invoiceHistoryIndex.latestByItem[k];
        if (hit && hit.price > 0) {
          return {
            price: hit.price,
            source: 'invoice',
            date: hit.date,
            supplierId: hit.supplierId,
            supplierName: supplierMap[hit.supplierId]?.name
          };
        }
      }

      // 3. Fallback to catalog price
      const catalogPrice = isProduct
        ? Number((refObj as Product)?.salePrice) || 0
        : Number((refObj as Item)?.price) || 0;
      return {
        price: catalogPrice,
        source: 'catalog'
      };
    },
    [invoiceHistoryIndex, productMap, rawItemMap, supplierMap]
  );

  // ==================== ORDERS HISTORY (NEWEST FIRST) ====================
  const ordersHistory = useMemo(() => {
    return [...(db.procurementOrders || [])]
      .filter(o => o.periodId === activePeriodId)
      .sort((a, b) => {
        const da = normalizeJalaliSortable(a.orderDate);
        const dbStr = normalizeJalaliSortable(b.orderDate);
        if (dbStr !== da) return dbStr.localeCompare(da);
        return String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id));
      });
  }, [db.procurementOrders, activePeriodId]);

  const latestOrderId = ordersHistory.length > 0 ? ordersHistory[0].id : null;

  const orderActiveMap = useMemo(() => {
    const map: Record<string, { isActive: boolean; reason?: 'new_order' | 'deadline_passed' }> = {};
    ordersHistory.forEach(o => {
      map[o.id] = resolveOrderActiveState(o, latestOrderId, todayJalali);
    });
    return map;
  }, [ordersHistory, latestOrderId, todayJalali]);

  const activeWeeklyOrder = useMemo(() => {
    return ordersHistory.find(o => orderActiveMap[o.id]?.isActive) || null;
  }, [ordersHistory, orderActiveMap]);

  // ==================== CATALOG CHECKLIST FILTERING ====================
  const suppliedItemsChecklist = useMemo(() => {
    return rawItems.filter(
      i =>
        i.isActive &&
        (checklistSearch
          ? matchPersianString(i.name, checklistSearch) ||
            matchPersianString(i.code, checklistSearch) ||
            matchPersianString(i.accountId || '', checklistSearch)
          : true)
    );
  }, [rawItems, checklistSearch]);

  const searchedPurchasedProducts = useMemo(() => {
    return purchasedProducts.filter(p =>
      checklistSearch
        ? matchPersianString(p.name, checklistSearch) ||
          matchPersianString(p.code, checklistSearch) ||
          matchPersianString(p.accountId || '', checklistSearch)
        : true
    );
  }, [purchasedProducts, checklistSearch]);

  const displayedCatalogItems = useMemo(() => {
    const rawEntries = suppliedItemsChecklist.map(item => ({
      id: item.id,
      isProduct: false as const,
      name: item.name,
      code: item.code,
      unit: item.unit,
      qtyPerPackage: item.qtyPerPackage || 1,
      packageType: item.packageType || 'کارتن',
      weightPerPackage: item.weightPerPackage || 0
    }));
    const prodEntries = searchedPurchasedProducts.map(prod => ({
      id: prod.id,
      isProduct: true as const,
      name: prod.name,
      code: prod.code,
      unit: prod.unit,
      qtyPerPackage: prod.qtyPerPackage || 1,
      packageType: prod.packageType || 'بسته',
      weightPerPackage: prod.weightPerPackage || 0
    }));

    if (creationSelectTab === 'items') return rawEntries;
    if (creationSelectTab === 'products') return prodEntries;
    return [...rawEntries, ...prodEntries];
  }, [suppliedItemsChecklist, searchedPurchasedProducts, creationSelectTab]);

  // ==================== DRAFT ORDER BUILDER HELPERS ====================
  const resetOrderForm = useCallback(() => {
    const today = getTodayJalali();
    setEditingOrderId(null);
    setOrderTitle(`درخواست هفتگی کالا - ${toPersianDigits(today)}`);
    setOrderDate(today);
    setExpectedDate(addDaysToJalaliSimple(today, 6));
    setRequestedBy(currentUserName);
    setNotes('');
    setBasketItems([]);
  }, [currentUserName]);

  const addItemToBasket = useCallback(
    (itemId: string, isProduct: boolean) => {
      // If item is already in the order, focus directly on its quantity input so user enters the exact amount
      const existingLine = basketItems.find(x => (isProduct ? x.productId === itemId : x.rawMaterialId === itemId));
      if (existingLine) {
        setPendingFocusLineId(existingLine.lineId || itemId);
        return;
      }

      const suggestedSups = getSuggestedSuppliersForItem(itemId, isProduct);
      const lastPriceGeneral = getLastPurchaseInfo(itemId, isProduct);
      // If item has suppliers, default to its supplier (preferring latest invoice supplier if among them); otherwise default to open order ('')
      const autoSupplierId =
        suggestedSups.length > 0
          ? lastPriceGeneral.supplierId && suggestedSups.some(s => s.id === lastPriceGeneral.supplierId)
            ? lastPriceGeneral.supplierId
            : suggestedSups[0].id
          : '';

      const priceInfo = getLastPurchaseInfo(itemId, isProduct, autoSupplierId || undefined);
      const newLineId = generateLineId();

      const newRow: ProcurementOrderItem = {
        lineId: newLineId,
        rawMaterialId: isProduct ? undefined : itemId,
        productId: isProduct ? itemId : undefined,
        supplierId: autoSupplierId || undefined,
        qtyProposed: 1,
        estimatedCostPerUnit: priceInfo.price,
        totalEstimatedCost: priceInfo.price,
        lastPurchasePrice: priceInfo.price,
        lastPurchasePriceSource: priceInfo.source,
        lastPurchaseDate: priceInfo.date,
        itemStatus: 'pending',
        isReceived: false
      };

      setBasketItems(prev => [...prev, newRow]);
      setPendingFocusLineId(newLineId);
    },
    [basketItems, getSuggestedSuppliersForItem, getLastPurchaseInfo]
  );

  const removeBasketRow = (lineId: string) => {
    setBasketItems(prev => prev.filter(x => x.lineId !== lineId));
  };

  const updateBasketRowSupplier = (lineId: string, supplierId: string) => {
    setBasketItems(prev =>
      prev.map(row => {
        if (row.lineId !== lineId) return row;
        const isProduct = !!row.productId;
        const itemId = isProduct ? row.productId! : row.rawMaterialId!;
        const priceInfo = getLastPurchaseInfo(itemId, isProduct, supplierId || undefined);
        const nextUnitCost = priceInfo.price;
        return {
          ...row,
          supplierId: supplierId || undefined,
          lastPurchasePrice: priceInfo.price,
          lastPurchasePriceSource: priceInfo.source,
          lastPurchaseDate: priceInfo.date,
          estimatedCostPerUnit: nextUnitCost,
          totalEstimatedCost: row.qtyProposed * nextUnitCost
        };
      })
    );
  };

  const updateBasketRowQty = (lineId: string, qty: number) => {
    const safeQty = Math.max(0, qty);
    setBasketItems(prev =>
      prev.map(row =>
        row.lineId === lineId
          ? {
              ...row,
              qtyProposed: safeQty,
              totalEstimatedCost: safeQty * row.estimatedCostPerUnit
            }
          : row
      )
    );
  };

  const updateBasketRowNotes = (lineId: string, rowNotes: string) => {
    setBasketItems(prev =>
      prev.map(row => (row.lineId === lineId ? { ...row, rowNotes } : row))
    );
  };

  // Enriched draft rows for display
  const enrichedBasketRows = useMemo(() => {
    return basketItems.map(row => {
      const isProduct = !!row.productId;
      const itemId = isProduct ? row.productId! : row.rawMaterialId!;
      const refObj = isProduct ? productMap[itemId] : rawItemMap[itemId];
      const unit = refObj?.unit || 'واحد';
      const qtyPerPackage = refObj?.qtyPerPackage || 1;
      const weightPerPackage = refObj?.weightPerPackage || 0;
      const packageType = refObj?.packageType || 'کارتن';
      const suggestedSuppliers = getSuggestedSuppliersForItem(itemId, isProduct);
      const otherSuppliers = activeSuppliers.filter(s => !suggestedSuppliers.some(ms => ms.id === s.id));
      const liveLastPrice = getLastPurchaseInfo(itemId, isProduct, row.supplierId);
      const estimatedWeightKg = calcEstimatedRowWeightKg(row.qtyProposed, unit, qtyPerPackage, weightPerPackage);

      return {
        row,
        lineId: row.lineId || itemId,
        isProduct,
        itemId,
        name: refObj?.name || 'کالای نامشخص',
        code: refObj?.code || '-',
        unit,
        qtyPerPackage,
        weightPerPackage,
        packageType,
        suggestedSuppliers,
        otherSuppliers,
        liveLastPrice,
        estimatedWeightKg,
        status: resolveLineStatus(row)
      };
    });
  }, [basketItems, productMap, rawItemMap, getSuggestedSuppliersForItem, activeSuppliers, getLastPurchaseInfo]);

  const draftTotals = useMemo(() => {
    const totalBill = enrichedBasketRows.reduce((acc, r) => acc + r.row.totalEstimatedCost, 0);
    const totalWeightKg = Math.round(enrichedBasketRows.reduce((acc, r) => acc + r.estimatedWeightKg, 0) * 100) / 100;
    const distinctSuppliers = new Set(enrichedBasketRows.map(r => r.row.supplierId).filter(Boolean)).size;
    return {
      rowCount: enrichedBasketRows.length,
      totalBill,
      totalWeightKg,
      distinctSuppliers
    };
  }, [enrichedBasketRows]);

  // Load existing order into editor for full Edit (blocked if inactive)
  const handleStartEditOrder = (order: ProcurementOrder) => {
    const activeState = orderActiveMap[order.id] || resolveOrderActiveState(order, latestOrderId, todayJalali);
    if (!activeState.isActive) {
      showToast('warning', 'این درخواست هفتگی غیرفعال (قفل) شده و امکان ویرایش آن وجود ندارد.');
      return;
    }

    setEditingOrderId(order.id);
    setOrderTitle(order.title || `درخواست سفارش ${order.orderDate}`);
    setOrderDate(order.orderDate || todayJalali);
    setExpectedDate(order.expectedDeliveryDate || addDaysToJalaliSimple(order.orderDate || todayJalali, 6));
    setRequestedBy(order.requestedBy || currentUserName);
    setNotes(order.notes || '');
    setBasketItems(
      (order.items || []).map(it => ({
        ...it,
        lineId: it.lineId || generateLineId(),
        supplierId: it.supplierId || order.supplierId || undefined,
        itemStatus: resolveLineStatus(it)
      }))
    );
    setActiveTab('create');
    showToast('info', `در حال ویرایش «${order.title || order.id}». پس از اعمال تغییرات دکمه ذخیره را بزنید.`);
  };

  // Save New or Edited Weekly Order (automatically deactivates previous weekly orders & marks carried-over rows)
  const handleSaveProcurementOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (basketItems.length === 0) {
      showToast('warning', 'سبد درخواست خالی است. حداقل یک کالا به ردیف‌های سفارش اضافه کنید.');
      return;
    }
    const invalidRow = basketItems.find(b => !b.qtyProposed || b.qtyProposed <= 0);
    if (invalidRow) {
      showToast('warning', 'مقدار سفارش در همه ردیف‌ها باید بزرگ‌تر از صفر باشد.');
      return;
    }

    const sanitizedItems: ProcurementOrderItem[] = basketItems.map(b => {
      const status = resolveLineStatus(b);
      const unitCost = b.estimatedCostPerUnit || b.lastPurchasePrice || 0;
      return {
        ...b,
        lineId: b.lineId || generateLineId(),
        estimatedCostPerUnit: unitCost,
        totalEstimatedCost: b.qtyProposed * unitCost,
        itemStatus: status,
        isReceived: status === 'received'
      };
    });

    const uniqueSupIds = Array.from(new Set(sanitizedItems.map(i => i.supplierId).filter(Boolean))) as string[];
    const orderSupplierFallback = uniqueSupIds.length === 1 ? uniqueSupIds[0] : undefined;
    const totalBill = sanitizedItems.reduce((sum, it) => sum + it.totalEstimatedCost, 0);
    const computedStatus = computeOrderStatus(sanitizedItems);
    const nowIso = new Date().toISOString();

    if (editingOrderId) {
      const updatedOrders = (db.procurementOrders || []).map(o => {
        if (o.id !== editingOrderId) return o;
        return {
          ...o,
          title: orderTitle.trim() || `درخواست هفتگی - ${toPersianDigits(orderDate)}`,
          requestedBy: requestedBy.trim() || currentUserName || undefined,
          supplierId: orderSupplierFallback,
          orderDate: orderDate || todayJalali,
          expectedDeliveryDate: expectedDate || orderDate || todayJalali,
          items: sanitizedItems,
          totalBill,
          status: computedStatus,
          notes: notes.trim() || undefined,
          updatedAt: nowIso
        };
      });

      onUpdateDb({
        ...db,
        procurementOrders: updatedOrders
      });
      resetOrderForm();
      showToast('success', 'تغییرات درخواست سفارش با موفقیت ذخیره شد.');
      setReportOrderFilter('ACTIVE');
      setReportStatusFilter('pending');
      setActiveTab('report');
      return;
    }

    // Creating a new weekly order -> deactivate all previous weekly orders in this period
    const newOrderId = nextSimpleId(db.procurementOrders || [], 'po');
    const nextOrder: ProcurementOrder = {
      id: newOrderId,
      periodId: activePeriodId,
      title: orderTitle.trim() || `درخواست هفتگی - ${toPersianDigits(orderDate)}`,
      requestedBy: requestedBy.trim() || currentUserName || undefined,
      supplierId: orderSupplierFallback,
      orderDate: orderDate || todayJalali,
      expectedDeliveryDate: expectedDate || addDaysToJalaliSimple(orderDate || todayJalali, 6),
      items: sanitizedItems,
      totalBill,
      status: computedStatus,
      notes: notes.trim() || undefined,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Atomically deactivate prior period orders & mark carried-over source rows
    const carryRefs = sanitizedItems.filter(it => it.carriedOverFromOrderId);
    const updatedExistingOrders = (db.procurementOrders || []).map(prevOrder => {
      if (prevOrder.periodId !== activePeriodId) return prevOrder;

      const matchingRefs = carryRefs.filter(r => r.carriedOverFromOrderId === prevOrder.id);
      const updatedPrevItems =
        matchingRefs.length > 0
          ? prevOrder.items.map((oldIt, idx) => {
              const oldLineKey = oldIt.lineId || `idx-${idx}`;
              const matched = matchingRefs.some(
                r =>
                  (r.carriedOverFromLineId && r.carriedOverFromLineId === oldLineKey) ||
                  (!r.carriedOverFromLineId &&
                    ((r.rawMaterialId && r.rawMaterialId === oldIt.rawMaterialId) ||
                      (r.productId && r.productId === oldIt.productId)))
              );
              if (!matched) return oldIt;
              return {
                ...oldIt,
                itemStatus: 'carried_over' as ProcurementItemStatus,
                isReceived: false,
                carriedOverToOrderId: newOrderId
              };
            })
          : prevOrder.items;

      return {
        ...prevOrder,
        items: updatedPrevItems,
        status: computeOrderStatus(updatedPrevItems),
        isActive: false,
        deactivatedAt: prevOrder.deactivatedAt || todayJalali,
        deactivationReason: prevOrder.deactivationReason || ('new_order' as const),
        updatedAt: nowIso
      };
    });

    onUpdateDb({
      ...db,
      procurementOrders: [...updatedExistingOrders, nextOrder]
    });

    resetOrderForm();
    setSelectedBacklogKeys({});
    setReportOrderFilter('ACTIVE');
    setReportStatusFilter('pending');
    showToast(
      'success',
      carryRefs.length > 0
        ? `سفارش هفتگی جدید با ${toPersianDigits(sanitizedItems.length)} ردیف ثبت شد، درخواست قبلی غیرفعال گردید و ${toPersianDigits(carryRefs.length)} قلم جامانده منتقل شد.`
        : `درخواست سفارش هفتگی جدید با ${toPersianDigits(sanitizedItems.length)} ردیف ثبت شد و درخواست هفتگی قبلی غیرفعال گردید.`
    );
    setActiveTab('report');
  };

  // Delete Order (via in-app confirmation modal)
  const confirmDeleteOrder = () => {
    if (!deleteTargetOrder) return;
    onUpdateDb({
      ...db,
      procurementOrders: (db.procurementOrders || []).filter(o => o.id !== deleteTargetOrder.id)
    });
    if (editingOrderId === deleteTargetOrder.id) {
      resetOrderForm();
    }
    if (reportOrderFilter === deleteTargetOrder.id) {
      setReportOrderFilter('ACTIVE');
    }
    showToast('info', `سفارش «${deleteTargetOrder.title || deleteTargetOrder.id}» حذف شد.`);
    setDeleteTargetOrder(null);
  };

  // ==================== FLATTENED REPORT & BACKLOG ENGINE ====================
  const allOrderedItemsReport: EnrichedReportRow[] = useMemo(() => {
    const reportList: EnrichedReportRow[] = [];

    ordersHistory.forEach(order => {
      const isFromPreviousOrder = !!latestOrderId && order.id !== latestOrderId;
      const activeState = orderActiveMap[order.id] || resolveOrderActiveState(order, latestOrderId, todayJalali);

      (order.items || []).forEach((it, idx) => {
        const isProduct = !!it.productId;
        const itemId = isProduct ? it.productId! : it.rawMaterialId!;
        const refObj = isProduct ? productMap[itemId] : rawItemMap[itemId];
        const rowSupId = it.supplierId || order.supplierId || '';
        const sup = rowSupId ? supplierMap[rowSupId] : undefined;
        const unit = refObj?.unit || 'واحد';
        const qtyPerPackage = refObj?.qtyPerPackage || 1;
        const weightPerPackage = refObj?.weightPerPackage || 0;
        const packageType = refObj?.packageType || 'کارتن';
        const fallbackPriceInfo = getLastPurchaseInfo(itemId, isProduct, rowSupId || undefined);

        reportList.push({
          orderId: order.id,
          orderTitle: order.title || `سفارش ${order.orderDate}`,
          orderDate: order.orderDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          requestedBy: order.requestedBy || '-',
          orderStatus: order.status,
          isFromPreviousOrder,
          isOrderActive: activeState.isActive,
          orderInactiveReason: activeState.reason,
          itemIndex: idx,
          lineId: it.lineId || `idx-${idx}`,
          itemId,
          isProduct,
          name: refObj?.name || 'کالای نامشخص',
          code: refObj?.code || '-',
          unit,
          qtyProposed: it.qtyProposed,
          estimatedCostPerUnit: it.estimatedCostPerUnit,
          totalEstimatedCost: it.totalEstimatedCost,
          lastPurchasePrice: it.lastPurchasePrice ?? fallbackPriceInfo.price,
          lastPurchasePriceSource: it.lastPurchasePriceSource || fallbackPriceInfo.source,
          lastPurchaseDate: it.lastPurchaseDate || fallbackPriceInfo.date,
          supplierId: rowSupId,
          supplierName: sup?.name || 'سفارش آزاد (تامین‌کننده نامشخص)',
          supplierPhone: sup?.phone || 'ثبت نشده',
          supplierAddress: sup?.address || 'ثبت نشده',
          supplierBank: sup?.bankAccounts?.[0]
            ? `${sup.bankAccounts[0].bankName} - ${sup.bankAccounts[0].cardNo || sup.bankAccounts[0].accountNo}`
            : undefined,
          itemStatus: resolveLineStatus(it),
          purchasedAt: it.purchasedAt,
          receivedQty: it.receivedQty,
          receivedBy: it.receivedBy,
          receivedAt: it.receivedAt,
          receiptNotes: it.receiptNotes,
          carriedOverFromTitle: it.carriedOverFromTitle,
          carriedOverToOrderId: it.carriedOverToOrderId,
          qtyPerPackage,
          weightPerPackage,
          packageType,
          estimatedWeightKg: calcEstimatedRowWeightKg(it.qtyProposed, unit, qtyPerPackage, weightPerPackage),
          rawLine: it
        });
      });
    });

    return reportList;
  }, [ordersHistory, latestOrderId, orderActiveMap, todayJalali, productMap, rawItemMap, supplierMap, getLastPurchaseInfo]);

  // Active (non-carried-over) items for main Buyer Report & KPIs
  const activeReportRows = useMemo(() => {
    return allOrderedItemsReport.filter(r => r.itemStatus !== 'carried_over');
  }, [allOrderedItemsReport]);

  // Unpurchased backlog rows: pending items from inactive/previous orders (deadline passed or superseded)
  const previousBacklogRows = useMemo(() => {
    return allOrderedItemsReport.filter(r => r.itemStatus === 'pending' && !r.isOrderActive);
  }, [allOrderedItemsReport]);

  const allPendingRows = useMemo(() => {
    return allOrderedItemsReport.filter(r => r.itemStatus === 'pending');
  }, [allOrderedItemsReport]);

  // Purchased items from inactive orders that still await staff delivery confirmation
  const inactivePurchasedAwaitingReceipt = useMemo(() => {
    return activeReportRows.filter(r => !r.isOrderActive && r.itemStatus === 'purchased');
  }, [activeReportRows]);

  const displayedBacklogRows = backlogScope === 'previous' ? previousBacklogRows : allPendingRows;

  // Scope rows for Buyer Workbench based on reportOrderFilter
  const scopedReportRows = useMemo(() => {
    if (reportOrderFilter === 'ALL') return activeReportRows;
    if (reportOrderFilter === 'ACTIVE') {
      // Show active weekly order rows + already-purchased items from closed orders awaiting staff receipt confirmation
      return activeReportRows.filter(r => r.isOrderActive || r.itemStatus === 'purchased');
    }
    return activeReportRows.filter(r => r.orderId === reportOrderFilter);
  }, [activeReportRows, reportOrderFilter]);

  // Report KPI stats
  const reportStats = useMemo(() => {
    const scoped = scopedReportRows;

    const totalLines = scoped.length;
    const pendingLines = scoped.filter(r => r.itemStatus === 'pending').length;
    const purchasedLines = scoped.filter(r => r.itemStatus === 'purchased').length;
    const receivedLines = scoped.filter(r => r.itemStatus === 'received').length;
    const totalOrderedCost = scoped.reduce((sum, r) => sum + r.totalEstimatedCost, 0);
    const pendingCost = scoped.filter(r => r.itemStatus === 'pending').reduce((sum, r) => sum + r.totalEstimatedCost, 0);
    const activePendingCount = activeReportRows.filter(r => r.isOrderActive && r.itemStatus === 'pending').length;

    return {
      totalLines,
      pendingLines,
      purchasedLines,
      receivedLines,
      totalOrderedCost,
      pendingCost,
      previousBacklogCount: previousBacklogRows.length,
      allPendingCount: allPendingRows.length,
      activePendingCount
    };
  }, [scopedReportRows, activeReportRows, previousBacklogRows.length, allPendingRows.length]);

  // Filtered report rows
  const filteredReportRows = useMemo(() => {
    return scopedReportRows.filter(row => {
      if (reportStatusFilter !== 'all' && row.itemStatus !== reportStatusFilter) return false;
      if (reportSupplierFilter !== 'ALL') {
        if (reportSupplierFilter === 'OPEN' && row.supplierId) return false;
        if (reportSupplierFilter !== 'OPEN' && row.supplierId !== reportSupplierFilter) return false;
      }
      if (!reportSearch.trim()) return true;
      return (
        matchPersianString(row.name, reportSearch) ||
        matchPersianString(row.code, reportSearch) ||
        matchPersianString(row.supplierName, reportSearch) ||
        matchPersianString(row.orderTitle, reportSearch) ||
        matchPersianString(row.receivedBy || '', reportSearch)
      );
    });
  }, [scopedReportRows, reportStatusFilter, reportSupplierFilter, reportSearch]);

  // Grouped by Supplier view for Buyer
  const groupedReportBySupplier = useMemo(() => {
    const groups: Record<
      string,
      {
        supplierKey: string;
        supplierName: string;
        supplierPhone: string;
        supplierAddress: string;
        supplierBank?: string;
        rows: EnrichedReportRow[];
        totalCost: number;
        totalWeightKg: number;
        pendingCount: number;
      }
    > = {};

    filteredReportRows.forEach(row => {
      const key = row.supplierId || 'OPEN';
      if (!groups[key]) {
        groups[key] = {
          supplierKey: key,
          supplierName: row.supplierName,
          supplierPhone: row.supplierPhone,
          supplierAddress: row.supplierAddress,
          supplierBank: row.supplierBank,
          rows: [],
          totalCost: 0,
          totalWeightKg: 0,
          pendingCount: 0
        };
      }
      groups[key].rows.push(row);
      groups[key].totalCost += row.totalEstimatedCost;
      groups[key].totalWeightKg = Math.round((groups[key].totalWeightKg + row.estimatedWeightKg) * 100) / 100;
      if (row.itemStatus === 'pending') groups[key].pendingCount += 1;
    });

    return Object.values(groups).sort((a, b) => b.pendingCount - a.pendingCount || b.totalCost - a.totalCost);
  }, [filteredReportRows]);

  // ==================== 3-STAGE STATUS TRANSITIONS ====================
  const handleMarkItemPurchased = (orderId: string, itemIdx: number) => {
    const targetOrder = ordersHistory.find(o => o.id === orderId);
    const activeState = targetOrder
      ? orderActiveMap[orderId] || resolveOrderActiveState(targetOrder, latestOrderId, todayJalali)
      : { isActive: false };

    if (!activeState.isActive) {
      showToast('warning', 'این درخواست هفتگی غیرفعال شده است. برای خرید اقلام جامانده آن، ابتدا آن‌ها را به سفارش جدید منتقل کنید.');
      return;
    }

    const updatedOrders = (db.procurementOrders || []).map(o => {
      if (o.id !== orderId) return o;
      const updatedItems = o.items.map((it, idx) => {
        if (idx !== itemIdx) return it;
        return {
          ...it,
          itemStatus: 'purchased' as ProcurementItemStatus,
          isReceived: false,
          purchasedAt: todayJalali,
          purchasedBy: currentUserName || undefined
        };
      });
      return {
        ...o,
        items: updatedItems,
        status: computeOrderStatus(updatedItems),
        updatedAt: new Date().toISOString()
      };
    });

    onUpdateDb({ ...db, procurementOrders: updatedOrders });
    showToast('info', 'وضعیت قلم به «خریداری شده» تغییر یافت و آماده تایید دریافت پرسنل است.');
  };

  const handleRevertItemToPending = (orderId: string, itemIdx: number) => {
    const targetOrder = ordersHistory.find(o => o.id === orderId);
    const activeState = targetOrder
      ? orderActiveMap[orderId] || resolveOrderActiveState(targetOrder, latestOrderId, todayJalali)
      : { isActive: false };

    if (!activeState.isActive) {
      showToast('warning', 'این سفارش غیرفعال است و بازگشت وضعیت به در انتظار خرید مجاز نیست.');
      return;
    }

    const updatedOrders = (db.procurementOrders || []).map(o => {
      if (o.id !== orderId) return o;
      const updatedItems = o.items.map((it, idx) => {
        if (idx !== itemIdx) return it;
        return {
          ...it,
          itemStatus: 'pending' as ProcurementItemStatus,
          isReceived: false,
          purchasedAt: undefined,
          receivedQty: undefined,
          receivedBy: undefined,
          receivedAt: undefined,
          receiptNotes: undefined
        };
      });
      return {
        ...o,
        items: updatedItems,
        status: computeOrderStatus(updatedItems),
        updatedAt: new Date().toISOString()
      };
    });

    onUpdateDb({ ...db, procurementOrders: updatedOrders });
    showToast('info', 'وضعیت قلم به «در انتظار خرید» بازگردانده شد.');
  };

  const openReceiptConfirmationModal = (row: EnrichedReportRow) => {
    // Allow receipt verification for active orders OR already-purchased items from inactive orders
    if (!row.isOrderActive && row.itemStatus !== 'purchased') {
      showToast('warning', 'این سفارش غیرفعال است و تنها اقلام «خریداری شده» آن امکان تایید دریافت دارند.');
      return;
    }

    setReceiptModal({
      orderId: row.orderId,
      itemIndex: row.itemIndex,
      itemName: row.name,
      unit: row.unit,
      qtyProposed: row.qtyProposed,
      supplierName: row.supplierName,
      packagingSummary: `${toPersianDigits(row.qtyPerPackage)} ${row.packageType}${row.weightPerPackage > 0 ? ` · هر بسته ${toPersianDigits(row.weightPerPackage)} کیلو` : ''}`,
      receivedQty: String(row.receivedQty ?? row.qtyProposed),
      receivedBy: row.receivedBy || currentUserName || '',
      receivedAt: row.receivedAt || todayJalali,
      receiptNotes: row.receiptNotes || '',
      alreadyReceived: row.itemStatus === 'received',
      isOrderActive: row.isOrderActive
    });
  };

  const handleConfirmReceiptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptModal) return;
    const actualQty = parseNumber(receiptModal.receivedQty);
    if (actualQty <= 0) {
      showToast('warning', 'مقدار واقعی تحویل باید بزرگ‌تر از صفر باشد.');
      return;
    }
    if (!receiptModal.receivedBy.trim()) {
      showToast('warning', 'لطفاً نام تحویل‌گیرنده را وارد یا انتخاب کنید.');
      return;
    }

    const updatedOrders = (db.procurementOrders || []).map(o => {
      if (o.id !== receiptModal.orderId) return o;
      const updatedItems = o.items.map((it, idx) => {
        if (idx !== receiptModal.itemIndex) return it;
        return {
          ...it,
          itemStatus: 'received' as ProcurementItemStatus,
          isReceived: true,
          purchasedAt: it.purchasedAt || receiptModal.receivedAt || todayJalali,
          receivedQty: actualQty,
          receivedBy: receiptModal.receivedBy.trim(),
          receivedAt: receiptModal.receivedAt || todayJalali,
          receiptNotes: receiptModal.receiptNotes.trim() || undefined
        };
      });
      return {
        ...o,
        items: updatedItems,
        status: computeOrderStatus(updatedItems),
        updatedAt: new Date().toISOString()
      };
    });

    onUpdateDb({ ...db, procurementOrders: updatedOrders });
    showToast(
      'success',
      `دریافت «${receiptModal.itemName}» به مقدار ${toPersianDigits(actualQty)} ${receiptModal.unit} توسط ${receiptModal.receivedBy.trim()} ثبت شد.`
    );
    setReceiptModal(null);
  };

  // ==================== CARRY OVER BACKLOG ITEMS TO NEW WEEKLY ORDER ====================
  const handleTransferBacklogToNewOrder = (rowsToTransfer: EnrichedReportRow[]) => {
    if (rowsToTransfer.length === 0) {
      showToast('warning', 'هیچ قلمی برای انتقال انتخاب نشده است.');
      return;
    }

    // If currently editing an existing order, reset to a fresh weekly draft first
    if (editingOrderId) {
      setEditingOrderId(null);
      setOrderTitle(`درخواست هفتگی کالا - ${toPersianDigits(todayJalali)}`);
      setOrderDate(todayJalali);
      setExpectedDate(addDaysToJalaliSimple(todayJalali, 6));
      setRequestedBy(currentUserName);
      setNotes('شامل اقلام منتقل‌شده از لیست‌های درخواست قبلی');
      setBasketItems([]);
    }

    const newLines: ProcurementOrderItem[] = rowsToTransfer.map(r => {
      const latestPrice = getLastPurchaseInfo(r.itemId, r.isProduct, r.supplierId || undefined);
      const unitCost = latestPrice.price > 0 ? latestPrice.price : r.estimatedCostPerUnit;
      return {
        lineId: generateLineId(),
        rawMaterialId: r.isProduct ? undefined : r.itemId,
        productId: r.isProduct ? r.itemId : undefined,
        supplierId: r.supplierId || undefined,
        qtyProposed: r.qtyProposed,
        estimatedCostPerUnit: unitCost,
        totalEstimatedCost: r.qtyProposed * unitCost,
        lastPurchasePrice: latestPrice.price,
        lastPurchasePriceSource: latestPrice.source,
        lastPurchaseDate: latestPrice.date,
        itemStatus: 'pending',
        isReceived: false,
        carriedOverFromOrderId: r.orderId,
        carriedOverFromLineId: r.lineId,
        carriedOverFromTitle: `${r.orderTitle} (${toPersianDigits(r.orderDate)})`
      };
    });

    setBasketItems(prev => {
      const existingOriginKeys = new Set(
        prev
          .filter(x => x.carriedOverFromOrderId && x.carriedOverFromLineId)
          .map(x => `${x.carriedOverFromOrderId}::${x.carriedOverFromLineId}`)
      );
      const deduped = newLines.filter(
        nl => !existingOriginKeys.has(`${nl.carriedOverFromOrderId}::${nl.carriedOverFromLineId}`)
      );
      return [...prev, ...deduped];
    });

    setActiveTab('create');
    showToast(
      'success',
      `${toPersianDigits(rowsToTransfer.length)} قلم جامانده به پیش‌نویس سفارش هفته جدید منتقل شد. می‌توانید اقلام جدید اضافه کرده و سفارش را ثبت کنید.`
    );
  };

  // ==================== EXPORTS & OFFICIAL PRINT SHEETS ====================
  const exportOrdersReportCSV = (onlyUnpurchased: boolean) => {
    const listToExport = onlyUnpurchased
      ? filteredReportRows.filter(x => x.itemStatus === 'pending')
      : filteredReportRows;

    if (listToExport.length === 0) {
      showToast('warning', 'ردیفی برای خروجی اکسل با فیلتر فعلی وجود ندارد.');
      return;
    }

    const headers = [
      'عنوان درخواست',
      'تاریخ سفارش',
      'کد کالا',
      'نوع کالا',
      'نام کالا',
      'تامین‌کننده ردیف',
      'تلفن تامین‌کننده',
      'میزان سفارش',
      'واحد',
      'بسته‌بندی',
      'وزن هر بسته (kg)',
      'وزن کل برآوردی (kg)',
      'آخرین قیمت خرید (ریال)',
      'قیمت برآوردی واحد (ریال)',
      'جمع برآوردی (ریال)',
      'وضعیت',
      'مقدار واقعی تحویل',
      'نام تحویل‌گیرنده',
      'تاریخ تحویل'
    ];

    const statusLabelMap: Record<ProcurementItemStatus, string> = {
      pending: 'در انتظار خرید',
      purchased: 'خریداری شده (در انتظار تحویل)',
      received: 'تایید دریافت پرسنل',
      carried_over: 'منتقل‌شده به سفارش جدید'
    };

    const rows = listToExport.map(x => [
      x.orderTitle,
      x.orderDate,
      x.code,
      x.isProduct ? 'محصول آماده' : 'ماده اولیه',
      x.name,
      x.supplierName,
      x.supplierPhone,
      String(x.qtyProposed),
      x.unit,
      `${x.qtyPerPackage} ${x.packageType}`,
      String(x.weightPerPackage),
      String(x.estimatedWeightKg),
      String(x.lastPurchasePrice),
      String(x.estimatedCostPerUnit),
      String(x.totalEstimatedCost),
      statusLabelMap[x.itemStatus],
      x.receivedQty !== undefined ? String(x.receivedQty) : '',
      x.receivedBy || '',
      x.receivedAt || ''
    ]);

    downloadCSV(
      onlyUnpurchased ? 'Gatan_Unpurchased_Procurement_Items' : 'Gatan_Weekly_Procurement_Report',
      headers,
      rows
    );
  };

  const printOrderProposalSheet = (order: ProcurementOrder) => {
    const rowsHtml = (order.items || [])
      .map((it, idx) => {
        const isProduct = !!it.productId;
        const itemId = isProduct ? it.productId! : it.rawMaterialId!;
        const refObj = isProduct ? productMap[itemId] : rawItemMap[itemId];
        const supId = it.supplierId || order.supplierId || '';
        const sup = supId ? supplierMap[supId] : undefined;
        const unit = refObj?.unit || 'واحد';
        const weight = refObj?.weightPerPackage || 0;
        const pkg = `${refObj?.qtyPerPackage || 1} ${refObj?.packageType || 'کارتن'}`;
        const status = resolveLineStatus(it);
        const statusText =
          status === 'received'
            ? `تحویل: ${toPersianDigits(it.receivedQty ?? it.qtyProposed)} (${it.receivedBy || '-'})`
            : status === 'purchased'
            ? 'خریداری شده'
            : status === 'carried_over'
            ? 'منتقل به سفارش بعدی'
            : 'در انتظار خرید';

        return `
          <tr>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${toPersianDigits(idx + 1)}</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">
              <strong>${refObj?.name || 'کالای نامشخص'}</strong>
              <div style="font-size: 9.5px; color: #475569; margin-top: 2px;">کد: ${refObj?.code || '-'} · ${isProduct ? 'محصول آماده' : 'ماده اولیه'}</div>
            </td>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">
              <strong>${sup?.name || 'سفارش آزاد'}</strong>
              ${sup?.phone ? `<div style="font-size: 9.5px; color: #475569;">${toPersianDigits(sup.phone)}</div>` : ''}
            </td>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">
              ${toPersianDigits(pkg)}${weight > 0 ? `<div style="font-size: 9.5px; color: #475569;">وزن بسته: ${toPersianDigits(weight)} kg</div>` : ''}
            </td>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${toPersianDigits(it.qtyProposed)} ${unit}</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: left; font-family: monospace;">${toPersianDigits(formatWithCommas(it.estimatedCostPerUnit))}</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: left; font-family: monospace; font-weight: bold;">${toPersianDigits(formatWithCommas(it.totalEstimatedCost))}</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-size: 10px;">${statusText}</td>
          </tr>
        `;
      })
      .join('');

    const bodyHtml = `
      <div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 20px; background: #ffffff; color: #0f172a; max-width: 960px; margin: auto;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px;">
          <div>
            <h1 style="margin: 0; font-size: 18px; font-weight: 800;">برگه درخواست سفارش هفتگی کالا</h1>
            <p style="margin: 4px 0 0 0; font-size: 11px; color: #475569;">${order.title || 'سفارش تدارکات کارگاه'} · تنظیم‌کننده: ${order.requestedBy || '-'}</p>
          </div>
          <div style="text-align: left; font-size: 11px; line-height: 1.7; color: #334155;">
            <div>شماره سند: <strong>${order.id.slice(-8)}</strong></div>
            <div>تاریخ درخواست: <strong>${toPersianDigits(order.orderDate)}</strong></div>
            <div>مهلت تحویل: <strong>${toPersianDigits(order.expectedDeliveryDate)}</strong></div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 18px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 4%;">#</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 22%;">شرح کالا</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 17%;">تامین‌کننده</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 14%;">بسته‌بندی / وزن</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 10%;">میزان سفارش</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 11%;">قیمت واحد (ریال)</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 11%;">جمع (ریال)</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; width: 11%;">وضعیت / تحویل</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr style="background: #f8fafc; font-weight: bold;">
              <td colspan="6" style="padding: 10px; border: 1px solid #cbd5e1; text-align: left;">جمع کل برآوردی سفارش:</td>
              <td colspan="2" style="padding: 10px; border: 1px solid #cbd5e1; text-align: left; font-family: monospace;">${toPersianDigits(formatWithCommas(order.totalBill))} ریال</td>
            </tr>
          </tbody>
        </table>

        ${order.notes ? `<div style="padding: 10px 12px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 11px; margin-bottom: 24px;"><strong>توضیحات:</strong> ${order.notes}</div>` : ''}

        <table style="width: 100%; border-collapse: collapse; margin-top: 32px; font-size: 11px;">
          <tr>
            <td style="width: 33%; text-align: center;">درخواست‌کننده (${order.requestedBy || 'پرسنل'})<br/><br/><br/>امضا: ....................</td>
            <td style="width: 33%; text-align: center;">مسئول خرید و تدارکات<br/><br/><br/>امضا: ....................</td>
            <td style="width: 33%; text-align: center;">تایید تحویل‌گیرنده انبار<br/><br/><br/>امضا: ....................</td>
          </tr>
        </table>
      </div>
    `;

    printElement(`سفارش_کالا_${order.id.slice(-6)}`, bodyHtml);
  };

  const printComprehensiveReport = () => {
    if (filteredReportRows.length === 0) {
      showToast('warning', 'گزارش فعلی خالی است و موردی برای چاپ وجود ندارد.');
      return;
    }

    const statusTextMap: Record<ProcurementItemStatus, string> = {
      pending: 'در انتظار خرید',
      purchased: 'خریداری شده',
      received: 'تایید دریافت',
      carried_over: 'منتقل‌شده'
    };

    const bodyHtml = `
      <div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 20px; background: #ffffff; color: #0f172a; max-width: 1020px; margin: auto;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;">
          <div>
            <h1 style="margin: 0; font-size: 18px; font-weight: 800;">گزارش اجرایی مسئول خرید و وضعیت تحویل اقلام</h1>
            <p style="margin: 4px 0 0 0; font-size: 11px; color: #475569;">تعداد ردیف‌های گزارش: ${toPersianDigits(filteredReportRows.length)} قلم · اقلام جامانده از لیست‌های قبلی: ${toPersianDigits(previousBacklogRows.length)} قلم</p>
          </div>
          <div style="text-align: left; font-size: 11px; color: #334155;">
            <div>تاریخ چاپ: <strong>${toPersianDigits(todayJalali)}</strong></div>
            <div>مجموع برآورد: <strong>${toPersianDigits(formatWithCommas(filteredReportRows.reduce((s, r) => s + r.totalEstimatedCost, 0)))} ریال</strong></div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 8px; border: 1px solid #cbd5e1;">درخواست / تاریخ</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">نام کالا</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">تامین‌کننده و تماس</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">بسته‌بندی / وزن</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">سفارش</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">آخرین قیمت</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1;">وضعیت و تایید تحویل</th>
            </tr>
          </thead>
          <tbody>
            ${filteredReportRows
              .map(
                row => `
              <tr>
                <td style="padding: 7px; border: 1px solid #cbd5e1;">
                  <strong>${row.orderTitle}</strong>
                  <div style="font-size: 9.5px; color: #475569;">${toPersianDigits(row.orderDate)}</div>
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1;">
                  <strong>${row.name}</strong>
                  <div style="font-size: 9.5px; color: #475569;">کد: ${row.code}</div>
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1;">
                  <strong>${row.supplierName}</strong>
                  <div style="font-size: 9.5px; color: #475569;">${toPersianDigits(row.supplierPhone)}</div>
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1; text-align: center;">
                  ${toPersianDigits(row.qtyPerPackage)} ${row.packageType}
                  ${row.weightPerPackage > 0 ? `<div style="font-size: 9.5px; color: #475569;">${toPersianDigits(row.weightPerPackage)} kg</div>` : ''}
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">
                  ${toPersianDigits(row.qtyProposed)} ${row.unit}
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1; text-align: left; font-family: monospace;">
                  ${toPersianDigits(formatWithCommas(row.lastPurchasePrice))}
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1; text-align: center;">
                  <strong>${statusTextMap[row.itemStatus]}</strong>
                  ${
                    row.itemStatus === 'received'
                      ? `<div style="font-size: 9.5px; color: #166534;">تحویل: ${toPersianDigits(row.receivedQty ?? row.qtyProposed)} · ${row.receivedBy || '-'} (${toPersianDigits(row.receivedAt || '')})</div>`
                      : ''
                  }
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    printElement('گزارش_مسئول_خرید_گاتان', bodyHtml);
  };

  // Filtered History Orders
  const searchedHistory = useMemo(() => {
    if (!historySearch.trim()) return ordersHistory;
    return ordersHistory.filter(o => {
      const titleMatch = matchPersianString(o.title || '', historySearch);
      const idMatch = matchPersianString(o.id, historySearch);
      const notesMatch = matchPersianString(o.notes || '', historySearch);
      const reqMatch = matchPersianString(o.requestedBy || '', historySearch);
      const itemMatch = (o.items || []).some(it => {
        const ref = it.productId ? productMap[it.productId] : rawItemMap[it.rawMaterialId || ''];
        const sup = supplierMap[it.supplierId || o.supplierId || ''];
        return (
          matchPersianString(ref?.name || '', historySearch) ||
          matchPersianString(sup?.name || '', historySearch)
        );
      });
      return titleMatch || idMatch || notesMatch || reqMatch || itemMatch;
    });
  }, [ordersHistory, historySearch, productMap, rawItemMap, supplierMap]);

  // Selected backlog items count
  const selectedBacklogList = useMemo(() => {
    return displayedBacklogRows.filter(r => selectedBacklogKeys[`${r.orderId}::${r.lineId}`]);
  }, [displayedBacklogRows, selectedBacklogKeys]);

  const allDisplayedBacklogSelected =
    displayedBacklogRows.length > 0 && selectedBacklogList.length === displayedBacklogRows.length;

  const toggleAllBacklog = () => {
    if (allDisplayedBacklogSelected) {
      setSelectedBacklogKeys({});
    } else {
      const next: Record<string, boolean> = {};
      displayedBacklogRows.forEach(r => {
        next[`${r.orderId}::${r.lineId}`] = true;
      });
      setSelectedBacklogKeys(next);
    }
  };

  // ==================== RENDER ====================
  return (
    <div
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-2xl sm:rounded-3xl min-h-[600px] shadow-xl font-sans p-3.5 sm:p-6 text-right"
      dir="rtl"
    >
      {/* UNIFIED MODULE HEADER & PRIMARY TABS */}
      <div className="mb-5">
        <ModuleHeader
          icon={<ShoppingCart className="h-5 w-5" />}
          title="سفارشات هفتگی کالا و کارتابل تدارکات"
          subtitle="ثبت درخواست چندردیفه پرسنل با انتخاب تامین‌کننده هر کالا، پیگیری جاماندگان و تایید تحویل واقعی"
          periodName={db.periods.find(p => p.id === activePeriodId)?.name}
          recordCount={ordersHistory.length}
          recordLabel="سفارش"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              {previousBacklogRows.length > 0 && activeTab !== 'backlog' && (
                <ErpButton
                  variant="secondary"
                  size="sm"
                  icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  onClick={() => setActiveTab('backlog')}
                >
                  {toPersianDigits(previousBacklogRows.length)} قلم جامانده
                </ErpButton>
              )}
              <ErpButton variant="secondary" size="sm" onClick={() => setShowCopyModal(true)}>
                {ERP_BUTTON_LABELS.copyFromPeriod}
              </ErpButton>
              <ErpButton
                variant="primary"
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setActiveTab('create')}
              >
                {ERP_BUTTON_LABELS.add}
              </ErpButton>
            </div>
          }
        />

        <ModulePrimaryTabs
          activeId={activeTab}
          onChange={(id) => {
            if (id === 'report') setReportOrderFilter('ACTIVE');
            setActiveTab(id as typeof activeTab);
          }}
          tabs={[
            { id: 'report', label: 'کارتابل مسئول خرید و تحویل', icon: <ClipboardCheck className="h-4 w-4" />, count: reportStats.activePendingCount },
            { id: 'backlog', label: 'اقلام جامانده از قبل', icon: <ArrowRightLeft className="h-4 w-4" />, count: previousBacklogRows.length },
            { id: 'history', label: 'آرشیو سفارش‌ها', icon: <FileText className="h-4 w-4" />, count: ordersHistory.length },
            { id: 'create', label: editingOrderId ? 'ویرایش درخواست سفارش' : 'ثبت درخواست هفتگی', icon: <Plus className="h-4 w-4" />, count: basketItems.length || undefined },
          ]}
        />

        {/* INLINE TOAST NOTIFICATION */}
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
      </div>

      {/* ==================== TAB 1: CREATE / EDIT MULTI-ITEM WEEKLY ORDER ==================== */}
      {activeTab === 'create' && (
        <form onSubmit={handleSaveProcurementOrder} className="space-y-6">
          {/* Edit Mode Banner */}
          {editingOrderId && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <Pencil className="h-4 w-4 shrink-0" />
                <span>
                  در حال ویرایش سند سفارش <strong className="font-mono">#{editingOrderId.slice(-6)}</strong> — وضعیت خرید و تحویل ردیف‌های قبلی حفظ خواهد شد.
                </span>
              </div>
              <button
                type="button"
                onClick={resetOrderForm}
                className="self-start sm:self-center px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 font-bold hover:bg-amber-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                انصراف از ویرایش
              </button>
            </div>
          )}

          {/* STEP 1: ORDER HEADER METADATA */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <span>۱. مشخصات سربرگ درخواست هفتگی</span>
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                تامین‌کننده هر کالا در جدول ردیف‌ها انتخاب می‌شود
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label htmlFor="order-title-inp" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  عنوان درخواست / هفته *
                </label>
                <input
                  id="order-title-inp"
                  type="text"
                  required
                  value={orderTitle}
                  onChange={e => setOrderTitle(e.target.value)}
                  placeholder="مثال: سفارش هفته اول خرداد"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <ShamsiDatePicker
                  id="order-date-picker"
                  label="تاریخ ثبت درخواست"
                  value={orderDate}
                  onChange={setOrderDate}
                />
              </div>

              <div>
                <ShamsiDatePicker
                  id="expected-delivery-picker"
                  label="مهلت تامین تا تاریخ"
                  value={expectedDate}
                  onChange={setExpectedDate}
                />
              </div>

              <div>
                <label htmlFor="order-requester-inp" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  درخواست‌کننده (پرسنل / سرپرست)
                </label>
                <input
                  id="order-requester-inp"
                  type="text"
                  list="procurement-personnel-list"
                  value={requestedBy}
                  onChange={e => setRequestedBy(e.target.value)}
                  placeholder="نام پرسنل درخواست‌کننده..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                />
                <datalist id="procurement-personnel-list">
                  {personnelNames.map(name => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          {/* STEP 2: CATALOG QUICK-ADD BAR */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <span>۲. افزودن کالاها به ردیف‌های سفارش</span>
              </h3>

              <div className="flex flex-wrap items-center gap-1 bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setCreationSelectTab('all')}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    creationSelectTab === 'all'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  تمام کالاها ({toPersianDigits(suppliedItemsChecklist.length + searchedPurchasedProducts.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setCreationSelectTab('items')}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    creationSelectTab === 'items'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  مواد اولیه ({toPersianDigits(suppliedItemsChecklist.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setCreationSelectTab('products')}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    creationSelectTab === 'products'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  محصولات خریداری ({toPersianDigits(searchedPurchasedProducts.length)})
                </button>
              </div>
            </div>

            {/* Catalog Search */}
            <div className="relative">
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                ref={catalogSearchInputRef}
                id="creation-catalog-search"
                type="text"
                placeholder="جستجو در تمام کالاها (نام کالا، کد کالا یا کد حسابداری) — با کلیک روی افزودن مستقیم مقدار سفارش وارد کنید..."
                className="w-full pl-3 pr-10 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 font-bold"
                value={checklistSearch}
                onChange={e => setChecklistSearch(e.target.value)}
              />
            </div>

            {/* Unified Catalog Results Grid */}
            <div className="max-h-60 overflow-y-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pr-0.5 scrollbar-thin">
              {displayedCatalogItems.length === 0 ? (
                <div className="col-span-full py-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                  کالایی با این مشخصات یافت نشد.
                </div>
              ) : (
                displayedCatalogItems.map(catItem => {
                  const existingLine = basketItems.find(x =>
                    catItem.isProduct ? x.productId === catItem.id : x.rawMaterialId === catItem.id
                  );
                  const sups = getSuggestedSuppliersForItem(catItem.id, catItem.isProduct);
                  const lastPrice = getLastPurchaseInfo(catItem.id, catItem.isProduct);
                  return (
                    <div
                      key={`${catItem.isProduct ? 'prod' : 'item'}-${catItem.id}`}
                      className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-colors ${
                        existingLine
                          ? 'bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                          <span className="truncate">{catItem.name}</span>
                          {creationSelectTab === 'all' && (
                            <span className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                              ({catItem.isProduct ? 'محصول' : 'ماده اولیه'})
                            </span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono">{catItem.code}</span>
                          <span aria-hidden="true">·</span>
                          <span>{toPersianDigits(catItem.qtyPerPackage)} {catItem.packageType}</span>
                          {catItem.weightPerPackage > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{toPersianDigits(catItem.weightPerPackage)} kg</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          {sups.length > 0 ? (
                            <span className="text-sky-700 dark:text-sky-400 font-bold">
                              {toPersianDigits(sups.length)} تامین‌کننده
                            </span>
                          ) : (
                            <span className="text-slate-400">سفارش آزاد</span>
                          )}
                        </div>
                        <div className="text-[10.5px] font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                          آخرین قیمت: {toPersianDigits(formatWithCommas(lastPrice.price))} ریال
                          <span className="font-sans font-normal text-slate-400 mr-1">
                            ({lastPrice.source === 'invoice' ? `فاکتور ${toPersianDigits(lastPrice.date || '')}` : 'کاتالوگ'})
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => addItemToBasket(catItem.id, catItem.isProduct)}
                        className={`px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                          existingLine
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-800 dark:text-slate-200 hover:text-white'
                        }`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{existingLine ? `مقدار (${toPersianDigits(existingLine.qtyProposed)})` : 'افزودن'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* STEP 3: MULTI-ROW ORDER TABLE (DESKTOP) + CARDS (MOBILE) */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Package className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <span>۳. جدول ردیف‌های درخواست سفارش ({toPersianDigits(enrichedBasketRows.length)} ردیف)</span>
              </h3>
              {enrichedBasketRows.length > 0 && (
                <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 font-bold">
                  <span>تامین‌کنندگان: <strong className="font-mono text-slate-900 dark:text-white">{toPersianDigits(draftTotals.distinctSuppliers)}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>وزن تقریبی: <strong className="font-mono text-slate-900 dark:text-white">{toPersianDigits(draftTotals.totalWeightKg)} kg</strong></span>
                </div>
              )}
            </div>

            {enrichedBasketRows.length === 0 ? (
              <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/50 space-y-2">
                <ShoppingCart className="h-9 w-9 mx-auto text-slate-400 dark:text-slate-600" />
                <div className="text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300">
                  هنوز ردیفی به این سفارش اضافه نشده است
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  کالاهای مورد نیاز هفته را از کاتالوگ بالا انتخاب کنید یا از تب «اقلام جامانده از قبل» اقلام خریداری‌نشده هفته‌های گذشته را به این لیست منتقل نمایید.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Ledger Table (No Unit Price column; dedicated Row Notes column) */}
                <div className="hidden lg:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <table className="w-full text-right border-collapse min-w-[960px]">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 text-[11px] font-extrabold border-b border-slate-200 dark:border-slate-800">
                        <th className="p-3 text-center w-[3%]">#</th>
                        <th className="p-3 w-[18%]">کالا و مشخصات</th>
                        <th className="p-3 w-[19%]">تامین‌کننده ردیف</th>
                        <th className="p-3 text-center w-[12%]">بسته‌بندی و وزن</th>
                        <th className="p-3 text-left w-[11%]">آخرین قیمت خرید</th>
                        <th className="p-3 text-center w-[9%]">میزان سفارش</th>
                        <th className="p-3 text-left w-[11%]">جمع ردیف</th>
                        <th className="p-3 w-[14%]">توضیحات ردیف</th>
                        <th className="p-3 text-center w-[3%]">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {enrichedBasketRows.map((entry, idx) => {
                        const hasAssignedSuppliers = entry.suggestedSuppliers.length > 0;
                        const savedSupplierFallback =
                          hasAssignedSuppliers &&
                          entry.row.supplierId &&
                          !entry.suggestedSuppliers.some(s => s.id === entry.row.supplierId)
                            ? supplierMap[entry.row.supplierId]
                            : undefined;

                        return (
                          <tr key={entry.lineId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 text-center font-mono font-bold text-slate-500">
                              {toPersianDigits(idx + 1)}
                            </td>

                            <td className="p-3">
                              <div className="font-black text-slate-900 dark:text-white leading-snug">{entry.name}</div>
                              <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono">{entry.code}</span>
                                <span aria-hidden="true">·</span>
                                <span>{entry.isProduct ? 'محصول آماده' : 'ماده اولیه'}</span>
                                {entry.row.carriedOverFromTitle && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-700 dark:text-amber-400 font-bold">
                                      منتقل‌شده از {entry.row.carriedOverFromTitle}
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>

                            <td className="p-3">
                              <select
                                value={entry.row.supplierId || ''}
                                onChange={e => updateBasketRowSupplier(entry.lineId, e.target.value)}
                                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 cursor-pointer"
                              >
                                {hasAssignedSuppliers ? (
                                  <>
                                    {entry.suggestedSuppliers.map(s => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                    {savedSupplierFallback && (
                                      <option value={savedSupplierFallback.id}>
                                        {savedSupplierFallback.name}
                                      </option>
                                    )}
                                    <option value="">سفارش آزاد (خرید بازار)</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="">سفارش آزاد (پیش‌فرض)</option>
                                    {entry.otherSuppliers.length > 0 && (
                                      <optgroup label="انتخاب از تامین‌کنندگان فعال (اختیاری)">
                                        {entry.otherSuppliers.map(s => (
                                          <option key={s.id} value={s.id}>
                                            {s.name}
                                          </option>
                                        ))}
                                      </optgroup>
                                    )}
                                  </>
                                )}
                              </select>
                              {entry.suggestedSuppliers.length > 1 && (
                                <div className="text-[10px] text-sky-700 dark:text-sky-400 font-bold mt-1">
                                  دارای {toPersianDigits(entry.suggestedSuppliers.length)} تامین‌کننده مجاز
                                </div>
                              )}
                            </td>

                            <td className="p-3 text-center">
                              <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                                {toPersianDigits(entry.qtyPerPackage)} {entry.packageType}
                              </div>
                              <div className="text-[10.5px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                {entry.weightPerPackage > 0
                                  ? `بسته: ${toPersianDigits(entry.weightPerPackage)} kg`
                                  : 'بدون وزن بسته'}
                              </div>
                              {entry.estimatedWeightKg > 0 && (
                                <div className="text-[10px] font-mono font-bold text-indigo-700 dark:text-indigo-400 mt-0.5">
                                  کل: {toPersianDigits(entry.estimatedWeightKg)} kg
                                </div>
                              )}
                            </td>

                            <td className="p-3 text-left font-mono">
                              <div className="font-extrabold text-emerald-700 dark:text-emerald-400 text-xs">
                                {toPersianDigits(formatWithCommas(entry.liveLastPrice.price))}
                              </div>
                              <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400 mt-0.5">
                                {entry.liveLastPrice.source === 'invoice'
                                  ? `فاکتور ${toPersianDigits(entry.liveLastPrice.date || '')}`
                                  : 'قیمت کاتالوگ'}
                              </div>
                            </td>

                            <td className="p-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  ref={el => {
                                    desktopQtyInputRefs.current[entry.lineId] = el;
                                  }}
                                  type="number"
                                  step="any"
                                  min={0.1}
                                  onFocus={handleFocus}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      catalogSearchInputRef.current?.focus();
                                      catalogSearchInputRef.current?.select();
                                    }
                                  }}
                                  value={entry.row.qtyProposed}
                                  onChange={e => updateBasketRowQty(entry.lineId, parseNumber(e.target.value))}
                                  className="w-20 px-2 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono font-black text-center text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                                />
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">{entry.unit}</span>
                              </div>
                            </td>

                            <td className="p-3 text-left font-mono font-black text-slate-900 dark:text-white">
                              {toPersianDigits(formatWithCommas(entry.row.totalEstimatedCost))}
                              <span className="block text-[9.5px] font-sans font-normal text-slate-500">ریال</span>
                            </td>

                            <td className="p-3">
                              <input
                                type="text"
                                value={entry.row.rowNotes || ''}
                                onChange={e => updateBasketRowNotes(entry.lineId, e.target.value)}
                                placeholder="برند، کیفیت، توضیح..."
                                className="w-full px-2.5 py-2 text-[11px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-rose-500"
                              />
                            </td>

                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() => removeBasketRow(entry.lineId)}
                                className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors cursor-pointer"
                                title="حذف ردیف"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile & Tablet Card Rows */}
                <div className="lg:hidden space-y-3">
                  {enrichedBasketRows.map((entry, idx) => {
                    const hasAssignedSuppliers = entry.suggestedSuppliers.length > 0;
                    const savedSupplierFallback =
                      hasAssignedSuppliers &&
                      entry.row.supplierId &&
                      !entry.suggestedSuppliers.some(s => s.id === entry.row.supplierId)
                        ? supplierMap[entry.row.supplierId]
                        : undefined;

                    return (
                      <div
                        key={entry.lineId}
                        className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-black text-slate-900 dark:text-white">
                              {toPersianDigits(idx + 1)}. {entry.name}
                            </div>
                            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {entry.code} · {toPersianDigits(entry.qtyPerPackage)} {entry.packageType}
                              {entry.weightPerPackage > 0 ? ` · بسته ${toPersianDigits(entry.weightPerPackage)} kg` : ''}
                            </div>
                            {entry.row.carriedOverFromTitle && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 font-bold mt-0.5">
                                منتقل‌شده از {entry.row.carriedOverFromTitle}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBasketRow(entry.lineId)}
                            className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 cursor-pointer"
                            aria-label="حذف ردیف"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div>
                          <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            تامین‌کننده این کالا
                            {entry.suggestedSuppliers.length > 1 && (
                              <span className="text-sky-700 dark:text-sky-400 mr-1.5">
                                ({toPersianDigits(entry.suggestedSuppliers.length)} تامین‌کننده مجاز)
                              </span>
                            )}
                          </label>
                          <select
                            value={entry.row.supplierId || ''}
                            onChange={e => updateBasketRowSupplier(entry.lineId, e.target.value)}
                            className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white"
                          >
                            {hasAssignedSuppliers ? (
                              <>
                                {entry.suggestedSuppliers.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                                {savedSupplierFallback && (
                                  <option value={savedSupplierFallback.id}>{savedSupplierFallback.name}</option>
                                )}
                                <option value="">سفارش آزاد (خرید بازار)</option>
                              </>
                            ) : (
                              <>
                                <option value="">سفارش آزاد (پیش‌فرض)</option>
                                {entry.otherSuppliers.length > 0 && (
                                  <optgroup label="انتخاب از تامین‌کنندگان فعال (اختیاری)">
                                    {entry.otherSuppliers.map(s => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </>
                            )}
                          </select>
                        </div>

                        <div className="grid grid-cols-12 gap-2.5">
                          <div className="col-span-5">
                            <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                              میزان سفارش ({entry.unit})
                            </label>
                            <input
                              ref={el => {
                                mobileQtyInputRefs.current[entry.lineId] = el;
                              }}
                              type="number"
                              step="any"
                              min={0.1}
                              onFocus={handleFocus}
                              value={entry.row.qtyProposed}
                              onChange={e => updateBasketRowQty(entry.lineId, parseNumber(e.target.value))}
                              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-black text-center text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div className="col-span-7">
                            <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                              توضیحات ردیف
                            </label>
                            <input
                              type="text"
                              value={entry.row.rowNotes || ''}
                              onChange={e => updateBasketRowNotes(entry.lineId, e.target.value)}
                              placeholder="برند، کیفیت..."
                              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400">
                            آخرین خرید: <strong className="font-mono text-emerald-700 dark:text-emerald-400">{toPersianDigits(formatWithCommas(entry.liveLastPrice.price))}</strong>
                            {entry.estimatedWeightKg > 0 ? ` · ${toPersianDigits(entry.estimatedWeightKg)} kg` : ''}
                          </span>
                          <strong className="font-mono text-slate-900 dark:text-white">
                            جمع: {toPersianDigits(formatWithCommas(entry.row.totalEstimatedCost))} ریال
                          </strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Notes & Final Submit Bar */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-7">
                <label htmlFor="sec-order-notes" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  توضیحات و نکات خرید برای مسئول تدارکات
                </label>
                <textarea
                  id="sec-order-notes"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="مثال: آرد نول حتماً تاریخ تولید جدید باشد، خامه تا صبح سه‌شنبه به کارگاه برسد..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="lg:col-span-5 space-y-3">
                <div className="px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">جمع برآورد مالی سفارش</span>
                    <span className="text-[10.5px] text-slate-400 font-mono">
                      {toPersianDigits(draftTotals.rowCount)} ردیف · {toPersianDigits(draftTotals.totalWeightKg)} kg
                    </span>
                  </div>
                  <strong className="text-base font-mono font-black text-emerald-700 dark:text-emerald-400">
                    {toPersianDigits(formatWithCommas(draftTotals.totalBill))} ریال
                  </strong>
                </div>

                <div className="flex flex-wrap gap-2">
                  {editingOrderId && (
                    <button
                      type="button"
                      onClick={resetOrderForm}
                      className="flex-1 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      انصراف
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={basketItems.length === 0}
                    className={`flex-[2] px-5 py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-colors ${
                      basketItems.length > 0
                        ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>{editingOrderId ? 'ذخیره تغییرات درخواست سفارش' : 'ثبت نهایی درخواست سفارش هفتگی'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ==================== TAB 2: BUYER WORKBENCH & RECEIPT VERIFICATION ==================== */}
      {activeTab === 'report' && (
        <div className="space-y-5">
          {/* 5-Metric Executive KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 block">کل اقلام فعال</span>
              <strong className="text-lg font-mono font-black text-slate-900 dark:text-white block mt-1">
                {toPersianDigits(reportStats.totalLines)} <span className="text-[11px] font-sans font-bold text-slate-500">ردیف</span>
              </strong>
            </div>

            <div className="bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-amber-800 dark:text-amber-300 block">در انتظار خرید</span>
              <strong className="text-lg font-mono font-black text-amber-800 dark:text-amber-300 block mt-1">
                {toPersianDigits(reportStats.pendingLines)} <span className="text-[11px] font-sans font-bold">ردیف</span>
              </strong>
            </div>

            <div className="bg-sky-50/70 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-sky-800 dark:text-sky-300 block">خریداری شده (در انتظار تحویل)</span>
              <strong className="text-lg font-mono font-black text-sky-800 dark:text-sky-300 block mt-1">
                {toPersianDigits(reportStats.purchasedLines)} <span className="text-[11px] font-sans font-bold">ردیف</span>
              </strong>
            </div>

            <div className="bg-emerald-50/70 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-emerald-800 dark:text-emerald-300 block">تایید دریافت پرسنل</span>
              <strong className="text-lg font-mono font-black text-emerald-800 dark:text-emerald-300 block mt-1">
                {toPersianDigits(reportStats.receivedLines)}{' '}
                <span className="text-[11px] font-sans font-bold">
                  ({toPersianDigits(reportStats.totalLines > 0 ? Math.round((reportStats.receivedLines / reportStats.totalLines) * 100) : 0)}٪)
                </span>
              </strong>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
              <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 block">برآورد کل ریالی</span>
              <strong className="text-sm sm:text-base font-mono font-black text-rose-700 dark:text-rose-400 block mt-1.5">
                {toPersianDigits(formatWithCommas(reportStats.totalOrderedCost))} <span className="text-[10px] font-sans">ریال</span>
              </strong>
            </div>
          </div>

          {/* Active Weekly Order Status Notice */}
          {reportOrderFilter === 'ACTIVE' && !activeWeeklyOrder && ordersHistory.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  در حال حاضر درخواست هفتگی فعالی وجود ندارد (مهلت تحویل درخواست قبلی به پایان رسیده است). اقلام خریداری‌نشده در تب «اقلام جامانده از قبل» در دسترس هستند.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previousBacklogRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('backlog')}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 font-bold hover:bg-amber-100 cursor-pointer whitespace-nowrap"
                  >
                    مشاهده جاماندگان ({toPersianDigits(previousBacklogRows.length)})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('create')}
                  className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer whitespace-nowrap"
                >
                  ثبت درخواست هفته جدید
                </button>
              </div>
            </div>
          )}

          {reportOrderFilter === 'ACTIVE' && reportStatusFilter === 'pending' && inactivePurchasedAwaitingReceipt.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 text-xs">
              <span className="font-bold text-sky-900 dark:text-sky-200">
                {toPersianDigits(inactivePurchasedAwaitingReceipt.length)} قلم خریداری‌شده از درخواست‌های غیرفعال قبلی همچنان منتظر تایید دریافت پرسنل است.
              </span>
              <button
                type="button"
                onClick={() => setReportStatusFilter('purchased')}
                className="self-start sm:self-center px-3 py-1 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold cursor-pointer whitespace-nowrap"
              >
                مشاهده و تایید دریافت
              </button>
            </div>
          )}

          {/* Specific Archived Order Banner (only shown when navigated from History tab) */}
          {reportOrderFilter !== 'ACTIVE' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                در حال مشاهده گزارش سفارش:{' '}
                <strong className="text-rose-700 dark:text-rose-400">
                  {ordersHistory.find(o => o.id === reportOrderFilter)?.title || 'سفارش انتخابی'}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setReportOrderFilter('ACTIVE');
                  setReportStatusFilter('pending');
                }}
                className="self-start sm:self-center px-3 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 font-bold cursor-pointer whitespace-nowrap"
              >
                بازگشت به سفارش فعال جاری
              </button>
            </div>
          )}

          {/* Buyer Filter & Controls Bar */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <select
                value={reportSupplierFilter}
                onChange={e => setReportSupplierFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
              >
                <option value="ALL">همه تامین‌کنندگان</option>
                <option value="OPEN">فقط اقلام سفارش آزاد (بدون تامین‌کننده)</option>
                {activeSuppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <div className="relative sm:col-span-2">
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </span>
                <input
                  type="text"
                  placeholder="جستجوی نام کالا، تامین‌کننده، عنوان سفارش یا نام تحویل‌گیرنده..."
                  value={reportSearch}
                  onChange={e => setReportSearch(e.target.value)}
                  className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              {/* Status Segmented Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                  {(
                    [
                      { key: 'all', label: `همه (${toPersianDigits(reportStats.totalLines)})` },
                      { key: 'pending', label: `در انتظار خرید (${toPersianDigits(reportStats.pendingLines)})` },
                      { key: 'purchased', label: `خریداری شده (${toPersianDigits(reportStats.purchasedLines)})` },
                      { key: 'received', label: `تایید دریافت (${toPersianDigits(reportStats.receivedLines)})` }
                    ] as const
                  ).map(st => (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() => setReportStatusFilter(st.key)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                        reportStatusFilter === st.key
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>

                {/* View Mode Toggle (Default: Grouped by Supplier) */}
                <div className="flex bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                  <button
                    type="button"
                    onClick={() => setReportViewMode('bySupplier')}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      reportViewMode === 'bySupplier'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>تفکیک تامین‌کننده</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportViewMode('table')}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      reportViewMode === 'table'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    <span>جدول کامل</span>
                  </button>
                </div>
              </div>

              {/* Export & Print Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={printComprehensiveReport}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                >
                  <Printer className="h-3.5 w-3.5 shrink-0" />
                  <span>چاپ لیست خرید</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportOrdersReportCSV(false)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold cursor-pointer whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 shrink-0" />
                  <span>اکسل گزارش</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportOrdersReportCSV(true)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-[11px] font-bold cursor-pointer whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 shrink-0" />
                  <span>اکسل خریداری‌نشده‌ها</span>
                </button>
              </div>
            </div>
          </div>

          {/* VIEW MODE A: FULL TABLE (DESKTOP) + CARDS (MOBILE) */}
          {reportViewMode === 'table' && (
            <>
              {filteredReportRows.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-500 dark:text-slate-400">
                  موردی مطابق فیلتر انتخاب‌شده یافت نشد.
                </div>
              ) : (
                <>
                  <div className="hidden lg:block border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 overflow-x-auto">
                    <table className="w-full text-right border-collapse min-w-[1040px]">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 text-[11px] font-extrabold border-b border-slate-200 dark:border-slate-800">
                          <th className="p-3 w-[14%]">سفارش / تاریخ</th>
                          <th className="p-3 w-[18%]">کالا و مشخصات</th>
                          <th className="p-3 w-[17%]">تامین‌کننده</th>
                          <th className="p-3 text-center w-[12%]">بسته‌بندی و وزن</th>
                          <th className="p-3 text-center w-[9%]">میزان سفارش</th>
                          <th className="p-3 text-left w-[12%]">آخرین قیمت / برآورد</th>
                          <th className="p-3 text-center w-[18%]">چرخه خرید و تایید دریافت</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                        {filteredReportRows.map(row => {
                          const hasDiscrepancy =
                            row.itemStatus === 'received' &&
                            row.receivedQty !== undefined &&
                            row.receivedQty !== row.qtyProposed;

                          return (
                            <tr key={`${row.orderId}-${row.lineId}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="p-3">
                                <div className="font-bold text-slate-900 dark:text-white text-[11.5px]">{row.orderTitle}</div>
                                <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                  {toPersianDigits(row.orderDate)}
                                  {row.isFromPreviousOrder && row.itemStatus === 'pending' && (
                                    <span className="font-sans text-amber-700 dark:text-amber-400 font-bold mr-1.5">· جامانده</span>
                                  )}
                                </div>
                              </td>

                              <td className="p-3">
                                <div className="font-black text-slate-900 dark:text-white">{row.name}</div>
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  <span className="font-mono">{row.code}</span> · {row.isProduct ? 'محصول آماده' : 'ماده اولیه'}
                                </div>
                                {row.rawLine.rowNotes && (
                                  <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 italic">
                                    نکته: {row.rawLine.rowNotes}
                                  </div>
                                )}
                              </td>

                              <td className="p-3">
                                <div className="font-bold text-slate-900 dark:text-slate-100">{row.supplierName}</div>
                                {row.supplierPhone !== 'ثبت نشده' && (
                                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-1">
                                    <Phone className="h-3 w-3 shrink-0" />
                                    <span>{toPersianDigits(row.supplierPhone)}</span>
                                  </div>
                                )}
                              </td>

                              <td className="p-3 text-center">
                                <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                                  {toPersianDigits(row.qtyPerPackage)} {row.packageType}
                                </div>
                                <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                  {row.weightPerPackage > 0 ? `بسته ${toPersianDigits(row.weightPerPackage)} kg` : '-'}
                                  {row.estimatedWeightKg > 0 ? ` · کل ${toPersianDigits(row.estimatedWeightKg)} kg` : ''}
                                </div>
                              </td>

                              <td className="p-3 text-center font-mono font-black text-slate-900 dark:text-white">
                                {toPersianDigits(row.qtyProposed)} <span className="font-sans font-bold text-[10.5px] text-slate-500">{row.unit}</span>
                              </td>

                              <td className="p-3 text-left font-mono">
                                <div className="font-bold text-slate-900 dark:text-white">
                                  {toPersianDigits(formatWithCommas(row.estimatedCostPerUnit))}
                                  <span className="text-[9.5px] font-sans font-normal text-slate-500 mr-1">ریال</span>
                                </div>
                                <div className="text-[10.5px] text-emerald-700 dark:text-emerald-400 font-bold mt-0.5">
                                  کل: {toPersianDigits(formatWithCommas(row.totalEstimatedCost))}
                                </div>
                              </td>

                              <td className="p-3">
                                {row.itemStatus === 'pending' && (
                                  row.isOrderActive ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleMarkItemPurchased(row.orderId, row.itemIndex)}
                                        className="flex-1 px-2.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                                      >
                                        <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                                        <span>ثبت خرید</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openReceiptConfirmationModal(row)}
                                        className="px-2.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                                        title="تایید مستقیم دریافت توسط پرسنل"
                                      >
                                        تحویل
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="text-center space-y-1">
                                      <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
                                        <Lock className="h-3 w-3 shrink-0" />
                                        <span>سفارش غیرفعال</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleTransferBacklogToNewOrder([row])}
                                        className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100 text-[10px] font-bold cursor-pointer whitespace-nowrap"
                                      >
                                        انتقال به سفارش جدید
                                      </button>
                                    </div>
                                  )
                                )}

                                {row.itemStatus === 'purchased' && (
                                  <div className="space-y-1.5">
                                    <div className="text-[10.5px] text-center font-bold text-sky-700 dark:text-sky-400">
                                      خریداری شد {row.purchasedAt ? `(${toPersianDigits(row.purchasedAt)})` : ''}
                                      {!row.isOrderActive && (
                                        <span className="block text-[9.5px] text-amber-700 dark:text-amber-400">
                                          سفارش قبلی · آماده تایید دریافت
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => openReceiptConfirmationModal(row)}
                                        className="flex-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                                      >
                                        <UserCheck className="h-3.5 w-3.5 shrink-0" />
                                        <span>تایید دریافت پرسنل</span>
                                      </button>
                                      {row.isOrderActive && (
                                        <button
                                          type="button"
                                          onClick={() => handleRevertItemToPending(row.orderId, row.itemIndex)}
                                          className="p-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-500 hover:text-amber-600 cursor-pointer"
                                          title="بازگشت به در انتظار خرید"
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {row.itemStatus === 'received' && (
                                  <div className="text-center space-y-1">
                                    <div className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1">
                                      <Check className="h-3.5 w-3.5 shrink-0" />
                                      <span>
                                        تحویل: {toPersianDigits(row.receivedQty ?? row.qtyProposed)} {row.unit}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-600 dark:text-slate-400">
                                      تحویل‌گیرنده: <strong>{row.receivedBy || '-'}</strong>
                                      {row.receivedAt ? ` · ${toPersianDigits(row.receivedAt)}` : ''}
                                    </div>
                                    {hasDiscrepancy && (
                                      <div className="text-[10px] font-bold text-rose-700 dark:text-rose-400">
                                        اختلاف با سفارش: {toPersianDigits((row.receivedQty || 0) - row.qtyProposed)} {row.unit}
                                      </div>
                                    )}
                                    {row.isOrderActive && (
                                      <button
                                        type="button"
                                        onClick={() => openReceiptConfirmationModal(row)}
                                        className="text-[10px] font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                                      >
                                        ویرایش اطلاعات تحویل
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Report Cards */}
                  <div className="lg:hidden space-y-3">
                    {filteredReportRows.map(row => (
                      <div
                        key={`${row.orderId}-${row.lineId}`}
                        className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-black text-slate-900 dark:text-white">{row.name}</div>
                            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {row.orderTitle} · {toPersianDigits(row.orderDate)}
                              {!row.isOrderActive && <span className="text-amber-700 dark:text-amber-400 font-bold mr-1">· غیرفعال</span>}
                            </div>
                          </div>
                          <span className="font-mono font-black text-xs text-slate-900 dark:text-white shrink-0">
                            {toPersianDigits(row.qtyProposed)} {row.unit}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-700 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-bold">{row.supplierName}</span>
                          {row.supplierPhone !== 'ثبت نشده' && (
                            <span className="font-mono text-slate-500">· {toPersianDigits(row.supplierPhone)}</span>
                          )}
                          <span className="text-slate-500">
                            · {toPersianDigits(row.qtyPerPackage)} {row.packageType}
                            {row.weightPerPackage > 0 ? ` (${toPersianDigits(row.weightPerPackage)} kg)` : ''}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 font-sans">برآورد کل:</span>
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {toPersianDigits(formatWithCommas(row.totalEstimatedCost))} ریال
                          </strong>
                        </div>

                        {row.itemStatus === 'pending' && (
                          row.isOrderActive ? (
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleMarkItemPurchased(row.orderId, row.itemIndex)}
                                className="flex-1 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold cursor-pointer"
                              >
                                ثبت خرید
                              </button>
                              <button
                                type="button"
                                onClick={() => openReceiptConfirmationModal(row)}
                                className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                              >
                                تایید دریافت
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                                <Lock className="h-3.5 w-3.5" /> سفارش غیرفعال
                              </span>
                              <button
                                type="button"
                                onClick={() => handleTransferBacklogToNewOrder([row])}
                                className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] font-bold cursor-pointer"
                              >
                                انتقال به سفارش جدید
                              </button>
                            </div>
                          )
                        )}

                        {row.itemStatus === 'purchased' && (
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => openReceiptConfirmationModal(row)}
                              className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                            >
                              تایید دریافت پرسنل
                            </button>
                            {row.isOrderActive && (
                              <button
                                type="button"
                                onClick={() => handleRevertItemToPending(row.orderId, row.itemIndex)}
                                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                              >
                                بازگشت
                              </button>
                            )}
                          </div>
                        )}

                        {row.itemStatus === 'received' && (
                          <div className="flex items-center justify-between pt-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">
                            <span>
                              تحویل: {toPersianDigits(row.receivedQty ?? row.qtyProposed)} {row.unit} · {row.receivedBy || '-'}
                            </span>
                            {row.isOrderActive && (
                              <button
                                type="button"
                                onClick={() => openReceiptConfirmationModal(row)}
                                className="underline text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                ویرایش
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* VIEW MODE B: GROUPED BY SUPPLIER (BUYER SHOPPING LIST) */}
          {reportViewMode === 'bySupplier' && (
            <div className="space-y-4">
              {groupedReportBySupplier.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-500">
                  اقلامی برای نمایش در گروه‌بندی تامین‌کنندگان وجود ندارد.
                </div>
              ) : (
                groupedReportBySupplier.map(group => (
                  <div
                    key={group.supplierKey}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden"
                  >
                    <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">{group.supplierName}</h4>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            · {toPersianDigits(group.rows.length)} قلم ({toPersianDigits(group.pendingCount)} در انتظار خرید)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {group.supplierPhone !== 'ثبت نشده' && (
                            <span className="flex items-center gap-1 font-mono">
                              <Phone className="h-3 w-3" /> {toPersianDigits(group.supplierPhone)}
                            </span>
                          )}
                          {group.supplierAddress !== 'ثبت نشده' && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {group.supplierAddress}
                            </span>
                          )}
                          {group.supplierBank && (
                            <span className="flex items-center gap-1 font-mono">
                              <CreditCard className="h-3 w-3" /> {group.supplierBank}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-left shrink-0">
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400">مجموع برآورد این تامین‌کننده</div>
                        <div className="text-sm font-mono font-black text-emerald-700 dark:text-emerald-400">
                          {toPersianDigits(formatWithCommas(group.totalCost))} ریال
                          {group.totalWeightKg > 0 && (
                            <span className="text-[11px] text-slate-500 mr-2">({toPersianDigits(group.totalWeightKg)} kg)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {group.rows.map(row => (
                        <div
                          key={`${row.orderId}-${row.lineId}`}
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950"
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-black text-slate-900 dark:text-white">
                              {row.name}
                              <span className="font-mono font-bold text-rose-700 dark:text-rose-400 mr-2">
                                {toPersianDigits(row.qtyProposed)} {row.unit}
                              </span>
                            </div>
                            <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                              {row.orderTitle} ({toPersianDigits(row.orderDate)}) · {toPersianDigits(row.qtyPerPackage)} {row.packageType}
                              {row.weightPerPackage > 0 ? ` · بسته ${toPersianDigits(row.weightPerPackage)} kg` : ''} · آخرین قیمت {toPersianDigits(formatWithCommas(row.lastPurchasePrice))} ریال
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {row.itemStatus === 'pending' && (
                              row.isOrderActive ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkItemPurchased(row.orderId, row.itemIndex)}
                                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    ثبت خرید
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openReceiptConfirmationModal(row)}
                                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    تایید دریافت
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleTransferBacklogToNewOrder([row])}
                                  className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] font-bold cursor-pointer"
                                >
                                  سفارش غیرفعال · انتقال به جدید
                                </button>
                              )
                            )}
                            {row.itemStatus === 'purchased' && (
                              <button
                                type="button"
                                onClick={() => openReceiptConfirmationModal(row)}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                              >
                                تایید دریافت پرسنل
                              </button>
                            )}
                            {row.itemStatus === 'received' && (
                              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                                ✓ تحویل {toPersianDigits(row.receivedQty ?? row.qtyProposed)} ({row.receivedBy})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: UNPURCHASED BACKLOG FROM PRIOR REQUESTS ==================== */}
      {activeTab === 'backlog' && (
        <div className="space-y-5">
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <ArrowRightLeft className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                <span>اقلام خریداری‌نشده و جامانده از لیست‌های درخواست قبلی</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                کالاهایی که در سفارش‌های قبلی هنوز خریداری نشده‌اند اینجا گردآوری می‌شوند تا مسئول خرید آن‌ها را رصد کند یا با یک کلیک به لیست سفارش هفته جدید منتقل نماید.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex bg-slate-200/70 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setBacklogScope('previous');
                    setSelectedBacklogKeys({});
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                    backlogScope === 'previous'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  لیست‌های قبلی ({toPersianDigits(previousBacklogRows.length)})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBacklogScope('allPending');
                    setSelectedBacklogKeys({});
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                    backlogScope === 'allPending'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  همه در انتظار خرید ({toPersianDigits(allPendingRows.length)})
                </button>
              </div>

              {displayedBacklogRows.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleTransferBacklogToNewOrder(
                      selectedBacklogList.length > 0 ? selectedBacklogList : displayedBacklogRows
                    )
                  }
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-sm whitespace-nowrap"
                >
                  <ArrowRightLeft className="h-4 w-4 shrink-0" />
                  <span>
                    {selectedBacklogList.length > 0
                      ? `انتقال ${toPersianDigits(selectedBacklogList.length)} قلم انتخابی به سفارش جدید`
                      : `انتقال همه (${toPersianDigits(displayedBacklogRows.length)} قلم) به سفارش هفته جدید`}
                  </span>
                </button>
              )}
            </div>
          </div>

          {displayedBacklogRows.length === 0 ? (
            <div className="py-14 px-4 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
              <CheckCircle className="h-10 w-10 mx-auto text-emerald-500" />
              <div className="text-sm font-black text-slate-800 dark:text-slate-200">
                {backlogScope === 'previous'
                  ? 'هیچ قلم خریداری‌نشده‌ای از لیست‌های درخواست قبلی باقی نمانده است'
                  : 'تمامی اقلام سفارش‌های ثبت‌شده خریداری یا تحویل شده‌اند'}
              </div>
              {backlogScope === 'previous' && allPendingRows.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {toPersianDigits(allPendingRows.length)} قلم در انتظار خرید در جدیدترین سفارش هفته جاری وجود دارد که با انتخاب گزینه «همه در انتظار خرید» قابل مشاهده و انتقال است.
                </p>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 overflow-x-auto">
              <table className="w-full text-right border-collapse min-w-[820px]">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 text-[11px] font-extrabold border-b border-slate-200 dark:border-slate-800">
                    <th className="p-3 text-center w-[5%]">
                      <input
                        type="checkbox"
                        checked={allDisplayedBacklogSelected}
                        onChange={toggleAllBacklog}
                        className="h-4 w-4 rounded cursor-pointer accent-rose-600"
                        aria-label="انتخاب همه اقلام جامانده"
                      />
                    </th>
                    <th className="p-3 w-[18%]">سفارش مبدا / تاریخ</th>
                    <th className="p-3 w-[20%]">نام کالا</th>
                    <th className="p-3 w-[17%]">تامین‌کننده</th>
                    <th className="p-3 text-center w-[13%]">بسته‌بندی و وزن</th>
                    <th className="p-3 text-center w-[10%]">مقدار سفارش</th>
                    <th className="p-3 text-left w-[10%]">آخرین قیمت</th>
                    <th className="p-3 text-center w-[12%]">اقدام سریع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {displayedBacklogRows.map(row => {
                    const rowKey = `${row.orderId}::${row.lineId}`;
                    const checked = !!selectedBacklogKeys[rowKey];
                    return (
                      <tr
                        key={rowKey}
                        className={`transition-colors ${
                          checked ? 'bg-rose-50/60 dark:bg-rose-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedBacklogKeys(prev => ({
                                ...prev,
                                [rowKey]: !prev[rowKey]
                              }))
                            }
                            className="h-4 w-4 rounded cursor-pointer accent-rose-600"
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900 dark:text-white text-[11.5px]">{row.orderTitle}</div>
                          <div className="text-[10.5px] font-mono text-amber-700 dark:text-amber-400 font-bold mt-0.5">
                            {toPersianDigits(row.orderDate)}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-black text-slate-900 dark:text-white">{row.name}</div>
                          <div className="text-[10.5px] text-slate-500 font-mono">{row.code}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{row.supplierName}</div>
                          {row.supplierPhone !== 'ثبت نشده' && (
                            <div className="text-[10.5px] font-mono text-slate-500">{toPersianDigits(row.supplierPhone)}</div>
                          )}
                        </td>
                        <td className="p-3 text-center text-[11px] text-slate-700 dark:text-slate-300">
                          {toPersianDigits(row.qtyPerPackage)} {row.packageType}
                          {row.weightPerPackage > 0 && (
                            <span className="block font-mono text-[10px] text-slate-500">
                              {toPersianDigits(row.weightPerPackage)} kg
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono font-black text-slate-900 dark:text-white">
                          {toPersianDigits(row.qtyProposed)} <span className="font-sans text-[10.5px] text-slate-500">{row.unit}</span>
                        </td>
                        <td className="p-3 text-left font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {toPersianDigits(formatWithCommas(row.lastPurchasePrice))}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleTransferBacklogToNewOrder([row])}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-800 dark:text-slate-200 hover:text-white text-[11px] font-bold cursor-pointer whitespace-nowrap transition-colors"
                          >
                            انتقال به جدید
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 4: ARCHIVE & MANAGEMENT OF WEEKLY ORDERS ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
              فهرست درخواست‌های سفارش ثبت‌شده (امکان ویرایش کامل، چاپ حواله و حذف)
            </span>
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                type="text"
                placeholder="جستجوی عنوان سفارش، کالا یا تامین‌کننده..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                className="w-full pr-10 pl-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>

          {searchedHistory.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl text-slate-500 text-xs">
              هیچ درخواست سفارشی در این دوره ثبت نشده است.
            </div>
          ) : (
            <div className="space-y-4">
              {searchedHistory.map(order => {
                const lines = order.items || [];
                const activeState = orderActiveMap[order.id] || resolveOrderActiveState(order, latestOrderId, todayJalali);
                const pendingCnt = lines.filter(i => resolveLineStatus(i) === 'pending').length;
                const purchasedCnt = lines.filter(i => resolveLineStatus(i) === 'purchased').length;
                const receivedCnt = lines.filter(i => resolveLineStatus(i) === 'received').length;
                const carriedCnt = lines.filter(i => resolveLineStatus(i) === 'carried_over').length;
                const activeCnt = Math.max(1, lines.length - carriedCnt);
                const completionPct = Math.round((receivedCnt / activeCnt) * 100);
                const involvedSupplierNames = Array.from(
                  new Set(
                    lines.map(it => {
                      const sid = it.supplierId || order.supplierId;
                      return sid && supplierMap[sid] ? supplierMap[sid].name : 'سفارش آزاد';
                    })
                  )
                );

                return (
                  <div
                    key={order.id}
                    className={`border rounded-2xl p-4 sm:p-5 space-y-4 ${
                      activeState.isActive
                        ? 'bg-slate-50 dark:bg-slate-950 border-emerald-300/70 dark:border-emerald-500/30'
                        : 'bg-slate-50/70 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">
                            {order.title || `سفارش تاریخ ${toPersianDigits(order.orderDate)}`}
                          </h4>
                          {activeState.isActive ? (
                            <span className="text-[10.5px] font-extrabold text-emerald-700 dark:text-emerald-400">
                              ● فعال
                            </span>
                          ) : (
                            <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                              <Lock className="h-3 w-3 shrink-0" />
                              <span>
                                غیرفعال ({activeState.reason === 'deadline_passed' ? 'پایان مهلت تحویل' : 'ثبت درخواست هفتگی جدید'})
                              </span>
                            </span>
                          )}
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            · وضعیت: <strong className={order.status === 'تکمیل شده' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>{order.status}</strong>
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span>تاریخ ثبت: <strong className="font-mono text-slate-700 dark:text-slate-300">{toPersianDigits(order.orderDate)}</strong></span>
                          <span aria-hidden="true">·</span>
                          <span>مهلت تحویل: <strong className="font-mono text-slate-700 dark:text-slate-300">{toPersianDigits(order.expectedDeliveryDate)}</strong></span>
                          {order.requestedBy && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>درخواست‌کننده: <strong className="text-slate-700 dark:text-slate-300">{order.requestedBy}</strong></span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>تامین‌کنندگان: <strong className="text-slate-700 dark:text-slate-300">{involvedSupplierNames.join('، ')}</strong></span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setReportOrderFilter(order.id);
                            setReportStatusFilter(!activeState.isActive && purchasedCnt > 0 ? 'purchased' : 'all');
                            setActiveTab('report');
                          }}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold cursor-pointer"
                        >
                          {activeState.isActive ? 'پیگیری خرید و تحویل' : purchasedCnt > 0 ? 'تایید تحویل اقلام خریداری‌شده' : 'مشاهده گزارش'}
                        </button>
                        {activeState.isActive ? (
                          <button
                            type="button"
                            onClick={() => handleStartEditOrder(order)}
                            className="px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-300 dark:border-sky-500/30 text-sky-800 dark:text-sky-300 hover:bg-sky-600 hover:text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>ویرایش</span>
                          </button>
                        ) : (
                          <span
                            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-[11px] font-bold flex items-center gap-1"
                            title="سفارش غیرفعال فقط‌خواندنی است"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            <span>فقط‌خواندنی</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => printOrderProposalSheet(order)}
                          className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>چاپ حواله</span>
                        </button>
                        {activeState.isActive && (
                          <button
                            type="button"
                            onClick={() => setDeleteTargetOrder(order)}
                            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-600 hover:text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Summary Bar */}
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 gap-2">
                        <div className="flex flex-wrap items-center gap-3 font-bold">
                          <span className="text-emerald-700 dark:text-emerald-400">دریافت‌شده: {toPersianDigits(receivedCnt)}</span>
                          <span className="text-sky-700 dark:text-sky-400">خریداری‌شده: {toPersianDigits(purchasedCnt)}</span>
                          <span className="text-amber-700 dark:text-amber-400">در انتظار: {toPersianDigits(pendingCnt)}</span>
                          {carriedCnt > 0 && <span className="text-slate-500">منتقل‌شده: {toPersianDigits(carriedCnt)}</span>}
                        </div>
                        <span className="font-mono font-black text-slate-900 dark:text-white">
                          جمع کل: {toPersianDigits(formatWithCommas(order.totalBill))} ریال
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, completionPct)}%` }}
                        />
                      </div>
                    </div>

                    {/* Compact Items Table */}
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <table className="w-full text-right border-collapse min-w-[680px] text-[11.5px]">
                        <thead>
                          <tr className="bg-slate-100/80 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-[10.5px] font-bold border-b border-slate-200 dark:border-slate-800">
                            <th className="p-2.5">کالا</th>
                            <th className="p-2.5">تامین‌کننده</th>
                            <th className="p-2.5 text-center">بسته‌بندی / وزن</th>
                            <th className="p-2.5 text-center">میزان سفارش</th>
                            <th className="p-2.5 text-left">جمع ردیف</th>
                            <th className="p-2.5 text-center">وضعیت و تحویل</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {lines.map((it, idx) => {
                            const isProduct = !!it.productId;
                            const refObj = isProduct ? productMap[it.productId!] : rawItemMap[it.rawMaterialId || ''];
                            const sup = supplierMap[it.supplierId || order.supplierId || ''];
                            const st = resolveLineStatus(it);
                            return (
                              <tr key={it.lineId || idx}>
                                <td className="p-2.5 font-bold text-slate-900 dark:text-white">
                                  {refObj?.name || 'کالای نامشخص'}
                                </td>
                                <td className="p-2.5 text-slate-700 dark:text-slate-300">
                                  {sup?.name || 'سفارش آزاد'}
                                </td>
                                <td className="p-2.5 text-center text-slate-600 dark:text-slate-400">
                                  {toPersianDigits(refObj?.qtyPerPackage || 1)} {refObj?.packageType || 'کارتن'}
                                  {(refObj?.weightPerPackage || 0) > 0 ? ` · ${toPersianDigits(refObj?.weightPerPackage)} kg` : ''}
                                </td>
                                <td className="p-2.5 text-center font-mono font-bold text-slate-900 dark:text-white">
                                  {toPersianDigits(it.qtyProposed)} {refObj?.unit || ''}
                                </td>
                                <td className="p-2.5 text-left font-mono font-bold text-slate-800 dark:text-slate-200">
                                  {toPersianDigits(formatWithCommas(it.totalEstimatedCost))} ریال
                                </td>
                                <td className="p-2.5 text-center font-bold">
                                  {st === 'received' && (
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      تحویل {toPersianDigits(it.receivedQty ?? it.qtyProposed)} ({it.receivedBy || '-'})
                                    </span>
                                  )}
                                  {st === 'purchased' && (
                                    <span className="text-sky-700 dark:text-sky-400">خریداری شده</span>
                                  )}
                                  {st === 'pending' && (
                                    <span className="text-amber-700 dark:text-amber-400">در انتظار خرید</span>
                                  )}
                                  {st === 'carried_over' && (
                                    <span className="text-slate-500">منتقل‌شده به سفارش جدید</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {order.notes && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5">
                        <strong className="text-slate-800 dark:text-slate-200">توضیحات:</strong> {order.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== MODAL 1: STAFF RECEIPT VERIFICATION ==================== */}
      {receiptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 text-right"
            dir="rtl"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <UserCheck className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
                  <span>تایید دریافت کالا توسط پرسنل</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {receiptModal.itemName} · {receiptModal.supplierName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">مقدار درخواستی سفارش:</span>
              <strong className="font-mono font-black text-slate-900 dark:text-white">
                {toPersianDigits(receiptModal.qtyProposed)} {receiptModal.unit}
              </strong>
            </div>

            <form onSubmit={handleConfirmReceiptSubmit} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  مقدار واقعی تحویل‌گرفته‌شده ({receiptModal.unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min={0.01}
                  required
                  onFocus={handleFocus}
                  value={receiptModal.receivedQty}
                  onChange={e => setReceiptModal({ ...receiptModal, receivedQty: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono font-black text-center text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
                {(() => {
                  const diff = parseNumber(receiptModal.receivedQty) - receiptModal.qtyProposed;
                  if (diff === 0) {
                    return (
                      <div className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                        ✓ تطابق کامل با مقدار سفارش داده‌شده
                      </div>
                    );
                  }
                  if (diff < 0) {
                    return (
                      <div className="text-[10.5px] font-bold text-rose-700 dark:text-rose-400 mt-1">
                        کسری تحویل: {toPersianDigits(Math.abs(Math.round(diff * 100) / 100))} {receiptModal.unit} کمتر از سفارش
                      </div>
                    );
                  }
                  return (
                    <div className="text-[10.5px] font-bold text-amber-700 dark:text-amber-400 mt-1">
                      تحویل مازاد: {toPersianDigits(Math.round(diff * 100) / 100)} {receiptModal.unit} بیشتر از سفارش
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  نام تحویل‌گیرنده (پرسنل انبار / کارگاه) *
                </label>
                <input
                  type="text"
                  required
                  list="procurement-personnel-list"
                  value={receiptModal.receivedBy}
                  onChange={e => setReceiptModal({ ...receiptModal, receivedBy: e.target.value })}
                  placeholder="نام و نام خانوادگی تحویل‌گیرنده..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <ShamsiDatePicker
                  id="receipt-date-picker"
                  label="تاریخ تحویل"
                  value={receiptModal.receivedAt}
                  onChange={val => setReceiptModal({ ...receiptModal, receivedAt: val })}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  توضیحات تحویل / علت مغایرت (اختیاری)
                </label>
                <textarea
                  rows={2}
                  value={receiptModal.receiptNotes}
                  onChange={e => setReceiptModal({ ...receiptModal, receiptNotes: e.target.value })}
                  placeholder="مثال: یک کارتن ناقص تحویل شد یا کیفیت تایید گردید..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                {receiptModal.alreadyReceived && receiptModal.isOrderActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleRevertItemToPending(receiptModal.orderId, receiptModal.itemIndex);
                      setReceiptModal(null);
                    }}
                    className="px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer"
                  >
                    لغو تایید تحویل
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReceiptModal(null)}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    انصراف
                  </button>
                )}

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <CheckCircle className="h-4 w-4" />
                  <span>ثبت تایید دریافت</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: DELETE ORDER CONFIRMATION ==================== */}
      {deleteTargetOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 text-right"
            dir="rtl"
          >
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h3 className="text-sm font-black text-slate-900 dark:text-white">حذف درخواست سفارش</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              آیا از حذف کامل سفارش <strong>«{deleteTargetOrder.title || deleteTargetOrder.id}»</strong> شامل{' '}
              <strong>{toPersianDigits((deleteTargetOrder.items || []).length)} ردیف کالا</strong> اطمینان دارید؟ این عملیات قابل بازگشت نیست.
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
                تایید و حذف سفارش
              </button>
            </div>
          </div>
        </div>
      )}
      <CopyFromPeriodModal
        open={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        targetPeriodId={activePeriodId}
        section="procurementOrders"
        onUpdateDb={onUpdateDb}
      />
    </div>
  );
}
