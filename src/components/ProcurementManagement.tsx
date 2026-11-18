/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Supplier, Item, Product, ProcurementOrder, ProcurementOrderItem } from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
 } from '../utils/persianUtils';
import { 
  FileText, Search, Plus, Trash2, Printer, CheckCircle, HelpCircle, 
  Phone, MapPin, CreditCard, Calendar, Truck, ArrowLeft, ArrowRight,
  Download, Check, X, Filter, AlertTriangle, ShoppingCart, Layers, Info
} from 'lucide-react';

interface ProcurementManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

export default function ProcurementManagement({ db, onUpdateDb, activePeriodId }: ProcurementManagementProps) {
  
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('۱۴۰۵/۰۲/۰۱');
  const [notes, setNotes] = useState('');

  // Items currently being built in the draft procurement basket
  const [basketItems, setBasketItems] = useState<ProcurementOrderItem[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'history' | 'report'>('create');
  
  // Search query for draft item checklist
  const [checklistSearch, setChecklistSearch] = useState('');
  // Selection tab within order creation: 'items' (Raw Materials) vs 'products' (Purchasable products)
  const [creationSelectTab, setCreationSelectTab] = useState<'items' | 'products'>('items');

  // Search query for orders history search
  const [searchTerm, setSearchTerm] = useState('');

  // Filtering option for the comprehensive report table: 'all' | 'delivered' | 'unpurchased'
  const [reportFilter, setReportFilter] = useState<'all' | 'delivered' | 'unpurchased'>('all');
  const [reportSearch, setReportSearch] = useState('');

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // Datasets scoped to Period
  const activeSuppliers = useMemo(() => {
    return db.suppliers.filter(s => s.periodId === activePeriodId && s.isActive);
  }, [db.suppliers, activePeriodId]);

  const rawItems = useMemo(() => {
    return db.items.filter(i => i.periodId === activePeriodId);
  }, [db.items, activePeriodId]);

  // Master lookup maps
  const supplierMap = useMemo(() => {
    const map: Record<string, Supplier> = {};
    db.suppliers.forEach(s => { map[s.id] = s; });
    return map;
  }, [db.suppliers]);

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
    db.products.forEach(p => {
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
  }, [db.products]);

  const selectedSupplierObj = useMemo(() => {
    return activeSuppliers.find(s => s.id === selectedSupplierId);
  }, [activeSuppliers, selectedSupplierId]);

  // Filter products classified as purchased / bought
  // Products whose category includes "خرید" / "خریداری" or if there's no matching category, display all as fallback
  const purchasedProducts = useMemo(() => {
    const categoriesWithPurchaseKeyword = db.productCategories.filter(cat => 
      cat.name.includes('خرید') || cat.name.includes('خریداری') || cat.name.includes('پیمانکاری') || cat.name.includes('آماده')
    );
    const categoryIds = categoriesWithPurchaseKeyword.map(c => c.id);

    const filtered = db.products.filter(p => p.periodId === activePeriodId && (categoryIds.includes(p.categoryId) || p.code.toLowerCase().includes('purch') || p.categoryId === 'purchased'));
    
    // If targeted category matches are empty, show all products in active period as fallback (extremely robust)
    if (filtered.length === 0) {
      return db.products.filter(p => p.periodId === activePeriodId);
    }
    return filtered;
  }, [db.products, db.productCategories, activePeriodId]);

  // Identify which suppliers can supply the items currently in the basket
  const suggestedSupplierIds = useMemo(() => {
    const selectedItemIds = basketItems.map(b => b.rawMaterialId).filter(Boolean) as string[];
    if (selectedItemIds.length === 0) return new Set<string>();
    
    const matches = new Set<string>();
    db.suppliers.forEach(s => {
      if (s.periodId === activePeriodId && s.isActive && s.suppliedItemIds) {
        const hasMatch = s.suppliedItemIds.some(itemId => selectedItemIds.includes(itemId));
        if (hasMatch) {
          matches.add(s.id);
        }
      }
    });
    return matches;
  }, [basketItems, db.suppliers, activePeriodId]);

  // List all raw material items so that the user can select items first, regardless of supplier selection
  const suppliedItemsChecklist = useMemo(() => {
    return rawItems.filter(i => 
      i.isActive && 
      (checklistSearch ? matchPersianString(i.name, checklistSearch) || matchPersianString(i.code, checklistSearch) : true)
    );
  }, [rawItems, checklistSearch]);

  // Filter purchased products in the creator checklist by search query
  const searchedPurchasedProducts = useMemo(() => {
    return purchasedProducts.filter(p => 
      checklistSearch ? matchPersianString(p.name, checklistSearch) || matchPersianString(p.code, checklistSearch) : true
    );
  }, [purchasedProducts, checklistSearch]);

  // Order List History of Active Period
  const ordersHistory = useMemo(() => {
    return db.procurementOrders.filter(o => o.periodId === activePeriodId);
  }, [db.procurementOrders, activePeriodId]);

  const searchedHistory = useMemo(() => {
    if (!searchTerm) return ordersHistory;
    return ordersHistory.filter(o => {
      const sup = o.supplierId ? supplierMap[o.supplierId] : undefined;
      const supName = sup ? sup.name : 'تامین‌کننده آزاد / نامشخص';
      return matchPersianString(supName, searchTerm) || (o.notes && matchPersianString(o.notes, searchTerm)) || (o.id && o.id.includes(searchTerm));
    });
  }, [ordersHistory, searchTerm, supplierMap]);

  // Helper mapping current draft/basket items to resolve full names, units and categories
  const basketItemDetails = useMemo(() => {
    return basketItems.map(basket => {
      const isProduct = !!basket.productId;
      const refObj = isProduct ? productMap[basket.productId!] : rawItemMap[basket.rawMaterialId!];
      
      return {
        basket,
        isProduct,
        id: isProduct ? basket.productId! : basket.rawMaterialId!,
        name: refObj?.name || 'کالای نامشخص',
        code: refObj?.code || 'C-?',
        unit: refObj?.unit || 'واحد',
        qtyPerPackage: refObj?.qtyPerPackage || 1,
        weightPerPackage: refObj?.weightPerPackage || 1,
        packageType: refObj?.packageType || 'کارتن',
        price: isProduct ? (refObj as Product)?.salePrice || 1000 : (refObj as Item)?.price || 1000
      };
    }).filter(x => x !== null);
  }, [basketItems, productMap, rawItemMap]);

  // Toggle item/product in draft basket
  const toggleBasketItemEx = (id: string, isProduct: boolean, defaultPrice: number) => {
    const exists = isProduct 
      ? basketItems.some(x => x.productId === id)
      : basketItems.some(x => x.rawMaterialId === id);

    if (exists) {
      setBasketItems(basketItems.filter(x => isProduct ? x.productId !== id : x.rawMaterialId !== id));
    } else {
      setBasketItems([
        ...basketItems,
        {
          rawMaterialId: isProduct ? undefined : id,
          productId: isProduct ? id : undefined,
          qtyProposed: 1,
          estimatedCostPerUnit: defaultPrice || 0,
          totalEstimatedCost: defaultPrice || 0,
          isReceived: false
        }
      ]);
    }
  };

  const updateBasketQty = (id: string, qty: number, isProduct: boolean) => {
    setBasketItems(basketItems.map(x => {
      const match = isProduct ? x.productId === id : x.rawMaterialId === id;
      if (match) {
        return {
          ...x,
          qtyProposed: qty,
          totalEstimatedCost: qty * x.estimatedCostPerUnit
        };
      }
      return x;
    }));
  };

  const updateBasketCost = (id: string, unitCost: number, isProduct: boolean) => {
    setBasketItems(basketItems.map(x => {
      const match = isProduct ? x.productId === id : x.rawMaterialId === id;
      if (match) {
        return {
          ...x,
          estimatedCostPerUnit: unitCost,
          totalEstimatedCost: x.qtyProposed * unitCost
        };
      }
      return x;
    }));
  };

  const totalProposalBill = useMemo(() => {
    return basketItems.reduce((acc, current) => acc + current.totalEstimatedCost, 0);
  }, [basketItems]);


  // Submit Purchase Order Proposal
  const handleSaveProcurementProposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (basketItems.length === 0) {
      alert('سبد سفارش تهی می‌باشد. حداقل یک کالا یا محصول را علامت بزنید.');
      return;
    }

    // Dynamic jalali date estimation based on active period index
    const monthPart = activePeriodId.split('-')[1] || '۰۲';
    const dynamicOrderDate = `۱۴۰۵/${monthPart}/۱۵`;

    const nextOrder: ProcurementOrder = {
      id: `order-${Date.now()}`,
      periodId: activePeriodId,
      supplierId: selectedSupplierId || undefined,
      orderDate: dynamicOrderDate,
      expectedDeliveryDate: expectedDate.trim() || `۱۴۰۵/${monthPart}/۳۰`,
      items: basketItems.map(b => ({ ...b, isReceived: false })), // default to not-received
      totalBill: totalProposalBill,
      status: 'ثبت شده',
      notes: notes.trim()
    };

    onUpdateDb({
      ...db,
      procurementOrders: [...db.procurementOrders, nextOrder]
    });

    // Reset Form & Basket
    setBasketItems([]);
    setNotes('');
    alert('سفارش خرید کالا با موفقیت صادر و ثبت گردید. هم‌اکنون در بخش گزارشات و تایید تحویل قابل پیگیری است.');
    setActiveTab('report');
  };

  const deleteProposalOrder = (id: string) => {
    if (confirm('آیا مایل به حذف کل این سفارش ثبت شده هستید؟')) {
      onUpdateDb({
        ...db,
        procurementOrders: db.procurementOrders.filter(o => o.id !== id)
      });
    }
  };


  // ==================== COMPREHENSIVE FLATTENED PURCHASE REPORT VIEW ====================
  const allOrderedItemsReport = useMemo(() => {
    const reportList: Array<{
      orderId: string;
      orderDate: string;
      expectedDeliveryDate: string;
      status: string;
      supplierId: string;
      supplierName: string;
      supplierPhone: string;
      supplierAddress: string;
      itemIndex: number;
      
      // item properties
      itemId: string;
      isProduct: boolean;
      name: string;
      code: string;
      unit: string;
      qtyProposed: number;
      estimatedCostPerUnit: number;
      totalEstimatedCost: number;
      isReceived: boolean;
      qtyPerPackage: number;
      weightPerPackage: number;
      packageType: string;
    }> = [];

    ordersHistory.forEach(order => {
      const sup = supplierMap[order.supplierId] || { name: 'تامین کننده نامشخص', phone: 'ثبت نشده', address: 'ثبت نشده' };
      
      order.items.forEach((it, idx) => {
        const isProduct = !!it.productId;
        const refObj = isProduct ? productMap[it.productId!] : rawItemMap[it.rawMaterialId!];
        
        reportList.push({
          orderId: order.id,
          orderDate: order.orderDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          status: order.status,
          supplierId: order.supplierId,
          supplierName: sup.name,
          supplierPhone: sup.phone,
          supplierAddress: sup.address,
          itemIndex: idx,
          
          itemId: isProduct ? it.productId! : it.rawMaterialId!,
          isProduct,
          name: refObj?.name || 'کالای نامشخص',
          code: refObj?.code || 'C-?',
          unit: refObj?.unit || 'واحد',
          qtyProposed: it.qtyProposed,
          estimatedCostPerUnit: it.estimatedCostPerUnit,
          totalEstimatedCost: it.totalEstimatedCost,
          isReceived: !!it.isReceived,
          qtyPerPackage: refObj?.qtyPerPackage || 1,
          weightPerPackage: refObj?.weightPerPackage || 1,
          packageType: refObj?.packageType || 'کارتن'
        });
      });
    });

    return reportList;
  }, [ordersHistory, supplierMap, productMap, rawItemMap]);

  // Compute stats for widgets
  const reportStats = useMemo(() => {
    const totalLines = allOrderedItemsReport.length;
    const deliveredLines = allOrderedItemsReport.filter(x => x.isReceived).length;
    const pendingLines = totalLines - deliveredLines;
    const totalOrderedCost = allOrderedItemsReport.reduce((sum, x) => sum + x.totalEstimatedCost, 0);
    const unpurchasedCost = allOrderedItemsReport.filter(x => !x.isReceived).reduce((sum, x) => sum + x.totalEstimatedCost, 0);

    return { totalLines, deliveredLines, pendingLines, totalOrderedCost, unpurchasedCost };
  }, [allOrderedItemsReport]);

  // Filtered and searched reports list
  const filteredAndSearchedReport = useMemo(() => {
    return allOrderedItemsReport.filter(row => {
      // 1. Status Filter
      if (reportFilter === 'delivered' && !row.isReceived) return false;
      if (reportFilter === 'unpurchased' && row.isReceived) return false;

      // 2. Text Search Match
      if (!reportSearch) return true;
      return (
        matchPersianString(row.name, reportSearch) ||
        matchPersianString(row.code, reportSearch) ||
        matchPersianString(row.supplierName, reportSearch) ||
        matchPersianString(row.orderId, reportSearch)
      );
    });
  }, [allOrderedItemsReport, reportFilter, reportSearch]);


  // Toggle item delivery confirmation status directly in procurementOrders db object
  const handleToggleReceivedStatus = (orderId: string, itemIdx: number) => {
    const updatedOrders = db.procurementOrders.map(o => {
      if (o.id === orderId) {
        const updatedItems = o.items.map((it, idx) => {
          if (idx === itemIdx) {
            return {
              ...it,
              isReceived: !it.isReceived
            };
          }
          return it;
        });
        
        // Auto determine order-level status based on completion state
        const allDelivered = updatedItems.every(x => x.isReceived);
        const anyDelivered = updatedItems.some(x => x.isReceived);
        let statusText = 'ثبت شده';
        if (allDelivered) statusText = 'تحویل شده';
        else if (anyDelivered) statusText = 'تحویل جزئی';

        return {
          ...o,
          items: updatedItems,
          status: statusText
        };
      }
      return o;
    });

    onUpdateDb({
      ...db,
      procurementOrders: updatedOrders
    });
  };


  // CSV Export for the Procurement Reports
  const exportOrdersReportCSV = (onlyUnpurchased: boolean) => {
    let listToExport = allOrderedItemsReport;
    if (onlyUnpurchased) {
      listToExport = allOrderedItemsReport.filter(x => !x.isReceived);
    }

    const headers = [
      'شناسه پیش فاکتور سفارش',
      'کد کالا',
      'نوع کالا',
      'شرح کالا / محصول سفارش داده شده',
      'تامین کننده کالا',
      'شماره تماس تامین کننده',
      'آدرس فیزیکی تامین کننده',
      'مقدار سفارش',
      'واحد سنجش کالا',
      'تعداد در بسته',
      'وزن هر بسته (کیلوگرم)',
      'قیمت توافقی واحد (ریال)',
      'جمع کل هزینه برآوردی (ریال)',
      'تاریخ لایحه خرید',
      'مهلت احتمالی تحویل',
      'وضعیت نهایی تحویل به کارگاه'
    ];

    const rows = listToExport.map(x => [
      x.orderId,
      x.code,
      x.isProduct ? 'محصول نهایی خریداری' : 'ماده خام اولیه انبار',
      x.name,
      x.supplierName,
      x.supplierPhone,
      x.supplierAddress,
      x.qtyProposed.toString(),
      x.unit,
      x.qtyPerPackage.toString(),
      x.weightPerPackage.toString(),
      x.estimatedCostPerUnit.toString(),
      x.totalEstimatedCost.toString(),
      x.orderDate,
      x.expectedDeliveryDate,
      x.isReceived ? 'تحویل شده (خریداری شده)' : 'خریداری نشده (در انتظار)'
    ]);

    const titlePrefix = onlyUnpurchased 
      ? 'Gatan_Unpurchased_Kala_Report' 
      : 'Gatan_Comprehensive_Procurement_All_Items';

    downloadCSV(titlePrefix, headers, rows);
  };


  // Printable sheet render
  const printOrderProposalSheet = (order: ProcurementOrder) => {
    const supplier = (order.supplierId ? supplierMap[order.supplierId] : undefined) || {
      id: 'none',
      name: 'بدون انتخاب تامین‌کننده (سفارش آزاد)',
      phone: 'ثبت نشده',
      address: 'تامین‌کننده پس از استعلام نهایی یا توسط واحد خرید تعیین خواهد شد.',
      periodId: activePeriodId,
      code: 'OPEN'
    };

    const bodyHtml = `
      <div style="font-family: 'Inter', sans-serif; direction: rtl; text-align: right; padding: 25px; border: 2px solid #e2e8f0; border-radius: 15px; max-width: 800px; margin: auto; background-color: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #b91c1c; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            <h1 style="margin: 0; font-size: 19px; color: #1e293b; font-weight: 800;">حواله سفارش و استعلام خرید کالا</h1>
            <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b;">سامانه جامع و یکپارچه انبارداری و تدارکاتی گاتان</p>
          </div>
          <div style="text-align: left; font-size: 11px; color: #475569; font-family: monospace;">
            <div>شماره ارجاع: ${order.id}</div>
            <div>تاریخ تنظیم پی‌نویس: ${order.orderDate}</div>
            <div>مهلت احتمالی تحویل: ${order.expectedDeliveryDate}</div>
          </div>
        </div>

        <!-- Supplier Info Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #cbd5e1; font-size: 11px;">
          <tr style="background-color: #f8fafc; font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #cbd5e1;" colspan="2">مشخصات تامین‌کننده کالا / مخاطب استعلام</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #cbd5e1; width: 50%;">نام شرکت/فرد تامین‌کننده: <strong>${supplier.name}</strong></td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">شماره تلفن هماهنگی: <strong>${supplier.phone}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #cbd5e1;" colspan="2">آدرس فیزیکی محل تحویل/ارسال: ${supplier.address}</td>
          </tr>
        </table>

        <!-- Items Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 11.5px; text-align: right;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 12%;">کد سیستم</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1;">شرح آیتم درخواستی مسئول خرید</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 15%;">میزان خرید</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: left; width: 18%;">بهای واحد خرید (ریال)</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: left; width: 20%;">جمع برآوردی سفارش (ریال)</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map(it => {
              const isProduct = !!it.productId;
              const refObj = isProduct ? productMap[it.productId!] : rawItemMap[it.rawMaterialId!];
              const item = refObj || { name: 'نامشخص', code: 'C-?', unit: 'واحد' };
              const typeLabel = isProduct ? 'محصول آماده' : 'مواد اولیه خام';
              
              return `
                <tr>
                  <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${item.code}</td>
                  <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold;">
                    <span style="font-size: 9px; line-height: 1; padding: 2px 4px; background-color: ${isProduct ? '#e0e7ff' : '#fef3c7'}; color: ${isProduct ? '#3730a3' : '#92400e'}; border-radius: 4px; margin-left: 6px; display: inline-block;">${typeLabel}</span>
                    <span style="color: #020617; font-weight: bold;">${item.name}</span>
                  </td>
                  <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${it.qtyProposed} ${item.unit}</td>
                  <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: left;">${it.estimatedCostPerUnit.toLocaleString('fa-IR')}</td>
                  <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: left; font-weight: bold;">${it.totalEstimatedCost.toLocaleString('fa-IR')}</td>
                </tr>
              `;
            }).join('')}
            <tr style="background-color: #f8fafc; font-weight: bold; font-size: 12.5px;">
              <td style="padding: 12px; border: 1px solid #cbd5e1; text-align: left;" colspan="4">جمع مبالغ پیش‌فاکتور خرید کالا:</td>
              <td style="padding: 12px; border: 1px solid #cbd5e1; text-align: left; color: #b91c1c;">${order.totalBill.toLocaleString('fa-IR')} ریال</td>
            </tr>
          </tbody>
        </table>

        ${order.notes ? `<div style="font-size: 11px; background-color: #f8fafc; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 25px; line-height: 1.6;"><strong>توضیحات و ملاحظات تسویه:</strong> ${order.notes}</div>` : ''}

        <!-- Signatures place -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 35px; font-size: 11px; border: none;">
          <tr style="border: none;">
            <td style="text-align: right; width: 50%; border: none; padding-right: 15px;">
              <div>مسئول اداری / تدارکات کارگاه:</div>
              <div style="height: 50px;"></div>
              <div>مهر و امضا: ................................</div>
            </td>
            <td style="text-align: left; border: none; padding-left: 15px;">
              <div>تایید تحویل‌گیرنده خط تولید:</div>
              <div style="height: 50px;"></div>
              <div>امضا و اثر انگشت: .............................</div>
            </td>
          </tr>
        </table>
      </div>
    `;

    printElement(`پیش‌فاکتور_چاپ_تدارکات_گاتان_${order.id}`, bodyHtml);
  };

  const printComprehensiveReport = () => {
    const reportList = filteredAndSearchedReport;
    if (reportList.length === 0) {
      alert('گزارش خالی است و قابل چاپ نمی‌باشد.');
      return;
    }

    const currentFilterLabel = reportFilter === 'all' 
      ? 'همه اقلام سفارشات' 
      : reportFilter === 'delivered' 
        ? 'اقلام تحویل شده نهایی' 
        : 'اقلام خریداری نشده تدارکاتی (در انتظار تامین)';

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; padding: 25px; border: 2px solid #cbd5e1; border-radius: 15px; max-width: 1000px; margin: auto; background-color: #ffffff; color: #1e293b;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #e11d48; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            <h1 style="margin: 0; font-size: 19px; color: #0f172a; font-weight: 800;">گزارش جامع تدارکات، خرید و تایید تحویل کالا</h1>
            <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b; font-weight: bold;">سیستم تدارکاتی گاتان | فیلتر چاپ: ${currentFilterLabel}</p>
          </div>
          <div style="text-align: left; font-size: 11px; color: #475569; font-family: monospace; line-height: 1.5;">
            <div>تاریخ تنظیم: ${new Date().toLocaleDateString('fa-IR')}</div>
            <div>تعداد اقلام مشمول: ${reportList.length} ردیف کالا</div>
            <div>منطقه مالی خط تولید</div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: right; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f8fafc; font-weight: bold; border-top: 1px solid #94a3b8; border-bottom: 2px solid #94a3b8;">
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 12%;">کد / تاریخ</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; width: 28%;">شرح کالا / محصول</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; width: 22%;">تامین‌کننده</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 10%;">مقدار سفارش</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: left; width: 15%;">بهای تخمینی واحد (ریال)</th>
              <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 13%;">وضعیت تحویل مسئول خرید</th>
            </tr>
          </thead>
          <tbody>
            ${reportList.map(row => `
              <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                <td style="padding: 9px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace; font-weight: bold; color: #475569;">
                  #${row.orderId.slice(-6)}
                  <div style="font-size: 9px; color: #94a3b8; font-weight: normal; margin-top: 2px;">${row.orderDate}</div>
                </td>
                <td style="padding: 9px; border: 1px solid #cbd5e1;">
                  <strong style="color: #0f172a; font-size: 11.5px;">${row.name}</strong>
                  <div style="font-size: 9px; color: #64748b; margin-top: 3px;">
                    کد سیستمی: ${row.code} | 
                    <span style="color: ${row.isProduct ? '#4f46e5' : '#b45309'}; font-weight: bold;">
                      ${row.isProduct ? 'محصول آماده خریداری' : 'مواد اولیه خام انبار'}
                    </span>
                  </div>
                </td>
                <td style="padding: 9px; border: 1px solid #cbd5e1;">
                  <strong style="color: #1e293b;">${row.supplierName}</strong>
                  <div style="font-size: 9px; color: #64748b; margin-top: 2px;">تلفن: ${row.supplierPhone}</div>
                </td>
                <td style="padding: 9px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; font-size: 11.5px;">
                  ${row.qtyProposed.toLocaleString('fa-IR')} ${row.unit}
                  <div style="font-size: 9.5px; color: #64748b; font-weight: normal; margin-top: 2px;">
                    ${row.qtyPerPackage} ${row.packageType} ${row.unit === 'عددی' || row.unit === 'عدد' ? '' : `(${row.weightPerPackage}kg)`}
                  </div>
                </td>
                <td style="padding: 9px; border: 1px solid #cbd5e1; text-align: left; font-family: monospace;">
                  <div style="font-weight: bold;">${row.estimatedCostPerUnit.toLocaleString('fa-IR')}</div>
                  <div style="font-size: 9px; color: #94a3b8; font-weight: normal; margin-top: 1px;">کل: ${row.totalEstimatedCost.toLocaleString('fa-IR')}</div>
                </td>
                <td style="padding: 9px; border: 1px solid #cbd5e1; text-align: center;">
                  <div style="display: inline-block; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 10px; ${
                    row.isReceived 
                      ? 'background-color: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;' 
                      : 'background-color: #fffbeb; color: #92400e; border: 1px solid #fde68a;'
                  }">
                    ${row.isReceived ? '✓ تحویل شده' : '✗ در انتظار خرید'}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Printable Summary calculations -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11.5px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
          <tr>
            <td style="padding: 12px; border-left: 1px solid #e2e8f0;">
              <span style="color: #64748b; block">مجموع کل ارزش سفارشات تدارکات:</span>
              <strong style="display: block; font-size: 14px; margin-top: 4px; color: #1e293b;">
                ${reportStats.totalOrderedCost.toLocaleString('fa-IR')} <span style="font-size: 10px;">ریال</span>
              </strong>
            </td>
            <td style="padding: 12px; margin-right: 15px;">
              <span style="color: #c2410c; block">ارزش اقلام معلق خریداری نشده:</span>
              <strong style="display: block; font-size: 14px; margin-top: 4px; color: #c2410c;">
                ${reportStats.unpurchasedCost.toLocaleString('fa-IR')} <span style="font-size: 10px;">ریال</span>
              </strong>
            </td>
            <td style="padding: 12px; font-size: 11px; text-align: left; vertical-align: middle; color: #475569;">
              <div>ردیف‌های تحویل نهایی: <strong style="color: #166534;">${reportStats.deliveredLines} از ${reportStats.totalLines}</strong></div>
              <div style="margin-top: 4px;">درصد تحقق تدارکات خط: <strong>${reportStats.totalLines > 0 ? Math.round((reportStats.deliveredLines / reportStats.totalLines) * 100) : 0}٪</strong></div>
            </td>
          </tr>
        </table>

        <!-- Signatures place -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 40px; font-size: 11px; border: none;">
          <tr style="border: none;">
            <td style="text-align: right; width: 33%; border: none; padding-right: 10px;">
              <div>مسئول اداری / تدارکاتی فاکتورها:</div>
              <div style="height: 45px;"></div>
              <div>مهر و امضا: ................................</div>
            </td>
            <td style="text-align: center; width: 34%; border: none;">
              <div>مسئول انبار / تحویل‌گیرنده کارگاه:</div>
              <div style="height: 45px;"></div>
              <div>امضا و اثر انگشت: .............................</div>
            </td>
            <td style="text-align: left; width: 33%; border: none; padding-left: 10px;">
              <div>تایید نهایی سوپروایزر انبارداری:</div>
              <div style="height: 45px;"></div>
              <div>مهر و تایید خط: .............................</div>
            </td>
          </tr>
        </table>

        <div style="text-align: center; margin-top: 35px; border-top: 1px dashed #cbd5e1; padding-top: 10px; font-size: 9.5px; color: #94a3b8;">
          این گزارش بر اساس آخرین واریزها، پیش‌فاکتورها و تاییدهای مستقیم سامانه گاتان در تاریخ فوق صادر گشته است.
        </div>
      </div>
    `;

    printElement('گزارش_جامع_تدارکات_گاتان', bodyHtml);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl min-h-[600px] shadow-2xl font-sans p-6 animate-fade-in text-right selection:bg-rose-500 selection:text-white" dir="rtl">
      
      {/* Dynamic Header */}
      <div className="flex flex-col border-b border-slate-800 pb-5 mb-6 gap-5">
        <div className="flex items-center gap-3">
          <div className="bg-rose-500/10 text-rose-400 p-2.5 rounded-2xl border border-rose-500/15">
            <ShoppingCart className="h-6 w-6 text-rose-500 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">
              سیستم هوشمند سفارش و تأمین کالا (سفارش کالا)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              صدور فاکتور و پیگیری فعال تحویل اقلام و کالاها (مواد اولیه یا محصول خریداری شده) با تعیین بهینه گام‌های تأمین کالا
            </p>
          </div>
        </div>

        {/* Tab Controls - Full Width and Grid-responsive to prevent horizontal scroll entirely */}
        <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-950 p-1.5 rounded-2xl border border-slate-850 w-full gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all text-center cursor-pointer ${
              activeTab === 'create' ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-lg shadow-rose-600/20' : 'bg-transparent text-slate-400 hover:text-white'
            }`}
          >
            صدور سفارش خرید جدید
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'report' ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-lg shadow-rose-600/20' : 'bg-transparent text-slate-400 hover:text-white'
            }`}
          >
            گزارش جامع و تایید تحویل
            {reportStats.pendingLines > 0 && (
              <span className="bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-bold">
                {reportStats.pendingLines} عدد تحویل‌نشده
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all text-center cursor-pointer ${
              activeTab === 'history' ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-lg shadow-rose-600/20' : 'bg-transparent text-slate-400 hover:text-white'
            }`}
          >
            تاریخچه فاکتورهای صادرشده ({ordersHistory.length})
          </button>
        </div>
      </div>


      {/* ==================== TAB 1: CREATE REQUISITION/ORDER ==================== */}
      {activeTab === 'create' && (
        <form onSubmit={handleSaveProcurementProposal} className="space-y-6">
          
          {/* Main order config layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* RIGHT COLUMN: Step 1 (Item & Product Selector Catalog) is always visible first */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4 shadow-xl">
                <h3 className="text-xs font-extrabold text-slate-100 border-b border-slate-850 pb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-5 w-5 text-rose-500" />
                    ۱. کاتالوگ و انتخاب اقلام درخواستی (مواد اولیه یا محصول)
                  </span>
                </h3>

                {/* Selector of Materials vs Product list */}
                <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setCreationSelectTab('items')}
                    className={`py-1.5 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${
                      creationSelectTab === 'items' ? 'bg-slate-850 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    مواد اولیه موجود ({suppliedItemsChecklist.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreationSelectTab('products')}
                    className={`py-1.5 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${
                      creationSelectTab === 'products' ? 'bg-slate-850 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    محصولات خریداری شده ({searchedPurchasedProducts.length})
                  </button>
                </div>

                {/* Search Field inside Catalog */}
                <div className="relative">
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-slate-500" />
                  </span>
                  <input
                    id="creation-catalog-search"
                    type="text"
                    placeholder="جستجوی نام یا کد کالا..."
                    className="w-full pl-3 pr-9 py-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-bold"
                    value={checklistSearch}
                    onChange={(e) => setChecklistSearch(e.target.value)}
                  />
                </div>

                {/* Selection checklists */}
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-900 pr-1 select-none font-medium text-xs space-y-1 scrollbar-thin">
                  
                  {creationSelectTab === 'items' && (
                    suppliedItemsChecklist.length === 0 ? (
                      <div className="text-xs text-slate-500 py-8 text-center bg-slate-950/40 border border-slate-850 rounded-2xl border-dashed">
                        ماده اولیه معتبری در این دوره یافت نشد.
                      </div>
                    ) : (
                      suppliedItemsChecklist.map(item => {
                        const isAdded = basketItems.some(x => x.rawMaterialId === item.id);
                        return (
                          <label key={item.id} className={`flex items-center justify-between py-2.5 cursor-pointer hover:bg-slate-900/40 px-2.5 rounded-xl border border-transparent hover:border-slate-800 transition-all ${isAdded ? 'bg-amber-500/10 border border-amber-500/25 text-amber-300' : 'text-slate-350'}`}>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="rounded border-slate-800 text-rose-500 focus:ring-rose-500 h-4 w-4 cursor-pointer bg-slate-950"
                                checked={isAdded}
                                onChange={() => toggleBasketItemEx(item.id, false, item.price)}
                              />
                              <div>
                                <span className="text-xs font-black text-slate-200 block">{item.name}</span>
                                <span className="text-[10px] text-slate-500 block pb-0.5">کد حسابداری: {item.accountId} | کد کالا: {item.code} | واحد: {item.unit}</span>
                              </div>
                            </div>
                            <span className="text-[10px] bg-slate-950 border border-slate-850 text-emerald-400 font-mono font-bold px-2.5 py-1 rounded-lg shadow-sm">
                              {formatWithCommas(item.price)} ریال
                            </span>
                          </label>
                        );
                      })
                    )
                  )}

                  {creationSelectTab === 'products' && (
                    searchedPurchasedProducts.length === 0 ? (
                      <div className="text-xs text-slate-500 py-8 text-center bg-slate-950/40 border border-slate-850 rounded-2xl border-dashed">
                        محصول خریداری‌شده معتبری یافت نشد.
                      </div>
                    ) : (
                      searchedPurchasedProducts.map(prod => {
                        const isAdded = basketItems.some(x => x.productId === prod.id);
                        return (
                          <label key={prod.id} className={`flex items-center justify-between py-2.5 cursor-pointer hover:bg-slate-900/40 px-2.5 rounded-xl border border-transparent hover:border-slate-800 transition-all ${isAdded ? 'bg-indigo-500/10 border border-indigo-500/25 text-indigo-300' : 'text-slate-350'}`}>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="rounded border-slate-800 text-rose-500 focus:ring-rose-500 h-4 w-4 cursor-pointer bg-slate-950"
                                checked={isAdded}
                                onChange={() => toggleBasketItemEx(prod.id, true, prod.salePrice || 1000)}
                              />
                              <div>
                                <span className="text-xs font-black text-slate-200 block">{prod.name}</span>
                                <span className="text-[10px] text-slate-500 block pb-0.5">کد حسابداری: {prod.accountId} | کد کالا: {prod.code} | واحد: {prod.unit}</span>
                              </div>
                            </div>
                            <span className="text-[10px] bg-slate-950 border border-slate-850 text-emerald-400 font-mono font-bold px-2.5 py-1 rounded-lg shadow-sm">
                              {formatWithCommas(prod.salePrice || 0)} ریال
                            </span>
                          </label>
                        );
                      })
                    )
                  )}

                </div>
              </div>
            </div>

            {/* LEFT COLUMN: Steps 2 & 3 (Supplier selection & Final basket specs) */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* STEP 2: Select Supplier */}
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4 shadow-xl">
                <h3 className="text-xs font-extrabold text-slate-100 border-b border-slate-850 pb-3 flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-rose-500 animate-pulse" />
                  ۲. انتخاب و تعیین تامین‌کننده سفارش
                </h3>
                
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="sec-order-supplier-select" className="text-[10px] font-bold text-slate-400 block">تامین‌کننده کالا/مواد اولیه‌ی هدف (اختیاری)</label>
                    <span className="text-[9.5px] text-slate-500 font-bold bg-slate-850 px-2 py-0.5 rounded-full">اختیاری / امکان سفارش آزاد</span>
                  </div>
                  <select
                    id="sec-order-supplier-select"
                    className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 focus:outline-none cursor-pointer"
                    value={selectedSupplierId}
                    onChange={(e) => {
                      setSelectedSupplierId(e.target.value);
                    }}
                  >
                    <option value="">-- بدون انتخاب تامین‌کننده (سفارش آزاد / تامین‌کننده بعداً تعیین می‌شود) --</option>
                    {activeSuppliers.map(s => {
                      const isSuggested = suggestedSupplierIds.has(s.id);
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} {isSuggested ? ' (⭐ منطبق با اقلام انتخابی)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Supplier info card */}
                {selectedSupplierObj ? (
                  <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4.5 text-xs space-y-3.5 shadow-inner">
                    <span className="text-[10px] font-bold text-slate-550 block uppercase border-b border-slate-950 pb-1.5">اطلاعات هماهنگی و آدرس فاکتور</span>
                    
                    <div className="space-y-2 text-slate-350">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-slate-500" />
                        <span>تلفن تماس: <strong className="font-mono text-slate-200 font-bold">{toPersianDigits(selectedSupplierObj.phone)}</strong></span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-slate-500 mt-0.5 flex-shrink-0" />
                        <span className="leading-relaxed text-slate-300">آدرس تامین‌کننده: {selectedSupplierObj.address}</span>
                      </div>
                    </div>

                    {selectedSupplierObj.bankAccounts && selectedSupplierObj.bankAccounts.length > 0 ? (
                      <div className="p-3 bg-slate-950 border border-slate-850 rounded-xl space-y-1.5 font-mono text-[10px]">
                        <div className="font-sans font-bold text-rose-500 flex items-center gap-1">
                          <CreditCard className="h-4 w-4" /> {selectedSupplierObj.bankAccounts[0].bankName}
                        </div>
                        <div className="text-slate-300">حساب: {selectedSupplierObj.bankAccounts[0].accountNo}</div>
                        <div className="text-slate-400">شبا: {selectedSupplierObj.bankAccounts[0].shaba}</div>
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-500 py-1 font-bold">حساب بانکی پیش‌فرض ثبت نگردیده است.</div>
                    )}
                  </div>
                ) : (
                  <div className="p-5 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/20 text-slate-400 text-xs font-bold leading-relaxed">
                    برای فعال‌سازی و ثبت نهایی، لطفاً پس از انتخاب اقلام درخواستی در گام نخست، تامین‌کننده بالا را انتخاب فرمایید.
                  </div>
                )}

                {/* Delivery Deadline */}
                <div className="pt-2 text-xs">
                  <label htmlFor="sec-delivery-date-inp" className="block text-[10.5px] text-slate-400 mb-1.5 font-bold">مهلت احتمالی تحویل محموله</label>
                  <input
                    id="sec-delivery-date-inp"
                    type="text"
                    className="w-full p-2.5 border border-slate-800 rounded-xl bg-slate-900 text-white font-mono text-center text-xs focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 focus:outline-none"
                    placeholder="۱۴۰۵/۰۲/۰۱"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>
              </div>

              {/* STEP 3: Basket / Finalize */}
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4 shadow-xl">
                <h3 className="text-xs font-extrabold text-slate-100 border-b border-slate-850 pb-3 flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-rose-500" />
                  ۳. بازبینی نهایی و مقداردهی سفارش
                </h3>

                <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4.5 space-y-4 text-white">
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-900 pr-1.5 space-y-3 font-medium scrollbar-thin">
                    {basketItemDetails.length === 0 ? (
                      <div className="text-xs text-slate-550 py-10 text-center bg-slate-900/20 rounded-2xl border border-dashed border-slate-850 flex flex-col items-center justify-center gap-2">
                        <ShoppingCart className="h-8 w-8 text-slate-650" />
                        <span>سبد سفارش تدارکاتی شما خالی است</span>
                        <span className="text-[10px] text-slate-550 font-bold block">ابتدا تیک کالاها یا محصولات درخواستی را از جدول سمت راست بزنید.</span>
                      </div>
                    ) : (
                      basketItemDetails.map(({ basket, isProduct, id, name, unit }) => (
                        <div key={id} className="pt-2.5 text-xs space-y-2">
                          <div className="flex justify-between font-bold text-slate-100">
                            <span className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 text-[8px] rounded-lg font-extrabold ${isProduct ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400' : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'}`}>
                                {isProduct ? 'محصول خریداری' : 'ماده اولیه'}
                              </span>
                              <span className="text-white font-black">{name}</span>
                            </span>
                            <span className="font-mono text-slate-400">واحد: {unit}</span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-slate-400 block mb-1 font-bold">مقدار سفارش</label>
                              <input
                                type="number"
                                onFocus={handleFocus}
                                className="p-2 border border-slate-800 rounded-xl w-full bg-slate-900 font-mono text-xs text-center text-white focus:outline-none focus:ring-2 focus:ring-rose-500/25"
                                value={basket.qtyProposed}
                                onChange={(e) => updateBasketQty(id, parseNumber(e.target.value), isProduct)}
                                min={1}
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-400 block mb-1 font-bold">قیمت خرید (ریال)</label>
                              <input
                                type="text"
                                onFocus={handleFocus}
                                className="p-2 border border-slate-800 rounded-xl w-full bg-slate-900 font-mono text-xs text-left text-white focus:outline-none focus:ring-2 focus:ring-rose-500/25"
                                value={formatWithCommas(basket.estimatedCostPerUnit)}
                                onChange={(e) => updateBasketCost(id, parseNumber(e.target.value), isProduct)}
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Cumulative stats block */}
                  {basketItemDetails.length > 0 && (
                    <div className="space-y-4 pt-4 border-t border-slate-850">
                      <div>
                        <label htmlFor="sec-notes" className="text-[10px] font-bold text-slate-400 block mb-1.5">ملاحظات و آیین خرید مسئول اداری</label>
                        <textarea
                           id="sec-notes"
                          className="w-full p-2.5 bg-slate-900 border border-slate-800 text-white rounded-xl text-xs focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 focus:outline-none"
                          placeholder="مثال: ترجیحاً خرید مرغوب با برگ تایید فاکتور چاپی باشد..."
                          rows={2}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>

                      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex justify-between items-center font-mono shadow-inner">
                        <span className="text-[10.5px] font-sans font-bold text-slate-400">کل برآورد مالی سفارش:</span>
                        <span className="text-sm font-extrabold text-emerald-400">{formatWithCommas(totalProposalBill)} ریال</span>
                      </div>

                      <button
                        type="submit"
                        disabled={basketItems.length === 0}
                        className={`w-full font-extrabold py-3 rounded-xl shadow-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-98 ${
                          basketItems.length > 0
                            ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-rose-600/15 hover:from-rose-500 hover:to-rose-400' 
                            : 'bg-slate-950 text-slate-550 cursor-not-allowed border border-slate-850'
                        }`}
                      >
                        <CheckCircle className="h-4 w-4" />
                        {basketItems.length === 0
                          ? 'ابتدا حداقل یک کالا یا محصول را در سبد علامت بزنید'
                          : selectedSupplierId
                            ? 'ثبت نهایی و ابلاغ سفارش به تامین‌کننده'
                            : 'ثبت نهایی سفارش کالا (بدون انتخاب تامین‌کننده / سفارش آزاد)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        </form>
      )}


      {/* ==================== TAB 2: COMPREHENSIVE REPORT & DELIVERY CHECKS ==================== */}
      {activeTab === 'report' && (
        <div className="space-y-6">
          
          {/* Dashboard Summary Widgets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4.5 text-right shadow-sm">
              <span className="text-[10px] text-slate-400 font-bold block">مجموع کل اقلام سفارش داده شده</span>
              <strong className="text-lg font-mono text-white font-extrabold block mt-1">{reportStats.totalLines} ردیف</strong>
            </div>
            
            <div className="bg-emerald-600/5 border border-emerald-500/15 text-emerald-400 p-4.5 rounded-2xl text-right shadow-sm">
              <span className="text-[10px] text-emerald-500 font-bold block">کل اقلام دریافت شده (تایید نهایی)</span>
              <strong className="text-lg font-mono text-emerald-400 font-extrabold block mt-1">
                {reportStats.deliveredLines} ردیف
                <span className="text-[10px] text-emerald-500 font-sans font-bold mr-1">
                  ({reportStats.totalLines > 0 ? Math.round((reportStats.deliveredLines / reportStats.totalLines) * 100) : 0}٪)
                </span>
              </strong>
            </div>

            <div className="bg-amber-600/5 border border-amber-500/15 text-amber-400 p-4.5 rounded-2xl text-right shadow-sm">
              <span className="text-[10px] text-amber-500 font-bold block">اقلام خریداری نشده (در انتظار)</span>
              <strong className="text-lg font-mono text-amber-400 font-extrabold block mt-1">{reportStats.pendingLines} ردیف</strong>
            </div>

            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4.5 text-right text-white shadow-sm">
              <span className="text-[10px] text-slate-400 font-bold block">ارزش ریالی تدارکات جاری</span>
              <strong className="text-base font-mono text-rose-450 font-extrabold block mt-1">{formatWithCommas(reportStats.totalOrderedCost)} ریال</strong>
            </div>
          </div>

          {/* Report Filtering & Search Actions */}
          <div className="flex flex-col xl:flex-row items-center justify-between gap-4 bg-slate-950 p-4 rounded-3xl border border-slate-850 shadow-sm">
            
            {/* Left Filter Options */}
            <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
              <span className="text-xs font-extrabold text-slate-400">فیلتر نمایش تحویل:</span>
              <div className="flex bg-slate-900 rounded-xl border p-1 border-slate-800">
                <button
                  onClick={() => setReportFilter('all')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    reportFilter === 'all' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  همه اقلام ({reportStats.totalLines})
                </button>
                <button
                  onClick={() => setReportFilter('delivered')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    reportFilter === 'delivered' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 shadow' : 'text-slate-400 hover:text-emerald-400'
                  }`}
                >
                  تحویل شده‌ها ({reportStats.deliveredLines})
                </button>
                <button
                  onClick={() => setReportFilter('unpurchased')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    reportFilter === 'unpurchased' ? 'bg-amber-600/20 text-amber-400 border border-amber-500/20 shadow' : 'text-slate-400 hover:text-amber-400'
                  }`}
                >
                  خریداری نشده‌ها ({reportStats.pendingLines})
                </button>
              </div>
            </div>

            {/* Middle text search filter */}
            <div className="relative w-full xl:w-72">
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                id="procurement-report-search"
                type="text"
                placeholder="جستجوی کالا، کد، تامین‌کننده..."
                className="w-full pr-10 pl-3 py-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-colors"
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
              />
            </div>

            {/* Excel Download Actions (Requested) & Print Report */}
            <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-end">
              <button
                type="button"
                onClick={printComprehensiveReport}
                className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white border border-rose-500/20 rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98 shadow-md"
                title="چاپ رسمی گزارش جامع تدارکات بر مبنای فیلتر و جستجوی شما"
              >
                <Printer className="h-4 w-4" />
                چاپ گزارش جامع تدارکات
              </button>

              <button
                type="button"
                onClick={() => exportOrdersReportCSV(false)}
                className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98"
                title="دانلود خلیج کارهای تمام اقلام سفارش گاتان"
              >
                <Download className="h-4 w-4 text-slate-400" />
                خروجی اکسل کل سفارشات
              </button>

              <button
                type="button"
                onClick={() => exportOrdersReportCSV(true)}
                className="flex-grow sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-600/10 border border-amber-500/20 hover:bg-amber-600 hover:text-white text-amber-400 rounded-xl text-xs font-bold cursor-pointer transition-all active:scale-98"
                title="دانلود فقط اقلام تدارکاتی که تحویل مسئول خرید نشده است"
              >
                <Download className="h-4 w-4 text-amber-400" />
                خروجی اکسل خریداری نشده‌‌ها
              </button>
            </div>
          </div>

          {/* Master Report Grid */}
          <div className="border border-slate-850 rounded-3xl overflow-hidden bg-slate-950 shadow-md overflow-x-auto">
            <table className="w-full text-right border-collapse min-w-[1000px]">
              <thead>
                <tr className="bg-slate-900/85 text-slate-200 text-xs select-none">
                  <th className="p-3 font-semibold text-center border border-slate-900 w-[12%]">کد سفارش / تاریخ</th>
                  <th className="p-3 font-semibold border border-slate-900 w-[18%] font-sans">شرح کالا (نوع)</th>
                  <th className="p-3 font-semibold border border-slate-900 w-[20%]">اطلاعات تماسی تامین‌کننده</th>
                  <th className="p-3 font-semibold text-center border border-slate-900 w-[10%]">میزان سفارش</th>
                  <th className="p-3 font-semibold text-center border border-slate-900 w-[8%]">تعداد در بسته</th>
                  <th className="p-3 font-semibold text-center border border-slate-900 w-[8%]">وزن هر بسته (kg)</th>
                  <th className="p-3 font-semibold text-left border border-slate-900 w-[12%]">بهای تخمینی</th>
                  <th className="p-3 font-semibold text-center border border-slate-900 w-[12%]">وضعیت مسئول خرید</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900 text-[11.5px] font-medium text-slate-300">
                {filteredAndSearchedReport.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-500 bg-slate-950 text-xs font-semibold">
                      هیچ رکوردی منطبق بر فیلتر یا جستجوی شما یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredAndSearchedReport.map((row, idx) => {
                    return (
                      <tr key={idx} className="hover:bg-slate-900/30 transition-colors">
                        {/* Order Code & Date */}
                        <td className="p-3 border border-slate-900 text-center font-mono text-slate-500">
                          <span className="block font-bold text-slate-200">#{row.orderId.slice(-6)}</span>
                          <span className="text-[10px] bg-slate-900 text-slate-400 rounded px-1 mt-0.5 inline-block">{row.orderDate}</span>
                        </td>

                        {/* Item Details */}
                        <td className="p-3 border border-slate-900">
                          <div className="font-extrabold text-white text-xs leading-relaxed">{row.name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="font-mono text-[9px] text-slate-550">کد: {row.code}</span>
                            <span className={`px-1.5 rounded-full text-[9px] font-bold ${
                              row.isProduct ? 'bg-indigo-500/10 text-indigo-450 border border-indigo-500/15' : 'bg-amber-500/10 text-amber-450 border border-amber-500/15'
                            }`}>
                              {row.isProduct ? 'محصول آماده' : 'ماده اولیه'}
                            </span>
                          </div>
                        </td>

                        {/* Supplier Details */}
                        <td className="p-3 border border-slate-900 space-y-1 text-slate-400">
                          <strong className="text-slate-100 block text-xs">{row.supplierName}</strong>
                          <div className="flex items-center gap-1 text-[10px]">
                            <Phone className="h-3 w-3 text-slate-500" />
                            <span>تلفن: {row.supplierPhone}</span>
                          </div>
                          <div className="flex items-start gap-1 text-[10px] break-all leading-normal text-slate-500">
                            <MapPin className="h-3 w-3 text-slate-500 mt-0.5 flex-shrink-0" />
                            <span>{row.supplierAddress}</span>
                          </div>
                        </td>

                        {/* Quantity & Unit */}
                        <td className="p-3 border border-slate-900 text-center font-bold text-white font-mono text-xs">
                          {toPersianDigits(row.qtyProposed)} {row.unit}
                        </td>

                        {/* Qty Per package */}
                        <td className="p-3 border border-slate-900 text-center font-mono text-slate-450">
                          {row.qtyPerPackage} {row.packageType}
                        </td>

                        {/* Weight per package */}
                        <td className="p-3 border border-slate-900 text-center font-mono text-slate-450">
                          {row.unit === 'عددی' || row.unit === 'عدد' ? '-' : `${row.weightPerPackage} kg`}
                        </td>

                        {/* Cost */}
                        <td className="p-3 border border-slate-900 text-left font-mono text-slate-200">
                          <div className="font-bold opacity-90">{formatWithCommas(row.estimatedCostPerUnit)} <span className="text-[9px] font-sans">ریال</span></div>
                          <div className="text-[10px] text-slate-450 mt-0.5 font-sans font-bold">کل: {formatWithCommas(row.totalEstimatedCost)} ریال</div>
                        </td>

                        {/* Status Toggle (Delivered Confirm System) */}
                        <td className="p-3 border border-slate-900 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleReceivedStatus(row.orderId, row.itemIndex)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-extrabold transition-all border shadow-sm w-full cursor-pointer flex items-center justify-center gap-1 ${
                              row.isReceived 
                                ? 'bg-emerald-600/10 text-emerald-405 text-emerald-400 border-emerald-500/20 hover:bg-emerald-600 hover:text-white' 
                                : 'bg-amber-600/10 text-amber-405 text-amber-400 border-amber-500/20 hover:bg-amber-600 hover:text-white'
                            }`}
                            title="کلیک کنید جهت تغییر وضعیت خرید این کالا"
                          >
                            {row.isReceived ? (
                              <>
                                <Check className="h-3.5 w-3.5 stroke-[3px]" />
                                <span>تحویل شده</span>
                              </>
                            ) : (
                              <>
                                <X className="h-3.5 w-3.5 stroke-[3px]" />
                                <span>خریداری نشده</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* User Guide Box */}
          <div className="bg-blue-950/20 border border-blue-900/30 text-blue-350 p-4 rounded-3xl flex items-start gap-3 text-xs leading-relaxed">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="block font-bold">راهنمای سیستم مسئول خرید:</strong>
              <p className="mt-0.5">
                شما می‌توانید سفارشات داده شده به مسئول تدارکات را در این بخش بررسی کنید. در صورتی که کالا خریداری شده و نهایتاً تحویل انبار گردید، بر روی دکمه مربوطه کلیک کنید تا به وضعیت 
                <span className="font-extrabold mx-1 text-emerald-400">«تحویل‌شده»</span> تبدیل شود. اقلام باقی‌مانده فیس به صورت 
                <span className="font-extrabold mx-1 text-amber-400">«خریداری نشده»</span> فیلتر شده و برای چاپ مجدد یا صدور فایل اکسل گزارش کسر خرید آماده می‌باشند.
              </p>
            </div>
          </div>
        </div>
      )}


      {/* ==================== TAB 3: TRADITIONAL HISTORY OF INVOICES ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-4 rounded-3xl border border-slate-850 shadow-sm">
            <span className="text-xs font-extrabold text-slate-200">پیش‌فاکتورها و سوابق ثبت سفارشات خرید مواد اولیه</span>
            <div className="relative w-full sm:w-64">
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                id="procurement-search-history"
                type="text"
                placeholder="جستجوی نام تامین‌کننده..."
                className="w-full pr-10 pl-3 py-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {searchedHistory.length === 0 ? (
              <div className="text-center py-10 bg-slate-950 border border-dashed border-slate-850 rounded-3xl text-slate-500 text-sm">
                هیچ پیش‌فاکتور سفارشی در این دوره ثبت نگردیده است.
              </div>
            ) : (
              searchedHistory.map(order => {
                const sup = supplierMap[order.supplierId];
                return (
                  <div key={order.id} className="bg-slate-950 border border-slate-850 p-5 rounded-3xl shadow-sm hover:border-slate-800 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    
                    {/* General details */}
                    <div className="space-y-2 lg:w-1/4">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${sup ? 'bg-rose-500 animate-pulse' : 'bg-slate-500'}`} />
                        <strong className="text-sm font-black text-white">{sup?.name || 'سفارش آزاد (بدون تامین‌کننده)'}</strong>
                      </div>
                      <div className="text-[11px] text-slate-400 space-y-1 font-sans">
                        <div>کد سیستم پیش‌فاکتور: <span className="font-mono font-bold text-slate-200">{order.id}</span></div>
                        <div>موعد تحویل تعهد شده: <span className="font-mono text-slate-200">{order.expectedDeliveryDate}</span></div>
                        {!sup && (
                          <div className="text-[10px] text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg inline-block">
                            تامین‌کننده پس از استعلام نهایی تعیین خواهد شد
                          </div>
                        )}
                      </div>
                      <div>
                        <span className={`inline-block text-[10px] font-bold border px-2.5 py-0.5 rounded-full ${
                          order.status === 'تحویل شده' 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          وضعیت: {order.status}
                        </span>
                      </div>
                    </div>

                    {/* Items table list */}
                    <div className="flex-grow lg:w-2/5 bg-slate-900/50 p-4 rounded-2xl border border-slate-850">
                      <span className="text-[10px] text-slate-500 font-bold block pb-1 border-b mb-1 border-slate-950">اقلام پیش‌فاکتور موافقت نامه:</span>
                      <div className="divide-y divide-slate-900 max-h-40 overflow-y-auto">
                        {order.items.map((it, idx) => {
                          const isProduct = !!it.productId;
                          const refObj = isProduct ? productMap[it.productId!] : rawItemMap[it.rawMaterialId!];
                          return (
                            <div key={idx} className="flex justify-between items-center text-xs py-1.5">
                              <span className="flex items-center gap-1.5">
                                <span className={`text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-md ${isProduct ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/15' : 'bg-amber-500/10 text-amber-400 border border-amber-500/15'}`}>
                                  {isProduct ? 'محصول' : 'ماده'}
                                </span>
                                <span className="font-extrabold text-slate-100">{refObj?.name || 'کالای نامشخص'}</span>
                              </span>
                              <span className="font-mono font-bold text-slate-300 text-[11px]">
                                {toPersianDigits(it.qtyProposed)} {refObj?.unit} <span className="text-slate-600">×</span> {formatWithCommas(it.estimatedCostPerUnit || 0)} ریال = {formatWithCommas(it.totalEstimatedCost)} ریال
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Comments & actions */}
                    <div className="lg:w-1/3 flex flex-col justify-between h-auto gap-4 lg:text-left self-stretch">
                      {order.notes ? (
                        <div className="p-3 border border-slate-850 rounded-2xl bg-slate-900/30 text-[10px] text-slate-400 font-medium leading-relaxed grow">
                          <strong>ملاحظات خرید:</strong> {order.notes}
                        </div>
                      ) : (
                        <div className="p-3 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10 text-[10px] text-slate-550 font-medium italic grow flex items-center justify-center">
                          فاقد توضیحات تکمیلی
                        </div>
                      )}
                      
                      <div className="flex xl:flex-row justify-between items-center pt-2.5 border-t border-slate-900 text-xs gap-3">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block font-medium">مجموع کل ناخالص خرید</span>
                          <span className="font-mono font-black text-sm text-white">{formatWithCommas(order.totalBill)} ریال</span>
                        </div>
                        
                        <div className="flex gap-2.5 flex-shrink-0">
                          <button
                            onClick={() => printOrderProposalSheet(order)}
                            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98 shadow-rose-600/10"
                          >
                            <Printer className="h-3.5 w-3.5" /> چاپ حواله رسمی
                          </button>
                          <button
                            onClick={() => deleteProposalOrder(order.id)}
                            className="px-2.5 py-2 border border-rose-950/40 text-rose-400 rounded-xl text-[11px] font-bold hover:bg-rose-950/20 cursor-pointer transition-colors"
                          >
                            حذف فاکتور
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

    </div>
  );
}
