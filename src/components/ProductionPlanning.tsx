import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Trash2, Edit, Save, ArrowUp, ArrowDown, Settings, Clock, 
  Layers, Info, AlertTriangle, CheckCircle, RefreshCcw, HelpCircle, 
  Play, Calendar, HelpCircle as HelpIcon, Flame, Thermometer, Wind,
  Sliders, Shuffle, Sparkles, Printer, FileSpreadsheet, ChevronDown, Check, X, Search, ChefHat
} from 'lucide-react';
import { AppDatabase, Product, ProductionOven, ProductionTray, ProductTrayAssignment, ProductionPlanningSettings, ProductionPlanningOrder, ProductionRackDefinition } from '../types';
import { toPersianDigits, formatWithCommas, getTodayJalali, printElement } from '../utils/persianUtils';
import * as XLSX from 'xlsx';
import CustomerProductionOrders from './CustomerProductionOrders';

interface ProductionPlanningProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  currentUserName?: string;
}

export default function ProductionPlanning({ db, onUpdateDb, activePeriodId, currentUserName }: ProductionPlanningProps) {
  const [activeTab, setActiveTab] = useState<'customer_orders' | 'planning' | 'settings' | 'optimization'>('planning');
  const activeCustomerOrdersCount = useMemo(() => {
    const list = db.customerProductionOrders || [];
    return list.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;
  }, [db.customerProductionOrders]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    // Default to a representative date in the active period
    const yearPart = activePeriodId.split('-')[0] || '1405';
    const monthPart = activePeriodId.split('-')[1] || '01';
    return `${yearPart}/${monthPart}/15`;
  });
  const [showComparisonTable, setShowComparisonTable] = useState<boolean>(true);
  const [visibleStages, setVisibleStages] = useState<{
    kneading: boolean;
    production: boolean;
    proofing: boolean;
    baking: boolean;
    cooling: boolean;
    packaging: boolean;
  }>({
    kneading: true,
    production: true,
    proofing: true,
    baking: true,
    cooling: true,
    packaging: true,
  });

  // --- 1. LOCAL OR DB PERSISTED STATE LOADER ---
  // We load from db if keys exist, otherwise initialize defaults
  const settings: ProductionPlanningSettings = useMemo(() => {
    const dbSettings = db.productionPlanningSettings;
    if (dbSettings && dbSettings.periodId === activePeriodId) {
      return dbSettings;
    }
    
    // Default Settings for this period
    return {
      periodId: activePeriodId,
      startHour: '06:00',
      endHour: '24:00',
      prepTimeMinutes: 15,
      kneadingTimeMinutes: 20,
      totalRacks: 6,
      tiersPerRack: 10,
      proofingMaxRacks: 3,
      ovens: [
        { id: 'oven-1', name: 'فر گردان شماره ۱', type: 'گردان', trayCapacity: 16 },
        { id: 'oven-2', name: 'فر طبقه‌ای شماره ۲', type: 'طبقه ای', trayCapacity: 8 },
      ],
      trays: [
        { id: 'tray-1', name: 'سینی توری چرخ‌دار', totalCount: 60, traysPerRackTier: 2 },
        { id: 'tray-2', name: 'سینی نسوز صاف دوجداره', totalCount: 40, traysPerRackTier: 1 },
      ],
      productAssignments: []
    };
  }, [db.productionPlanningSettings, activePeriodId]);

  const orders: ProductionPlanningOrder[] = useMemo(() => {
    const dbOrders = db.productionPlanningOrders || [];
    return dbOrders.filter(o => o.periodId === activePeriodId && o.dateStr === selectedDate);
  }, [db.productionPlanningOrders, activePeriodId, selectedDate]);

  // Update Settings helper
  const saveSettings = (updatedSettings: ProductionPlanningSettings) => {
    onUpdateDb({
      ...db,
      productionPlanningSettings: updatedSettings
    });
  };

  // Update Orders helper
  const saveOrders = (updatedOrders: ProductionPlanningOrder[]) => {
    const otherOrders = (db.productionPlanningOrders || []).filter(
      o => !(o.periodId === activePeriodId && o.dateStr === selectedDate)
    );
    onUpdateDb({
      ...db,
      productionPlanningOrders: [...otherOrders, ...updatedOrders]
    });
  };

  // State variables for adding/editing items in Settings
  const [editingOven, setEditingOven] = useState<Partial<ProductionOven> | null>(null);
  const [editingTray, setEditingTray] = useState<Partial<ProductionTray> | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Partial<ProductTrayAssignment> | null>(null);
  const [editingRack, setEditingRack] = useState<Partial<ProductionRackDefinition> | null>(null);

  // State for real batch calculator
  const [realBatchQty, setRealBatchQty] = useState<number>(100);
  const [realBatchProdTime, setRealBatchProdTime] = useState<number>(10);
  const [realBatchCoolTime, setRealBatchCoolTime] = useState<number>(30);
  const [realBatchPackTime, setRealBatchPackTime] = useState<number>(50);

  // State for modal batch calculator (Calculates unit times based on batch data)
  const [modalBatchQty, setModalBatchQty] = useState<number>(100);
  const [modalBatchProdTime, setModalBatchProdTime] = useState<number>(10);
  const [modalBatchCoolTime, setModalBatchCoolTime] = useState<number>(30);
  const [modalBatchPackTime, setModalBatchPackTime] = useState<number>(50);
  const [showBatchCalc, setShowBatchCalc] = useState<boolean>(false);

  const [assignProductSearch, setAssignProductSearch] = useState<string>('');
  const [isOpenAssignProductDropdown, setIsOpenAssignProductDropdown] = useState<boolean>(false);
  const [rackProductSearch, setRackProductSearch] = useState<string>('');
  const [isOpenRackProductDropdown, setIsOpenRackProductDropdown] = useState<boolean>(false);

  const lastInitializedIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!editingAssignment) {
      lastInitializedIdRef.current = null;
      setShowBatchCalc(false);
      return;
    }

    const uniqueId = editingAssignment.productId || 'new-assignment';
    if (lastInitializedIdRef.current !== uniqueId) {
      lastInitializedIdRef.current = uniqueId;
      setShowBatchCalc(false);
      const pUnit = editingAssignment.prodTimePerUnit || 0.1;
      const cUnit = editingAssignment.coolingTimePerUnit || 1;
      const pkUnit = editingAssignment.packagingTimePerUnit || 0.5;

      setModalBatchQty(100);
      setModalBatchProdTime(Math.round(100 * pUnit * 100) / 100);
      setModalBatchCoolTime(cUnit);
      setModalBatchPackTime(Math.round(100 * pkUnit * 100) / 100);

      if (editingAssignment.productId) {
        const prod = db.products.find(p => p.id === editingAssignment.productId);
        setAssignProductSearch(prod ? prod.name : '');
      } else {
        setAssignProductSearch('');
      }
    }
  }, [editingAssignment, db.products]);

  const updateModalBatchQty = (qty: number) => {
    setModalBatchQty(qty);
    if (qty > 0 && editingAssignment) {
      setEditingAssignment(prev => {
        if (!prev) return null;
        return {
          ...prev,
          prodTimePerUnit: Number((modalBatchProdTime / qty).toFixed(4)),
          coolingTimePerUnit: Number(modalBatchCoolTime.toFixed(2)),
          packagingTimePerUnit: Number((modalBatchPackTime / qty).toFixed(4)),
        };
      });
    }
  };

  const updateModalBatchProdTime = (prodTime: number) => {
    setModalBatchProdTime(prodTime);
    if (modalBatchQty > 0 && editingAssignment) {
      setEditingAssignment(prev => {
        if (!prev) return null;
        return {
          ...prev,
          prodTimePerUnit: Number((prodTime / modalBatchQty).toFixed(4)),
        };
      });
    }
  };

  const updateModalBatchCoolTime = (coolTime: number) => {
    setModalBatchCoolTime(coolTime);
    if (editingAssignment) {
      setEditingAssignment(prev => {
        if (!prev) return null;
        return {
          ...prev,
          coolingTimePerUnit: Number(coolTime.toFixed(2)),
        };
      });
    }
  };

  const updateModalBatchPackTime = (packTime: number) => {
    setModalBatchPackTime(packTime);
    if (modalBatchQty > 0 && editingAssignment) {
      setEditingAssignment(prev => {
        if (!prev) return null;
        return {
          ...prev,
          packagingTimePerUnit: Number((packTime / modalBatchQty).toFixed(4)),
        };
      });
    }
  };

  // State for print reports modal
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [printType, setPrintType] = useState<'comprehensive' | 'process' | 'department'>('comprehensive');
  const [printSubSelection, setPrintSubSelection] = useState<string>('kneading');

  // Export current day's orders to Excel
  const handleExportPlanningExcel = () => {
    try {
      const exportData = orders.flatMap(order => {
        return order.items.map(item => {
          const p = db.products.find(prod => prod.id === item.productId);
          return {
            'تاریخ': order.dateStr,
            'شماره راک': order.rackNumber,
            'تکنیک پخت': order.bakingTechnique,
            'کد محصول (شناسه)': item.productId,
            'نام محصول': p ? p.name : item.productId,
            'تعداد تولید واقعی': item.qtyToProduce,
            'سینی‌های مورد نیاز': item.traysNeeded,
            'اولویت تولید': item.priority,
            'توضیحات پس از پخت': order.postBakeNotes || ''
          };
        });
      });

      if (exportData.length === 0) {
        alert('هیچ راک فعال یا سفارشی برای خروجی گرفتن وجود ندارد.');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'برنامه ریزی تولید');
      
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Gatan_Production_Planning_${selectedDate.replace(/\//g, '-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting planning Excel', err);
      alert('خطایی در خروجی اکسل رخ داد.');
    }
  };

  // Import planning orders from Excel
  const handleImportPlanningExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawJson = XLSX.utils.sheet_to_json<any>(worksheet);

        if (rawJson.length === 0) {
          alert('فایل اکسل خالی است یا فرمت آن نامعتبر است.');
          return;
        }

        // Reconstruct orders from flat rows
        // We will group rows by 'شماره راک'
        const ordersMap: Record<string, ProductionPlanningOrder> = {};
        
        rawJson.forEach((row) => {
          const rackNum = String(row['شماره راک'] || '').trim();
          if (!rackNum) return;

          const dateStr = String(row['تاریخ'] || selectedDate).trim();
          const bakingTechnique = (row['تکنیک پخت'] === '8-8' ? '8-8' : 'عادی') as 'عادی' | '8-8';
          const postBakeNotes = String(row['توضیحات پس از پخت'] || '').trim();
          
          let productId = String(row['کد محصول (شناسه)'] || '').trim();
          const pName = String(row['نام محصول'] || '').trim();
          
          // Try to match product by name if ID is missing
          if (!productId && pName) {
            const found = db.products.find(p => p.name === pName);
            if (found) productId = found.id;
          }

          if (!productId) return;

          const qtyToProduce = Number(row['تعداد تولید واقعی']) || 0;
          const traysNeeded = Number(row['سینی‌های مورد نیاز']) || 0;
          const priority = Number(row['اولویت تولید']) || 1;

          // Unique key for the order (by date and rack number)
          const orderKey = `${dateStr}-${rackNum}`;

          if (!ordersMap[orderKey]) {
            ordersMap[orderKey] = {
              id: Math.random().toString(36).substr(2, 9),
              periodId: activePeriodId,
              rackNumber: rackNum,
              bakingTechnique,
              postBakeNotes,
              dateStr,
              calculateKneadingTime: true,
              items: []
            };
          }

          ordersMap[orderKey].items.push({
            productId,
            qtyToProduce,
            traysNeeded,
            priority
          });
        });

        const importedOrders = Object.values(ordersMap);
        if (importedOrders.length === 0) {
          alert('هیچ سفارش معتبری در فایل اکسل یافت نشد.');
          return;
        }

        saveOrders(importedOrders);
        alert(`تعداد ${toPersianDigits(importedOrders.length)} راک سفارش با موفقیت بارگذاری و جایگزین گردید.`);
      } catch (err) {
        console.error('Error importing planning Excel', err);
        alert('خطایی در پردازش و ورود فایل اکسل رخ داد. لطفاً قالب فایل را بررسی نمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
  };

  // Export Capacity & Settings to Multi-sheet Excel
  const handleExportSettingsExcel = () => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Ovens
      const ovensData = settings.ovens.map(o => ({
        'شناسه فر': o.id,
        'نام فر': o.name,
        'نوع فر': o.type === 'گردان' ? 'گردان' : 'طبقه ای',
        'ظرفیت سینی': o.trayCapacity
      }));
      const ovensWS = XLSX.utils.json_to_sheet(ovensData);
      XLSX.utils.book_append_sheet(wb, ovensWS, 'فرها');

      // Sheet 2: Trays
      const traysData = settings.trays.map(t => ({
        'شناسه سینی': t.id,
        'نام سینی': t.name,
        'تعداد کل موجود': t.totalCount,
        'ظرفیت سینی در هر طبقه راک': t.traysPerRackTier
      }));
      const traysWS = XLSX.utils.json_to_sheet(traysData);
      XLSX.utils.book_append_sheet(wb, traysWS, 'سینی‌ها');

      // Sheet 3: Product Assignments
      const assignmentsData = settings.productAssignments.map(a => {
        const p = db.products.find(prod => prod.id === a.productId);
        const t = settings.trays.find(tray => tray.id === a.trayTypeId);
        return {
          'کد محصول (شناسه)': a.productId,
          'نام محصول': p ? p.name : a.productId,
          'شناسه نوع سینی': a.trayTypeId,
          'نام سینی اختصاصی': t ? t.name : a.trayTypeId,
          'ظرفیت سینی (تعداد در سینی)': a.qtyPerTray,
          'زمان تولید هر واحد (دقیقه)': a.prodTimePerUnit,
          'زمان خمیرگیری محصول (دقیقه)': a.kneadingTime ?? 15,
          'نیاز به گرمخانه (بله/خیر)': a.needsProofing ? 'بله' : 'خیر',
          'زمان گرمخانه (دقیقه)': a.proofingTime || 0,
          'نیاز به بخار آب فر (بله/خیر)': a.steamRequired ? 'بله' : 'خیر',
          'چیدمان یک‌درمیان (بله/خیر)': a.alternatingShelves ? 'بله' : 'خیر',
          'زمان خنک شدن راک (دقیقه)': a.coolingTimePerUnit || 1,
          'زمان بسته‌بندی هر واحد (دقیقه)': a.packagingTimePerUnit || 0.5
        };
      });
      const assignmentsWS = XLSX.utils.json_to_sheet(assignmentsData);
      XLSX.utils.book_append_sheet(wb, assignmentsWS, 'انتساب سینی‌ها');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Gatan_Production_Capacity_Settings.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting settings Excel', err);
      alert('خطایی در خروجی تنظیمات ظرفیت فر، راک و سینی‌ها رخ داد.');
    }
  };

  // Import Capacity & Settings from Multi-sheet Excel
  const handleImportSettingsExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Parse Ovens
        const ovensWS = workbook.Sheets['فرها'];
        let importedOvens = settings.ovens;
        if (ovensWS) {
          const rawOvens = XLSX.utils.sheet_to_json<any>(ovensWS);
          if (rawOvens.length > 0) {
            importedOvens = rawOvens.map(row => ({
              id: String(row['شناسه فر'] || Math.random().toString(36).substr(2, 9)),
              name: String(row['نام فر'] || 'فر جدید'),
              type: row['نوع فر'] === 'طبقه ای' ? 'طبقه ای' : 'گردان',
              trayCapacity: Number(row['ظرفیت سینی']) || 16
            }));
          }
        }

        // Parse Trays
        const traysWS = workbook.Sheets['سینی‌ها'];
        let importedTrays = settings.trays;
        if (traysWS) {
          const rawTrays = XLSX.utils.sheet_to_json<any>(traysWS);
          if (rawTrays.length > 0) {
            importedTrays = rawTrays.map(row => ({
              id: String(row['شناسه سینی'] || Math.random().toString(36).substr(2, 9)),
              name: String(row['نام سینی'] || 'سینی جدید'),
              totalCount: Number(row['تعداد کل موجود']) || 100,
              traysPerRackTier: Number(row['ظرفیت سینی در هر طبقه راک']) || 2
            }));
          }
        }

        // Parse Assignments
        const assignmentsWS = workbook.Sheets['انتساب سینی‌ها'];
        let importedAssignments = settings.productAssignments;
        if (assignmentsWS) {
          const rawAssignments = XLSX.utils.sheet_to_json<any>(assignmentsWS);
          if (rawAssignments.length > 0) {
            importedAssignments = rawAssignments.map(row => {
              let productId = String(row['کد محصول (شناسه)'] || '').trim();
              const pName = String(row['نام محصول'] || '').trim();
              
              if (!productId && pName) {
                const found = db.products.find(p => p.name === pName);
                if (found) productId = found.id;
              }

              return {
                productId,
                trayTypeId: String(row['شناسه نوع سینی'] || importedTrays[0]?.id || ''),
                qtyPerTray: Number(row['ظرفیت سینی (تعداد در سینی)']) || 20,
                prodTimePerUnit: Number(row['زمان تولید هر واحد (دقیقه)']) || 0.1,
                kneadingTime: Number(row['زمان خمیرگیری محصول (دقیقه)']) || 15,
                needsProofing: row['نیاز به گرمخانه (بله/خیر)'] === 'بله',
                proofingTime: Number(row['زمان گرمخانه (دقیقه)']) || 0,
                steamRequired: row['نیاز به بخار آب فر (بله/خیر)'] === 'بله',
                alternatingShelves: row['چیدمان یک‌درمیان (بله/خیر)'] === 'بله',
                coolingTimePerUnit: Number(row['زمان خنک شدن راک (دقیقه)']) || 1,
                packagingTimePerUnit: Number(row['زمان بسته‌بندی هر واحد (دقیقه)']) || 0.5,
                bakingSettings: {}
              };
            }).filter(a => a.productId);
          }
        }

        const updatedSettings: ProductionPlanningSettings = {
          ...settings,
          ovens: importedOvens,
          trays: importedTrays,
          productAssignments: importedAssignments
        };

        saveSettings(updatedSettings);
        alert('تنظیمات ظرفیت فرها، سینی‌ها و انتساب کالا با موفقیت از اکسل بارگذاری گردید.');
      } catch (err) {
        console.error('Error importing settings Excel', err);
        alert('خطایی در وارد کردن تنظیمات از اکسل رخ داد. لطفا فایل ارسالی را مجددا بررسی فرمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
  };

  // Generate and display printable reports
  const handleGenerateAndPrintReport = () => {
    if (orders.length === 0) {
      alert('هیچ راک فعال یا سفارشی برای تاریخ انتخاب شده جهت چاپ وجود ندارد.');
      return;
    }

    let reportTitle = '';
    let reportHtml = '';

    const header = `
      <div style="direction: rtl; text-align: right; font-family: 'Vazirmatn', Tahoma, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;">
          <div>
            <h1 style="color: #059669; margin: 0; font-size: 18px; font-weight: 900;">برنامه زمان‌بندی و پخت کارگاه محصولات گاتان</h1>
            <p style="font-size: 11px; color: #4b5563; margin: 4px 0 0 0;">تاریخ برنامه‌ریزی: ${toPersianDigits(selectedDate)} | شیفت کاری جاری</p>
          </div>
          <div style="text-align: left;">
            <div style="font-weight: bold; font-size: 12px; color: #111827;">کارگاه شیرینی و نان گاتان</div>
            <div style="font-size: 10px; color: #6b7280; margin-top: 2px;">سامانه جامع برنامه‌ریزی هوشمند تولید</div>
          </div>
        </div>
    `;

    const footer = `
        <div style="border-top: 1px dashed #d1d5db; padding-top: 10px; margin-top: 30px; text-align: center; font-size: 9px; color: #6b7280; display: flex; justify-content: space-between;">
          <span>تولید شده توسط سیستم هوشمند گاتان</span>
          <span>امضای سرپرست نوبت کاری: .........................</span>
          <span>صفحه ۱ از ۱</span>
        </div>
      </div>
    `;

    if (printType === 'comprehensive') {
      reportTitle = 'گزارش جامع زمان‌بندی پخت و فرآیندهای کارگاه';
      let tableRows = '';

      timelineData.racks.forEach((rack) => {
        const s = rack.stages;
        if (!s) return;
        const productsNames = rack.rackOrder.items.map((it: any) => `${getProdName(it.productId)} (${toPersianDigits(it.qtyToProduce)} عدد)`).join(' + ');
        
        tableRows += `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
            <td style="padding: 10px; font-size: 10.5px;">${productsNames}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace;">${toPersianDigits(minutesToClockString(s.kneading.start))} - ${toPersianDigits(minutesToClockString(s.kneading.end))}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace;">${toPersianDigits(minutesToClockString(s.kneading.start + (rack.productStages?.[0]?.productionStart || 0)))} - ${toPersianDigits(minutesToClockString(s.kneading.start + (rack.productStages?.[0]?.productionEnd || 0)))}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace;">${s.proofing.needs && s.proofing.duration > 0 ? `${toPersianDigits(minutesToClockString(s.proofing.start))} - ${toPersianDigits(minutesToClockString(s.proofing.end))}` : 'نیاز ندارد'}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace; font-weight: bold; color: #be123c;">${toPersianDigits(minutesToClockString(s.baking.start))} - ${toPersianDigits(minutesToClockString(s.baking.end))}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace;">${s.cooling.duration > 0 ? `${toPersianDigits(minutesToClockString(s.cooling.start))} - ${toPersianDigits(minutesToClockString(s.cooling.end))}` : 'نیاز ندارد'}</td>
            <td style="padding: 10px; font-size: 10px; font-family: monospace;">${s.packaging.duration > 0 ? `${toPersianDigits(minutesToClockString(s.packaging.start))} - ${toPersianDigits(minutesToClockString(s.packaging.end))}` : 'نیاز ندارد'}</td>
          </tr>
        `;
      });

      reportHtml = `
        ${header}
        <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">برنامه تولید جامع کارگاه - کلیه فرآیندها</h2>
        <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
          <thead>
            <tr style="background-color: #059669; color: white;">
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">شماره راک</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">محصولات و مقادیر سفارش</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">خمیرگیری</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">وزن‌کشی و شکل‌دهی</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">گرمخانه تخمیر</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px; background-color: #be123c;">پخت در فر</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">سردکاری راک</th>
              <th style="padding: 8px; border: 1px solid #059669; font-size: 11px;">بسته‌بندی نهایی</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        ${footer}
      `;
    } else if (printType === 'comparison_table') {
      reportTitle = 'گزارش تطبیقی ترتیبی فرآیندهای موازی و زنجیره پخت';
      let tableRows = '';

      timelineData.racks.forEach((item) => {
        if (!item.stages) return;
        const stages = item.stages;
        const allProdNames = item.rackOrder.items.map((it: any) => getProdName(it.productId)).join(' + ');

        // 1. Kneading column html
        let kneadingHtml = '';
        if (item.productStages) {
          item.productStages.forEach((pStage: any) => {
            const assign = settings.productAssignments.find(a => a.productId === pStage.productId);
            const hasKnead = assign ? (assign.hasKneading !== false) : true;
            if (!hasKnead || pStage.kneadingDuration <= 0) {
              kneadingHtml += `<div style="font-size: 9px; color: #9ca3af; font-style: italic; margin-bottom: 4px;">${getProdName(pStage.productId)}: فاقد خمیرگیری</div>`;
            } else {
              const absStart = stages.kneading.start + pStage.kneadingStart;
              const absEnd = stages.kneading.start + pStage.kneadingEnd;
              kneadingHtml += `
                <div style="background-color: rgba(245, 158, 11, 0.05); padding: 5px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.2); margin-bottom: 4px; text-align: right;">
                  <div style="font-size: 9px; font-weight: bold; color: #b45309; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${getProdName(pStage.productId)}</div>
                  <div style="font-family: monospace; font-size: 9.5px; color: #d97706; font-weight: bold; margin-top: 2px;">
                    ${toPersianDigits(minutesToClockString(absStart))} - ${toPersianDigits(minutesToClockString(absEnd))}
                  </div>
                  <div style="font-size: 8.5px; color: #6b7280; margin-top: 1px;">(${toPersianDigits(pStage.kneadingDuration)} دقیقه)</div>
                </div>
              `;
            }
          });
        }

        // 2. Dough Production column html
        let productionHtml = '';
        if (item.productStages) {
          item.productStages.forEach((pStage: any) => {
            const assign = settings.productAssignments.find(a => a.productId === pStage.productId);
            const hasProd = assign ? (assign.hasProduction !== false) : true;
            if (!hasProd || pStage.productionDuration <= 0) {
              productionHtml += `<div style="font-size: 9px; color: #9ca3af; font-style: italic; margin-bottom: 4px;">${getProdName(pStage.productId)}: فاقد تولید</div>`;
            } else {
              const absStart = stages.kneading.start + pStage.productionStart;
              const absEnd = stages.kneading.start + pStage.productionEnd;
              const rackItem = item.rackOrder.items.find((it: any) => it.productId === pStage.productId);
              const totalQty = rackItem ? rackItem.qtyToProduce : 0;
              const qtyPerTray = assign?.qtyPerTray || 20;
              const completeTrays = Math.floor(totalQty / qtyPerTray);
              const remainder = totalQty % qtyPerTray;
              const incompleteTrays = remainder > 0 ? 1 : 0;

              productionHtml += `
                <div style="background-color: rgba(37, 99, 235, 0.04); padding: 5px; border-radius: 4px; border: 1px solid rgba(37, 99, 235, 0.15); margin-bottom: 4px; text-align: right;">
                  <div style="font-size: 9px; font-weight: bold; color: #1d4ed8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${getProdName(pStage.productId)}</div>
                  <div style="font-family: monospace; font-size: 9.5px; color: #2563eb; font-weight: bold; margin-top: 2px;">
                    ${toPersianDigits(minutesToClockString(absStart))} - ${toPersianDigits(minutesToClockString(absEnd))}
                  </div>
                  <div style="font-size: 8.5px; color: #6b7280; margin-top: 1px;">(${toPersianDigits(pStage.productionDuration)} دقیقه)</div>
                  <div style="font-size: 8.5px; color: #4b5563; border-top: 1px dashed rgba(37, 99, 235, 0.1); margin-top: 4px; padding-top: 2px;">
                    کل: <b>${toPersianDigits(totalQty)} عدد</b> | سینی: <b>${toPersianDigits(completeTrays + incompleteTrays)} سینی</b>
                  </div>
                </div>
              `;
            }
          });
        }

        // 3. Proofing column html
        const proofingHtml = stages.proofing.needs && stages.proofing.duration > 0 ? `
          <div style="text-align: center;">
            <div style="font-family: monospace; font-size: 10px; font-weight: bold; color: #6d28d9;">
              ${toPersianDigits(minutesToClockString(stages.proofing.start))} - ${toPersianDigits(minutesToClockString(stages.proofing.end))}
            </div>
            <div style="font-size: 9px; color: #7c3aed; margin-top: 2px;">(${toPersianDigits(stages.proofing.duration)} دقیقه)</div>
          </div>
        ` : `<div style="text-align: center; color: #9ca3af; font-style: italic; font-size: 9.5px;">نیاز ندارد</div>`;

        // 4. Baking column html
        let bakingHtml = '';
        if (stages.baking.duration > 0) {
          const ovenObj = settings.ovens.find(o => o.id === stages.baking.ovenId);
          bakingHtml = `
            <div style="text-align: center;">
              <div style="font-family: monospace; font-size: 10.5px; font-weight: 900; color: #be123c;">
                ${toPersianDigits(minutesToClockString(stages.baking.start))} - ${toPersianDigits(minutesToClockString(stages.baking.end))}
              </div>
              <div style="font-size: 9px; color: #be123c; font-weight: bold; margin-top: 2px;">
                ${toPersianDigits(stages.baking.duration)} دقیقه (${toPersianDigits(item.analysis.bakingTemp || 200)}°)
              </div>
              <div style="display: inline-block; font-size: 8.5px; background-color: #f3f4f6; border: 1px solid #d1d5db; color: #374151; padding: 2px 4px; border-radius: 3px; font-weight: bold; margin-top: 4px;">
                ${ovenObj?.name || 'فر'}
              </div>
              ${stages.baking.hasCollision ? `
                <div style="font-size: 8.5px; color: #ef4444; font-weight: bold; margin-top: 4px; background-color: #fef2f2; border: 1px solid #fca5a5; padding: 2px; border-radius: 3px;">
                  ⚠️ تداخل فر با راک ${toPersianDigits(stages.baking.collidingWith)}
                </div>
              ` : ''}
            </div>
          `;
        } else {
          bakingHtml = `<div style="text-align: center; color: #9ca3af; font-style: italic; font-size: 9.5px;">غیرفعال</div>`;
        }

        // 5. Oven Idle Time html
        let ovenIdleHtml = '';
        if (stages.baking.duration > 0) {
          if (stages.baking.isFirst) {
            ovenIdleHtml = `
              <div style="text-align: center; color: #6b7280; font-size: 9px;">
                خالی از شروع شیفت<br/>
                <span style="font-family: monospace; color: #9ca3af;">(${toPersianDigits(stages.baking.idleTimeBefore)} دقیقه)</span>
              </div>
            `;
          } else if (stages.baking.idleTimeBefore > 0) {
            ovenIdleHtml = `
              <div style="text-align: center;">
                <div style="font-family: monospace; font-size: 11px; font-weight: 900; color: #d97706;">
                  ${toPersianDigits(stages.baking.idleTimeBefore)} دقیقه
                </div>
                <div style="font-size: 8.5px; color: #b45309; font-weight: bold; margin-top: 1px;">بیکاری فر</div>
              </div>
            `;
          } else {
            ovenIdleHtml = `
              <div style="text-align: center; color: #059669; font-weight: bold; font-size: 9.5px; background-color: #ecfdf5; padding: 2px 4px; border-radius: 3px; display: inline-block;">
                بدون وقفه
              </div>
            `;
          }
        } else {
          ovenIdleHtml = `<div style="text-align: center; color: #9ca3af; font-style: italic; font-size: 9.5px;">بدون پخت</div>`;
        }

        // 6. Cooling column html
        const coolingHtml = stages.cooling.duration > 0 ? `
          <div style="text-align: center;">
            <div style="font-family: monospace; font-size: 10px; font-weight: bold; color: #047857;">
              ${toPersianDigits(minutesToClockString(stages.cooling.start))} - ${toPersianDigits(minutesToClockString(stages.cooling.end))}
            </div>
            <div style="font-size: 9px; color: #059669; margin-top: 2px;">(${toPersianDigits(stages.cooling.duration)} دقیقه)</div>
          </div>
        ` : `<div style="text-align: center; color: #9ca3af; font-style: italic; font-size: 9.5px;">غیرفعال</div>`;

        // 7. Packaging column html
        const packagingHtml = stages.packaging.duration > 0 ? `
          <div style="text-align: center;">
            <div style="font-family: monospace; font-size: 10px; font-weight: bold; color: #4b5563;">
              ${toPersianDigits(minutesToClockString(stages.packaging.start))} - ${toPersianDigits(minutesToClockString(stages.packaging.end))}
            </div>
            <div style="font-size: 9px; color: #6b7280; margin-top: 2px;">(${toPersianDigits(stages.packaging.duration)} دقیقه)</div>
          </div>
        ` : `<div style="text-align: center; color: #9ca3af; font-style: italic; font-size: 9.5px;">غیرفعال</div>`;

        tableRows += `
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 8px; font-weight: bold; border-left: 1px solid #e2e8f0; background-color: #f8fafc; text-align: right; vertical-align: middle;">
              <div style="color: #059669; font-size: 10.5px; font-weight: 900; margin-bottom: 3px;">راک ${toPersianDigits(item.rackOrder.rackNumber)}</div>
              <div style="font-size: 8.5px; color: #475569; font-weight: 500; line-height: 1.4;">${allProdNames}</div>
            </td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; vertical-align: top;">${kneadingHtml}</td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; vertical-align: top;">${productionHtml}</td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">${proofingHtml}</td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; background-color: rgba(254, 242, 242, 0.5); text-align: center; vertical-align: middle;">${bakingHtml}</td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; background-color: rgba(254, 243, 199, 0.2); text-align: center; vertical-align: middle;">${ovenIdleHtml}</td>
            <td style="padding: 8px; border-left: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">${coolingHtml}</td>
            <td style="padding: 8px; text-align: center; vertical-align: middle;">${packagingHtml}</td>
          </tr>
        `;
      });

      reportHtml = `
        ${header}
        <h2 style="font-size: 13px; text-align: center; background-color: #e0f2fe; border: 1px solid #bae6fd; padding: 8px; margin-bottom: 15px; border-radius: 8px; color: #0369a1; font-weight: 900;">
          جدول تطبیقی ترتیبی فرآیندهای موازی و زنجیره پخت کارگاه (Parallel Chain)
        </h2>
        <table style="width: 100%; border-collapse: collapse; text-align: right; border: 1px solid #cbd5e1; direction: rtl; font-size: 9.5px;">
          <thead>
            <tr style="background-color: #1e293b; color: white;">
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: right; width: 14%;">راک / محصولات</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: right; width: 15%;">۱. خمیرگیری</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: right; width: 17%;">۲. تولید</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: center; width: 11%;">۳. گرمخانه</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: center; background-color: #be123c; width: 13%;">۴. پخت در فر</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: center; background-color: #d97706; width: 10%;">بیکاری فر بین پخت‌ها</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: center; width: 10%;">۵. خنک‌سازی</th>
              <th style="padding: 8px; border: 1px solid #cbd5e1; font-size: 9.5px; font-weight: 900; text-align: center; width: 10%;">۶. بسته‌بندی</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-top: 15px; font-size: 9px; line-height: 1.5; color: #475569;">
          <strong style="color: #1e293b; display: block; margin-bottom: 4px;">💡 راهنمای سرپرست تولید برای تطبیق فرآیندها:</strong>
          • فازهای خمیرگیری و چانه‌گیری به صورت موازی برای راک‌ها زمان‌بندی شده‌اند تا تداخلی در اشغال فر به وجود نیاید.<br/>
          • مدت زمان بیکاری فر بین پخت‌ها حداقل مقدار ممکن انتخاب شده است تا بهره‌وری حرارتی کارگاه حفظ گردد.<br/>
          • تداخل‌های فر با رنگ قرمز مشخص می‌شوند و حتماً باید بر اساس اولویت‌بندی مجدد راک‌ها رفع گردند.
        </div>
        ${footer}
      `;
    } else if (printType === 'process') {
      if (printSubSelection === 'kneading') {
        reportTitle = 'لیست کار دپارتمان آماده‌سازی و خمیرگیری';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          rack.rackOrder.items.forEach((item: any) => {
            const assign = settings.productAssignments.find(a => a.productId === item.productId);
            const kDur = assign ? (assign.kneadingTime ?? 15) : 15;
            if (kDur <= 0 || assign?.hasKneading === false) return;

            tableRows += `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold;">${getProdName(item.productId)}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${toPersianDigits(minutesToClockString(s.kneading.start))} الی ${toPersianDigits(minutesToClockString(s.kneading.end))}</td>
                <td style="padding: 10px; font-size: 11px;">${toPersianDigits(kDur)} دقیقه</td>
                <td style="padding: 10px; font-size: 10.5px; color: #4b5563;">کاسه خمیر تکی - طبق دستور استاندارد فرمولاسیون</td>
              </tr>
            `;
          });
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">فرآیند ۱: لیست زمان‌بندی خمیرگیری (آماده‌سازی مواد اولیه)</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #d97706; color: white;">
                <th style="padding: 8px; border: 1px solid #d97706; font-size: 11px;">شماره راک مربوطه</th>
                <th style="padding: 8px; border: 1px solid #d97706; font-size: 11px;">نام محصول خمیر</th>
                <th style="padding: 8px; border: 1px solid #d97706; font-size: 11px;">ساعت کار خمیرگیر</th>
                <th style="padding: 8px; border: 1px solid #d97706; font-size: 11px;">مدت زمان خمیرگیری</th>
                <th style="padding: 8px; border: 1px solid #d97706; font-size: 11px;">توضیحات فنی دپارتمان خمیر</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ خمیرگیری فعالی تعریف نشده است.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'shaping') {
        reportTitle = 'لیست کار دپارتمان فرم‌دهی و چانه‌گیری';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          rack.rackOrder.items.forEach((item: any) => {
            const assign = settings.productAssignments.find(a => a.productId === item.productId);
            if (assign?.hasProduction === false) return;
            const qtyPerTray = assign?.qtyPerTray || 20;
            const totalQty = item.qtyToProduce;
            const completeTrays = Math.floor(totalQty / qtyPerTray);
            const remainder = totalQty % qtyPerTray;
            const incompleteTrays = remainder > 0 ? 1 : 0;

            const pStage = rack.productStages?.find((ps: any) => ps.productId === item.productId);
            const absStart = s.kneading.start + (pStage?.productionStart || 0);
            const absEnd = s.kneading.start + (pStage?.productionEnd || 0);

            tableRows += `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold;">${getProdName(item.productId)}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${toPersianDigits(minutesToClockString(absStart))} الی ${toPersianDigits(minutesToClockString(absEnd))}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold; color:#10b981;">${toPersianDigits(totalQty)} عدد</td>
                <td style="padding: 10px; font-size: 11px;">${toPersianDigits(completeTrays)} کامل</td>
                <td style="padding: 10px; font-size: 11px; color:#d97706;">${toPersianDigits(incompleteTrays)} ناقص (${toPersianDigits(remainder)} محصول)</td>
                <td style="padding: 10px; font-size: 11px; font-weight:bold;">${toPersianDigits(item.traysNeeded)} سینی</td>
              </tr>
            `;
          });
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">فرآیند ۲: لیست دپارتمان فرم‌دهی، چانه‌گیری و سینی‌چینی</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #2563eb; color: white;">
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">شماره راک</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">محصول</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">ساعت کار پرسنل</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">تعداد کل</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">سینی کامل</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">سینی ناقص (مانده)</th>
                <th style="padding: 8px; border: 1px solid #2563eb; font-size: 11px;">جمع کل سینی راک</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="7" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ فرم دهی فعالی ثبت نشده است.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'proofing') {
        reportTitle = 'لیست کنترل فرآیند گرمخانه و تخمیر نهایی';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s || !s.proofing.needs || s.proofing.duration <= 0) return;
          const productsNames = rack.rackOrder.items.map((it: any) => getProdName(it.productId)).join(' + ');

          tableRows += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
              <td style="padding: 10px; font-size: 11px;">${productsNames}</td>
              <td style="padding: 10px; font-size: 11px; font-family: monospace; font-weight: bold; color: #7c3aed;">${toPersianDigits(minutesToClockString(s.proofing.start))}</td>
              <td style="padding: 10px; font-size: 11px; font-family: monospace; font-weight: bold; color: #059669;">${toPersianDigits(minutesToClockString(s.proofing.end))}</td>
              <td style="padding: 10px; font-size: 11px;">${toPersianDigits(s.proofing.duration)} دقیقه</td>
              <td style="padding: 10px; font-size: 10px; color:#4b5563;">دما ۳۸ درجه | رطوبت ۸۵٪ - کنترل دقیق برای جلوگیری از اورپروف شدن خمیر</td>
            </tr>
          `;
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">فرآیند ۳: لیست زمان‌بندی کنترل گرمخانه تخمیر نهایی</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #7c3aed; color: white;">
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">شماره راک</th>
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">محصولات موجود در راک</th>
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">ساعت ورود به گرمخانه</th>
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">ساعت خروج از گرمخانه</th>
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">مدت زمان کل استراحت</th>
                <th style="padding: 8px; border: 1px solid #7c3aed; font-size: 11px;">پروتکل بهداشتی و کنترلی</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="6" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ راکی در گرمخانه تخمیر نهایی حضور ندارد.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'baking') {
        reportTitle = 'برنامه فرها و زنجیره پخت نانوایان';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s || s.baking.duration <= 0) return;
          const productsNames = rack.rackOrder.items.map((it: any) => getProdName(it.productId)).join(' + ');
          const ovenObj = settings.ovens.find(o => o.id === s.baking.ovenId);

          tableRows += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
              <td style="padding: 10px; font-size: 11px; font-weight: bold;">${productsNames}</td>
              <td style="padding: 10px; font-size: 11px; font-weight: bold; color: #be123c;">${ovenObj?.name || 'فر نامشخص'}</td>
              <td style="padding: 10px; font-size: 11.5px; font-family: monospace; font-weight: 900; color: #be123c;">${toPersianDigits(minutesToClockString(s.baking.start))} الی ${toPersianDigits(minutesToClockString(s.baking.end))}</td>
              <td style="padding: 10px; font-size: 11px; font-weight: bold;">${toPersianDigits(rack.analysis.bakingTemp || 200)} درجه</td>
              <td style="padding: 10px; font-size: 11px;">${toPersianDigits(s.baking.duration)} دقیقه</td>
              <td style="padding: 10px; font-size: 11px; color:#4b5563;">${rack.rackOrder.bakingTechnique === '8-8' ? 'تکنیک ۸-۸' : 'عادی'}</td>
            </tr>
          `;
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">فرآیند ۴: برنامه کنترل فرها، زمان‌بندی و اولویت پخت تنورداران</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #be123c; color: white;">
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">راک مبدا</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">محصولات راک پخت</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">نام و شماره فر اختصاصی</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">ساعت پخت دقیق (شروع - پایان)</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">دمای هدف فر</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">مدت زمان پخت</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">تکنیک پخت</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="7" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ برنامه‌ریزی پختی برای فرها وجود ندارد.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'packaging') {
        reportTitle = 'لیست کنترل دپارتمان بسته‌بندی و تحویل کالا';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          rack.rackOrder.items.forEach((item: any) => {
            const assign = settings.productAssignments.find(a => a.productId === item.productId);
            if (assign?.hasPackaging === false) return;

            const coolStart = s.baking.end;
            const coolEnd = s.baking.end + (assign?.coolingTimePerUnit || 1);
            const packStart = s.packaging.start;
            const packEnd = s.packaging.end;

            tableRows += `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold;">${getProdName(item.productId)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold; color: #059669;">${toPersianDigits(item.qtyToProduce)} عدد</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${toPersianDigits(minutesToClockString(coolStart))} الی ${toPersianDigits(minutesToClockString(coolEnd))}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace; font-weight: bold; color: #3b82f6;">${toPersianDigits(minutesToClockString(packStart))} الی ${toPersianDigits(minutesToClockString(packEnd))}</td>
                <td style="padding: 10px; font-size: 10.5px; color:#4b5563;">بسته‌بندی بهداشتی تک‌عددی در سلفون با اتمسفر اصلاح‌شده</td>
              </tr>
            `;
          });
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">فرآیند ۵ و ۶: برنامه کنترل دپارتمان خنک‌سازی راک و بسته‌بندی نهایی کالا</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #10b981; color: white;">
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">راک منشا پخت</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">محصول جهت بسته‌بندی</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">مقدار سفارش واقعی</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">بازه زمانی خنک‌شدن راک</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">بازه زمانی دقیق بسته‌بندی کالا</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">دستورالعمل بسته‌بندی دپارتمان</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="6" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ محصولی در دپارتمان بسته‌بندی برنامه‌ریزی نشده است.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      }
    } else if (printType === 'department') {
      if (printSubSelection === 'prep-knead') {
        reportTitle = 'برنامه کار دپارتمان آماده‌سازی و خمیرگیری کارگاه گاتان';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          rack.rackOrder.items.forEach((item: any) => {
            const assign = settings.productAssignments.find(a => a.productId === item.productId);
            const kDur = assign ? (assign.kneadingTime ?? 15) : 15;
            const hasKnead = assign ? (assign.hasKneading !== false) : true;
            const hasProd = assign ? (assign.hasProduction !== false) : true;
            
            const pStage = rack.productStages?.find((ps: any) => ps.productId === item.productId);
            const shapeStart = s.kneading.start + (pStage?.productionStart || 0);
            const shapeEnd = s.kneading.start + (pStage?.productionEnd || 0);

            tableRows += `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold;">${getProdName(item.productId)}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${hasKnead && kDur > 0 ? `${toPersianDigits(minutesToClockString(s.kneading.start))} - ${toPersianDigits(minutesToClockString(s.kneading.end))} (${toPersianDigits(kDur)}دقیقه)` : 'فاقد خمیرگیری'}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${hasProd && pStage ? `${toPersianDigits(minutesToClockString(shapeStart))} - ${toPersianDigits(minutesToClockString(shapeEnd))} (${toPersianDigits(pStage.productionDuration)}دقیقه)` : 'فاقد تولید'}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold; color: #059669;">${toPersianDigits(item.qtyToProduce)} عدد (${toPersianDigits(item.traysNeeded)} سینی)</td>
              </tr>
            `;
          });
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">برنامه دپارتمان آماده‌سازی خمیر، توزین کالا و چانه‌گیری پرسنل</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #0d9488; color: white;">
                <th style="padding: 8px; border: 1px solid #0d9488; font-size: 11px;">راک مقصد</th>
                <th style="padding: 8px; border: 1px solid #0d9488; font-size: 11px;">محصول تولیدی خمیر</th>
                <th style="padding: 8px; border: 1px solid #0d9488; font-size: 11px;">بازه زمانی خمیرگیری</th>
                <th style="padding: 8px; border: 1px solid #0d9488; font-size: 11px;">بازه زمانی چانه و شکل‌دهی</th>
                <th style="padding: 8px; border: 1px solid #0d9488; font-size: 11px;">تعداد کل تولید و سینی مورد نیاز</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ خمیرگیری یا فرم‌دهی فعالی ثبت نشده است.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'ferment-bake') {
        reportTitle = 'برنامه کار دپارتمان پخت و گرمخانه کارگاه گاتان';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          const productsNames = rack.rackOrder.items.map((it: any) => getProdName(it.productId)).join(' + ');
          const ovenObj = settings.ovens.find(o => o.id === s.baking.ovenId);

          tableRows += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
              <td style="padding: 10px; font-size: 11px;">${productsNames}</td>
              <td style="padding: 10px; font-size: 11px; font-family: monospace;">${s.proofing.needs && s.proofing.duration > 0 ? `${toPersianDigits(minutesToClockString(s.proofing.start))} - ${toPersianDigits(minutesToClockString(s.proofing.end))} (${toPersianDigits(s.proofing.duration)} دقیقه)` : 'بدون گرمخانه'}</td>
              <td style="padding: 10px; font-size: 11px; font-family: monospace; font-weight: bold; color: #be123c;">${toPersianDigits(minutesToClockString(s.baking.start))} - ${toPersianDigits(minutesToClockString(s.baking.end))}</td>
              <td style="padding: 10px; font-size: 11px; font-weight: bold; color: #059669;">${ovenObj?.name || 'فر'} (${toPersianDigits(rack.analysis.bakingTemp || 200)}°)</td>
            </tr>
          `;
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">برنامه دپارتمان فرها، گرمخانه تخمیر نهایی و کنترل زنجیره پخت</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #be123c; color: white;">
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">شماره راک</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">نام محصولات راک</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">بازه زمانی گرمخانه</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">بازه زمانی دقیق پخت فر</th>
                <th style="padding: 8px; border: 1px solid #be123c; font-size: 11px;">نام فر و دمای هدف پخت</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ راکی برنامه‌ریزی گرمخانه یا فر ندارد.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      } else if (printSubSelection === 'cool-pack') {
        reportTitle = 'برنامه کار دپارتمان خنک‌سازی، بسته‌بندی و تحویل کارگاه گاتان';
        let tableRows = '';
        timelineData.racks.forEach((rack) => {
          const s = rack.stages;
          if (!s) return;
          rack.rackOrder.items.forEach((item: any) => {
            const assign = settings.productAssignments.find(a => a.productId === item.productId);
            if (assign?.hasPackaging === false) return;

            const coolStart = s.baking.end;
            const coolEnd = s.baking.end + (assign?.coolingTimePerUnit || 1);
            const packStart = s.packaging.start;
            const packEnd = s.packaging.end;

            tableRows += `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: bold; color: #059669; font-size: 11px;">راک ${toPersianDigits(rack.rackOrder.rackNumber)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold;">${getProdName(item.productId)}</td>
                <td style="padding: 10px; font-size: 11px; font-weight: bold; color: #059669;">${toPersianDigits(item.qtyToProduce)} عدد</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace;">${toPersianDigits(minutesToClockString(coolStart))} الی ${toPersianDigits(minutesToClockString(coolEnd))}</td>
                <td style="padding: 10px; font-size: 11px; font-family: monospace; font-weight: bold; color: #2563eb;">${toPersianDigits(minutesToClockString(packStart))} الی ${toPersianDigits(minutesToClockString(packEnd))}</td>
              </tr>
            `;
          });
        });

        reportHtml = `
          ${header}
          <h2 style="font-size: 14px; text-align: center; background-color: #f3f4f6; padding: 6px; margin-bottom: 15px; border-radius: 6px; color: #1f2937;">برنامه دپارتمان سردخانه، خنک‌سازی راک‌ها، بسته‌بندی و الصاق لیبل</h2>
          <table style="width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px;">
            <thead>
              <tr style="background-color: #10b981; color: white;">
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">شماره راک</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">نام محصول</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">تعداد نهایی تحویل</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">بازه زمانی خنک‌شدن راک</th>
                <th style="padding: 8px; border: 1px solid #10b981; font-size: 11px;">بازه زمانی دقیق بسته‌بندی و درج تاریخ</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#9fa6b2;">هیچ برنامه خنک‌سازی یا بسته‌بندی فعالی یافت نشد.</td></tr>`}
            </tbody>
          </table>
          ${footer}
        `;
      }
    }

    printElement(reportTitle, reportHtml);
    setShowPrintModal(false);
  };

  // Load products of active period
  const periodProducts = useMemo(() => {
    return db.products.filter(p => p.periodId === activePeriodId);
  }, [db.products, activePeriodId]);

  // Helper to find a product name
  const getProdName = (id: string) => {
    return periodProducts.find(p => p.id === id)?.name || 'کالای نامشخص';
  };

  const getProdCategoryName = (prodId: string) => {
    const prod = periodProducts.find(p => p.id === prodId);
    if (!prod) return 'عمومی';
    const cat = db.productCategories.find(c => c.id === prod.categoryId);
    return cat ? cat.name : 'عمومی';
  };

  // Helper to convert minutes to Clock format
  const minutesToClockString = (totalMins: number) => {
    const startHourNum = parseInt(settings.startHour.split(':')[0]) || 6;
    const startMinNum = parseInt(settings.startHour.split(':')[1]) || 0;
    
    const absoluteMins = startHourNum * 60 + startMinNum + totalMins;
    const h = Math.floor(absoluteMins / 60) % 24;
    const m = Math.floor(absoluteMins % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // --- 2. SETTINGS EDIT HANDLERS ---
  const handleUpdateGeneralSettings = (field: keyof ProductionPlanningSettings, value: any) => {
    saveSettings({
      ...settings,
      [field]: value
    });
  };

  const handleSaveOven = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOven || !editingOven.name) return;
    
    let updatedOvens = [...settings.ovens];
    if (editingOven.id) {
      updatedOvens = updatedOvens.map(o => o.id === editingOven.id ? (editingOven as ProductionOven) : o);
    } else {
      updatedOvens.push({
        id: `oven-${Date.now()}`,
        name: editingOven.name,
        type: editingOven.type || 'گردان',
        trayCapacity: Number(editingOven.trayCapacity) || 12
      });
    }

    saveSettings({ ...settings, ovens: updatedOvens });
    setEditingOven(null);
  };

  const handleSaveTray = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTray || !editingTray.name) return;

    let updatedTrays = [...settings.trays];
    if (editingTray.id) {
      updatedTrays = updatedTrays.map(t => t.id === editingTray.id ? (editingTray as ProductionTray) : t);
    } else {
      updatedTrays.push({
        id: `tray-${Date.now()}`,
        name: editingTray.name,
        totalCount: Number(editingTray.totalCount) || 50,
        traysPerRackTier: Number(editingTray.traysPerRackTier) || 2
      });
    }

    saveSettings({ ...settings, trays: updatedTrays });
    setEditingTray(null);
  };

  const handleSaveAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignment || !editingAssignment.productId || !editingAssignment.trayTypeId) return;

    // Check if bakingSettings covers all defined ovens
    const defaultBaking: Record<string, { temp: number; time: number }> = editingAssignment.bakingSettings || {};
    settings.ovens.forEach(o => {
      if (!defaultBaking[o.id]) {
        defaultBaking[o.id] = { temp: 200, time: 15 };
      }
    });

    const finalAssignment: ProductTrayAssignment = {
      productId: editingAssignment.productId,
      trayTypeId: editingAssignment.trayTypeId,
      qtyPerTray: Number(editingAssignment.qtyPerTray) || 20,
      prodTimePerUnit: Number(editingAssignment.prodTimePerUnit) || 0.1, // minutes
      needsProofing: editingAssignment.needsProofing ?? false,
      proofingTime: Number(editingAssignment.proofingTime) || 0,
      steamRequired: editingAssignment.steamRequired ?? false,
      alternatingShelves: editingAssignment.alternatingShelves ?? false,
      coolingTimePerUnit: Number(editingAssignment.coolingTimePerUnit) || 1,
      packagingTimePerUnit: Number(editingAssignment.packagingTimePerUnit) || 0.5,
      bakingSettings: defaultBaking,
      allowedOvens: editingAssignment.allowedOvens || settings.ovens.map(o => o.id),
      kneadingTime: Number(editingAssignment.kneadingTime) || 15,
      hasKneading: editingAssignment.hasKneading !== false,
      hasProduction: editingAssignment.hasProduction !== false,
      hasProofing: editingAssignment.hasProofing !== false,
      hasBaking: editingAssignment.hasBaking !== false,
      hasCooling: editingAssignment.hasCooling !== false,
      hasPackaging: editingAssignment.hasPackaging !== false,
    };

    let updatedAssignments = [...settings.productAssignments];
    const existingIndex = updatedAssignments.findIndex(a => a.productId === finalAssignment.productId);
    if (existingIndex > -1) {
      updatedAssignments[existingIndex] = finalAssignment;
    } else {
      updatedAssignments.push(finalAssignment);
    }

    saveSettings({ ...settings, productAssignments: updatedAssignments });
    setEditingAssignment(null);
  };

  const handleDeleteOven = (id: string) => {
    saveSettings({
      ...settings,
      ovens: settings.ovens.filter(o => o.id !== id)
    });
  };

  const handleDeleteTray = (id: string) => {
    saveSettings({
      ...settings,
      trays: settings.trays.filter(t => t.id !== id)
    });
  };

  const handleDeleteAssignment = (productId: string) => {
    saveSettings({
      ...settings,
      productAssignments: settings.productAssignments.filter(a => a.productId !== productId)
    });
  };

  const handleSaveRack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRack || !editingRack.name || !editingRack.rackNumber) return;

    let updatedRacks = [...(settings.racks || [])];
    if (editingRack.id) {
      updatedRacks = updatedRacks.map(r => r.id === editingRack.id ? (editingRack as ProductionRackDefinition) : r);
    } else {
      updatedRacks.push({
        id: `rack-${Date.now()}`,
        rackNumber: editingRack.rackNumber,
        name: editingRack.name,
        tiersCount: Number(editingRack.tiersCount) || 10
      });
    }

    updatedRacks.sort((a, b) => {
      const aNum = parseInt(a.rackNumber) || 0;
      const bNum = parseInt(b.rackNumber) || 0;
      return aNum - bNum || a.rackNumber.localeCompare(b.rackNumber);
    });

    saveSettings({
      ...settings,
      racks: updatedRacks,
      totalRacks: updatedRacks.length
    });
    setEditingRack(null);
  };

  const handleDeleteRack = (id: string) => {
    if (confirm('آیا از حذف این راک اطمینان دارید؟')) {
      const updatedRacks = (settings.racks || []).filter(r => r.id !== id);
      saveSettings({
        ...settings,
        racks: updatedRacks,
        totalRacks: updatedRacks.length
      });
    }
  };

  // --- 3. PRODUCTION BOARD & RACK SCHEDULER ---
  const [editingRackOrder, setEditingRackOrder] = useState<Partial<ProductionPlanningOrder> | null>(null);
  const [isNewRackOrder, setIsNewRackOrder] = useState<boolean>(false);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [newOrderItem, setNewOrderItem] = useState<{ productId: string; qty: number }>({ productId: '', qty: 0 });
  const [editingOrderItemId, setEditingOrderItemId] = useState<string | null>(null);
  const [editingOrderItemQty, setEditingOrderItemQty] = useState<number>(0);
  const [editingOrderItemProdId, setEditingOrderItemProdId] = useState<string>('');

  useEffect(() => {
    if (!editingRackOrder) {
      setRackProductSearch('');
      setIsOpenRackProductDropdown(false);
    }
  }, [editingRackOrder]);

  // Calculate trays needed for a product order
  const calculateTraysRequired = (productId: string, qty: number) => {
    const assignment = settings.productAssignments.find(a => a.productId === productId);
    if (!assignment || assignment.qtyPerTray === 0) return 1;
    return Math.ceil(qty / assignment.qtyPerTray);
  };

  const handleAddRackOrder = () => {
    const newId = `rack-order-${Date.now()}`;
    const nextNum = settings.racks && settings.racks.length > 0
      ? (settings.racks[orders.length % settings.racks.length]?.rackNumber || String(orders.length + 1))
      : String(orders.length + 1);
    const newOrder: ProductionPlanningOrder = {
      id: newId,
      periodId: activePeriodId,
      rackNumber: nextNum,
      bakingTechnique: 'عادی',
      items: [],
      dateStr: selectedDate,
      postBakeNotes: ''
    };
    saveOrders([...orders, newOrder]);
    setEditingRackOrder(newOrder);
    setIsNewRackOrder(true);
  };

  const handleCancelEditingRackOrder = () => {
    if (isNewRackOrder && editingRackOrder) {
      saveOrders(orders.filter(o => o.id !== editingRackOrder.id));
    }
    setEditingRackOrder(null);
    setIsNewRackOrder(false);
  };

  const handleUpdateRackOrderField = (orderId: string, field: keyof ProductionPlanningOrder, value: any) => {
    const updated = orders.map(o => o.id === orderId ? { ...o, [field]: value } : o);
    saveOrders(updated);
  };

  const handleSaveRackOrderItems = () => {
    if (!editingRackOrder) return;

    // Validate rack capacity against limits
    const tempAnalysis = analyzeRack(editingRackOrder as ProductionPlanningOrder);
    const matchedRack = settings.racks?.find(r => String(r.rackNumber) === String(editingRackOrder.rackNumber));
    const limit = matchedRack ? matchedRack.tiersCount : settings.tiersPerRack;

    if (tempAnalysis.maxTiersNeeded > limit) {
      alert(`خطای تکمیل ظرفیت: تعداد طبقات مورد نیاز (${toPersianDigits(tempAnalysis.maxTiersNeeded)} طبقه) از ظرفیت مجاز این راک (${toPersianDigits(limit)} طبقه) بیشتر است و با ظرفیت راک تطابق ندارد!`);
      return;
    }

    const updated = orders.map(o => o.id === editingRackOrder.id ? (editingRackOrder as ProductionPlanningOrder) : o);
    saveOrders(updated);
    setEditingRackOrder(null);
    setIsNewRackOrder(false);
  };

  const handleAddProductToEditingRack = () => {
    if (!editingRackOrder || !newOrderItem.productId || newOrderItem.qty <= 0) return;

    const existIndex = (editingRackOrder.items || []).findIndex(i => i.productId === newOrderItem.productId);
    const trays = calculateTraysRequired(newOrderItem.productId, newOrderItem.qty);
    
    let updatedItems = [...(editingRackOrder.items || [])];
    if (existIndex > -1) {
      updatedItems[existIndex] = {
        ...updatedItems[existIndex],
        qtyToProduce: updatedItems[existIndex].qtyToProduce + newOrderItem.qty,
        traysNeeded: calculateTraysRequired(newOrderItem.productId, updatedItems[existIndex].qtyToProduce + newOrderItem.qty)
      };
    } else {
      updatedItems.push({
        productId: newOrderItem.productId,
        qtyToProduce: newOrderItem.qty,
        traysNeeded: trays,
        priority: updatedItems.length + 1
      });
    }

    setEditingRackOrder({
      ...editingRackOrder,
      items: updatedItems
    });
    setNewOrderItem({ productId: '', qty: 0 });
    setRackProductSearch('');
  };

  const handleRemoveProductFromEditingRack = (productId: string) => {
    if (!editingRackOrder) return;
    const filtered = (editingRackOrder.items || []).filter(i => i.productId !== productId)
      .map((item, index) => ({ ...item, priority: index + 1 }));
    setEditingRackOrder({
      ...editingRackOrder,
      items: filtered
    });
  };

  const handleMoveOrderItemPriority = (productId: string, direction: 'up' | 'down') => {
    if (!editingRackOrder || !editingRackOrder.items) return;
    const items = [...editingRackOrder.items];
    const index = items.findIndex(i => i.productId === productId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    // Swap
    const temp = items[index];
    items[index] = items[newIndex];
    items[newIndex] = temp;

    // Re-assign priorities
    const updatedItems = items.map((item, idx) => ({
      ...item,
      priority: idx + 1
    }));

    setEditingRackOrder({
      ...editingRackOrder,
      items: updatedItems
    });
  };

  const handleStartEditOrderItem = (productId: string, qty: number) => {
    setEditingOrderItemId(productId);
    setEditingOrderItemQty(qty);
    setEditingOrderItemProdId(productId);
  };

  const handleSaveOrderItemEdit = (originalProductId: string) => {
    if (!editingRackOrder || !editingOrderItemProdId || editingOrderItemQty <= 0) return;

    let updatedItems = [...(editingRackOrder.items || [])];
    const existIndex = updatedItems.findIndex(i => i.productId === editingOrderItemProdId);

    if (editingOrderItemProdId === originalProductId) {
      updatedItems = updatedItems.map(item => {
        if (item.productId === originalProductId) {
          return {
            ...item,
            qtyToProduce: editingOrderItemQty,
            traysNeeded: calculateTraysRequired(originalProductId, editingOrderItemQty)
          };
        }
        return item;
      });
    } else {
      if (existIndex > -1) {
        const existingItem = updatedItems[existIndex];
        const newQty = existingItem.qtyToProduce + editingOrderItemQty;
        updatedItems = updatedItems.filter(item => item.productId !== originalProductId);
        updatedItems = updatedItems.map(item => {
          if (item.productId === editingOrderItemProdId) {
            return {
              ...item,
              qtyToProduce: newQty,
              traysNeeded: calculateTraysRequired(editingOrderItemProdId, newQty)
            };
          }
          return item;
        });
      } else {
        updatedItems = updatedItems.map(item => {
          if (item.productId === originalProductId) {
            return {
              ...item,
              productId: editingOrderItemProdId,
              qtyToProduce: editingOrderItemQty,
              traysNeeded: calculateTraysRequired(editingOrderItemProdId, editingOrderItemQty)
            };
          }
          return item;
        });
      }
    }

    setEditingRackOrder({
      ...editingRackOrder,
      items: updatedItems
    });
    setEditingOrderItemId(null);
  };

  const handleMoveRackPriority = (orderId: string, direction: 'up' | 'down') => {
    const index = orders.findIndex(o => o.id === orderId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= orders.length) return;

    const updated = [...orders];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;

    saveOrders(updated);
  };

  const handleDeleteRackOrder = (orderId: string) => {
    const filtered = orders.filter(o => o.id !== orderId);
    saveOrders(filtered);
  };

  // --- 4. RACK ANALYSIS AND ERROR CHECKS ---
  const analyzeRack = (rackOrder: ProductionPlanningOrder) => {
    const result = {
      isValid: true,
      errors: [] as string[],
      warnings: [] as string[],
      totalTrays: 0,
      maxTiersNeeded: 0,
      ovenType: '' as string,
      bakingTemp: null as number | null,
      maxBakingTime: 0,
      steamRequired: null as boolean | null,
      alternatingShelves: false,
      needsProofing: false,
      maxProofingTime: 0,
      maxKneadingTime: 0,
      totalCoolingTime: 0,
      totalPackagingTime: 0,
      totalProdTime: 0,
    };

    if (!rackOrder.items || rackOrder.items.length === 0) {
      result.isValid = false;
      result.errors.push('هیچ محصولی در این راک تعریف نشده است.');
      return result;
    }

    // Reference the first product inside the rack
    const firstItem = rackOrder.items[0];
    const firstAssign = settings.productAssignments.find(a => a.productId === firstItem.productId);
    
    if (firstAssign) {
      result.steamRequired = firstAssign.steamRequired;
      result.needsProofing = firstAssign.needsProofing && (firstAssign.hasProofing !== false);
    }

    rackOrder.items.forEach((item, index) => {
      const assign = settings.productAssignments.find(a => a.productId === item.productId);
      if (!assign) {
        result.isValid = false;
        result.errors.push(`محصول ${getProdName(item.productId)} انتساب سینی ندارد. ابتدا در تنظیمات تعریف کنید.`);
        return;
      }

      // Max kneading time
      const hasKnead = assign.hasKneading !== false;
      const productKneading = hasKnead ? (assign.kneadingTime ?? 15) : 0;
      result.maxKneadingTime = Math.max(result.maxKneadingTime, productKneading);

      // Check tray capacity & racks
      const trayType = settings.trays.find(t => t.id === assign.trayTypeId);
      if (trayType) {
        // Trays per shelf tier
        const shelfCapacity = trayType.traysPerRackTier;
        const totalTraysNeeded = item.traysNeeded;
        result.totalTrays += totalTraysNeeded;
        
        // Shelf tiers needed
        let tiersNeeded = Math.ceil(totalTraysNeeded / shelfCapacity);
        if (assign.alternatingShelves) {
          result.alternatingShelves = true;
          // Halves the capacity, which means double the required tiers
          tiersNeeded = tiersNeeded * 2;
        }
        result.maxTiersNeeded += tiersNeeded;
      }

      // Proofing check
      const hasProof = assign.hasProofing !== false;
      if (assign.needsProofing && hasProof) {
        result.needsProofing = true;
        result.maxProofingTime = Math.max(result.maxProofingTime, assign.proofingTime);
      }

      // Oven & Baking Settings Check
      const hasBake = assign.hasBaking !== false;
      if (hasBake) {
        // Find which ovens are allowed for this product, defaulting to all if none specified
        const productAllowedOvens = assign.allowedOvens && assign.allowedOvens.length > 0
          ? assign.allowedOvens
          : settings.ovens.map(o => o.id);
        const firstProductAllowedOvens = firstAssign?.allowedOvens && firstAssign.allowedOvens.length > 0
          ? firstAssign.allowedOvens
          : settings.ovens.map(o => o.id);
        
        // Find intersection of allowed ovens
        const commonOvens = productAllowedOvens.filter(id => firstProductAllowedOvens.includes(id));
        if (commonOvens.length === 0) {
          result.isValid = false;
          result.errors.push(`تداخل فر مجاز: محصول "${getProdName(item.productId)}" و محصول اول راک فر مشترک مجاز ندارند.`);
        }

        const primaryOvenId = commonOvens[0] || productAllowedOvens[0] || settings.ovens[0]?.id;
        const ovenConfig = settings.ovens.find(o => o.id === primaryOvenId);
        const firstProductOvenConfig = firstAssign ? settings.ovens.find(o => o.id === (firstProductAllowedOvens[0] || settings.ovens[0]?.id)) : null;

        if (ovenConfig) {
          if (firstProductOvenConfig && firstProductOvenConfig.type !== ovenConfig.type) {
            result.isValid = false;
            result.errors.push(`تداخل نوع فر: محصول "${getProdName(item.productId)}" نیاز به فر ${ovenConfig.type} دارد در حالی که اولین محصول راک نیاز به فر ${firstProductOvenConfig.type} دارد.`);
          }
          result.ovenType = ovenConfig.type;
        }

        const bakeDetails = assign.bakingSettings[primaryOvenId] || { temp: 200, time: 15 };
        if (bakeDetails) {
          const firstBakeDetails = firstAssign ? (firstAssign.bakingSettings[primaryOvenId] || { temp: 200, time: 15 }) : null;
          if (firstBakeDetails && firstBakeDetails.temp !== bakeDetails.temp) {
            result.isValid = false;
            result.errors.push(`تداخل دمای پخت: دمای پخت "${getProdName(item.productId)}" (${bakeDetails.temp}°C) با دمای اولین محصول راک (${firstBakeDetails.temp}°C) مغایر است.`);
          }
          result.bakingTemp = bakeDetails.temp;

          if (index > 0 && firstBakeDetails && bakeDetails.time > firstBakeDetails.time) {
            result.isValid = false;
            result.errors.push(`تداخل زمان پخت: زمان پخت محصول ثانویه "${getProdName(item.productId)}" (${bakeDetails.time} دقیقه) بیشتر از زمان پخت اولین محصول راک (${firstBakeDetails.time} دقیقه) است.`);
          }
          result.maxBakingTime = Math.max(result.maxBakingTime, bakeDetails.time);
        }
      }

      // Steam check
      if (hasBake && firstAssign && firstAssign.steamRequired !== assign.steamRequired) {
        result.warnings.push(`تفاوت بخاردهی: محصول "${getProdName(item.productId)}" و "${getProdName(firstItem.productId)}" نیاز یکسانی به بخار ندارند. محصول بدون بخار را می‌توان ۱۰ دقیقه بعد اضافه کرد.`);
      }

      // Production Time calculations
      const hasProd = assign.hasProduction !== false;
      const hasCool = assign.hasCooling !== false;
      const hasPack = assign.hasPackaging !== false;

      result.totalProdTime += hasProd ? (item.qtyToProduce * assign.prodTimePerUnit) : 0;
      result.totalCoolingTime = Math.max(result.totalCoolingTime, hasCool ? assign.coolingTimePerUnit : 0);
      result.totalPackagingTime += hasPack ? (item.qtyToProduce * assign.packagingTimePerUnit) : 0;
    });

    // Check Rack tier overflow
    const matchedRack = settings.racks?.find(r => String(r.rackNumber) === String(rackOrder.rackNumber));
    const tiersLimit = matchedRack ? matchedRack.tiersCount : settings.tiersPerRack;

    if (result.maxTiersNeeded > tiersLimit) {
      result.isValid = false;
      result.errors.push(`تکمیل ظرفیت راک: تعداد طبقات مورد نیاز (${result.maxTiersNeeded}) از کل طبقات مجاز راک (${tiersLimit}) فراتر رفته است.`);
    }

    return result;
  };

  const editingRackTiersLimit = useMemo(() => {
    if (!editingRackOrder) return settings.tiersPerRack;
    const matchedRack = settings.racks?.find(r => String(r.rackNumber) === String(editingRackOrder.rackNumber));
    return matchedRack ? matchedRack.tiersCount : settings.tiersPerRack;
  }, [editingRackOrder, settings]);

  const editingRackAnalysis = useMemo(() => {
    if (!editingRackOrder) return null;
    return analyzeRack(editingRackOrder as ProductionPlanningOrder);
  }, [editingRackOrder, settings]);

  // --- 5. DAILY TIMELINE GANTT GENERATOR ---
  // Calculates real start/end minutes for each phase of each rack in chronological order.
  const timelineData = useMemo(() => {
    let lastKneadingEnd = settings.prepTimeMinutes;
    let lastProductionEnd = settings.prepTimeMinutes;
    
    // We keep track of oven occupancies to resolve bottlenecks and show idle times
    // ovenOccupancies: record of ovenId -> array of { startMin, endMin }
    const ovenOccupancies: Record<string, { startMin: number; endMin: number; rackNum: string }[]> = {};
    settings.ovens.forEach(o => { ovenOccupancies[o.id] = []; });

    // Proofing room active occupancy count
    const proofingOccupancies: { startMin: number; endMin: number }[] = [];

    // Track completed racks for dynamic capacity validation (racks and trays are occupied from kneading.start to packaging.end)
    const completedRacks: {
      rackOrder: any;
      analysis: any;
      stages: {
        kneading: { start: number; end: number; duration: number };
        production: { start: number; end: number; duration: number };
        proofing: { start: number; end: number; duration: number; needs: boolean };
        baking: { start: number; end: number; duration: number; ovenId: string; idleTimeBefore: number; isFirst: boolean; hasCollision: boolean; collidingWith: string };
        cooling: { start: number; end: number; duration: number };
        packaging: { start: number; end: number; duration: number };
      };
    }[] = [];

    const calculatedRacks = orders.map((rackOrder, index) => {
      const analysis = analyzeRack(rackOrder);
      if (!analysis.isValid || rackOrder.items.length === 0) {
        return {
          rackOrder,
          analysis,
          stages: null,
          error: 'محاسبه زمان‌بندی به دلیل خطای راک لغو شد.'
        };
      }

      // 1. Calculate relative product-by-product stages (relative to T_rack = 0)
      const productStages: {
        productId: string;
        kneadingStart: number;
        kneadingEnd: number;
        productionStart: number;
        productionEnd: number;
        kneadingDuration: number;
        productionDuration: number;
      }[] = [];

      rackOrder.items.forEach((item, itemIdx) => {
        const assign = settings.productAssignments.find(a => a.productId === item.productId);
        const hasKnead = assign ? (assign.hasKneading !== false) : true;
        const hasProd = assign ? (assign.hasProduction !== false) : true;

        const kDur = hasKnead ? (assign ? (assign.kneadingTime ?? 15) : 15) : 0;
        const pDur = hasProd ? Math.ceil(item.qtyToProduce * (assign ? assign.prodTimePerUnit : 1)) : 0;

        let kStart = 0;
        let kEnd = 0;
        let pStart = 0;
        let pEnd = 0;

        if (itemIdx === 0) {
          kStart = 0;
          kEnd = kStart + kDur;
          pStart = kEnd;
          pEnd = pStart + pDur;
        } else {
          const prevProductStage = productStages[itemIdx - 1];
          
          if (kDur > 0) {
            const prevPDur = prevProductStage.productionDuration;
            if (prevPDur >= kDur) {
              kEnd = prevProductStage.productionEnd;
              kStart = kEnd - kDur;
            } else {
              kStart = prevProductStage.kneadingEnd;
              kEnd = kStart + kDur;
            }
          } else {
            kStart = prevProductStage.productionEnd;
            kEnd = kStart;
          }

          pStart = kEnd;
          pEnd = pStart + pDur;
        }

        productStages.push({
          productId: item.productId,
          kneadingStart: kStart,
          kneadingEnd: kEnd,
          productionStart: pStart,
          productionEnd: pEnd,
          kneadingDuration: kDur,
          productionDuration: pDur
        });
      });

      // 2. Determine T_rack (absolute start time of the rack)
      let T_rack = settings.prepTimeMinutes;
      if (index > 0) {
        const firstProductStage = productStages[0];
        T_rack = Math.max(lastKneadingEnd, lastProductionEnd - (firstProductStage ? firstProductStage.productionStart : 0));
      }

      // 3. Absolute times for overall rack stages
      const activeKneadingStages = productStages.filter(ps => ps.kneadingDuration > 0);
      const activeProductionStages = productStages.filter(ps => ps.productionDuration > 0);

      const overallStartKneading = T_rack;
      const overallEndKneading = activeKneadingStages.length > 0
        ? T_rack + Math.max(...activeKneadingStages.map(ps => ps.kneadingEnd))
        : T_rack;

      const overallStartProduction = activeProductionStages.length > 0
        ? T_rack + Math.min(...activeProductionStages.map(ps => ps.productionStart))
        : T_rack;
      const overallEndProduction = activeProductionStages.length > 0
        ? T_rack + Math.max(...activeProductionStages.map(ps => ps.productionEnd))
        : T_rack;

      const kneadingDuration = overallEndKneading - overallStartKneading;
      const productionDuration = overallEndProduction - overallStartProduction;

      lastKneadingEnd = overallEndKneading;
      lastProductionEnd = overallEndProduction;

      const startKneading = overallStartKneading;
      const endKneading = overallEndKneading;
      const startProduction = overallStartProduction;
      const endProduction = overallEndProduction;

      // Proofing stage (گرمخانه)
      const firstItem = rackOrder.items[0];
      const firstAssign = settings.productAssignments.find(a => a.productId === firstItem.productId);
      const hasProof = firstAssign ? (firstAssign.hasProofing !== false) : true;
      const needsProofing = analysis.needsProofing && hasProof;

      let startProofing = endProduction;
      let proofingDuration = needsProofing ? analysis.maxProofingTime : 0;
      let endProofing = startProofing + proofingDuration;

      // Proofing Capacity control warning
      if (needsProofing) {
        proofingOccupancies.push({ startMin: startProofing, endMin: endProofing });
      }

      // Baking stage (پخت)
      const hasBake = firstAssign ? (firstAssign.hasBaking !== false) : true;

      // Find the appropriate oven dynamically based on assignment
      let assignedOvenId = settings.ovens[0]?.id;
      let startBaking = endProofing;
      let bakingDuration = hasBake ? analysis.maxBakingTime : 0;
      let idleTimeBeforeBake = 0;
      let isFirstBake = true;
      let hasOvenCollision = false;
      let collidingRackNum = '';

      if (hasBake) {
        // Calculate the intersection of allowed ovens of all products in this rack
        let allowedOvenIds = settings.ovens.map(o => o.id);
        rackOrder.items.forEach(item => {
          const assign = settings.productAssignments.find(a => a.productId === item.productId);
          if (assign) {
            const itemAllowed = assign.allowedOvens && assign.allowedOvens.length > 0
              ? assign.allowedOvens
              : settings.ovens.map(o => o.id);
            allowedOvenIds = allowedOvenIds.filter(id => itemAllowed.includes(id));
          }
        });
        if (allowedOvenIds.length === 0) {
          // Fallback to firstAssign's allowed ovens if no intersection
          allowedOvenIds = firstAssign?.allowedOvens && firstAssign.allowedOvens.length > 0
            ? firstAssign.allowedOvens
            : settings.ovens.map(o => o.id);
        }

        // Among the allowed ovens, find the one that becomes free the earliest
        let bestOvenId = allowedOvenIds[0] || settings.ovens[0]?.id;
        let earliestStartBaking = Infinity;
        let bestOvenBookingInfo: any = null;

        allowedOvenIds.forEach(oId => {
          const bookings = ovenOccupancies[oId] || [];
          let tempStartBaking = endProofing;
          let tempCollision = false;
          let tempCollidingRackNum = '';
          let tempIsFirst = true;
          let tempIdleTime = 0;

          if (bookings.length > 0) {
            tempIsFirst = false;
            const lastBooking = bookings[bookings.length - 1];
            
            // Do not consider it a collision if the overlap is up to 5 minutes
            const collision = bookings.find(b => b.startMin < endProofing && endProofing < b.endMin && (b.endMin - endProofing) > 5);
            if (collision) {
              tempCollision = true;
              tempCollidingRackNum = collision.rackNum;
            }

            bookings.forEach(b => {
              if (tempStartBaking < b.endMin) {
                tempStartBaking = b.endMin; // wait in queue!
              }
            });
            tempIdleTime = tempStartBaking - lastBooking.endMin;
          } else {
            tempIsFirst = true;
            tempIdleTime = tempStartBaking; // idle from start of shift
          }

          // Apply 8-8 technique staggering if both ovens are allowed
          if (rackOrder.bakingTechnique === '8-8' && allowedOvenIds.length > 1) {
            settings.ovens.forEach(otherOven => {
              if (otherOven.id !== oId) {
                const otherBookings = ovenOccupancies[otherOven.id] || [];
                otherBookings.forEach(ob => {
                  if (Math.abs(tempStartBaking - ob.startMin) < 8) {
                    tempStartBaking = ob.startMin + 8;
                  }
                });
              }
            });
          }

          if (tempStartBaking < earliestStartBaking) {
            earliestStartBaking = tempStartBaking;
            bestOvenId = oId;
            bestOvenBookingInfo = {
              startBaking: tempStartBaking,
              isFirstBake: tempIsFirst,
              idleTimeBeforeBake: tempIdleTime,
              hasOvenCollision: tempCollision,
              collidingRackNum: tempCollidingRackNum
            };
          }
        });

        // Apply best oven selections
        assignedOvenId = bestOvenId;
        if (bestOvenBookingInfo) {
          startBaking = bestOvenBookingInfo.startBaking;
          isFirstBake = bestOvenBookingInfo.isFirstBake;
          idleTimeBeforeBake = bestOvenBookingInfo.idleTimeBeforeBake;
          hasOvenCollision = bestOvenBookingInfo.hasOvenCollision;
          collidingRackNum = bestOvenBookingInfo.collidingRackNum;
        }

        // Book the chosen oven
        const bookings = ovenOccupancies[assignedOvenId] || [];
        const endBakeCalculated = startBaking + bakingDuration;
        bookings.push({
          startMin: startBaking,
          endMin: endBakeCalculated,
          rackNum: rackOrder.rackNumber
        });
        ovenOccupancies[assignedOvenId] = bookings;
      } else {
        isFirstBake = false;
        idleTimeBeforeBake = 0;
      }

      if (hasOvenCollision) {
        const ovenName = settings.ovens.find(o => o.id === assignedOvenId)?.name || 'فر نامشخص';
        analysis.errors.push(`خطای تداخل فر: فر (${ovenName}) در زمان اتمام گرمخانه‌گذاری این راک (${minutesToClockString(endProofing)}) به علت پخت راک ${toPersianDigits(collidingRackNum)} پر است و محصول نمی‌تواند بلافاصله وارد فر شود.`);
      }

      const endBaking = startBaking + bakingDuration;

      // Post-Bake stages: Cooling & Packaging
      const hasCool = firstAssign ? (firstAssign.hasCooling !== false) : true;
      const startCooling = endBaking;
      const coolingDuration = hasCool ? analysis.totalCoolingTime : 0; // Rack's cooling time directly
      const endCooling = startCooling + coolingDuration;

      const hasPack = firstAssign ? (firstAssign.hasPackaging !== false) : true;
      const startPackaging = endCooling;
      const packagingDuration = hasPack ? Math.ceil(analysis.totalPackagingTime / rackOrder.items.length) : 0;
      const endPackaging = startPackaging + packagingDuration;

      // 1. Calculate active previous racks at startKneading (T_rack)
      const activePrevRacks = completedRacks.filter(pr => pr.stages && pr.stages.packaging.end > startKneading);
      const occupiedRacksCount = activePrevRacks.length;
      const maxRacks = (settings.racks && settings.racks.length > 0) ? settings.racks.length : settings.totalRacks;

      if (occupiedRacksCount + 1 > maxRacks) {
        analysis.errors.push(`خطای ظرفیت راک: در زمان شروع این راک (${minutesToClockString(startKneading)})، هیچ راک آزادی در کارگاه وجود ندارد. تمامی ${toPersianDigits(maxRacks)} راک تعریف شده مشغول هستند و تا زمان اتمام بسته‌بندی راک‌های قبلی آزاد نمی‌شوند.`);
      }

      // 2. Check Tray capacity for each type
      const occupiedTrays: Record<string, number> = {};
      settings.trays.forEach(t => { occupiedTrays[t.id] = 0; });

      activePrevRacks.forEach(pr => {
        pr.rackOrder.items.forEach((item: any) => {
          const assign = settings.productAssignments.find(a => a.productId === item.productId);
          if (assign && occupiedTrays[assign.trayTypeId] !== undefined) {
            occupiedTrays[assign.trayTypeId] += item.traysNeeded;
          }
        });
      });

      const currentTraysNeeded: Record<string, number> = {};
      rackOrder.items.forEach(item => {
        const assign = settings.productAssignments.find(a => a.productId === item.productId);
        if (assign) {
          currentTraysNeeded[assign.trayTypeId] = (currentTraysNeeded[assign.trayTypeId] || 0) + item.traysNeeded;
        }
      });

      settings.trays.forEach(trayType => {
        const occupied = occupiedTrays[trayType.id] || 0;
        const needed = currentTraysNeeded[trayType.id] || 0;
        if (needed > 0 && occupied + needed > trayType.totalCount) {
          analysis.errors.push(`خطای ظرفیت سینی (${trayType.name}): در زمان شروع این راک (${minutesToClockString(startKneading)})، تعداد ${toPersianDigits(occupied + needed)} سینی از نوع ${trayType.name} نیاز است، در حالی که کل سینی‌های موجود در کارگاه ${toPersianDigits(trayType.totalCount)} عدد می‌باشد. لطفاً منتظر آزاد شدن سینی‌ها بعد از بسته‌بندی راک‌های قبلی بمانید.`);
        }
      });

      const resultObj = {
        rackOrder,
        analysis,
        productStages,
        stages: {
          kneading: { start: startKneading, end: endKneading, duration: kneadingDuration },
          production: { start: startProduction, end: endProduction, duration: productionDuration },
          proofing: { start: startProofing, end: endProofing, duration: proofingDuration, needs: needsProofing },
          baking: { start: startBaking, end: endBaking, duration: bakingDuration, ovenId: assignedOvenId, idleTimeBefore: idleTimeBeforeBake, isFirst: isFirstBake, hasCollision: hasOvenCollision, collidingWith: collidingRackNum },
          cooling: { start: startCooling, end: endCooling, duration: coolingDuration },
          packaging: { start: startPackaging, end: endPackaging, duration: packagingDuration },
        }
      };

      completedRacks.push(resultObj);
      return resultObj;
    });

    // Check proofing room max capacity warning at any given time slice
    const proofingCapacityExceeded = false;
    let maxProofingRacksActiveAtOnce = 0;
    
    // Simple sweep-line to check overlapping proofing Racks
    const events: { time: number; type: number }[] = [];
    proofingOccupancies.forEach(occ => {
      events.push({ time: occ.startMin, type: 1 }); // enter
      events.push({ time: occ.endMin, type: -1 }); // exit
    });
    events.sort((a, b) => a.time - b.time || a.type - b.type);
    
    let currentProofingRacks = 0;
    events.forEach(e => {
      currentProofingRacks += e.type;
      if (currentProofingRacks > maxProofingRacksActiveAtOnce) {
        maxProofingRacksActiveAtOnce = currentProofingRacks;
      }
    });

    const proofingCapacityWarning = maxProofingRacksActiveAtOnce > settings.proofingMaxRacks
      ? `هشدار گلوگاه گرمخانه: تداخل حداکثر ظرفیت گرمخانه رخ داده است! در شلوغ‌ترین زمان ${toPersianDigits(maxProofingRacksActiveAtOnce)} راک همزمان در گرمخانه قرار می‌گیرند در حالی که ظرفیت گرمخانه شما حداکثر ${toPersianDigits(settings.proofingMaxRacks)} راک است.`
      : null;

    return {
      racks: calculatedRacks,
      proofingCapacityWarning,
      maxProofingRacksActiveAtOnce,
      ovenOccupancies
    };
  }, [orders, settings, selectedDate]);

  const editingRackAvailability = useMemo(() => {
    if (!editingRackOrder) return null;
    const currentCalc = timelineData.racks.find(r => r.rackOrder.id === editingRackOrder.id);
    if (!currentCalc || !currentCalc.stages) return null;

    const startMin = currentCalc.stages.kneading.start;

    const currentIdx = timelineData.racks.findIndex(r => r.rackOrder.id === editingRackOrder.id);
    const priorActiveRacks = timelineData.racks.slice(0, currentIdx).filter(r => r.stages && r.stages.packaging.end > startMin);

    const maxRacks = (settings.racks && settings.racks.length > 0) ? settings.racks.length : settings.totalRacks;
    const freeRacks = Math.max(0, maxRacks - priorActiveRacks.length);

    // Trays occupied
    const occupiedTrays: Record<string, number> = {};
    settings.trays.forEach(t => { occupiedTrays[t.id] = 0; });
    priorActiveRacks.forEach(pr => {
      pr.rackOrder.items.forEach((item: any) => {
        const assign = settings.productAssignments.find(a => a.productId === item.productId);
        if (assign && occupiedTrays[assign.trayTypeId] !== undefined) {
          occupiedTrays[assign.trayTypeId] += item.traysNeeded;
        }
      });
    });

    const traysStatus = settings.trays.map(t => {
      const occupied = occupiedTrays[t.id] || 0;
      const free = Math.max(0, t.totalCount - occupied);
      return {
        id: t.id,
        name: t.name,
        total: t.totalCount,
        occupied,
        free
      };
    });

    return {
      startMin,
      freeRacks,
      maxRacks,
      traysStatus
    };
  }, [editingRackOrder, timelineData, settings]);

  const availableRacksForEditing = useMemo(() => {
    if (!editingRackOrder || !settings.racks) return [];
    
    // Find the current index and startMin of this rack
    const currentIdx = timelineData.racks.findIndex(r => r.rackOrder.id === editingRackOrder.id);
    if (currentIdx === -1) return settings.racks;
    
    const currentCalc = timelineData.racks[currentIdx];
    if (!currentCalc || !currentCalc.stages) return settings.racks;

    const startMin = currentCalc.stages.kneading.start;
    
    // Prior active racks that overlap with this rack's start time
    // (i.e. those whose packaging phase hasn't ended yet at startMin)
    const priorActiveRacks = timelineData.racks.slice(0, currentIdx).filter(r => r.stages && r.stages.packaging.end > startMin);
    
    const occupiedRackNumbers = new Set(
      priorActiveRacks
        .map(r => String(r.rackOrder.rackNumber).trim())
        .filter(Boolean)
    );

    return settings.racks.filter(r => {
      const rackNum = String(r.rackNumber).trim();
      // If it's not occupied, it's available.
      // If it is the currently selected rack number for this editing rack order, it's also available.
      return !occupiedRackNumbers.has(rackNum) || rackNum === String(editingRackOrder.rackNumber).trim();
    });
  }, [editingRackOrder, timelineData, settings]);

  const dayDurationMinutes = useMemo(() => {
    const startHourNum = parseInt(settings.startHour?.split(':')[0]) || 6;
    const startMinNum = parseInt(settings.startHour?.split(':')[1]) || 0;
    const endHourNum = parseInt(settings.endHour?.split(':')[0]) || 24;
    const endMinNum = parseInt(settings.endHour?.split(':')[1]) || 0;
    
    let totalMins = (endHourNum * 60 + endMinNum) - (startHourNum * 60 + startMinNum);
    if (totalMins <= 0) {
      totalMins = 18 * 60; // fallback to 18 hours (1080 mins)
    }
    return totalMins;
  }, [settings.startHour, settings.endHour]);

  // --- 6. SMART OPTIMIZATION SUGGESTIONS ---
  const optimizationSuggestions = useMemo(() => {
    const suggestions: { title: string; desc: string; type: 'info' | 'success' | 'warning' }[] = [];

    if (orders.length === 0) {
      return [{
        title: 'ثبت سفارشات تولید',
        desc: 'لطفاً ابتدا سفارشات و راک‌های تولیدی جدید را از دکمه "ایجاد راک تولیدی جدید" اضافه نمایید تا موتور بهینه‌ساز فعال گردد.',
        type: 'info' as const
      }];
    }

    // 1. Check oven idle time / scheduling gaps
    let totalBakingTime = 0;
    let minBakeStart = 9999;
    let maxBakeEnd = 0;

    (Object.values(timelineData.ovenOccupancies) as any[]).forEach(bookings => {
      (bookings as any[]).forEach(b => {
        totalBakingTime += b.endMin - b.startMin;
        if (b.startMin < minBakeStart) minBakeStart = b.startMin;
        if (b.endMin > maxBakeEnd) maxBakeEnd = b.endMin;
      });
    });

    const span = maxBakeEnd - minBakeStart;
    if (span > 0) {
      const idleTime = span - totalBakingTime;
      const idlePercent = Math.round((idleTime / span) * 100);
      if (idlePercent > 30) {
        suggestions.push({
          title: 'بهینه‌سازی زمان‌های خالی فرها',
          desc: `فرها در بازه تولید پخت حدود ${toPersianDigits(idlePercent)}٪ زمان خالی (کاهش بهره‌وری) دارند. پیشنهاد می‌شود با جابجایی اولویت راک‌ها، زمان استراحت در گرمخانه و زمان آماده‌سازی را هم‌پوشان کنید تا فرها پشت‌سرهم شارژ شوند.`,
          type: 'warning'
        });
      } else {
        suggestions.push({
          title: 'بهره‌وری فوق‌العاده فرها',
          desc: 'چیدمان فعلی اولویت راک‌ها کمترین تداخل فر را دارد و فرها با حداکثر ظرفیت زمانی و حداقل فواصل خالی کار می‌کنند.',
          type: 'success'
        });
      }
    }

    // 2. Multi-product rack grouping recommendation
    // Look at products that have the same baking temperature and oven types but are in separate racks
    const separateRacksProducts: string[] = [];
    orders.forEach(r => {
      r.items.forEach(i => {
        if (!separateRacksProducts.includes(i.productId)) {
          separateRacksProducts.push(i.productId);
        }
      });
    });

    if (orders.length > 1) {
      suggestions.push({
        title: 'پیشنهاد تجمیع محصولات هم‌دما',
        desc: 'می‌توانید با ترکیب محصولات هم‌دما و هم‌نوع فر در یک راک واحد (مشروط به اینکه زمان پخت محصول دوم کمتر از محصول اول باشد و نیاز بخار یکسانی داشته باشند)، تعداد راک‌های فعال روزانه را کاهش دهید.',
        type: 'info'
      });
    }

    // 3. Spacing / alternation notice
    const hasAlternating = settings.productAssignments.some(a => a.alternatingShelves);
    if (hasAlternating) {
      suggestions.push({
        title: 'مدیریت راک‌های یک‌درمیان (فاصله‌دار)',
        desc: 'به دلیل تعریف فاصله طبقاتی برای برخی محصولات، ظرفیت مفید راک‌های مربوطه به نصف کاهش یافته است. تا حد امکان این محصولات را در یک راک متمرکز کنید تا بقیه راک‌ها با ظرفیت کامل طبقات بارگیری شوند.',
        type: 'info'
      });
    }

    // 4. Proofing room warnings
    if (timelineData.proofingCapacityWarning) {
      suggestions.push({
        title: 'گلوگاه گرمخانه تخمیر',
        desc: 'ظرفیت گرمخانه شما در ساعات اوج تکمیل خواهد شد. پیشنهاد می‌شود شروع تولید راک‌های نیاز به گرمخانه را با فواصل ۳۰ دقیقه‌ای از یکدیگر برنامه‌ریزی کنید.',
        type: 'warning'
      });
    }

    // 5. Oven collision warnings
    const collisionRacks = timelineData.racks.filter(r => r.stages?.baking?.hasCollision);
    if (collisionRacks.length > 0) {
      collisionRacks.forEach(r => {
        const b = r.stages!.baking;
        suggestions.push({
          title: `تداخل پخت فوری راک ${toPersianDigits(r.rackOrder.rackNumber)}`,
          desc: `فر در زمان اتمام گرمخانه‌گذاری این راک پر است (تداخل با راک ${toPersianDigits(b.collidingWith)}). جهت جلوگیری از خراب شدن خمیر، اولویت راک‌ها را تغییر دهید تا بلافاصله پس از خروج از گرمخانه فر خالی باشد.`,
          type: 'warning'
        });
      });
    }

    return suggestions;
  }, [orders, settings, timelineData]);

  return (
    <div className="space-y-6 font-sans text-right" dir="rtl">
      
      {/* ================= HEADER CONTROL PANEL ================= */}
      <div className="bg-[#0d0d0f] p-3.5 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/80 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Sliders className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 shrink-0" />
            برنامه‌ریزی تولید و سفارشات کارگاه
          </h1>
          <p className="hidden sm:block text-xs text-zinc-400 mt-1">
            سیستم پیشرفته چیدمان راک‌های تولیدی، زمان‌بندی زنجیره پخت، مدیریت گرمخانه تخمیر و آنالیز تداخل فرها
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-nowrap sm:flex-wrap overflow-x-auto no-scrollbar w-full md:w-auto items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setActiveTab('customer_orders')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'customer_orders'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white'
            }`}
          >
            <ChefHat className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            ثبت سفارش تولید
            {activeCustomerOrdersCount > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${
                activeTab === 'customer_orders'
                  ? 'bg-white/20 text-white'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {toPersianDigits(activeCustomerOrdersCount)}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('planning')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'planning' 
                ? 'bg-emerald-600 text-white shadow-lg' 
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            صفحه برنامه‌ریزی و تایم‌لاین
          </button>
          <button
            onClick={() => setActiveTab('optimization')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'optimization' 
                ? 'bg-emerald-600 text-white shadow-lg' 
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            بهینه‌سازی تولید
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'settings' 
                ? 'bg-emerald-600 text-white shadow-lg' 
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            تنظیمات ظرفیت فر، راک و سینی‌ها
          </button>
        </div>
      </div>

      {/* ================= MAIN CONTENT VIEWPORT ================= */}
      <AnimatePresence mode="wait">
        {activeTab === 'customer_orders' ? (
          <motion.div
            key="customer-orders-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CustomerProductionOrders
              db={db}
              onUpdateDb={onUpdateDb}
              activePeriodId={activePeriodId}
              currentUserName={currentUserName}
            />
          </motion.div>
        ) : activeTab === 'planning' ? (
          <motion.div
            key="planning-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            
            {/* Racks List */}
            <div className="space-y-6">
                <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-black text-white flex items-center gap-1.5">
                        <Layers className="h-4 w-4 text-emerald-400" />
                        لیست اولویت راک‌های تولیدی ({toPersianDigits(orders.length)} راک فعال)
                      </h2>
                      <p className="text-[11px] text-zinc-500">
                        ترتیب راک‌ها مشخص‌کننده اولویت تولید است. از دکمه‌های فلش جهت جابجایی اولویت‌ها استفاده کنید.
                      </p>
                    </div>

                    <button
                      onClick={handleAddRackOrder}
                      className="p-2 px-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white text-xs font-black flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      ایجاد راک تولیدی جدید
                    </button>
                  </div>

                  {orders.length === 0 ? (
                    <div className="p-10 text-center text-zinc-500 bg-zinc-950/40 rounded-2xl border border-zinc-900/50">
                      <HelpIcon className="h-10 w-10 mx-auto text-zinc-600 mb-2" />
                      <p className="text-xs font-bold text-zinc-400">هیچ راک تولیدی در برنامه جاری ایجاد نشده است.</p>
                      <p className="text-[10px] text-zinc-500 mt-1">جهت شروع فرآیند پخت روزانه، روی دکمه فوق کلیک نمایید.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orders.map((order, index) => {
                        const analysis = analyzeRack(order);
                        return (
                          <div 
                            key={order.id}
                            className={`p-5 rounded-2xl bg-[#121214] border transition-all ${
                              analysis.isValid ? 'border-zinc-800 hover:border-zinc-700' : 'border-rose-950/70 bg-rose-950/5'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-3 border-b border-zinc-900">
                              
                              {/* Rack Header */}
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center font-bold font-mono text-emerald-400">
                                  {toPersianDigits(index + 1)}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-black text-white">شماره راک: {toPersianDigits(order.rackNumber)}</h3>
                                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-bold font-mono">
                                      {order.bakingTechnique === '8-8' ? 'تکنیک ۸-۸' : 'تکنیک عادی'}
                                    </span>
                                  </div>
                                  {(() => {
                                    const matchedRack = settings.racks?.find(r => String(r.rackNumber) === String(order.rackNumber));
                                    const tiersCount = matchedRack ? matchedRack.tiersCount : settings.tiersPerRack;
                                    return (
                                      <p className="text-[10px] text-zinc-400 mt-0.5">
                                        دسته بندی: {toPersianDigits(order.items.length)} نوع محصول | کل سینی‌ها: <strong className="text-white">{toPersianDigits(analysis.totalTrays)} سینی</strong> (از {toPersianDigits(tiersCount * (settings.trays[0]?.traysPerRackTier || 2))})
                                      </p>
                                    );
                                  })()}
                                </div>
                              </div>

                              {/* Priority & Edit Controls */}
                              <div className="flex items-center gap-1.5">
                                <button
                                  disabled={index === 0}
                                  onClick={() => handleMoveRackPriority(order.id, 'up')}
                                  className="p-1.5 bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-white rounded-lg disabled:opacity-25 transition-all cursor-pointer"
                                  title="افزایش اولویت"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  disabled={index === orders.length - 1}
                                  onClick={() => handleMoveRackPriority(order.id, 'down')}
                                  className="p-1.5 bg-zinc-900 border border-zinc-850 text-zinc-400 hover:text-white rounded-lg disabled:opacity-25 transition-all cursor-pointer"
                                  title="کاهش اولویت"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>

                                <div className="w-[1px] h-6 bg-zinc-900 mx-1" />

                                {deletingOrderId === order.id ? (
                                  <div className="flex items-center gap-1.5 bg-rose-950/20 border border-rose-900/30 p-1 px-2.5 rounded-xl animate-pulse">
                                    <span className="text-[10px] text-rose-400 font-bold">حذف شود؟</span>
                                    <button
                                      onClick={() => {
                                        handleDeleteRackOrder(order.id);
                                        setDeletingOrderId(null);
                                      }}
                                      className="p-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[9px] font-black px-2 cursor-pointer transition-colors"
                                    >
                                      بله
                                    </button>
                                    <button
                                      onClick={() => setDeletingOrderId(null)}
                                      className="p-1 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded text-[9px] font-bold px-2 cursor-pointer transition-colors"
                                    >
                                      خیر
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => setEditingRackOrder(order)}
                                      className="p-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded-lg text-zinc-300 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                    >
                                      <Edit className="h-3.5 w-3.5 text-zinc-400" />
                                      ویرایش سفارشات
                                    </button>

                                    <button
                                      onClick={() => setDeletingOrderId(order.id)}
                                      className="p-1.5 bg-zinc-900 hover:bg-rose-950/50 hover:border-rose-800 border border-zinc-850 rounded-lg text-rose-500 transition-all cursor-pointer"
                                      title="حذف راک"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Products inside the Rack */}
                            <div className="mt-3 space-y-2">
                              {order.items.length === 0 ? (
                                <p className="text-[10px] text-zinc-500">هیچ محصولی در این راک تعریف نشده است. جهت اضافه کردن روی ویرایش کلیک کنید.</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {order.items.map((item, itemIdx) => {
                                    const assign = settings.productAssignments.find(a => a.productId === item.productId);
                                    return (
                                      <div key={item.productId} className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-900 text-[11px] space-y-1">
                                        <div className="flex items-center justify-between">
                                          <strong className="text-zinc-200">{getProdName(item.productId)}</strong>
                                          <span className="text-[9.5px] font-mono text-zinc-500">#{itemIdx + 1}</span>
                                        </div>
                                        <div className="flex justify-between text-zinc-400">
                                          <span>میزان سفارش:</span>
                                          <strong className="text-emerald-400 font-mono">{toPersianDigits(item.qtyToProduce)} عدد</strong>
                                        </div>
                                        <div className="flex justify-between text-zinc-400">
                                          <span>تعداد سینی:</span>
                                          <strong className="text-zinc-300 font-mono">{toPersianDigits(item.traysNeeded)} سینی</strong>
                                        </div>
                                        {assign && assign.qtyPerTray > 0 && (item.qtyToProduce % assign.qtyPerTray) !== 0 && (
                                          <div className="text-[10px] text-amber-500 bg-amber-500/5 px-2 py-1 rounded-md mt-1 font-bold border border-amber-500/10 flex flex-col gap-0.5">
                                            <div className="flex justify-between">
                                              <span>سینی آخر ناقص:</span>
                                              <span className="font-mono text-amber-400">{toPersianDigits(item.qtyToProduce % assign.qtyPerTray)} محصول</span>
                                            </div>
                                            <div className="text-[9px] text-zinc-500 text-left">
                                              ({toPersianDigits(assign.qtyPerTray - (item.qtyToProduce % assign.qtyPerTray))} عدد کمبود برای تکمیل سینی)
                                            </div>
                                          </div>
                                        )}
                                        {assign?.needsProofing && (
                                          <div className="flex justify-between text-[10px] text-zinc-500">
                                            <span>زمان گرمخانه:</span>
                                            <span>{toPersianDigits(assign.proofingTime)} دقیقه</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Warnings & Errors */}
                              <div className="mt-3 space-y-1.5">
                                {analysis.errors.map((err, errIdx) => (
                                  <div key={errIdx} className="p-2 rounded-lg bg-rose-950/20 text-rose-400 border border-rose-900/50 text-[10px] font-bold flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span>{err}</span>
                                  </div>
                                ))}
                                {analysis.warnings.map((war, warIdx) => (
                                  <div key={warIdx} className="p-2 rounded-lg bg-amber-950/10 text-amber-400 border border-amber-900/45 text-[10px] font-medium flex items-center gap-1.5">
                                    <Info className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span>{war}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            {/* ================= VISUAL DAILY TIMELINE GANTT CHART ================= */}
            <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-6">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-zinc-900 pb-4 gap-4">
                <div>
                  <h2 className="text-sm font-black text-white flex items-center gap-2">
                    <Clock className="h-4.5 w-4.5 text-emerald-400 animate-pulse" />
                    تایم‌لاین روزانه و چارت پخت زنجیره‌ای کارگاه ({toPersianDigits(settings.startHour)} الی {toPersianDigits(settings.endHour)})
                  </h2>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    نمایش گرافیکی و تعاملی جریان کارهای پخت به تفکیک زمان‌های ۱۵ دقیقه‌ای همراه با راهنمای تراز فرآیندها
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[10px] bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/65 animate-fade-in">
                  <div className="flex items-center gap-1.5 px-1"><div className="h-2.5 w-2.5 rounded-md bg-amber-600 shadow-[0_0_8px_rgba(217,119,6,0.2)]"></div><span className="text-zinc-400 font-bold">خمیرگیری</span></div>
                  <div className="flex items-center gap-1.5 px-1"><div className="h-2.5 w-2.5 rounded-md bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.2)]"></div><span className="text-zinc-400 font-bold">تولید</span></div>
                  <div className="flex items-center gap-1.5 px-1"><div className="h-2.5 w-2.5 rounded-md bg-purple-600 shadow-[0_0_8px_rgba(147,51,234,0.2)]"></div><span className="text-zinc-400 font-bold">گرمخانه</span></div>
                  {settings.ovens.map((oven, oIdx) => {
                    const ovenColors = ['bg-rose-600', 'bg-orange-600', 'bg-pink-600', 'bg-red-600'];
                    const colorClass = ovenColors[oIdx % ovenColors.length] || 'bg-rose-600';
                    return (
                      <div key={oven.id} className="flex items-center gap-1.5 px-1">
                        <div className={`h-2.5 w-2.5 rounded-md ${colorClass} shadow-[0_0_8px_rgba(244,63,94,0.2)]`}></div>
                        <span className="text-zinc-300 font-bold">پخت ({oven.name})</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Timeline Phase Visibility Controls */}
              <div className="bg-zinc-950/45 p-4 rounded-2xl border border-zinc-900/60 space-y-3">
                <span className="block text-[10.5px] font-bold text-zinc-400 uppercase tracking-wider">
                  ⚙️ فیلتر و شخصی‌سازی فازهای تایم‌لاین (انتخاب فازهای نمایشی):
                </span>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
                  
                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.kneading}
                      onChange={(e) => setVisibleStages({ ...visibleStages, kneading: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                      خمیرگیری
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.production}
                      onChange={(e) => setVisibleStages({ ...visibleStages, production: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                      تولید
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.proofing}
                      onChange={(e) => setVisibleStages({ ...visibleStages, proofing: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                      گرمخانه
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.baking}
                      onChange={(e) => setVisibleStages({ ...visibleStages, baking: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                      پخت در فر
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.cooling}
                      onChange={(e) => setVisibleStages({ ...visibleStages, cooling: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-teal-500"></span>
                      خنک شدن
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
                    <input 
                      type="checkbox"
                      checked={visibleStages.packaging}
                      onChange={(e) => setVisibleStages({ ...visibleStages, packaging: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-900 text-emerald-600 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                      بسته‌بندی
                    </span>
                  </label>

                </div>
              </div>

              {/* Gantt Row Renderer */}
              {timelineData.racks.length === 0 ? (
                <div className="p-12 text-center text-zinc-600 text-xs italic bg-zinc-950/20 rounded-2xl border border-zinc-900/50">
                  جهت مشاهده چارت زنجیره‌ای تولید، لطفاً حداقل یک راک تولیدی معتبر ایجاد نمایید.
                </div>
              ) : (
                <div className="space-y-6 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-zinc-950">
                  <div className="min-w-[1500px] relative bg-[#09090b]/40 p-5 rounded-2xl border border-zinc-900/85 overflow-visible">
                    
                    {/* Integrated 15-Minute Grid Background (Pixel perfect matching with labels) - Unified z-10 for seamless vertical guide lines */}
                    <div className="absolute top-[60px] bottom-0 right-[296px] left-[20px] pointer-events-none z-10">
                      {Array.from({ length: Math.floor(dayDurationMinutes / 15) + 1 }).map((_, i) => {
                        const isHour = i % 4 === 0;
                        const isHalfHour = i % 2 === 0;
                        const percentRight = ((i * 15) / dayDurationMinutes) * 100;
                        if (percentRight > 100) return null;
                        return (
                          <div
                            key={i}
                            className={`absolute top-0 bottom-0 border-r transition-all ${
                              isHour 
                                ? 'border-zinc-800/80 z-10' 
                                : isHalfHour 
                                ? 'border-zinc-900/40 border-dashed' 
                                : 'border-zinc-950/25 border-dotted'
                            }`}
                            style={{ right: `${percentRight}%` }}
                          />
                        );
                      })}
                    </div>

                    {/* High Fidelity Timescale Header */}
                    <div className="flex items-center gap-4 relative z-20 border-b border-zinc-900 pb-4 mb-2">
                      <span className="w-[260px] flex-shrink-0 font-black text-[11.5px] text-zinc-400 text-right pr-2 select-none">نام راک و محصولات تولیدی</span>
                      <div className="flex-grow relative h-8 select-none">
                        {Array.from({ length: Math.floor(dayDurationMinutes / 15) + 1 }).map((_, i) => {
                          const startHourNum = parseInt(settings.startHour.split(':')[0]) || 6;
                          const startMinNum = parseInt(settings.startHour.split(':')[1]) || 0;
                          const totalMinsOffset = i * 15;
                          const currentAbsMins = (startHourNum * 60 + startMinNum + totalMinsOffset);
                          const currentHour = Math.floor(currentAbsMins / 60) % 24;
                          const currentMin = Math.floor(currentAbsMins % 60);
                          
                          const percentRight = (totalMinsOffset / dayDurationMinutes) * 100;
                          if (percentRight > 100) return null;

                          const isHour = currentMin === 0;
                          const isHalfHour = currentMin === 30;

                          return (
                            <div 
                              key={i} 
                              className="absolute top-0 bottom-0 flex flex-col justify-between items-center"
                              style={{ right: `${percentRight}%`, transform: 'translateX(50%)' }}
                            >
                              {isHour ? (
                                <span className="font-extrabold text-[10.5px] text-zinc-100 font-mono tracking-tight whitespace-nowrap bg-zinc-950/80 px-1 rounded">
                                  {toPersianDigits(`${String(currentHour).padStart(2, '0')}:00`)}
                                </span>
                              ) : isHalfHour ? (
                                <span className="text-[8.5px] text-zinc-500 font-bold font-mono">
                                  {toPersianDigits('۳۰')}
                                </span>
                              ) : (
                                <span className="text-[7px] text-zinc-700 font-mono">
                                  {toPersianDigits(String(currentMin))}
                                </span>
                              )}
                              <div className={`w-[1px] ${isHour ? 'h-2.5 bg-zinc-600' : isHalfHour ? 'h-1.5 bg-zinc-700' : 'h-1 bg-zinc-800'}`} />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Preparation Block (Visual Row) - Styled as a unified grid row */}
                    <div className="flex items-center gap-4 relative z-20 py-3.5 border-b border-zinc-900/40 hover:bg-zinc-900/5 transition-all">
                      <span className="w-[260px] flex-shrink-0 text-right font-black text-[10.5px] text-zinc-400 pr-2 select-none">آماده‌سازی اولیه کارگاه:</span>
                      <div className="flex-grow relative h-10 overflow-visible">
                        {/* Thin Horizontal Center Track for high-end feel */}
                        <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-zinc-900/40 -translate-y-1/2 pointer-events-none" />
                        
                        <div 
                          className="absolute z-20 top-1 bottom-1 bg-gradient-to-l from-zinc-800/90 to-zinc-700/80 text-zinc-300 flex items-center justify-center rounded-xl text-[9px] font-black transition-all px-3 shadow-lg border border-zinc-600/30 backdrop-blur-[1px] hover:brightness-115 cursor-help group"
                          style={{ right: 0, left: `calc(100% - ${Math.min(100, Math.max(0, (settings.prepTimeMinutes / dayDurationMinutes) * 100))}%` }}
                        >
                          آغاز فعالیت‌های کارگاه
                          
                          {/* CSS Tooltip */}
                          <div className="absolute bottom-full mb-2 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                            <div className="bg-zinc-950 text-white text-[10.5px] rounded-xl p-2.5 border border-zinc-800 shadow-2xl whitespace-nowrap space-y-1 text-right">
                              <p className="font-black text-emerald-400 border-b border-zinc-900 pb-1">آماده‌سازی اولیه کارگاه</p>
                              <p className="font-mono text-zinc-300">ساعت: {toPersianDigits(settings.startHour)} الی {toPersianDigits(minutesToClockString(settings.prepTimeMinutes))}</p>
                              <p className="text-zinc-500 text-[9.5px]">مدت زمان کل: {toPersianDigits(settings.prepTimeMinutes)} دقیقه</p>
                            </div>
                            <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-800 rotate-45 -mt-1.5" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Racks list scheduler Gantt layout */}
                    {timelineData.racks.map((item, idx) => {
                      if (!item.stages) {
                        return (
                          <div key={item.rackOrder.id} className="flex items-center gap-4 relative z-20 py-3 border-b border-zinc-900/40">
                            <span className="w-[260px] flex-shrink-0 text-right font-black text-[11px] text-rose-400 pr-2">راک {toPersianDigits(item.rackOrder.rackNumber)}:</span>
                            <div className="flex-grow bg-rose-950/10 h-10 rounded-xl border border-rose-950/45 flex items-center justify-center text-rose-500 text-[10px] font-black">
                              {item.error}
                            </div>
                          </div>
                        );
                      }

                      const stages = item.stages;
                      
                      // Calculate width and right offset percent for each stage
                      const calcPercent = (mins: number) => {
                        return `${Math.min(100, Math.max(0, (mins / dayDurationMinutes) * 100))}%`;
                      };

                      return (
                        <div key={item.rackOrder.id} className="flex items-center gap-4 relative z-20 py-4 border-b border-zinc-900/40 hover:bg-zinc-900/5 transition-all">
                          
                          {/* Column 1: Rack Name & Product Type in one cell */}
                          <div className="w-[260px] flex-shrink-0 text-right pr-2 flex flex-col justify-center select-none col-1-info">
                            <div className="flex items-center gap-2">
                              <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-md font-black text-[10.5px]">
                                راک {toPersianDigits(item.rackOrder.rackNumber)}
                              </span>
                              <span className="text-zinc-500 font-bold text-[9.5px]">
                                ({toPersianDigits(item.rackOrder.items.length)} ردیف)
                              </span>
                            </div>
                            <div className="text-zinc-200 font-extrabold text-[11px] mt-1.5 leading-relaxed truncate" title={item.rackOrder.items.map(it => getProdName(it.productId)).join(' + ')}>
                              {item.rackOrder.items.map(it => getProdName(it.productId)).join(' + ')}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 text-[9px] text-zinc-500 font-mono">
                              <span>شروع: <span className="text-amber-500 font-bold">{toPersianDigits(minutesToClockString(stages.kneading.start))}</span></span>
                              <span className="text-zinc-700 select-none">|</span>
                              <span>پایان پخت: <span className="text-zinc-400 font-bold">{toPersianDigits(minutesToClockString(stages.baking.end))}</span></span>
                            </div>
                          </div>

                          {/* Column 2: Day Schedule Gantt chart bar */}
                          <div className={`flex-grow bg-zinc-950/20 rounded-2xl relative border border-zinc-900/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] overflow-visible ${
                            item.rackOrder.items.length > 1 ? 'h-16' : 'h-12'
                          }`}>
                              {/* Thin horizontal track line in the center of the row */}
                              <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-zinc-900/40 -translate-y-1/2 pointer-events-none" />
                              
                              {/* Kneading Stage */}
                              {visibleStages.kneading && item.productStages && item.productStages.map((pStage, pIdx) => {
                                const absStart = stages.kneading.start + pStage.kneadingStart;
                                const absEnd = stages.kneading.start + pStage.kneadingEnd;
                                const duration = pStage.kneadingDuration;
                                if (duration <= 0) return null;

                                const itemsCount = item.productStages.length;
                                let layoutStyle: React.CSSProperties = {
                                  right: calcPercent(absStart),
                                  left: `calc(100% - ${calcPercent(absEnd)})`,
                                };
                                if (itemsCount > 1) {
                                  const topOffset = 4 + pIdx * (56 / itemsCount);
                                  const blockHeight = (56 / itemsCount) - 3;
                                  layoutStyle.top = `${topOffset}px`;
                                  layoutStyle.height = `${blockHeight}px`;
                                } else {
                                  layoutStyle.top = '4px';
                                  layoutStyle.bottom = '4px';
                                }

                                const prodName = getProdName(pStage.productId);

                                return (
                                  <div 
                                    key={`kneading-${pStage.productId}-${pIdx}`}
                                    className="absolute z-20 bg-gradient-to-l from-amber-500/80 to-amber-600/80 text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),_inset_0_1px_0_rgba(255,255,255,0.15)] border border-amber-500/30 backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group"
                                    style={layoutStyle}
                                  >
                                    <span className="font-mono text-[10px] font-black select-none leading-none">
                                      {toPersianDigits(duration)}
                                    </span>
                                    
                                    {/* Custom CSS Tooltip */}
                                    <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                      <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                        <p className="font-black text-amber-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                          <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                                          فرآیند خمیرگیری: {prodName}
                                        </p>
                                        <p className="font-mono text-zinc-300">ساعت: {toPersianDigits(minutesToClockString(absStart))} الی {toPersianDigits(minutesToClockString(absEnd))}</p>
                                        <p className="text-zinc-500 text-[9.5px]">مدت: {toPersianDigits(duration)} دقیقه</p>
                                      </div>
                                      <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Dough Production Stage */}
                              {visibleStages.production && item.productStages && item.productStages.map((pStage, pIdx) => {
                                const absStart = stages.kneading.start + pStage.productionStart;
                                const absEnd = stages.kneading.start + pStage.productionEnd;
                                const duration = pStage.productionDuration;
                                if (duration <= 0) return null;

                                const itemsCount = item.productStages.length;
                                let layoutStyle: React.CSSProperties = {
                                  right: calcPercent(absStart),
                                  left: `calc(100% - ${calcPercent(absEnd)})`,
                                };
                                if (itemsCount > 1) {
                                  const topOffset = 4 + pIdx * (56 / itemsCount);
                                  const blockHeight = (56 / itemsCount) - 3;
                                  layoutStyle.top = `${topOffset}px`;
                                  layoutStyle.height = `${blockHeight}px`;
                                } else {
                                  layoutStyle.top = '4px';
                                  layoutStyle.bottom = '4px';
                                }

                                const prodName = getProdName(pStage.productId);

                                return (
                                  <div 
                                    key={`production-${pStage.productId}-${pIdx}`}
                                    className="absolute z-20 bg-gradient-to-l from-blue-500/80 to-blue-600/80 text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),_inset_0_1px_0_rgba(255,255,255,0.15)] border border-blue-500/30 backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group"
                                    style={layoutStyle}
                                  >
                                    <span className="font-mono text-[10px] font-black select-none leading-none">
                                      {toPersianDigits(duration)}
                                    </span>
                                    
                                    {/* Custom CSS Tooltip */}
                                    <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                      <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                        <p className="font-black text-blue-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                                          تولید و فرم‌دهی چانه: {prodName}
                                        </p>
                                        <p className="font-mono text-zinc-300">ساعت: {toPersianDigits(minutesToClockString(absStart))} الی {toPersianDigits(minutesToClockString(absEnd))}</p>
                                        <p className="text-zinc-500 text-[9.5px]">مدت: {toPersianDigits(duration)} دقیقه</p>
                                      </div>
                                      <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Proofing Stage (گرمخانه) */}
                              {visibleStages.proofing && stages.proofing.needs && stages.proofing.duration > 0 && (
                                <div 
                                  className="absolute z-20 top-1 bottom-1 bg-gradient-to-l from-purple-500/80 to-purple-600/80 text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),_inset_0_1px_0_rgba(255,255,255,0.15)] border border-purple-500/30 backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group"
                                  style={{ right: calcPercent(stages.proofing.start), left: `calc(100% - ${calcPercent(stages.proofing.end)})` }}
                                >
                                  <span className="font-mono text-[10px] font-black select-none leading-none">
                                    {toPersianDigits(stages.proofing.duration)}
                                  </span>
                                  
                                  {/* Custom CSS Tooltip */}
                                  <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                    <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                      <p className="font-black text-purple-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                                        تخمیر نهایی در گرمخانه
                                      </p>
                                      <p className="font-mono text-zinc-300">زمان: {toPersianDigits(minutesToClockString(stages.proofing.start))} الی {toPersianDigits(minutesToClockString(stages.proofing.end))}</p>
                                      <p className="text-zinc-500 text-[9.5px]">مدت: {toPersianDigits(stages.proofing.duration)} دقیقه</p>
                                    </div>
                                    <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                  </div>
                                </div>
                              )}

                              {/* Baking Stage (فر) */}
                              {visibleStages.baking && stages.baking.duration > 0 && (() => {
                                const ovenIdx = settings.ovens.findIndex(o => o.id === stages.baking.ovenId);
                                const ovenName = settings.ovens[ovenIdx]?.name || 'فر نامشخص';
                                const collisionStyle = 'from-red-600/90 to-rose-600/90 animate-pulse border-red-500/60 shadow-[0_0_15px_rgba(239,68,68,0.25)]';
                                
                                const ovenGradients = [
                                  'from-rose-500/85 to-rose-600/85 border-rose-500/35 shadow-[0_4px_12px_rgba(244,63,94,0.15)]',
                                  'from-orange-500/85 to-orange-600/85 border-orange-500/35 shadow-[0_4px_12px_rgba(249,115,22,0.15)]',
                                  'from-pink-500/85 to-pink-600/85 border-pink-500/35 shadow-[0_4px_12px_rgba(236,72,153,0.15)]',
                                  'from-red-500/85 to-red-600/85 border-red-500/35 shadow-[0_4px_12px_rgba(239,68,68,0.15)]',
                                ];
                                const finalStyle = stages.baking.hasCollision 
                                  ? collisionStyle 
                                  : (ovenGradients[ovenIdx % ovenGradients.length] || ovenGradients[0]);

                                return (
                                  <div 
                                    className={`absolute z-20 top-1 bottom-1 bg-gradient-to-l ${finalStyle} text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 border backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group`}
                                    style={{ right: calcPercent(stages.baking.start), left: `calc(100% - ${calcPercent(stages.baking.end)})` }}
                                  >
                                    <span className="font-mono text-[9px] font-black select-none leading-none flex items-center gap-0.5">
                                      {stages.baking.hasCollision && <AlertTriangle className="h-2.5 w-2.5 text-red-100 flex-shrink-0 animate-bounce" />}
                                      {toPersianDigits(stages.baking.duration)}
                                    </span>
                                    {settings.ovens.length > 1 && (
                                      <span className="text-[7.5px] bg-black/40 px-1 rounded font-black text-white mt-0.5 leading-none block truncate max-w-full">
                                        {ovenName}
                                      </span>
                                    )}
                                    
                                    {/* Custom CSS Tooltip */}
                                    <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                      <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                        <p className="font-black text-rose-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                          <span className="h-2 w-2 rounded-full bg-rose-555"></span>
                                          پخت در {ovenName}
                                        </p>
                                        {stages.baking.hasCollision && (
                                          <p className="text-red-400 font-bold bg-red-950/40 p-1.5 px-2 rounded border border-red-900/30 text-[9.5px] mb-1">
                                            ⚠️ خطا: فر در زمان اتمام گرمخانه‌گذاری پر است! (تداخل با راک {toPersianDigits(stages.baking.collidingWith)})
                                          </p>
                                        )}
                                        <p className="font-mono text-zinc-300">ساعت: {toPersianDigits(minutesToClockString(stages.baking.start))} الی {toPersianDigits(minutesToClockString(stages.baking.end))}</p>
                                        <p className="text-rose-300 text-[9.5px]">مدت: {toPersianDigits(stages.baking.duration)} دقیقه | دمای پخت: {toPersianDigits(item.analysis.bakingTemp || 200)} درجه</p>
                                        <p className="text-zinc-500 text-[9px] pt-0.5">سایر جزئیات فر: {toPersianDigits(ovenName)}</p>
                                      </div>
                                      <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Cooling Stage */}
                              {visibleStages.cooling && stages.cooling.duration > 0 && (
                                <div 
                                  className="absolute z-20 top-1 bottom-1 bg-gradient-to-l from-teal-500/80 to-teal-600/80 text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),_inset_0_1px_0_rgba(255,255,255,0.15)] border border-teal-500/30 backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group"
                                  style={{ right: calcPercent(stages.cooling.start), left: `calc(100% - ${calcPercent(stages.cooling.end)})` }}
                                >
                                  <span className="font-mono text-[10px] font-black select-none leading-none">
                                    {toPersianDigits(stages.cooling.duration)}
                                  </span>
                                  
                                  {/* Custom CSS Tooltip */}
                                  <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                    <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                      <p className="font-black text-teal-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-teal-500"></span>
                                        مرحله خنک شدن راک
                                      </p>
                                      <p className="font-mono text-zinc-300">زمان: {toPersianDigits(minutesToClockString(stages.cooling.start))} الی {toPersianDigits(minutesToClockString(stages.cooling.end))}</p>
                                      <p className="text-zinc-500 text-[9.5px]">مدت: {toPersianDigits(stages.cooling.duration)} دقیقه</p>
                                    </div>
                                    <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                  </div>
                                </div>
                              )}

                              {/* Packaging Stage */}
                              {visibleStages.packaging && stages.packaging.duration > 0 && (
                                <div 
                                  className="absolute z-20 top-1 bottom-1 bg-gradient-to-l from-indigo-500/80 to-indigo-600/80 text-white flex flex-col items-center justify-center rounded-xl transition-all px-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),_inset_0_1px_0_rgba(255,255,255,0.15)] border border-indigo-500/30 backdrop-blur-[1px] hover:scale-[1.02] hover:brightness-110 hover:z-30 cursor-help group"
                                  style={{ right: calcPercent(stages.packaging.start), left: `calc(100% - ${calcPercent(stages.packaging.end)})` }}
                                >
                                  <span className="font-mono text-[10px] font-black select-none leading-none">
                                    {toPersianDigits(stages.packaging.duration)}
                                  </span>
                                  
                                  {/* Custom CSS Tooltip */}
                                  <div className="absolute bottom-full mb-2.5 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col items-center z-30 animate-fade-in pointer-events-none">
                                    <div className="bg-zinc-950 text-white text-[10px] rounded-xl p-2.5 border border-zinc-850 shadow-2xl whitespace-nowrap space-y-1 text-right">
                                      <p className="font-black text-indigo-400 border-b border-zinc-900 pb-1 flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                                        مرحله بسته‌بندی نهایی
                                      </p>
                                      <p className="font-mono text-zinc-300">زمان: {toPersianDigits(minutesToClockString(stages.packaging.start))} الی {toPersianDigits(minutesToClockString(stages.packaging.end))}</p>
                                      <p className="text-zinc-500 text-[9.5px]">مدت: {toPersianDigits(stages.packaging.duration)} دقیقه</p>
                                    </div>
                                    <div className="w-2.5 h-2.5 bg-zinc-950 border-r border-b border-zinc-850 rotate-45 -mt-1.5" />
                                  </div>
                                </div>
                              )}

                            </div>
                        </div>
                      );
                    })}

                  </div>
                </div>
              )}

              {/* Sequential Comparison Table of Baking Chain */}
              {timelineData.racks.length > 0 && (
                <div className="mt-8 border-t border-zinc-900/75 pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                        <Layers className="h-4 w-4 text-emerald-400" />
                        جدول تطبیقی ترتیبی فرآیندهای موازی و زنجیره پخت
                      </h3>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        بررسی، همترازی و مقایسه همزمان بازه‌های زمانی کلیه فازهای تولید راک‌ها برای کاهش اتلاف وقت و همپوشانی‌ها
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowPrintModal(true)}
                        className="p-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        چاپ گزارش دپارتمان‌ها و فرآیندها
                      </button>
                      <button
                        onClick={() => setShowComparisonTable(!showComparisonTable)}
                        className="p-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        {showComparisonTable ? 'پنهان کردن جدول مقایسه‌ای' : 'نمایش جدول مقایسه‌ای'}
                      </button>
                    </div>
                  </div>

                  {showComparisonTable && (
                    <div className="overflow-x-auto rounded-2xl border border-zinc-800/80 bg-zinc-950/25">
                      <table className="w-full text-right text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-zinc-900/60 text-zinc-400 font-black border-b border-zinc-800 select-none">
                            <th className="p-3.5 text-right w-44">راک / محصول شاخص</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40">۱. خمیرگیری</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40">۲. تولید</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40">۳. گرمخانه</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40 bg-rose-950/10 text-rose-300">۴. پخت در فر</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40 bg-amber-950/15 text-amber-300">خالی بودن فر بین پخت‌ها</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40">۵. خنک شدن</th>
                            <th className="p-3.5 text-center border-r border-zinc-900/40">۶. بسته‌بندی</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/60">
                          {timelineData.racks.map((item) => {
                            if (!item.stages) return null;
                            const stages = item.stages;
                            const allProdNames = item.rackOrder.items.map((it: any) => getProdName(it.productId)).join(' + ');
                            return (
                              <tr key={item.rackOrder.id} className="hover:bg-zinc-900/20 transition-colors">
                                <td className="p-3 font-bold text-zinc-300 border-b border-zinc-900/30">
                                  <div className="text-emerald-400 font-extrabold font-mono text-[11.5px] mb-1">
                                    راک {toPersianDigits(item.rackOrder.rackNumber)}
                                  </div>
                                  <div className="text-zinc-400 font-medium text-[10px] leading-relaxed max-w-[160px] break-words">
                                    {allProdNames}
                                  </div>
                                </td>

                                {/* Kneading */}
                                <td className="p-3 border-r border-zinc-900/40 text-right">
                                  <div className="space-y-2">
                                    {item.productStages && item.productStages.map((pStage: any, pIdx: number) => {
                                      const assign = settings.productAssignments.find(a => a.productId === pStage.productId);
                                      const hasKnead = assign ? (assign.hasKneading !== false) : true;
                                      
                                      if (!hasKnead || pStage.kneadingDuration <= 0) {
                                        return (
                                          <div key={pIdx} className="text-zinc-600 italic text-[9.5px]">
                                            {getProdName(pStage.productId)}: فاقد خمیرگیری
                                          </div>
                                        );
                                      }
                                      
                                      const absStart = stages.kneading.start + pStage.kneadingStart;
                                      const absEnd = stages.kneading.start + pStage.kneadingEnd;
                                      
                                      return (
                                        <div key={pIdx} className="bg-amber-500/5 p-1.5 rounded border border-amber-500/10">
                                          <div className="text-[9.5px] text-amber-400 font-black leading-tight truncate mb-0.5" title={getProdName(pStage.productId)}>
                                            {getProdName(pStage.productId)}
                                          </div>
                                          <div className="font-mono text-amber-500 font-bold text-[10px]">
                                            {toPersianDigits(minutesToClockString(absStart))} - {toPersianDigits(minutesToClockString(absEnd))}
                                          </div>
                                          <div className="text-[9px] text-zinc-500 font-medium mt-0.5">({toPersianDigits(pStage.kneadingDuration)} دقیقه)</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>

                                {/* Dough Production */}
                                <td className="p-3 border-r border-zinc-900/40 text-right">
                                  <div className="space-y-2">
                                    {item.productStages && item.productStages.map((pStage: any, pIdx: number) => {
                                      const assign = settings.productAssignments.find(a => a.productId === pStage.productId);
                                      const hasProd = assign ? (assign.hasProduction !== false) : true;
                                      
                                      if (!hasProd || pStage.productionDuration <= 0) {
                                        return (
                                          <div key={pIdx} className="text-zinc-600 italic text-[9.5px]">
                                            {getProdName(pStage.productId)}: فاقد تولید
                                          </div>
                                        );
                                      }
                                      
                                      const absStart = stages.kneading.start + pStage.productionStart;
                                      const absEnd = stages.kneading.start + pStage.productionEnd;
                                      
                                      const rackItem = item.rackOrder.items.find((it: any) => it.productId === pStage.productId);
                                      const totalQty = rackItem ? rackItem.qtyToProduce : 0;
                                      const qtyPerTray = assign?.qtyPerTray || 20;
                                      const completeTrays = Math.floor(totalQty / qtyPerTray);
                                      const remainder = totalQty % qtyPerTray;
                                      const incompleteTrays = remainder > 0 ? 1 : 0;
                                      
                                      const tooltipText = `نام محصول: ${getProdName(pStage.productId)}
سینی‌های کامل: ${toPersianDigits(completeTrays)}
سینی‌های ناقص: ${toPersianDigits(incompleteTrays)} (باقیمانده: ${toPersianDigits(remainder)} محصول)
تعداد تولید کل: ${toPersianDigits(totalQty)} عدد`;
                                      
                                      return (
                                        <div 
                                          key={pIdx} 
                                          className="bg-blue-500/5 p-2 rounded-xl border border-blue-500/10 cursor-help transition-all hover:bg-blue-500/10 group relative"
                                          title={tooltipText}
                                        >
                                          <div className="text-[10px] text-blue-400 font-black leading-tight truncate mb-1" title={getProdName(pStage.productId)}>
                                            {getProdName(pStage.productId)}
                                          </div>
                                          <div className="font-mono text-blue-400 font-bold text-[10.5px]">
                                            {toPersianDigits(minutesToClockString(absStart))} - {toPersianDigits(minutesToClockString(absEnd))}
                                          </div>
                                          <div className="text-[9px] text-zinc-500 font-medium mt-1">({toPersianDigits(pStage.productionDuration)} دقیقه)</div>
                                          
                                          {/* In-cell details */}
                                          <div className="mt-1.5 pt-1 border-t border-blue-500/10 text-[9.5px] space-y-0.5 text-zinc-400 font-bold">
                                            <div className="flex justify-between">
                                              <span>تولید کل:</span>
                                              <span className="text-emerald-400 font-mono">{toPersianDigits(totalQty)} عدد</span>
                                            </div>
                                            <div className="flex justify-between text-[9px]">
                                              <span>سینی کامل:</span>
                                              <span className="text-zinc-300 font-mono">{toPersianDigits(completeTrays)}</span>
                                            </div>
                                            <div className="flex justify-between text-[9px]">
                                              <span>سینی ناقص:</span>
                                              <span className="text-amber-500 font-mono">{toPersianDigits(incompleteTrays)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>

                                {/* Proofing */}
                                <td className="p-3 text-center border-r border-zinc-900/40">
                                  {stages.proofing.needs && stages.proofing.duration > 0 ? (
                                    <div className="space-y-0.5">
                                      <span className="font-mono text-purple-400 font-bold">
                                        {toPersianDigits(minutesToClockString(stages.proofing.start))} - {toPersianDigits(minutesToClockString(stages.proofing.end))}
                                      </span>
                                      <span className="block text-[9px] text-zinc-500">({toPersianDigits(stages.proofing.duration)} دقیقه)</span>
                                    </div>
                                  ) : (
                                    <span className="text-zinc-600 italic">نیاز ندارد یا غیرفعال</span>
                                  )}
                                </td>

                                {/* Baking */}
                                <td className="p-3 text-center border-r border-zinc-900/40 bg-rose-950/10">
                                  {stages.baking.duration > 0 ? (
                                    <div className="space-y-1">
                                      <span className="font-mono text-rose-400 font-black text-xs block">
                                        {toPersianDigits(minutesToClockString(stages.baking.start))} - {toPersianDigits(minutesToClockString(stages.baking.end))}
                                      </span>
                                      <span className="block text-[9.5px] text-rose-300 font-bold leading-none">
                                        {toPersianDigits(stages.baking.duration)} دقیقه ({toPersianDigits(item.analysis.bakingTemp || 200)}°)
                                      </span>
                                      {stages.baking.ovenId && (() => {
                                        const ovenObj = settings.ovens.find(o => o.id === stages.baking.ovenId);
                                        return (
                                          <span className="inline-block text-[9px] bg-zinc-900 text-amber-400 px-1.5 py-0.5 rounded border border-zinc-800 font-black mt-0.5">
                                            {toPersianDigits(ovenObj?.name || 'فر')}
                                          </span>
                                        );
                                      })()}
                                      {stages.baking.hasCollision && (
                                        <span className="inline-block text-[9px] bg-red-950 text-red-400 px-1.5 py-0.5 rounded border border-red-900/30 font-bold mt-1">
                                          ⚠️ خطا: فر پر است (تداخل با راک {toPersianDigits(stages.baking.collidingWith)})
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-zinc-600 italic">غیرفعال</span>
                                  )}
                                </td>

                                {/* Oven Idle Time Column */}
                                <td className="p-3 text-center border-r border-zinc-900/40 bg-amber-950/5">
                                  {stages.baking.duration > 0 ? (
                                    stages.baking.isFirst ? (
                                      <div className="space-y-0.5">
                                        <span className="text-zinc-500 font-bold text-[10px]">خالی از شروع شیفت</span>
                                        <span className="block text-[9px] text-zinc-600 font-mono">({toPersianDigits(stages.baking.idleTimeBefore)} دقیقه)</span>
                                      </div>
                                    ) : stages.baking.idleTimeBefore > 0 ? (
                                      <div className="space-y-0.5">
                                        <span className="font-mono text-amber-400 font-black text-xs">
                                          {toPersianDigits(stages.baking.idleTimeBefore)} دقیقه
                                        </span>
                                        <span className="block text-[9.5px] text-amber-500 font-bold">بیکاری بین پخت</span>
                                      </div>
                                    ) : (
                                      <span className="text-emerald-500 font-bold text-[10.5px]">پشت سر هم (بدون وقفه)</span>
                                    )
                                  ) : (
                                    <span className="text-zinc-600 italic">بدون پخت</span>
                                  )}
                                </td>

                                {/* Cooling */}
                                <td className="p-3 text-center border-r border-zinc-900/40">
                                  {stages.cooling.duration > 0 ? (
                                    <div className="space-y-0.5">
                                      <span className="font-mono text-emerald-400 font-bold">
                                        {toPersianDigits(minutesToClockString(stages.cooling.start))} - {toPersianDigits(minutesToClockString(stages.cooling.end))}
                                      </span>
                                      <span className="block text-[9px] text-zinc-500">({toPersianDigits(stages.cooling.duration)} دقیقه)</span>
                                    </div>
                                  ) : (
                                    <span className="text-zinc-600 italic">غیرفعال</span>
                                  )}
                                </td>

                                {/* Packaging */}
                                <td className="p-3 text-center border-r border-zinc-900/40">
                                  {stages.packaging.duration > 0 ? (
                                    <div className="space-y-0.5">
                                      <span className="font-mono text-zinc-400 font-bold">
                                        {toPersianDigits(minutesToClockString(stages.packaging.start))} - {toPersianDigits(minutesToClockString(stages.packaging.end))}
                                      </span>
                                      <span className="block text-[9px] text-zinc-500">({toPersianDigits(stages.packaging.duration)} دقیقه)</span>
                                    </div>
                                  ) : (
                                    <span className="text-zinc-600 italic">غیرفعال</span>
                                  )}
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
            </div>

            {/* --- 7. EDIT RACK MODAL / SLIDE-IN PANEL --- */}
            {editingRackOrder && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-sans" dir="rtl">
                <div className="bg-[#0e0e11] border border-zinc-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
                  
                  <div className="flex items-center justify-between border-b border-zinc-850 pb-3">
                    <h3 className="text-sm font-black text-white flex items-center gap-2">
                      <Settings className="h-5 w-5 text-emerald-400" />
                      ویرایش و اولویت‌بندی محصولات راک {toPersianDigits(editingRackOrder.rackNumber || '')}
                    </h3>
                    <button
                      onClick={handleCancelEditingRackOrder}
                      className="p-1 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white cursor-pointer transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Baking technique selection */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-[10.5px] font-bold text-zinc-400">تکنیک پخت فر:</label>
                      <select
                        value={editingRackOrder.bakingTechnique || 'عادی'}
                        onChange={(e) => setEditingRackOrder({ ...editingRackOrder, bakingTechnique: e.target.value as any })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                      >
                        <option value="عادی">عادی (پخت سنتی)</option>
                        <option value="8-8">تکنیک ۸-۸ (پخت رطوبتی مداوم)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[10.5px] font-bold text-zinc-400">کد/شماره راک:</label>
                      {settings.racks && settings.racks.length > 0 ? (
                        <select
                          value={editingRackOrder.rackNumber || ''}
                          onChange={(e) => setEditingRackOrder({ ...editingRackOrder, rackNumber: e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                        >
                          <option value="">انتخاب راک...</option>
                          {availableRacksForEditing.map(r => (
                            <option key={r.id} value={r.rackNumber}>
                              {r.name} ({toPersianDigits(r.tiersCount)} طبقه)
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input 
                          type="text" 
                          value={editingRackOrder.rackNumber || ''}
                          onChange={(e) => setEditingRackOrder({ ...editingRackOrder, rackNumber: e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs font-mono font-bold text-white outline-none focus:border-emerald-500"
                        />
                      )}
                    </div>
                  </div>

                  {/* Add Product Order to this Rack */}
                  <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-900 space-y-3">
                    <span className="block text-[10px] font-bold text-zinc-400 uppercase">افزودن سفارش محصول به این راک:</span>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      
                      {/* Product Selector with Search */}
                      <div className="space-y-1 relative">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="جستجوی کالا..."
                            value={rackProductSearch}
                            onChange={(e) => {
                              setRackProductSearch(e.target.value);
                              setIsOpenRackProductDropdown(true);
                              const matched = periodProducts.find(p => p.name === e.target.value);
                              setNewOrderItem({ ...newOrderItem, productId: matched ? matched.id : '' });
                            }}
                            onFocus={() => setIsOpenRackProductDropdown(true)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 pr-3 pl-8 text-xs text-white placeholder-zinc-500 font-sans outline-none focus:border-emerald-500 transition-all font-bold"
                          />
                          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-zinc-550" />
                          </span>
                          
                          {isOpenRackProductDropdown && (
                            <>
                              <div 
                                className="fixed inset-0 z-10" 
                                onClick={() => setIsOpenRackProductDropdown(false)} 
                              />
                              <div className="absolute top-full right-0 left-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-20 max-h-48 overflow-y-auto divide-y divide-zinc-900 font-sans">
                                {periodProducts
                                  .filter(p => !rackProductSearch || p.name.includes(rackProductSearch))
                                  .map(p => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => {
                                        setNewOrderItem({ ...newOrderItem, productId: p.id });
                                        setRackProductSearch(p.name);
                                        setIsOpenRackProductDropdown(false);
                                      }}
                                      className="w-full text-right px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-emerald-600/10 transition-colors"
                                    >
                                      {p.name}
                                    </button>
                                  ))
                                }
                                {periodProducts.filter(p => !rackProductSearch || p.name.includes(rackProductSearch)).length === 0 && (
                                  <p className="p-3 text-center text-[11px] text-zinc-500 italic">کالایی یافت نشد</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Qty field */}
                      <div className="space-y-1">
                        <input 
                          type="number"
                          placeholder="تعداد سفارش..."
                          value={newOrderItem.qty || ''}
                          onChange={(e) => setNewOrderItem({ ...newOrderItem, qty: Number(e.target.value) })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs font-mono text-white outline-none"
                        />
                      </div>

                      {/* Add Button */}
                      <button
                        type="button"
                        onClick={handleAddProductToEditingRack}
                        className="w-full p-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white text-xs font-black transition-all cursor-pointer"
                      >
                        + افزودن سفارش
                      </button>

                    </div>

                    {/* Live Permitted & Free Trays Info for the Selected Product */}
                    {(() => {
                      if (!newOrderItem.productId) return null;
                      const assign = settings.productAssignments.find(a => a.productId === newOrderItem.productId);
                      if (!assign) {
                        return (
                          <div className="p-2.5 bg-rose-500/5 border border-rose-500/10 rounded-xl text-[10.5px] text-rose-400">
                            ⚠️ برای این محصول هیچ سینی تعریف نشده است. ابتدا به بخش تنظیمات مراجعه کنید.
                          </div>
                        );
                      }
                      const trayType = settings.trays.find(t => t.id === assign.trayTypeId);
                      const trayStatus = trayType && editingRackAvailability 
                        ? editingRackAvailability.traysStatus.find(ts => ts.id === trayType.id) 
                        : null;
                      
                      if (!trayType || !trayStatus) return null;

                      const requestedTrays = calculateTraysRequired(newOrderItem.productId, newOrderItem.qty || 0);
                      const isShortage = requestedTrays > trayStatus.free;

                      return (
                        <div className="p-3 bg-zinc-900/50 border border-zinc-850 rounded-xl space-y-1.5 animate-fade-in">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-zinc-300">سینی مجاز محصول:</span>
                            <span className="text-emerald-400 font-extrabold">{trayType.name}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10.5px] text-zinc-400">
                            <div>کل سینی‌های کارگاه: <strong className="text-zinc-200 font-mono">{toPersianDigits(trayStatus.total)}</strong></div>
                            <div className="text-left">
                              سینی‌های آزاد موجود: <strong className={`font-mono ${trayStatus.free > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{toPersianDigits(trayStatus.free)}</strong>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-850/50">
                            <span className="font-bold text-zinc-300">زمان خنک شدن راک:</span>
                            <span className="text-amber-400 font-bold">{toPersianDigits(assign.coolingTimePerUnit)} دقیقه</span>
                          </div>
                          {newOrderItem.qty > 0 && (
                            <div className="pt-1.5 border-t border-zinc-800/60 flex items-center justify-between text-[11px]">
                              <span className="text-zinc-400">سینی‌های مورد نیاز برای این تعداد:</span>
                              <span className={`font-mono font-bold ${isShortage ? 'text-rose-400' : 'text-amber-400'}`}>
                                {toPersianDigits(requestedTrays)} سینی {isShortage && ' (بیشتر از حد مجاز آزاد!)'}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Order Items Priority List */}
                  <div className="space-y-2">
                    <span className="block text-[10px] font-bold text-zinc-400 uppercase">لیست کالاهای داخل راک به ترتیب اولویت:</span>
                    <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                      {(editingRackOrder.items || []).length === 0 ? (
                        <p className="text-xs text-zinc-500 italic text-center p-4">هیچ کالایی به این راک اضافه نشده است.</p>
                      ) : (
                        (editingRackOrder.items || []).map((item, idx) => {
                          const assignment = settings.productAssignments.find(a => a.productId === item.productId);
                          const isEditingRow = editingOrderItemId === item.productId;

                          return (
                            <div key={item.productId} className="p-3 bg-zinc-900 rounded-xl border border-zinc-850 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-medium">
                              {isEditingRow ? (
                                <div className="flex flex-col gap-2 flex-grow">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <select
                                      value={editingOrderItemProdId}
                                      onChange={(e) => setEditingOrderItemProdId(e.target.value)}
                                      className="bg-zinc-950 border border-zinc-800 text-white rounded-xl p-2 text-xs font-bold outline-none flex-grow sm:flex-grow-0"
                                    >
                                      {periodProducts.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      value={editingOrderItemQty || ''}
                                      onChange={(e) => setEditingOrderItemQty(Number(e.target.value))}
                                      className="w-24 bg-zinc-950 border border-zinc-800 text-white rounded-xl p-2 text-xs font-bold font-mono text-center outline-none"
                                      placeholder="تعداد..."
                                    />
                                    <span className="text-[10px] text-zinc-500">
                                      (ظرفیت هر سینی: {assignment ? toPersianDigits(assignment.qtyPerTray) : 20})
                                    </span>
                                  </div>

                                  {/* Live Permitted & Free Trays Info for Row Edit */}
                                  {(() => {
                                    if (!editingOrderItemProdId) return null;
                                    const assign = settings.productAssignments.find(a => a.productId === editingOrderItemProdId);
                                    if (!assign) return null;
                                    const tType = settings.trays.find(t => t.id === assign.trayTypeId);
                                    const tStatus = tType && editingRackAvailability 
                                      ? editingRackAvailability.traysStatus.find(ts => ts.id === tType.id) 
                                      : null;
                                    if (!tType || !tStatus) return null;

                                    const reqTrays = calculateTraysRequired(editingOrderItemProdId, editingOrderItemQty || 0);
                                    const isShortage = reqTrays > tStatus.free;

                                    return (
                                      <div className="text-[10px] text-zinc-400 bg-zinc-950 p-2 rounded-xl border border-zinc-900/50 flex flex-col gap-1">
                                        <div className="flex justify-between">
                                          <span>سینی مجاز: <strong className="text-emerald-400">{tType.name}</strong></span>
                                          <span>آزاد موجود: <strong className={tStatus.free > 0 ? "text-emerald-400" : "text-rose-400"}>{toPersianDigits(tStatus.free)}</strong></span>
                                        </div>
                                        <div className="flex justify-between pt-1 border-t border-zinc-900/30">
                                          <span>زمان خنک شدن راک:</span>
                                          <strong className="text-amber-400">{toPersianDigits(assign.coolingTimePerUnit)} دقیقه</strong>
                                        </div>
                                        {editingOrderItemQty > 0 && (
                                          <div className="flex justify-between pt-1 border-t border-zinc-900/40">
                                            <span>سینی‌های مورد نیاز:</span>
                                            <span className={`font-mono font-bold ${isShortage ? 'text-rose-400' : 'text-amber-400'}`}>
                                              {toPersianDigits(reqTrays)} سینی {isShortage && ' (بیشتر از حد مجاز آزاد!)'}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <strong className="text-white">{getProdName(item.productId)}</strong>
                                  <div className="text-[10px] text-zinc-400 flex flex-wrap gap-x-2 gap-y-1 space-x-reverse">
                                    <span>تعداد: {toPersianDigits(item.qtyToProduce)} عدد</span>
                                    <span>•</span>
                                    <span>سینی موردنیاز: {toPersianDigits(item.traysNeeded)} ({assignment ? toPersianDigits(assignment.qtyPerTray) : 20} عدد در سینی)</span>
                                    <span>•</span>
                                    <span>زمان خنک شدن راک: {assignment ? toPersianDigits(assignment.coolingTimePerUnit) : 0} دقیقه</span>
                                  </div>
                                  {assignment && assignment.qtyPerTray > 0 && (item.qtyToProduce % assignment.qtyPerTray) !== 0 && (
                                    <div className="text-[9.5px] text-amber-400 font-bold mt-1 bg-amber-500/5 p-1 px-1.5 rounded border border-amber-500/10 inline-block">
                                      ⚠️ سینی آخر ناقص: {toPersianDigits(item.qtyToProduce % assignment.qtyPerTray)} از {toPersianDigits(assignment.qtyPerTray)} محصول ({toPersianDigits(assignment.qtyPerTray - (item.qtyToProduce % assignment.qtyPerTray))} عدد کمبود برای تکمیل سینی)
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center justify-end gap-1.5 self-end sm:self-auto">
                                {isEditingRow ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveOrderItemEdit(item.productId)}
                                      className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold px-2.5"
                                      title="ذخیره تغییرات"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      ذخیره
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingOrderItemId(null)}
                                      className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold px-2.5"
                                      title="انصراف"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      انصراف
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* Up and down within the rack */}
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveOrderItemPriority(item.productId, 'up')}
                                      className="p-1 bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white rounded-md disabled:opacity-20 transition-all cursor-pointer"
                                      title="افزایش اولویت پخت"
                                    >
                                      <ArrowUp className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === (editingRackOrder.items || []).length - 1}
                                      onClick={() => handleMoveOrderItemPriority(item.productId, 'down')}
                                      className="p-1 bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white rounded-md disabled:opacity-20 transition-all cursor-pointer"
                                      title="کاهش اولویت پخت"
                                    >
                                      <ArrowDown className="h-3 w-3" />
                                    </button>

                                    {/* Edit Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditOrderItem(item.productId, item.qtyToProduce)}
                                      className="p-1 bg-zinc-950 border border-zinc-800 hover:border-emerald-800 text-emerald-400 hover:text-white rounded-md transition-all cursor-pointer"
                                      title="ویرایش ردیف"
                                    >
                                      <Edit className="h-3 w-3" />
                                    </button>

                                    {/* Delete Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProductFromEditingRack(item.productId)}
                                      className="p-1 bg-zinc-950 border border-zinc-800 hover:border-rose-900 text-rose-500 rounded-md transition-all cursor-pointer"
                                      title="حذف از راک"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Real-time Rack Capacity Matcher & Compliance */}
                  {editingRackAnalysis && (
                    <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-900 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-black text-zinc-300">وضعیت تطابق ظرفیت و طبقات راک:</span>
                        <span className={`font-black ${editingRackAnalysis.maxTiersNeeded > editingRackTiersLimit ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {toPersianDigits(editingRackAnalysis.maxTiersNeeded)} از {toPersianDigits(editingRackTiersLimit)} طبقه استفاده شده
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            editingRackAnalysis.maxTiersNeeded > editingRackTiersLimit 
                              ? 'bg-rose-500' 
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, (editingRackAnalysis.maxTiersNeeded / editingRackTiersLimit) * 100)}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-[11px] text-zinc-400">
                        <span>مجموع سینی‌های قرار گرفته: <strong className="text-zinc-200 font-mono">{toPersianDigits(editingRackAnalysis.totalTrays)} سینی</strong></span>
                        <span>حداکثر طبقات راک: <strong className="text-zinc-200 font-mono">{toPersianDigits(editingRackTiersLimit)} طبقه</strong></span>
                      </div>

                      {/* Error State if Mismatched / Overflowed */}
                      {editingRackAnalysis.maxTiersNeeded > editingRackTiersLimit ? (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-bold flex items-start gap-2 animate-pulse mt-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 animate-bounce" />
                          <div className="space-y-0.5">
                            <div>⚠️ خطای عدم تطابق ظرفیت: سینی‌های قرار داده شده فراتر از گنجایش راک است!</div>
                            <div className="text-[10px] font-normal text-rose-300">
                              تعداد طبقات اضافی موردنیاز: {toPersianDigits(editingRackAnalysis.maxTiersNeeded - editingRackTiersLimit)} طبقه. لطفاً تعداد کالا یا تعداد سینی‌ها را کاهش دهید.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 rounded-xl text-[10.5px] font-medium flex items-center gap-2 mt-2">
                          <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                          <span>تطابق کامل برقرار است. تعداد سینی‌ها و طبقات در محدوده مجاز ظرفیت راک می‌باشد.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Real-time Free Equipment Capacity Check */}
                  {editingRackAvailability && (
                    <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-900 space-y-2.5">
                      <span className="block text-[10.5px] font-black text-emerald-400 flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4" />
                        بررسی ظرفیت آزاد تجهیزات کارگاه در زمان شروع پخت این راک ({toPersianDigits(minutesToClockString(editingRackAvailability.startMin))})
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        تجهیزات (سینی‌ها و راک‌ها) در پایان مرحله بسته‌بندی راک قبلی بلافاصله آزاد شده و قابل استفاده مجدد می‌باشند.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                        {/* Rack capacity */}
                        <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
                          editingRackAvailability.freeRacks > 0 
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' 
                            : 'bg-rose-500/5 border-rose-500/10 text-rose-400 font-bold'
                        }`}>
                          <span className="font-bold flex items-center gap-1">
                            <Layers className="h-3.5 w-3.5" />
                            راک‌های آزاد کارگاه:
                          </span>
                          <span className="font-mono font-black">
                            {editingRackAvailability.freeRacks > 0 
                              ? `${toPersianDigits(editingRackAvailability.freeRacks)} از ${toPersianDigits(editingRackAvailability.maxRacks)} راک آزاد` 
                              : 'تکمیل ظرفیت (۰ راک آزاد)'
                            }
                          </span>
                        </div>

                        {/* Tray status */}
                        {(() => {
                          const activeProductId = newOrderItem.productId || (editingOrderItemId ? editingOrderItemProdId : null);
                          if (!activeProductId) {
                            return (
                              <div className="col-span-1 sm:col-span-2 p-2.5 rounded-xl border border-zinc-850 bg-zinc-950 text-zinc-400 text-center italic text-[10px]">
                                برای مشاهده سینی‌های مجاز و آزاد موجود، یک کالا را در بخش بالا انتخاب کنید.
                              </div>
                            );
                          }

                          const assign = settings.productAssignments.find(a => a.productId === activeProductId);
                          const filteredTrays = editingRackAvailability.traysStatus.filter(t => assign ? t.id === assign.trayTypeId : true);

                          if (filteredTrays.length === 0) {
                            return (
                              <div className="col-span-1 sm:col-span-2 p-2.5 rounded-xl border border-rose-900/40 bg-rose-950/10 text-rose-400 text-center text-[10.5px]">
                                سینی مجازی برای این محصول تعریف نشده است.
                              </div>
                            );
                          }

                          return filteredTrays.map(t => (
                            <div key={t.id} className={`p-2.5 rounded-xl border flex items-center justify-between col-span-1 sm:col-span-2 ${
                              t.free > 0 
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' 
                                : 'bg-rose-500/5 border-rose-500/10 text-rose-400 font-bold'
                            }`}>
                              <span className="font-bold truncate max-w-[150px]" title={t.name}>
                                سینی آزاد مجاز ({t.name}):
                              </span>
                              <span className="font-mono font-black whitespace-nowrap">
                                {t.free > 0 
                                  ? `${toPersianDigits(t.free)} از ${toPersianDigits(t.total)} سینی` 
                                  : 'تکمیل ظرفیت (۰ سینی)'
                                }
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Actions footer */}
                  <div className="flex items-center justify-end gap-2 border-t border-zinc-850 pt-4">
                    <button
                      type="button"
                      onClick={handleCancelEditingRackOrder}
                      className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white text-xs font-bold cursor-pointer transition-colors"
                    >
                      انصراف
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveRackOrderItems}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white text-xs font-black shadow-lg cursor-pointer transition-colors"
                    >
                      ذخیره راک و به‌روزرسانی تایم‌لاین
                    </button>
                  </div>

                </div>
              </div>
            )}

          </motion.div>
        ) : activeTab === 'settings' ? (
          <motion.div
            key="settings-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            
            {/* General parameters and limits */}
            <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
              <h2 className="text-sm font-black text-white flex items-center gap-1.5 border-b border-zinc-900 pb-2.5">
                <Settings className="h-4.5 w-4.5 text-emerald-400" />
                پارامترهای عمومی زمان‌بندی تولید
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Daily hours range start */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-zinc-400">ساعت شروع کارگاه (روزانه):</label>
                  <input 
                    type="text" 
                    value={settings.startHour}
                    onChange={(e) => handleUpdateGeneralSettings('startHour', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 px-3 text-xs font-mono font-bold text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Daily hours range end */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-zinc-400">ساعت پایان کارگاه (روزانه):</label>
                  <input 
                    type="text" 
                    value={settings.endHour}
                    onChange={(e) => handleUpdateGeneralSettings('endHour', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 px-3 text-xs font-mono font-bold text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Initial prep time minutes */}
                <div className="space-y-1.5 col-span-2">
                  <label className="block text-[10.5px] font-bold text-zinc-400">زمان آماده‌سازی اولیه (دقیقه):</label>
                  <input 
                    type="number" 
                    value={settings.prepTimeMinutes}
                    onChange={(e) => handleUpdateGeneralSettings('prepTimeMinutes', Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 px-3 text-xs font-mono font-bold text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Total racks in workshop */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-zinc-400">تعداد کل راک‌های تولیدی موجود:</label>
                  <input 
                    type="number" 
                    readOnly
                    disabled
                    value={settings.totalRacks}
                    title="از جمع راک‌های تعریف شده در بخش زیر به صورت خودکار محاسبه می‌شود"
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-xl p-2.5 px-3 text-xs font-mono font-bold text-emerald-400 outline-none cursor-not-allowed"
                  />
                  <span className="text-[9px] text-zinc-500 block">محاسبه شده بر اساس جمع راک‌های تعریف شده</span>
                </div>

                {/* Proofing max racks */}
                <div className="space-y-1.5 col-span-1">
                  <label className="block text-[10.5px] font-bold text-zinc-400">ظرفیت کل گرمخانه (تعداد راک همزمان):</label>
                  <input 
                    type="number" 
                    value={settings.proofingMaxRacks}
                    onChange={(e) => handleUpdateGeneralSettings('proofingMaxRacks', Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 px-3 text-xs font-mono font-bold text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>

              </div>
            </div>

            {/* Racks Definition Card */}
            <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                    <Layers className="h-4.5 w-4.5 text-emerald-400" />
                    تعریف و پیکربندی راک‌های کارگاه (با طبقات مجزا)
                  </h3>
                  <p className="text-[10.5px] text-zinc-500 mt-0.5">
                    در این بخش می‌توانید راک‌های تولیدی کارگاه را با کدهای مجزا و تعداد طبقات متفاوت تعریف نمایید. تعداد کل راک‌ها از این بخش جمع زده می‌شود.
                  </p>
                </div>
                <button
                  onClick={() => setEditingRack({ rackNumber: String((settings.racks?.length || 0) + 1), name: `راک شماره ${(settings.racks?.length || 0) + 1}`, tiersCount: settings.tiersPerRack || 10 })}
                  className="p-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1 transition-all shadow-md cursor-pointer"
                >
                  + افزودن راک جدید
                </button>
              </div>

              {(!settings.racks || settings.racks.length === 0) ? (
                <p className="p-8 text-center text-zinc-500 text-xs italic bg-zinc-950/40 rounded-2xl border border-zinc-900/50">
                  هیچ راکی برای کارگاه تعریف نشده است. جهت اجرای محاسبات، یک راک اضافه نمایید.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {settings.racks.map(r => (
                    <div key={r.id} className="p-4 bg-[#121214] border border-zinc-850 rounded-2xl flex items-center justify-between text-xs font-medium hover:border-zinc-700 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-white text-xs">{r.name}</strong>
                          <span className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 font-bold rounded font-mono">کد راک: {toPersianDigits(r.rackNumber)}</span>
                        </div>
                        <p className="text-[10.5px] text-zinc-400">
                          تعداد طبقات: <strong className="text-emerald-400">{toPersianDigits(r.tiersCount)} طبقه</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingRack(r)}
                          className="p-1.5 bg-zinc-900 hover:bg-zinc-850 rounded-lg text-zinc-400 hover:text-white transition-all cursor-pointer"
                          title="ویرایش"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteRack(r.id)}
                          className="p-1.5 bg-zinc-900 hover:bg-rose-950/40 rounded-lg text-rose-500 transition-all cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Split layout: Ovens and Trays management */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Ovens Definitions */}
              <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5">
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                    <Flame className="h-4.5 w-4.5 text-emerald-400" />
                    تعریف و ظرفیت فرهای پخت کارگاه
                  </h3>
                  <button
                    onClick={() => setEditingOven({ name: '', type: 'گردان', trayCapacity: 12 })}
                    className="p-1.5 px-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10.5px] font-bold text-white rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                  >
                    + افزودن فر جدید
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {settings.ovens.map(o => (
                    <div key={o.id} className="p-3 bg-[#121214] border border-zinc-850 rounded-xl flex items-center justify-between text-xs font-medium">
                      <div>
                        <strong className="text-zinc-200">{o.name}</strong>
                        <div className="text-[10px] text-zinc-400 mt-0.5 space-x-2 space-x-reverse">
                          <span>نوع: {o.type === 'گردان' ? 'فر گردان چرخشی' : 'فر طبقه‌ای ثابت'}</span>
                          {o.type === 'طبقه ای' && (
                            <>
                              <span>|</span>
                              <span>ظرفیت: {toPersianDigits(o.trayCapacity)} سینی</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditingOven(o)}
                          className="p-1 bg-zinc-900 hover:bg-zinc-850 rounded text-zinc-400 hover:text-white transition-all cursor-pointer"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteOven(o.id)}
                          className="p-1 bg-zinc-900 hover:bg-rose-950/40 rounded text-rose-500 transition-all cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trays Definitions */}
              <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5">
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                    <Layers className="h-4.5 w-4.5 text-emerald-400" />
                    تعریف انواع سینی‌های تولید
                  </h3>
                  <button
                    onClick={() => setEditingTray({ name: '', totalCount: 50, traysPerRackTier: 2 })}
                    className="p-1.5 px-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10.5px] font-bold text-white rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                  >
                    + افزودن سینی جدید
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {settings.trays.map(t => (
                    <div key={t.id} className="p-3 bg-[#121214] border border-zinc-850 rounded-xl flex items-center justify-between text-xs font-medium">
                      <div>
                        <strong className="text-zinc-200">{t.name}</strong>
                        <div className="text-[10px] text-zinc-400 mt-0.5 space-x-2 space-x-reverse">
                          <span>کل موجودی کارگاه: {toPersianDigits(t.totalCount)} عدد</span>
                          <span>|</span>
                          <span>تعداد قرارگیری در هر طبقه راک: {toPersianDigits(t.traysPerRackTier)} عدد</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditingTray(t)}
                          className="p-1 bg-zinc-900 hover:bg-zinc-850 rounded text-zinc-400 hover:text-white transition-all cursor-pointer"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTray(t.id)}
                          className="p-1 bg-zinc-900 hover:bg-rose-950/40 rounded text-rose-500 transition-all cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Product to Tray Assignments List */}
            <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5">
                <div>
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                    <Sliders className="h-4.5 w-4.5 text-emerald-400" />
                    جدول انتساب سینی، زمان‌بندی و پخت به تفکیک محصولات
                  </h3>
                  <p className="text-[10.5px] text-zinc-500 mt-0.5">
                    برای هر محصول مشخص کنید در کدام سینی و با چه زمان و دمایی باید پخته شود.
                  </p>
                </div>
                <button
                  onClick={() => setEditingAssignment({ productId: '', trayTypeId: settings.trays[0]?.id || '', qtyPerTray: 20, prodTimePerUnit: 0.1, kneadingTime: 15, needsProofing: false, proofingTime: 60, steamRequired: false, alternatingShelves: false, coolingTimePerUnit: 1, packagingTimePerUnit: 0.5, bakingSettings: {} })}
                  className="p-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1 transition-all shadow-md cursor-pointer"
                >
                  + ایجاد انتساب جدید
                </button>
              </div>

              {settings.productAssignments.length === 0 ? (
                <p className="p-8 text-center text-zinc-500 text-xs italic bg-zinc-950/40 rounded-2xl border border-zinc-900/50">
                  هیچ انتسابی برای محصولات ثبت نشده است. لطفاً کالاها را ابتدا به سینی‌ها منتسب کنید تا محاسبات ظرفیت فعال گردد.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-medium text-zinc-400 text-right min-w-[1000px]">
                    <thead>
                      <tr className="border-b border-zinc-900 pb-2 text-[11px] text-zinc-500 font-black">
                        <th className="py-2.5">محصول</th>
                        <th className="py-2.5">نوع سینی</th>
                        <th className="py-2.5">ظرفیت سینی</th>
                        <th className="py-2.5">زمان تولید (واحد)</th>
                        <th className="py-2.5">زمان خمیرگیری</th>
                        <th className="py-2.5">گرمخانه (تخمیر)</th>
                        <th className="py-2.5">نیاز به بخار</th>
                        <th className="py-2.5">طبقات یک‌درمیان</th>
                        <th className="py-2.5">بسته‌بندی و خنک</th>
                        <th className="py-2.5 text-left">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settings.productAssignments.map(a => {
                        const tray = settings.trays.find(t => t.id === a.trayTypeId);
                        return (
                          <tr key={a.productId} className="border-b border-zinc-950 hover:bg-zinc-900/15 transition-all text-zinc-300">
                            <td className="py-2.5 font-bold text-white">{getProdName(a.productId)}</td>
                            <td className="py-2.5">{tray ? tray.name : 'نامشخص'}</td>
                            <td className="py-2.5 font-mono">{toPersianDigits(a.qtyPerTray)} عدد</td>
                            <td className="py-2.5 font-mono">{toPersianDigits(a.prodTimePerUnit)} دقیقه</td>
                            <td className="py-2.5 font-mono text-emerald-400 font-bold">{toPersianDigits(a.kneadingTime ?? 15)} دقیقه</td>
                            <td className="py-2.5">
                              {a.needsProofing ? (
                                <span className="text-purple-400 font-bold">{toPersianDigits(a.proofingTime)} دقیقه</span>
                              ) : (
                                <span className="text-zinc-600">ندارد</span>
                              )}
                            </td>
                            <td className="py-2.5">
                              {a.steamRequired ? (
                                <span className="text-emerald-400 font-bold flex items-center gap-1">
                                  <Wind className="h-3.5 w-3.5" /> بله
                                </span>
                              ) : (
                                <span className="text-zinc-600">خیر</span>
                              )}
                            </td>
                            <td className="py-2.5">
                              {a.alternatingShelves ? (
                                <span className="text-amber-500 font-bold">بله (نصف ظرفیت)</span>
                              ) : (
                                <span className="text-zinc-600 font-medium">خیر</span>
                              )}
                            </td>
                            <td className="py-2.5 text-[10px] text-zinc-400">
                              <div>خنک شدن راک: {toPersianDigits(a.coolingTimePerUnit)} دقیقه</div>
                              <div>بسته‌بندی: {toPersianDigits(a.packagingTimePerUnit)} دقیقه</div>
                            </td>
                            <td className="py-2.5 text-left">
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={() => setEditingAssignment(a)}
                                  className="p-1 bg-zinc-900 hover:bg-zinc-850 rounded text-zinc-400 hover:text-white transition-all cursor-pointer"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteAssignment(a.productId)}
                                  className="p-1 bg-zinc-900 hover:bg-rose-950/40 rounded text-rose-500 transition-all cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* --- SETTINGS EDIT SUB-MODALS --- */}
            
            {/* 1. Oven Edit Modal */}
            {editingOven && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in font-sans" dir="rtl">
                <form onSubmit={handleSaveOven} className="bg-[#0e0e11] border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
                  <h3 className="text-xs font-black text-white border-b border-zinc-900 pb-2">
                    {editingOven.id ? 'ویرایش فر پخت' : 'تعریف فر جدید برای کارگاه'}
                  </h3>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">نام فر:</label>
                    <input 
                      type="text" 
                      required
                      value={editingOven.name || ''}
                      onChange={(e) => setEditingOven({ ...editingOven, name: e.target.value })}
                      placeholder="مانند فر گردان چرخشی سوئیسی..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">نوع فر:</label>
                    <select
                      value={editingOven.type || 'گردان'}
                      onChange={(e) => setEditingOven({ ...editingOven, type: e.target.value as any })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-xs text-white"
                    >
                      <option value="گردان">فر گردان (Rotary)</option>
                      <option value="طبقه ای">فر طبقه‌ای (Deck)</option>
                    </select>
                  </div>

                  {editingOven.type === 'طبقه ای' && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">ظرفیت تعداد سینی در فر طبقه:</label>
                      <input 
                        type="number" 
                        value={editingOven.trayCapacity || 8}
                        onChange={(e) => setEditingOven({ ...editingOven, trayCapacity: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white"
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-1.5 pt-3">
                    <button
                      type="button"
                      onClick={() => setEditingOven(null)}
                      className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-850 rounded-lg text-[10.5px] font-bold text-zinc-400 transition-colors"
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-[10.5px] font-black text-white transition-colors"
                    >
                      ذخیره فر
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 2. Tray Edit Modal */}
            {editingTray && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in font-sans" dir="rtl">
                <form onSubmit={handleSaveTray} className="bg-[#0e0e11] border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
                  <h3 className="text-xs font-black text-white border-b border-zinc-900 pb-2">
                    {editingTray.id ? 'ویرایش نوع سینی' : 'تعریف سینی تولید جدید'}
                  </h3>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">نام سینی:</label>
                    <input 
                      type="text" 
                      required
                      value={editingTray.name || ''}
                      onChange={(e) => setEditingTray({ ...editingTray, name: e.target.value })}
                      placeholder="مانند سینی چدنی باگت ۵ شیار..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">کل تعداد موجود در کارگاه:</label>
                    <input 
                      type="number" 
                      required
                      value={editingTray.totalCount || 50}
                      onChange={(e) => setEditingTray({ ...editingTray, totalCount: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">تعداد قرارگیری در هر طبقه راک:</label>
                    <input 
                      type="number" 
                      required
                      value={editingTray.traysPerRackTier || 2}
                      onChange={(e) => setEditingTray({ ...editingTray, traysPerRackTier: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white"
                    />
                  </div>

                  <div className="flex justify-end gap-1.5 pt-3">
                    <button
                      type="button"
                      onClick={() => setEditingTray(null)}
                      className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-850 rounded-lg text-[10.5px] font-bold text-zinc-400 transition-colors"
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-[10.5px] font-black text-white transition-colors"
                    >
                      ذخیره سینی
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 3. Product Tray Assignment Edit Modal */}
            {editingAssignment && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-sans" dir="rtl">
                <form onSubmit={handleSaveAssignment} className="bg-[#0e0e11] border border-zinc-800 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <h3 className="text-xs font-black text-white border-b border-zinc-900 pb-2">
                    انتساب سینی، زمان‌بندی و پخت فر اختصاصی محصول
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Product Selector with Search */}
                    <div className="space-y-1.5 relative">
                      <label className="block text-[10px] font-bold text-zinc-400">انتخاب محصول موردنظر:</label>
                      {editingAssignment.productId ? (
                        <input
                          type="text"
                          disabled
                          value={getProdName(editingAssignment.productId)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2 text-xs text-zinc-400 font-bold font-sans cursor-not-allowed"
                        />
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="جستجوی محصول..."
                            value={assignProductSearch}
                            onChange={(e) => {
                              setAssignProductSearch(e.target.value);
                              setIsOpenAssignProductDropdown(true);
                            }}
                            onFocus={() => setIsOpenAssignProductDropdown(true)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 pr-3 pl-8 text-xs text-white placeholder-zinc-500 font-sans outline-none focus:border-emerald-500 transition-all font-bold"
                            required
                          />
                          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-zinc-500" />
                          </span>
                          
                          {isOpenAssignProductDropdown && (
                            <>
                              <div 
                                className="fixed inset-0 z-10" 
                                onClick={() => setIsOpenAssignProductDropdown(false)} 
                              />
                              <div className="absolute top-full right-0 left-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-20 max-h-48 overflow-y-auto divide-y divide-zinc-900 font-sans">
                                {periodProducts
                                  .filter(p => !assignProductSearch || p.name.includes(assignProductSearch))
                                  .map(p => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => {
                                        setEditingAssignment({ ...editingAssignment, productId: p.id });
                                        setAssignProductSearch(p.name);
                                        setIsOpenAssignProductDropdown(false);
                                      }}
                                      className="w-full text-right px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-emerald-600/10 transition-colors"
                                    >
                                      {p.name}
                                    </button>
                                  ))
                                }
                                {periodProducts.filter(p => !assignProductSearch || p.name.includes(assignProductSearch)).length === 0 && (
                                  <p className="p-3 text-center text-[11px] text-zinc-500 italic">محصولی یافت نشد</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Tray Type Selector */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">انتخاب سینی تولید منتسب:</label>
                      <select
                        value={editingAssignment.trayTypeId || ''}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, trayTypeId: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-xs text-white font-medium"
                        required
                      >
                        {settings.trays.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} (کل: {toPersianDigits(t.totalCount)})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantity per tray */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">تعداد کالا در هر سینی (مثلا ۲۱ عدد):</label>
                      <input 
                        type="number" 
                        value={editingAssignment.qtyPerTray || 20}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, qtyPerTray: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white font-mono"
                        required
                      />
                    </div>

                    {/* Smart Scheduling Toggle Button & Batch Calculator */}
                    <div className="md:col-span-2 space-y-3 mt-1">
                      <button
                        type="button"
                        onClick={() => setShowBatchCalc(!showBatchCalc)}
                        className="w-full py-2.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all select-none cursor-pointer"
                      >
                        <Sliders className="h-4 w-4" />
                        <span>محاسبه هوشمند زمان‌بندی</span>
                        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showBatchCalc ? 'rotate-180' : ''}`} />
                      </button>

                      {showBatchCalc && editingAssignment.productId && (
                        <div className="space-y-3.5 p-4 rounded-2xl bg-zinc-950 border border-emerald-500/20 shadow-lg animate-fade-in text-right">
                          <span className="block text-[11px] font-black text-emerald-400 flex items-center gap-1.5">
                            <Sliders className="h-4 w-4 text-emerald-400" />
                            محاسبه‌گر تولید واقعی دسته‌ای (Batch) اختصاصی {getProdName(editingAssignment.productId)}
                          </span>
                          <p className="text-[10px] text-zinc-500 leading-relaxed">
                            اطلاعات تولید واقعی یک دسته (بچ) بزرگ را وارد کنید؛ فیلدهای اصلی زمان‌بندی (مدت زمان تولید، زمان خنک‌سازی و زمان بسته‌بندی) بر اساس این مقادیر به طور خودکار محاسبه و پر می‌شوند.
                          </p>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs text-right">
                            <div className="space-y-1">
                              <label className="block text-[9.5px] text-zinc-400 font-bold">تعداد کل کالا در بچ:</label>
                              <input 
                                type="number"
                                min={1}
                                value={modalBatchQty}
                                onChange={(e) => updateModalBatchQty(Math.max(1, Number(e.target.value) || 0))}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-2.5 text-xs text-white font-bold outline-none font-mono"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="block text-[9.5px] text-zinc-400 font-bold">کل زمان تولید بچ (دقیقه):</label>
                              <input 
                                type="number"
                                min={0.1}
                                step="0.1"
                                value={modalBatchProdTime}
                                onChange={(e) => updateModalBatchProdTime(Math.max(0.1, Number(e.target.value) || 0))}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-2.5 text-xs text-white font-bold outline-none font-mono"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="block text-[9.5px] text-zinc-400 font-bold">زمان خنک‌سازی (دقیقه):</label>
                              <input 
                                type="number"
                                min={0}
                                step="1"
                                value={modalBatchCoolTime}
                                onChange={(e) => updateModalBatchCoolTime(Math.max(0, Number(e.target.value) || 0))}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-2.5 text-xs text-white font-bold outline-none font-mono"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="block text-[9.5px] text-zinc-400 font-bold">کل زمان بسته‌بندی بچ (دقیقه):</label>
                              <input 
                                type="number"
                                min={0.1}
                                step="0.1"
                                value={modalBatchPackTime}
                                onChange={(e) => updateModalBatchPackTime(Math.max(0.1, Number(e.target.value) || 0))}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-2.5 text-xs text-white font-bold outline-none font-mono"
                              />
                            </div>
                          </div>

                          {/* Calculated Outcome & Auto Fill Preview */}
                          <div className="p-3 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 space-y-2 text-right">
                            <span className="block text-[10.5px] font-black text-emerald-400">⏱️ مقادیر خروجی واحد محاسبه شده و اعمال‌شده بالا:</span>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-zinc-400 font-bold">
                              <div>مدت زمان تولید ۱ عدد کالا: <strong className="text-white font-mono">{toPersianDigits((modalBatchProdTime / modalBatchQty).toFixed(4))}</strong> دقیقه</div>
                              <div>زمان خنک‌سازی کل راک: <strong className="text-white font-mono">{toPersianDigits(modalBatchCoolTime)}</strong> دقیقه</div>
                              <div>زمان بسته‌بندی ۱ عدد کالا: <strong className="text-white font-mono">{toPersianDigits((modalBatchPackTime / modalBatchQty).toFixed(4))}</strong> دقیقه</div>
                            </div>
                            <p className="text-[9.5px] text-zinc-500 border-t border-zinc-900/60 pt-1.5 leading-relaxed">
                              * مقادیر فوق بلافاصله روی فرم انتساب محصول اعمال شده‌اند و در زمان ذخیره نهایی اعمال خواهند شد.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Production time per 1 product unit */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">مدت زمان تولید ۱ عدد کالا (دقیقه):</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editingAssignment.prodTimePerUnit || 0.1}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, prodTimePerUnit: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white font-mono"
                        required
                      />
                    </div>

                    {/* Standard Kneading Time (Minutes) per Product */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">زمان استاندارد خمیرگیری محصول (دقیقه):</label>
                      <input 
                        type="number" 
                        value={editingAssignment.kneadingTime || 15}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, kneadingTime: Number(e.target.value) })}
                        className="w-full bg-[#121215] border border-zinc-800 rounded-xl p-2 px-3 text-xs text-emerald-400 font-mono font-bold"
                        required
                        min={0}
                      />
                    </div>

                    {/* Proofing Checkbox */}
                    <div className="space-y-1.5 flex flex-col justify-end">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-zinc-300">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.needsProofing || false}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setEditingAssignment({
                              ...editingAssignment,
                              needsProofing: checked,
                              proofingTime: checked && (!editingAssignment.proofingTime || editingAssignment.proofingTime === 0) ? 60 : editingAssignment.proofingTime
                            });
                          }}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>نیاز به استراحت در گرمخانه دارد</span>
                      </label>
                    </div>

                    {/* Proofing Time minutes */}
                    {editingAssignment.needsProofing && (
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-zinc-400">مدت زمان گرمخانه (دقیقه):</label>
                        <input 
                          type="number" 
                          value={editingAssignment.proofingTime || 60}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, proofingTime: Number(e.target.value) })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white font-mono"
                        />
                      </div>
                    )}

                    {/* Steam and alternating Spacing */}
                    <div className="space-y-1.5 flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-zinc-300">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.steamRequired || false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, steamRequired: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>نیاز به بخار آب فر</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-zinc-300">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.alternatingShelves || false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, alternatingShelves: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>چیدمان سینی‌ها به صورت یک‌درمیان (فاصله‌دار)</span>
                      </label>
                    </div>

                    <div className="h-[1px] md:col-span-2 bg-zinc-900 my-1" />

                    {/* Post-Bake attributes: Cooling & Packaging */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">زمان خنک شدن راک (دقیقه):</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editingAssignment.coolingTimePerUnit || 1}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, coolingTimePerUnit: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white font-mono"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-zinc-400">زمان بسته‌بندی ۱ کالا (دقیقه):</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editingAssignment.packagingTimePerUnit || 0.5}
                        onChange={(e) => setEditingAssignment({ ...editingAssignment, packagingTimePerUnit: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white font-mono"
                      />
                    </div>

                  </div>

                  {/* Granular Stage Activation/Deactivation Controls */}
                  <div className="space-y-2.5 p-4 rounded-2xl bg-zinc-950 border border-zinc-900">
                    <span className="block text-[10.5px] font-black text-emerald-400">مراحل فعال فرآیند تولید برای این محصول:</span>
                    <p className="text-[9.5px] text-zinc-500">مراحل غیرفعال از محاسبات زمان‌بندی و زنجیره تولید این محصول به طور کامل خارج می‌شوند.</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasKneading !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasKneading: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۱. خمیرگیری</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasProduction !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasProduction: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۲. تولید</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasProofing !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasProofing: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۳. گرمخانه</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasBaking !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasBaking: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۴. پخت در فر</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasCooling !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasCooling: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۵. خنک شدن</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900 p-2 rounded-xl border border-zinc-800 hover:bg-zinc-850 transition-colors select-none">
                        <input 
                          type="checkbox"
                          checked={editingAssignment.hasPackaging !== false}
                          onChange={(e) => setEditingAssignment({ ...editingAssignment, hasPackaging: e.target.checked })}
                          className="accent-emerald-500 h-4 w-4"
                        />
                        <span>۶. بسته‌بندی</span>
                      </label>
                    </div>
                  </div>

                  {/* Permitted Ovens Selection */}
                  {settings.ovens.length > 1 && (
                    <div className="space-y-2.5 p-4 rounded-2xl bg-zinc-950 border border-zinc-900 animate-fade-in">
                      <span className="block text-[10.5px] font-black text-emerald-400">فرهای مجاز برای پخت این محصول:</span>
                      <p className="text-[9.5px] text-zinc-500">مشخص کنید پخت این محصول در کدام فرها مجاز است. (حداقل یک فر انتخاب شود)</p>
                      <div className="flex flex-wrap gap-3">
                        {settings.ovens.map(oven => {
                          const allowedOvensList = editingAssignment.allowedOvens || settings.ovens.map(o => o.id);
                          const isAllowed = allowedOvensList.includes(oven.id);
                          const handleToggleOven = () => {
                            let newList;
                            if (isAllowed) {
                              newList = allowedOvensList.filter(id => id !== oven.id);
                              // Prevent unchecking all ovens (must have at least one allowed oven)
                              if (newList.length === 0) return;
                            } else {
                              newList = [...allowedOvensList, oven.id];
                            }
                            setEditingAssignment({
                              ...editingAssignment,
                              allowedOvens: newList
                            });
                          };
                          return (
                            <label key={oven.id} className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-300 bg-zinc-900/65 p-2 px-3 rounded-xl border border-zinc-800/80 hover:bg-zinc-800 transition-colors select-none">
                              <input 
                                type="checkbox"
                                checked={isAllowed}
                                onChange={handleToggleOven}
                                className="accent-emerald-500 h-4 w-4"
                              />
                              <span>{oven.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Oven Specific Baking Specs Grid */}
                  <div className="space-y-2.5 p-4 rounded-2xl bg-zinc-950 border border-zinc-900">
                    <span className="block text-[10.5px] font-black text-emerald-400">دمای پخت و زمان پخت به تفکیک فرهای کارگاه:</span>
                    <div className="space-y-3">
                      {settings.ovens.map(oven => {
                        const currentBake = editingAssignment.bakingSettings?.[oven.id] || { temp: 200, time: 15 };
                        const handleUpdateBakeSpec = (field: 'temp' | 'time', val: number) => {
                          const updatedBaking = {
                            ...(editingAssignment.bakingSettings || {}),
                            [oven.id]: {
                              ...currentBake,
                              [field]: val
                            }
                          };
                          setEditingAssignment({
                            ...editingAssignment,
                            bakingSettings: updatedBaking
                          });
                        };

                        return (
                          <div key={oven.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                            <span className="text-xs font-bold text-white">{oven.name}:</span>
                            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                              <span>دما:</span>
                              <input 
                                type="number"
                                value={currentBake.temp}
                                onChange={(e) => handleUpdateBakeSpec('temp', Number(e.target.value))}
                                className="w-16 bg-zinc-950 border border-zinc-800 rounded text-center text-white p-1 text-xs font-mono"
                              />
                              <span>°C</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                              <span>زمان:</span>
                              <input 
                                type="number"
                                value={currentBake.time}
                                onChange={(e) => handleUpdateBakeSpec('time', Number(e.target.value))}
                                className="w-16 bg-zinc-950 border border-zinc-800 rounded text-center text-white p-1 text-xs font-mono"
                              />
                              <span>دقیقه</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-1.5 pt-3 border-t border-zinc-850">
                    <button
                      type="button"
                      onClick={() => setEditingAssignment(null)}
                      className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-400 hover:text-white transition-colors"
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-black text-white transition-colors"
                    >
                      ذخیره انتساب کالا
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 4. Rack Edit Modal */}
            {editingRack && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-sans" dir="rtl">
                <form onSubmit={handleSaveRack} className="bg-[#0e0e11] border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <h3 className="text-xs font-black text-white border-b border-zinc-900 pb-2">
                    {editingRack.id ? 'ویرایش مشخصات راک تولیدی' : 'تعریف راک تولیدی جدید'}
                  </h3>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">شماره/کد شناسایی راک:</label>
                    <input 
                      type="text" 
                      required
                      value={editingRack.rackNumber || ''}
                      onChange={(e) => setEditingRack({ ...editingRack, rackNumber: e.target.value })}
                      placeholder="مانند 1، 2، A، یا B..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white outline-none focus:border-emerald-500 font-mono font-bold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">نام راک:</label>
                    <input 
                      type="text" 
                      required
                      value={editingRack.name || ''}
                      onChange={(e) => setEditingRack({ ...editingRack, name: e.target.value })}
                      placeholder="مانند راک شماره ۱ یا راک بزرگ..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400">تعداد طبقات راک:</label>
                    <input 
                      type="number" 
                      required
                      min={1}
                      value={editingRack.tiersCount || 10}
                      onChange={(e) => setEditingRack({ ...editingRack, tiersCount: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2 px-3 text-xs text-white outline-none focus:border-emerald-500 font-mono font-bold"
                    />
                  </div>

                  <div className="flex justify-end gap-1.5 pt-3">
                    <button
                      type="button"
                      onClick={() => setEditingRack(null)}
                      className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-850 rounded-lg text-[10.5px] font-bold text-zinc-400 transition-colors"
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-[10.5px] font-black text-white transition-colors"
                    >
                      ذخیره راک
                    </button>
                  </div>
                </form>
              </div>
            )}

          </motion.div>
        ) : (
          <motion.div
            key="optimization-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Optimization Welcome & Introduction Banner */}
            <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6" dir="rtl">
              <div className="space-y-1">
                <h2 className="text-sm font-black text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-400 animate-pulse" />
                  موتور هوشمند بهینه‌سازی تولید و پخت کارگاه گاتان
                </h2>
                <p className="text-[11px] text-zinc-400 leading-relaxed max-w-2xl">
                  این بخش با پایش بلادرنگ صف سفارشات، ظرفیت فیزیکی فرها، گرمخانه‌ها و زمان‌های بیکاری، پیشنهادهای عملیاتی دقیقی را برای تنظیم بهینه اولویت‌های تولید ارائه می‌دهد تا کمترین تداخل فر و بیشترین بازدهی حاصل شود.
                </p>
              </div>
              <div className="bg-zinc-900/60 p-3 rounded-2xl border border-zinc-800/50 flex items-center gap-3">
                <div className="text-right">
                  <span className="block text-[10px] text-zinc-500">حداکثر تداخل ثبت شده:</span>
                  <strong className="text-xs text-rose-400 font-mono">{toPersianDigits(timelineData.hasOvenCollision ? 'بله (تداخل وجود دارد)' : 'بدون تداخل فر')}</strong>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" dir="rtl">
              
              {/* Column 1 & 2: Optimization suggestions and customized detailed rules */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* 1. Standard Optimization Advisor suggestions */}
                <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5 border-b border-zinc-900 pb-2.5">
                    <Sparkles className="h-4.5 w-4.5 text-emerald-400" />
                    توصیه‌های هوشمند موتور بهینه‌ساز تولید
                  </h3>

                  {optimizationSuggestions.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500 bg-zinc-950/40 rounded-2xl border border-zinc-900/50 flex flex-col items-center justify-center gap-2">
                      <CheckCircle className="h-8 w-8 text-emerald-400" />
                      <span className="text-[11px] text-zinc-300 font-bold">برنامه فعلی کارگاه ۱۰۰٪ بهینه و فاقد هرگونه تداخل است!</span>
                      <p className="text-[10px] text-zinc-500">تمامی فاکتورهای زنجیره تامین، پخت فرها و زمان سرد شدن راک‌ها رعایت شده‌اند.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {optimizationSuggestions.map((s: any, idx: number) => {
                        let colorClass = 'bg-zinc-950/80 border-zinc-900 text-zinc-300';
                        let icon = <Info className="h-4 w-4 text-zinc-400" />;

                        if (s.type === 'error' || s.severity === 'high') {
                          colorClass = 'bg-rose-950/10 border-rose-900/30 text-rose-200';
                          icon = <AlertTriangle className="h-4 w-4 text-rose-400" />;
                        } else if (s.type === 'warning' || s.severity === 'medium') {
                          colorClass = 'bg-amber-950/10 border-amber-900/30 text-amber-200';
                          icon = <AlertTriangle className="h-4 w-4 text-amber-400" />;
                        } else if (s.type === 'success') {
                          colorClass = 'bg-emerald-950/10 border-emerald-900/30 text-emerald-200';
                          icon = <CheckCircle className="h-4 w-4 text-emerald-400" />;
                        }

                        return (
                          <div key={idx} className={`p-4 rounded-2xl border flex items-start gap-3 ${colorClass}`}>
                            <div className="mt-0.5">{icon}</div>
                            <div className="space-y-1">
                              <span className="block text-xs font-black">{s.title || 'توصیه بهینه‌سازی'}</span>
                              <p className="text-[10.5px] leading-relaxed opacity-90">{s.message}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Interactive Workshop Real Batch Analysis & Tailored priority recommendations */}
                <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5 border-b border-zinc-900 pb-2.5">
                    <Sliders className="h-4.5 w-4.5 text-emerald-400" />
                    آنالیز تفاوت‌ها و پیشنهادات فرآیند پخت اختصاصی کارگاه گاتان
                  </h3>
                  
                  <div className="space-y-4 text-xs">
                    {/* Temperature warning rule */}
                    {(() => {
                      const temps = settings.productAssignments.map(a => {
                        return Object.values(a.bakingSettings || {}).map((v: any) => v.temp);
                      }).flat().filter(Boolean);
                      const uniqueTemps = Array.from(new Set(temps));
                      if (uniqueTemps.length > 1) {
                        return (
                          <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                            <Thermometer className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                            <div className="space-y-1">
                              <span className="block font-black text-amber-400 text-xs">⚠️ بهینه‌سازی دمای فرها و پیشگیری از افت انرژی</span>
                              <p className="text-[11px] text-zinc-300 leading-relaxed">
                                شما در برنامه‌ریزی امروز خود دارای <strong className="text-white font-mono">{toPersianDigits(uniqueTemps.length)} دمای متفاوت</strong> برای پخت محصولات هستید ({uniqueTemps.map(t => `${toPersianDigits(t)}°`).join('، ')}). جهت بهینه‌ترین حالت پخت، قویاً پیشنهاد می‌شود راک‌های هم‌دما را به طور متوالی پشت سر هم پخت کنید. همچنین شروع پخت با دماهای بالاتر و کاهش تدریجی دما راندمان حرارتی فر را تا ۳۰٪ بهبود می‌دهد.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Steam required warning rule */}
                    {(() => {
                      const steamProducts = settings.productAssignments.filter(a => a.steamRequired);
                      if (steamProducts.length > 0) {
                        return (
                          <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-3">
                            <Wind className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
                            <div className="space-y-1">
                              <span className="block font-black text-blue-400 text-xs">💧 هماهنگی و تجمیع پخت‌های نیازمند بخار آب</span>
                              <p className="text-[11px] text-zinc-300 leading-relaxed">
                                محصولاتی نظیر <strong className="text-white">{steamProducts.map(p => getProdName(p.productId)).join(' و ')}</strong> نیاز به تزریق بخار آب فر در حین پخت دارند. چیدمان متوالی این پخت‌ها سبب می‌شود بویلر فر به طور یکنواخت کار کند و هزینه‌های تامین گرمایش و بخار آب فرها کاهش یابد.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Alternating shelves spacing advice */}
                    {(() => {
                      const alternatingProducts = settings.productAssignments.filter(a => a.alternatingShelves);
                      if (alternatingProducts.length > 0) {
                        return (
                          <div className="p-4 rounded-2xl bg-purple-500/5 border border-purple-500/10 flex items-start gap-3">
                            <Layers className="h-5 w-5 text-purple-400 mt-0.5 shrink-0" />
                            <div className="space-y-1">
                              <span className="block font-black text-purple-400 text-xs">⚖️ مدیریت فضا با تمرکز چیدمان یک‌درمیان سینی‌ها</span>
                              <p className="text-[11px] text-zinc-300 leading-relaxed">
                                محصولاتی مانند <strong className="text-white">{alternatingProducts.map(p => getProdName(p.productId)).join('، ')}</strong> به چیدمان فاصله‌دار (یک‌درمیان) در طبقات راک نیاز دارند تا حرارت به صورت یکنواخت به دیواره آن‌ها برسد. پیشنهاد می‌شود سینی‌های این محصولات را در راک‌های مشخص متمرکز کنید تا از خالی ماندن بی‌مورد طبقات در سایر راک‌های عادی کارگاه جلوگیری شود.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* General tips */}
                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/60 flex items-start gap-3">
                      <Info className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <span className="block font-black text-emerald-400 text-xs">💡 راهکار هم‌راستایی پخت و جلوگیری از سرد شدن راک‌ها</span>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          اگر تفاوت میان پایان زمان تخمیر نهایی و شروع زمان پخت یک راک بیش از ۱۵ دقیقه باشد، خمیر دچار تخمیر بیش از حد (اورپروف) شده و در فر کیفیت خود را از دست می‌دهد. اولویت‌های راک را به نحوی تغییر دهید که بلافاصله پس از اتمام استراحت گرمخانه، فر آزاد شده و آماده بارگیری باشد.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Column 3: Physical Status of Ovens & Proofing */}
              <div className="space-y-6">
                
                {/* Proofing & Ovens occupancy status */}
                <div className="bg-[#0d0d0f] p-6 rounded-3xl border border-zinc-800/80 shadow-2xl space-y-4">
                  <h3 className="text-xs font-black text-white flex items-center gap-1.5 border-b border-zinc-900 pb-2">
                    <Flame className="h-4.5 w-4.5 text-emerald-400" />
                    وضعیت فیزیکی فرها و گرمخانه تخمیر
                  </h3>

                  <div className="space-y-4 text-xs font-medium">
                    {/* Proofing room indicator */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-zinc-400">ظرفیت کل گرمخانه تخمیر:</span>
                        <strong className="text-zinc-200">{toPersianDigits(settings.proofingMaxRacks)} راک همزمان</strong>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-zinc-400">حداکثر فعال روز جاری:</span>
                        <strong className={timelineData.maxProofingRacksActiveAtOnce > settings.proofingMaxRacks ? 'text-rose-400' : 'text-emerald-400'}>
                          {toPersianDigits(timelineData.maxProofingRacksActiveAtOnce)} راک همزمان
                        </strong>
                      </div>
                    </div>

                    {/* Ovens ocupancies list */}
                    {settings.ovens.map((oven) => {
                      const bookings = timelineData.ovenOccupancies?.[oven.id] || [];
                      return (
                        <div key={oven.id} className="space-y-1.5 pt-2 border-t border-zinc-900/40">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-zinc-400">رزرو پخت {oven.name}:</span>
                            <span className="text-rose-400 font-bold font-mono">{toPersianDigits(bookings.length)} پخت</span>
                          </div>
                          {bookings.length === 0 ? (
                            <p className="text-[10px] text-zinc-500 italic">بدون پخت در فر جاری در کل ساعات روز</p>
                          ) : (
                            <div className="space-y-1">
                              {bookings.map((b: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center text-[10px] bg-zinc-900 p-1 px-2 rounded text-zinc-400 font-mono">
                                  <span>راک {toPersianDigits(b.rackNum)}:</span>
                                  <span>{toPersianDigits(minutesToClockString(b.startMin))} الی {toPersianDigits(minutesToClockString(b.endMin))}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>



              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= PRINT REPORT SELECTION MODAL ================= */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0d0d0f] border border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-right"
          >
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <Printer className="h-5 w-5 text-emerald-400" />
                انتخاب گزارش زمان‌بندی جهت چاپ
              </h3>
              <button 
                onClick={() => setShowPrintModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Report Type options */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-zinc-400">نوع گزارش چاپی:</label>
                <div className="grid grid-cols-1 gap-2">
                  <label className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${printType === 'comprehensive' ? 'bg-emerald-600/10 border-emerald-500 text-white' : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                    <input 
                      type="radio" 
                      name="printType" 
                      checked={printType === 'comprehensive'} 
                      onChange={() => setPrintType('comprehensive')}
                      className="accent-emerald-500"
                    />
                    <div className="text-right">
                      <span className="block text-xs font-black">گزارش جامع کل فرآیندها</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5">چاپ جدول زمان‌بندی همزمان کلیه راک‌ها به صورت افقی</span>
                    </div>
                  </label>

                  <label className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${printType === 'process' ? 'bg-emerald-600/10 border-emerald-500 text-white' : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                    <input 
                      type="radio" 
                      name="printType" 
                      checked={printType === 'process'} 
                      onChange={() => setPrintType('process')}
                      className="accent-emerald-500"
                    />
                    <div className="text-right">
                      <span className="block text-xs font-black">گزارش مجزا بر اساس هر فرآیند</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5">مخصوص یک سرپرست فرآیند (مانند خمیرگیری، پخت، بسته‌بندی)</span>
                    </div>
                  </label>

                  <label className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${printType === 'department' ? 'bg-emerald-600/10 border-emerald-500 text-white' : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                    <input 
                      type="radio" 
                      name="printType" 
                      checked={printType === 'department'} 
                      onChange={() => setPrintType('department')}
                      className="accent-emerald-500"
                    />
                    <div className="text-right">
                      <span className="block text-xs font-black">گزارش تفکیک شده دپارتمان‌های کارگاه</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5">مخصوص ایستگاه‌های فیزیکی کارگاه (آماده‌سازی، پخت، بسته‌بندی)</span>
                    </div>
                  </label>

                  <label className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${printType === 'comparison_table' ? 'bg-emerald-600/10 border-emerald-500 text-white' : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                    <input 
                      type="radio" 
                      name="printType" 
                      checked={printType === 'comparison_table'} 
                      onChange={() => setPrintType('comparison_table')}
                      className="accent-emerald-500"
                    />
                    <div className="text-right">
                      <span className="block text-xs font-black">جدول تطبیقی ترتیبی فرآیندهای موازی</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5">گزارش تطبیقی و هماهنگی زنجیره پخت کل راک‌ها و فرآیندها</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Sub selections conditional on Print Type */}
              {printType === 'process' && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-zinc-400">فرآیند مورد نظر را انتخاب کنید:</label>
                  <select
                    value={printSubSelection}
                    onChange={(e) => setPrintSubSelection(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-emerald-500 font-bold"
                  >
                    <option value="kneading">۱. خمیرگیری و تامین خمیر</option>
                    <option value="shaping">۲. چانه‌گیری، توزین و شکل‌دهی</option>
                    <option value="proofing">۳. زمان‌بندی و کنترل گرمخانه تخمیر</option>
                    <option value="baking">۴. برنامه پخت فرها (مخصوص تنورداران)</option>
                    <option value="packaging">۵ و ۶. دپارتمان خنک‌سازی و بسته‌بندی</option>
                  </select>
                </div>
              )}

              {printType === 'department' && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-zinc-400">ایستگاه و دپارتمان فیزیکی:</label>
                  <select
                    value={printSubSelection}
                    onChange={(e) => setPrintSubSelection(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-emerald-500 font-bold"
                  >
                    <option value="prep-knead">دپارتمان آماده‌سازی و فرم‌دهی خمیر</option>
                    <option value="ferment-bake">دپارتمان گرمخانه‌ها و فر خانه پخت</option>
                    <option value="cool-pack">دپارتمان سردکاری و سلفون‌پیچی بسته‌بندی</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-900">
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                onClick={handleGenerateAndPrintReport}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1 transition-all cursor-pointer shadow-lg"
              >
                <Printer className="h-4 w-4" />
                تایید و چاپ گزارش
              </button>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
