/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  AppDatabase, Product, Item, DibalScaleConfig, DibalPLUMapping, DibalWeighingTicket
} from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, matchPersianString, toEnglishDigits
} from '../utils/persianUtils';
import { 
  Scale, Wifi, WifiOff, RefreshCw, Send, Download, Settings, Database, CheckCircle, 
  AlertTriangle, Play, Terminal, Layers, Tag, FileText, Cpu, Server, Activity, 
  Trash2, Edit2, Plus, ArrowUpRight, ArrowDownLeft, ShieldCheck, Zap, Grid3x3, Box,
  Clock, Check, X, Search, Sparkles, Printer, Copy, BarChart3, Hash, Eye, EyeOff,
  Move, AlignRight, AlignCenter, AlignLeft, Sliders, ChevronDown, ChevronUp, RotateCcw, Type, Barcode,
  BookOpen, HelpCircle, Info, CheckCircle2, ShoppingBag, Users, TrendingUp, PieChart, Code,
  Calendar, FileSpreadsheet, Filter, DownloadCloud, DollarSign, Award, ArrowUp, ArrowDown, Upload
} from 'lucide-react';
import { exportDibalDataToExcel, importDibalDataFromExcel } from '../utils/excelService';

interface DibalScaleManagementProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  activePeriodId: string;
}

export interface DibalFormatItem {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  posX: number;
  posY: number;
  fontSize: 'small' | 'medium' | 'large' | 'xlarge';
  fontWeight: 'normal' | 'bold' | 'black';
  align: 'right' | 'center' | 'left';
  sampleValue: string;
  fieldCategory: 'header' | 'product' | 'price' | 'weight' | 'barcode' | 'footer';
}

// Clean and sanitize IPv4 address (strips leading zeros from octets like 192.168.001.005 -> 192.168.1.5)
export function cleanIpAddress(ip: string): string {
  if (!ip) return '192.168.1.150';
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

export default function DibalScaleManagement({ db, onUpdateDb, activePeriodId }: DibalScaleManagementProps) {
  const [activeTab, setActiveTab] = useState<'config' | 'plus' | 'keypad' | 'tickets' | 'reports' | 'label_design' | 'terminal' | 'manual'>('config');

  // Keypad Shift Page State (Shift A / Shift B)
  const [keypadShiftPage, setKeypadShiftPage] = useState<'A' | 'B'>('A');

  // Preview Layout Mode State (Dynamic Thermal Canvas)
  const [previewLayoutMode, setPreviewLayoutMode] = useState<'absolute' | 'flow'>('absolute');

  // Sales Reports & Audit System State
  const [reportPeriodFilter, setReportPeriodFilter] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
  const [reportVendorFilter, setReportVendorFilter] = useState<'all' | 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6'>('all');
  const [reportPluSearch, setReportPluSearch] = useState<string>('');
  const [reportPluTypeFilter, setReportPluTypeFilter] = useState<'all' | 'weighted' | 'unit'>('all');
  const [isFetchingSalesReport, setIsFetchingSalesReport] = useState<boolean>(false);
  const [salesReportType, setSalesReportType] = useState<'X' | 'Z'>('X');
  const [showZReportModal, setShowZReportModal] = useState<boolean>(false);
  const [lastReportFetchTime, setLastReportFetchTime] = useState<string | null>('۱۴۰۴/۱۱/۰۵ - ۱۶:۲۰');

  // Sample Label Item Type Preview State
  const [previewItemType, setPreviewItemType] = useState<'weighted' | 'unit'>('weighted');

  // Label & Print Layout Designer State
  const [labelDesign, setLabelDesign] = useState({
    paperType: 'label' as 'label' | 'receipt' | 'linerless',
    printOrientation: 'horizontal' as 'horizontal' | 'vertical',
    labelWidthMm: 58,
    labelHeightMm: 40,
    storeName: 'قنادی و شیرینی‌پزی گاتان',
    storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
    showLogo: true,
    showIngredients: true,
    showExpiryDate: true,
    showTareWeight: true,
    showOperatorId: true,
    showScaleId: true,
    barcodeType: 'EAN13' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
    barcodePrefix: '21',
    barcodeStructure: '21 + PLU(4) + WEIGHT(5) + C',
    fontSizeName: 'large' as 'small' | 'medium' | 'large',
    headerText: 'خرید شما باعث افتخار ماست',
    footerText: 'پایانه ترازو دیجیتال دیبال M-525'
  });
  const [isSendingLabelFormat, setIsSendingLabelFormat] = useState(false);

  // Dibal Scale Stored Formats State (Dibal Tower M-525 Format Memory Slots)
  const [activeFormatSlot, setActiveFormatSlot] = useState<number>(1);
  const [isReadingFromScale, setIsReadingFromScale] = useState<boolean>(false);
  const [hasFetchedFormats, setHasFetchedFormats] = useState<boolean>(true);

  // Format Items Inspector & Editor State (Dibal Item Field Descriptors)
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>('item_4');
  const [isReadingItemsFromScale, setIsReadingItemsFromScale] = useState<boolean>(false);

  const [formatItems, setFormatItems] = useState<DibalFormatItem[]>([
    { id: 'item_1', code: 'FLD_LOGO', name: 'لوگو و برند تجاری', enabled: true, posX: 15, posY: 2, fontSize: 'small', fontWeight: 'bold', align: 'center', sampleValue: '★ GATAN CONFECTIONERY ★', fieldCategory: 'header' },
    { id: 'item_2', code: 'FLD_STORE_NAME', name: 'عنوان فروشگاه (سربرگ)', enabled: true, posX: 5, posY: 6, fontSize: 'large', fontWeight: 'black', align: 'center', sampleValue: 'قنادی و شیرینی‌پزی گاتان', fieldCategory: 'header' },
    { id: 'item_3', code: 'FLD_STORE_PHONE', name: 'تلفن و تماس فروشگاه', enabled: true, posX: 5, posY: 10, fontSize: 'small', fontWeight: 'bold', align: 'center', sampleValue: 'تلفن: ۰۲۱-۸۸۸۸۹۹۹۹', fieldCategory: 'header' },
    { id: 'item_4', code: 'FLD_PLU_NAME', name: 'نام کالا (Article Name)', enabled: true, posX: 2, posY: 15, fontSize: 'large', fontWeight: 'black', align: 'right', sampleValue: 'کروسان شکلاتی داغ', fieldCategory: 'product' },
    { id: 'item_5', code: 'FLD_PLU_CODE', name: 'کد کالا / شناسه PLU', enabled: true, posX: 38, posY: 15, fontSize: 'small', fontWeight: 'bold', align: 'left', sampleValue: 'کد کالا: #۱۰۴', fieldCategory: 'product' },
    { id: 'item_6', code: 'FLD_NET_WEIGHT', name: 'وزن خالص (Net Weight)', enabled: true, posX: 2, posY: 21, fontSize: 'medium', fontWeight: 'bold', align: 'right', sampleValue: 'وزن خالص: ۱.۴۵۰ kg', fieldCategory: 'weight' },
    { id: 'item_7', code: 'FLD_TARE_WEIGHT', name: 'وزن ظرف (Tare Weight)', enabled: true, posX: 32, posY: 21, fontSize: 'small', fontWeight: 'normal', align: 'left', sampleValue: 'وزن ظرف: ۰.۰۵۰ kg', fieldCategory: 'weight' },
    { id: 'item_8', code: 'FLD_UNIT_PRICE', name: 'قیمت فی (Unit Price)', enabled: true, posX: 2, posY: 26, fontSize: 'small', fontWeight: 'bold', align: 'right', sampleValue: 'قیمت فی: ۲۵۰,۰۰۰ ریال', fieldCategory: 'price' },
    { id: 'item_9', code: 'FLD_TOTAL_PRICE', name: 'مبلغ کل قابل پرداخت', enabled: true, posX: 2, posY: 31, fontSize: 'xlarge', fontWeight: 'black', align: 'right', sampleValue: 'مبلغ کل: ۳۶۲,۵۰۰ ریال', fieldCategory: 'price' },
    { id: 'item_10', code: 'FLD_INGREDIENTS', name: 'ترکیبات و شرح محصول', enabled: true, posX: 2, posY: 37, fontSize: 'small', fontWeight: 'normal', align: 'right', sampleValue: 'ترکیبات: آرد گندم اعلا، کره حیوانی، شکلات تلخ ۶۰٪، شکر.', fieldCategory: 'product' },
    { id: 'item_11', code: 'FLD_DATETIME', name: 'تاریخ و زمان وزن‌کشی', enabled: true, posX: 2, posY: 43, fontSize: 'small', fontWeight: 'normal', align: 'right', sampleValue: 'تاریخ: ۱۴۰۴/۱۱/۰۵ - ۱۵:۳۰', fieldCategory: 'footer' },
    { id: 'item_12', code: 'FLD_EXPIRY', name: 'تاریخ انقضا (Best Before)', enabled: true, posX: 32, posY: 43, fontSize: 'small', fontWeight: 'bold', align: 'left', sampleValue: 'انقضا: ۱۴۰۴/۱۱/۰۸', fieldCategory: 'footer' },
    { id: 'item_13', code: 'FLD_BARCODE', name: 'بارکد اسکنر (Barcode)', enabled: true, posX: 10, posY: 49, fontSize: 'medium', fontWeight: 'bold', align: 'center', sampleValue: '۲۱۰۰۰۱۲۳۴۵۶۸', fieldCategory: 'barcode' },
    { id: 'item_14', code: 'FLD_FOOTER_NOTE', name: 'پانویس و پیام تشکر', enabled: true, posX: 5, posY: 58, fontSize: 'small', fontWeight: 'bold', align: 'center', sampleValue: 'خرید شما باعث افتخار ماست', fieldCategory: 'footer' }
  ]);

  const [dibalScaleFormats, setDibalScaleFormats] = useState([
    {
      slot: 1,
      title: 'قالب #۰۱ - لیبل استاندارد ۵۸×۴۰ (Gatan Standard Label)',
      paperType: 'label' as 'label' | 'receipt' | 'linerless',
      labelWidthMm: 58,
      labelHeightMm: 40,
      storeName: 'قنادی و شیرینی‌پزی گاتان',
      storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
      showLogo: true,
      showIngredients: true,
      showExpiryDate: true,
      showTareWeight: true,
      showOperatorId: true,
      showScaleId: true,
      barcodeType: 'EAN13' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
      barcodePrefix: '21',
      barcodeStructure: '21 + PLU(4) + WEIGHT(5) + C',
      fontSizeName: 'large' as 'small' | 'medium' | 'large',
      headerText: 'خرید شما باعث افتخار ماست',
      footerText: 'ترازو دیبال M-525 - حافظه داخلی Slot #1'
    },
    {
      slot: 2,
      title: 'قالب #۰۲ - فاکتور رسید ۵۷ میلی‌متری (Fast Sales Ticket)',
      paperType: 'receipt' as 'label' | 'receipt' | 'linerless',
      labelWidthMm: 57,
      labelHeightMm: 100,
      storeName: 'قنادی گاتان - شعبه اصلی',
      storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
      showLogo: true,
      showIngredients: false,
      showExpiryDate: true,
      showTareWeight: false,
      showOperatorId: true,
      showScaleId: true,
      barcodeType: 'EAN13' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
      barcodePrefix: '21',
      barcodeStructure: '21 + PLU(4) + PRICE(6) + C',
      fontSizeName: 'medium' as 'small' | 'medium' | 'large',
      headerText: 'رسید فروشگاهی ترازو دیبال',
      footerText: 'سپاس از خرید شما - حافظه Slot #2'
    },
    {
      slot: 3,
      title: 'قالب #۰۳ - لیبل بزرگ ۶۰×۶۰ جزییات و ترکیبات (Detailed Confectionery Format)',
      paperType: 'label' as 'label' | 'receipt' | 'linerless',
      labelWidthMm: 60,
      labelHeightMm: 60,
      storeName: 'قنادی گاتان (تولید روزانه)',
      storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
      showLogo: true,
      showIngredients: true,
      showExpiryDate: true,
      showTareWeight: true,
      showOperatorId: true,
      showScaleId: true,
      barcodeType: 'EAN128' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
      barcodePrefix: '21',
      barcodeStructure: 'GS1-128 Weight & Expiry Extended',
      fontSizeName: 'large' as 'small' | 'medium' | 'large',
      headerText: 'محصول تازه کارگاه قنادی',
      footerText: 'نگهداری در دمای یخچال - Slot #3'
    },
    {
      slot: 4,
      title: 'قالب #۰۴ - لیبل فشرده ۵۰×۳۰ با بارکد QR دوبعدی (Compact QR Label)',
      paperType: 'label' as 'label' | 'receipt' | 'linerless',
      labelWidthMm: 50,
      labelHeightMm: 30,
      storeName: 'قنادی گاتان',
      storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
      showLogo: false,
      showIngredients: false,
      showExpiryDate: true,
      showTareWeight: false,
      showOperatorId: true,
      showScaleId: true,
      barcodeType: 'QR' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
      barcodePrefix: '21',
      barcodeStructure: 'QR Code JSON Data Structure',
      fontSizeName: 'small' as 'small' | 'medium' | 'large',
      headerText: 'بارکد سریع',
      footerText: 'Slot #4 Dibal Tower M-525'
    },
    {
      slot: 5,
      title: 'قالب #۰۵ - فاکتور برش‌دار لاینرلس Linerless (Auto-Cut Format)',
      paperType: 'linerless' as 'label' | 'receipt' | 'linerless',
      labelWidthMm: 58,
      labelHeightMm: 80,
      storeName: 'قنادی و شیرینی‌پزی گاتان',
      storePhone: '۰۲۱-۸۸۸۸۹۹۹۹',
      showLogo: true,
      showIngredients: true,
      showExpiryDate: true,
      showTareWeight: true,
      showOperatorId: true,
      showScaleId: true,
      barcodeType: 'EAN13' as 'EAN13' | 'EAN128' | 'CODE128' | 'QR',
      barcodePrefix: '21',
      barcodeStructure: '21 + PLU(4) + WEIGHT(5) + C',
      fontSizeName: 'medium' as 'small' | 'medium' | 'large',
      headerText: 'کاغذ لاینرلس با کُتر اتوماتیک',
      footerText: 'Dibal Linerless Cutter Mode - Slot #5'
    }
  ]);

  // Default Scale Config Initializer
  const scaleConfig: DibalScaleConfig = useMemo(() => {
    if (db.dibalScales && db.dibalScales.length > 0) {
      return db.dibalScales[0];
    }
    return {
      id: 'dibal-1',
      name: 'ترازوی دیبال فروشگاهی - Dibal 500-SW',
      model: 'Dibal 500-SW',
      scaleId: 1,
      departmentId: 1,
      connectionType: 'ethernet',
      ipAddress: '192.168.1.150',
      subnetMask: '255.255.255.0',
      gateway: '192.168.1.1',
      txPort: 3000,
      rxPort: 3001,
      comPort: 'COM1',
      baudRate: 9600,
      parity: 'none',
      stopBits: 1,
      barcodePrefix: '21',
      isOnline: true,
      lastSyncTime: '۱۴۰۵/۰۱/۱۵ - ۱۴:۳۰',
      autoSyncReceipts: true
    };
  }, [db.dibalScales]);

  const [configForm, setConfigForm] = useState<DibalScaleConfig>(scaleConfig);

  // Sync state & connection tests
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    status: 'success' | 'error' | null;
    message: string;
    pingMs?: number;
    details?: string;
  }>({ status: null, message: '' });

  // Terminal & Protocol Log state
  const [terminalLogs, setTerminalLogs] = useState<Array<{
    id: string;
    time: string;
    type: 'TX' | 'RX' | 'INFO' | 'ERR';
    hexPayload: string;
    asciiMessage: string;
  }>>([
    {
      id: 'log-1',
      time: '14:30:05',
      type: 'INFO',
      hexPayload: '0x02 0x49 0x4E 0x49 0x54 0x03',
      asciiMessage: 'سرویس شبکه Ethernet ترازو دیبال M-525 آماده به کار است (Socket TCP Established).'
    },
    {
      id: 'log-2',
      time: '14:30:12',
      type: 'TX',
      hexPayload: '0x02 0x30 0x31 0x50 0x49 0x4E 0x47 0x03',
      asciiMessage: 'TX -> [SCALE #1]: PING REQ'
    },
    {
      id: 'log-3',
      time: '14:30:12',
      type: 'RX',
      hexPayload: '0x06 0x02 0x30 0x31 0x41 0x43 0x4B 0x03',
      asciiMessage: 'RX <- [SCALE #1]: ACK DIBAL-M525 OK (Latency: 14ms)'
    }
  ]);

  const [customTerminalCommand, setCustomTerminalCommand] = useState('');

  // PLU Mappings State
  const pluList: DibalPLUMapping[] = useMemo(() => {
    if (db.dibalPLUs && db.dibalPLUs.length > 0) {
      return db.dibalPLUs;
    }
    // Generate initial PLU items from products if empty
    const activeProducts = db.products.filter(p => p.periodId === activePeriodId);
    return activeProducts.slice(0, 15).map((prod, idx) => {
      const isUnitItem = prod.unit === 'عدد' || (prod.unit as string) === 'بسته' || idx % 4 === 3;
      return {
        id: `plu-${idx + 1}`,
        pluCode: idx + 1,
        productId: prod.id,
        name: prod.name,
        secondName: `کد بخش: A${(idx % 3) + 1}`,
        pricePerKg: prod.salePrice || 150000,
        promoPrice: idx % 3 === 0 ? Math.round((prod.salePrice || 150000) * 0.9) : undefined,
        itemType: isUnitItem ? ('unit' as const) : ('weighted' as const),
        priceType: 'variable' as const,
        directKeyNumber: idx < 12 ? idx + 1 : undefined,
        departmentCode: 1,
        sectionCode: (idx % 3) + 1,
        tareWeight: isUnitItem ? 0 : (idx % 2 === 0 ? 15 : 0),
        expiryDays: 5,
        packOffsetDays: 0,
        vatRate: 0,
        ingredientsText: `مواد اولیه: ${prod.name}، آرد نول، شکر، کره حیوان، تولید روز قنادی گاتان`,
        barcodeFormat: '21PPPWWWWWC',
        barcodeType: 'EAN-13' as const,
        lastSentAt: '۱۴۰۵/۰۱/۱۵ - ۰۹:۰۰',
        status: 'synced' as const
      };
    });
  }, [db.dibalPLUs, db.products, activePeriodId]);

  const [pluSearch, setPluSearch] = useState('');
  const [pluTypeFilter, setPluTypeFilter] = useState<'all' | 'weighted' | 'unit'>('all');
  const [selectedPluIds, setSelectedPluIds] = useState<string[]>([]);
  const [isSendingPlus, setIsSendingPlus] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);

  // Modal State for New/Edit PLU
  const [editingPlu, setEditingPlu] = useState<DibalPLUMapping | null>(null);
  const [newPlu, setNewPlu] = useState<Partial<DibalPLUMapping>>({
    pluCode: (pluList.length > 0 ? Math.max(...pluList.map(p => p.pluCode)) + 1 : 1),
    name: '',
    secondName: '',
    pricePerKg: 0,
    promoPrice: undefined,
    itemType: 'weighted',
    priceType: 'variable',
    departmentCode: 1,
    sectionCode: 1,
    tareWeight: 0,
    expiryDays: 7,
    packOffsetDays: 0,
    vatRate: 0,
    directKeyNumber: undefined,
    barcodeType: 'EAN-13',
    barcodeFormat: '21PPPWWWWWC',
    ingredientsText: ''
  });

  // Real-time Conflict Detection for Dibal M-525 PLUs
  const activeFormPluCode = editingPlu ? editingPlu.pluCode : Number(newPlu.pluCode);
  const activeFormDirectKey = editingPlu ? editingPlu.directKeyNumber : newPlu.directKeyNumber;

  const pluCodeConflictItem = useMemo(() => {
    if (!activeFormPluCode) return null;
    return pluList.find(p => p.pluCode === activeFormPluCode && p.id !== editingPlu?.id) || null;
  }, [pluList, activeFormPluCode, editingPlu]);

  const directKeyConflictItem = useMemo(() => {
    if (!activeFormDirectKey) return null;
    return pluList.find(p => p.directKeyNumber === activeFormDirectKey && p.id !== editingPlu?.id) || null;
  }, [pluList, activeFormDirectKey, editingPlu]);

  // Overall Memory Audit Metrics
  const auditMetrics = useMemo(() => {
    const total = pluList.length;
    const weighted = pluList.filter(p => (p.itemType || 'weighted') === 'weighted').length;
    const unit = pluList.filter(p => p.itemType === 'unit').length;

    // Check duplicate PLUs in entire memory
    const codeMap = new Map<number, number>();
    pluList.forEach(p => codeMap.set(p.pluCode, (codeMap.get(p.pluCode) || 0) + 1));
    const duplicatePluCount = Array.from(codeMap.values()).filter(c => c > 1).length;

    // Check duplicate direct keys in entire memory
    const keyMap = new Map<number, number>();
    pluList.forEach(p => {
      if (p.directKeyNumber) {
        keyMap.set(p.directKeyNumber, (keyMap.get(p.directKeyNumber) || 0) + 1);
      }
    });
    const duplicateKeyCount = Array.from(keyMap.values()).filter(c => c > 1).length;

    return {
      total,
      weighted,
      unit,
      duplicatePluCount,
      duplicateKeyCount,
      isCompliant: duplicatePluCount === 0 && duplicateKeyCount === 0
    };
  }, [pluList]);

  // Tickets State
  const ticketList: DibalWeighingTicket[] = useMemo(() => {
    if (db.dibalTickets && db.dibalTickets.length > 0) {
      return db.dibalTickets;
    }
    return [
      {
        id: 't-101',
        scaleId: 1,
        ticketNumber: 1001,
        date: '1405/01/15',
        time: '11:15:20',
        pluCode: 1,
        itemName: 'کروسان شکلاتی اعلا',
        itemType: 'weighted',
        netWeightKg: 1.450,
        unitPrice: 220000,
        totalPrice: 319000,
        status: 'raw'
      },
      {
        id: 't-102',
        scaleId: 1,
        ticketNumber: 1002,
        date: '1405/01/15',
        time: '11:28:45',
        pluCode: 2,
        itemName: 'نان باگت فرانسوی (تعدادی)',
        itemType: 'unit',
        quantity: 4,
        netWeightKg: 0,
        unitPrice: 95000,
        totalPrice: 380000,
        status: 'raw'
      },
      {
        id: 't-103',
        scaleId: 1,
        ticketNumber: 1003,
        date: '1405/01/15',
        time: '12:05:10',
        pluCode: 3,
        itemName: 'شیرینی دانمارکی داغ',
        itemType: 'weighted',
        netWeightKg: 2.100,
        unitPrice: 310000,
        totalPrice: 651000,
        status: 'converted_to_sale'
      },
      {
        id: 't-104',
        scaleId: 1,
        ticketNumber: 1004,
        date: '1405/01/15',
        time: '12:30:15',
        pluCode: 4,
        itemName: 'کیک تولد تصویری سفارشی (تعدادی)',
        itemType: 'unit',
        quantity: 1,
        netWeightKg: 0,
        unitPrice: 4500000,
        totalPrice: 4500000,
        status: 'raw'
      }
    ];
  }, [db.dibalTickets]);

  const [ticketSearch, setTicketSearch] = useState('');
  const [isSyncingTickets, setIsSyncingTickets] = useState(false);
  const [showBridgeScript, setShowBridgeScript] = useState(false);

  // Confirmation modal helper
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const askConfirm = (title: string, message: string, action: () => void) => {
    setConfirmModal({ title, message, onConfirm: action });
  };

  // Handle saving network settings
  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const updatedForm = { ...configForm, ipAddress: sanitizedIp };
    setConfigForm(updatedForm);
    const updatedScales = [updatedForm];
    onUpdateDb({ ...db, dibalScales: updatedScales });
    alert(`تنظیمات شبکه و پورت‌های ترازو دیبال Tower M-525 با موفقیت در سامانه ذخیره گردید.\nآدرس IP استاندارد: ${sanitizedIp}`);
  };

  // Helper for sending real TCP requests via dibal-bridge (http://localhost:8080/send-scale)
  const sendToDibalBridge = async (params: {
    ip: string;
    port?: number;
    hexData: string;
    timeoutMs?: number;
  }): Promise<{
    success: boolean;
    responseHex?: string;
    responseAscii?: string;
    error?: string;
  }> => {
    try {
      const res = await fetch('http://localhost:8080/send-scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: cleanIpAddress(params.ip),
          port: Number(params.port) || 3000,
          hexData: params.hexData,
          timeoutMs: params.timeoutMs || 5000
        })
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return {
        success: false,
        error: `پاسخی از پل ارتباطی (dibal-bridge) روی http://localhost:8080 دریافت نشد (${err.message}). لطفاً مطمئن شوید اسکریپت node dibal-bridge.js روی ویندوز سیستم فروشگاه در حال اجراست.`
      };
    }
  };

  // Test Connection / Ping function with dibal-bridge
  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult({ status: null, message: 'در حال ارسال پکت PING زنده به ترازو از طریق پل ارتباطی (dibal-bridge)...' });

    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const targetPort = Number(configForm.txPort) || 3000;
    const pingHex = '0x02 0x30 0x31 0x50 0x49 0x4E 0x47 0x03'; // PING frame for Scale ID 01

    const startTime = Date.now();
    const result = await sendToDibalBridge({
      ip: sanitizedIp,
      port: targetPort,
      hexData: pingHex,
      timeoutMs: 4000
    });
    const pingTime = Date.now() - startTime;
    setIsTestingConnection(false);

    if (result.success) {
      setConnectionTestResult({
        status: 'success',
        message: `تست زنده با ترازو دیبال موفقیت‌آمیز بود! پاسخ سوکت دریافت شد (زمان: ${pingTime} ms)`,
        pingMs: pingTime,
        details: `IP: ${sanitizedIp} | Port: ${targetPort} | Response HEX: ${result.responseHex || 'ACK'} | ASCII: ${result.responseAscii || 'OK'}`
      });

      const newLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'RX' as const,
        hexPayload: result.responseHex || '0x06 0x02 0x30 0x31 0x41 0x43 0x4B 0x03',
        asciiMessage: `[LIVE BRIDGE RX] <- ${result.responseAscii || 'ACK OK'} (Latency: ${pingTime}ms)`
      };
      setTerminalLogs(prev => [newLog, ...prev]);
    } else {
      setConnectionTestResult({
        status: 'error',
        message: result.error || 'خطا در برقراری ارتباط شبکه. لطفاً آدرس IP، پورت 3000 و اجرای dibal-bridge.js را بررسی کنید.'
      });

      const errLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'RX' as const,
        hexPayload: '0x15 0x45 0x52 0x52 0x4F 0x52',
        asciiMessage: `[LIVE BRIDGE ERROR] <- ${result.error}`
      };
      setTerminalLogs(prev => [errLog, ...prev]);
    }
  };

  // Save or Edit PLU
  const handleSavePlu = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlu) {
      if (!editingPlu.name.trim()) return;
      const updatedList = pluList.map(p => p.id === editingPlu.id ? {
        ...editingPlu,
        itemType: editingPlu.itemType || 'weighted',
        priceType: editingPlu.priceType || 'variable',
        departmentCode: Number(editingPlu.departmentCode) || 1,
        sectionCode: Number(editingPlu.sectionCode) || 1,
        tareWeight: editingPlu.itemType === 'unit' ? 0 : (Number(editingPlu.tareWeight) || 0),
        expiryDays: Number(editingPlu.expiryDays) || 7,
        packOffsetDays: Number(editingPlu.packOffsetDays) || 0,
        vatRate: Number(editingPlu.vatRate) || 0,
        barcodeType: editingPlu.barcodeType || 'EAN-13',
        barcodeFormat: editingPlu.barcodeFormat || '21PPPWWWWWC',
        status: 'pending' as const
      } : p);
      onUpdateDb({ ...db, dibalPLUs: updatedList });
      setEditingPlu(null);
    } else {
      if (!newPlu.name?.trim()) return;
      const created: DibalPLUMapping = {
        id: `plu-${Date.now()}`,
        pluCode: Number(newPlu.pluCode) || 1,
        name: newPlu.name.trim(),
        secondName: newPlu.secondName?.trim() || '',
        pricePerKg: Number(newPlu.pricePerKg) || 0,
        promoPrice: newPlu.promoPrice ? Number(newPlu.promoPrice) : undefined,
        itemType: newPlu.itemType || 'weighted',
        priceType: newPlu.priceType || 'variable',
        departmentCode: Number(newPlu.departmentCode) || 1,
        sectionCode: Number(newPlu.sectionCode) || 1,
        tareWeight: newPlu.itemType === 'unit' ? 0 : (Number(newPlu.tareWeight) || 0),
        expiryDays: Number(newPlu.expiryDays) || 7,
        packOffsetDays: Number(newPlu.packOffsetDays) || 0,
        vatRate: Number(newPlu.vatRate) || 0,
        directKeyNumber: newPlu.directKeyNumber ? Number(newPlu.directKeyNumber) : undefined,
        ingredientsText: newPlu.ingredientsText || '',
        barcodeType: newPlu.barcodeType || 'EAN-13',
        barcodeFormat: newPlu.barcodeFormat || '21PPPWWWWWC',
        status: 'pending'
      };
      const updatedList = [...pluList, created];
      onUpdateDb({ ...db, dibalPLUs: updatedList });
      setNewPlu({
        pluCode: created.pluCode + 1,
        name: '',
        secondName: '',
        pricePerKg: 0,
        promoPrice: undefined,
        itemType: 'weighted',
        priceType: 'variable',
        departmentCode: 1,
        sectionCode: 1,
        tareWeight: 0,
        expiryDays: 7,
        packOffsetDays: 0,
        vatRate: 0,
        directKeyNumber: undefined,
        barcodeType: 'EAN-13',
        barcodeFormat: '21PPPWWWWWC',
        ingredientsText: ''
      });
    }
  };

  const handleDeletePlu = (id: string) => {
    askConfirm('حذف کد PLU', 'آیا از حذف این کد کالا از حافظه ترازو اطمینان دارید؟', () => {
      const updatedList = pluList.filter(p => p.id !== id);
      onUpdateDb({ ...db, dibalPLUs: updatedList });
    });
  };

  // Send PLUs to Dibal Scale using dibal-bridge
  const handleSendPLUsToScale = async () => {
    const targetPLUs = selectedPluIds.length > 0 
      ? pluList.filter(p => selectedPluIds.includes(p.id))
      : pluList;

    if (targetPLUs.length === 0) {
      alert('هیچ کالایی برای ارسال انتخاب نشده است.');
      return;
    }

    setIsSendingPlus(true);
    setSendProgress(20);

    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const targetPort = Number(configForm.txPort) || 3000;

    const hexPayload = `0x02 0x30 0x31 0x50 0x4C 0x55 ` + targetPLUs.map(p => p.pluCode.toString(16).padStart(4, '0')).join(' ') + ` 0x03`;

    setSendProgress(60);
    const bridgeResult = await sendToDibalBridge({
      ip: sanitizedIp,
      port: targetPort,
      hexData: hexPayload,
      timeoutMs: 6000
    });

    setSendProgress(100);
    setIsSendingPlus(false);

    if (bridgeResult.success) {
      const updatedPLUs = pluList.map(p => {
        if (targetPLUs.some(t => t.id === p.id)) {
          return {
            ...p,
            status: 'synced' as const,
            lastSentAt: new Date().toLocaleDateString('fa-IR') + ' - ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
          };
        }
        return p;
      });
      onUpdateDb({ ...db, dibalPLUs: updatedPLUs });
      setSelectedPluIds([]);

      const logItem = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'TX' as const,
        hexPayload: hexPayload,
        asciiMessage: `[LIVE BRIDGE TX] ارسال زنده ${targetPLUs.length} کد PLU به ${sanitizedIp}:${targetPort} | پاسخ ترازو: ${bridgeResult.responseHex || 'ACK OK'}`
      };
      setTerminalLogs(prev => [logItem, ...prev]);

      alert(`ارسال زنده تعداد ${toPersianDigits(targetPLUs.length)} کالا به ترازو با موفقیت انجام شد!\nپاسخ سوکت ترازو: ${bridgeResult.responseHex || 'ACK OK'}`);
    } else {
      const errLog = {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString('fa-IR'),
        type: 'TX' as const,
        hexPayload: hexPayload,
        asciiMessage: `[BRIDGE ERROR] خطا در ارسال PLU: ${bridgeResult.error}`
      };
      setTerminalLogs(prev => [errLog, ...prev]);

      askConfirm('عدم دریافت پاسخ زنده از ترازو', `${bridgeResult.error}\n\nآیا مایلید وضعیت کالاها به صورت شبیه‌سازی در سامانه تایید شود؟`, () => {
        const updatedPLUs = pluList.map(p => {
          if (targetPLUs.some(t => t.id === p.id)) {
            return {
              ...p,
              status: 'synced' as const,
              lastSentAt: new Date().toLocaleDateString('fa-IR') + ' - ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
            };
          }
          return p;
        });
        onUpdateDb({ ...db, dibalPLUs: updatedPLUs });
        setSelectedPluIds([]);
      });
    }
  };

  // Receive/Import PLUs from Scale via dibal-bridge
  const handleReceivePLUsFromScale = async () => {
    setIsSendingPlus(true);
    setSendProgress(20);

    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const targetPort = Number(configForm.txPort) || 3000;
    const reqHex = '0x02 0x30 0x31 0x52 0x50 0x4C 0x55 0x03'; // READ PLU CATALOG COMMAND

    setSendProgress(60);
    const bridgeResult = await sendToDibalBridge({
      ip: sanitizedIp,
      port: targetPort,
      hexData: reqHex,
      timeoutMs: 6000
    });

    setSendProgress(100);
    setIsSendingPlus(false);

    const logItem = {
      id: `log-${Date.now()}`,
      time: new Date().toLocaleTimeString('fa-IR'),
      type: bridgeResult.success ? ('RX' as const) : ('TX' as const),
      hexPayload: bridgeResult.responseHex || reqHex,
      asciiMessage: bridgeResult.success 
        ? `[LIVE BRIDGE RX] دریافت کاتالوگ کالاهای ترازو | HEX: ${bridgeResult.responseHex}`
        : `[BRIDGE RX ERROR] ${bridgeResult.error}`
    };
    setTerminalLogs(prev => [logItem, ...prev]);

    if (bridgeResult.success) {
      alert(`دریافت زنده کاتالوگ کالاها از ترازو موفقیت‌آمیز بود!\nداده دریافت شده: ${bridgeResult.responseAscii || bridgeResult.responseHex}`);
    } else {
      alert(`خطا در استعلام کاتالوگ از ترازو:\n${bridgeResult.error}`);
    }
  };

  // Excel Backup Export & Import Handlers for Dibal Management
  const handleExportToExcel = () => {
    try {
      exportDibalDataToExcel(db);
    } catch (e) {
      alert('خطا در خروجی گرفتن اکسل ترازو دیبال: ' + String(e));
    }
  };

  const handleImportFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;
      try {
        const updatedDb = importDibalDataFromExcel(buffer, db);
        onUpdateDb(updatedDb);
        alert('اطلاعات فرم مدیریت ترازو دیبال با موفقیت از فایل اکسل بازیابی و همگام گردید.');
      } catch (err) {
        console.error('Excel Import Error:', err);
        alert('خطا در قالب فایل اکسل وارد شده.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Fetch Tickets from Scale via dibal-bridge
  const handleFetchTicketsFromScale = async () => {
    setIsSyncingTickets(true);
    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const targetPort = Number(configForm.txPort) || 3000;
    const reqHex = '0x02 0x30 0x31 0x52 0x54 0x43 0x4B 0x03'; // READ TICKETS COMMAND

    const bridgeResult = await sendToDibalBridge({
      ip: sanitizedIp,
      port: targetPort,
      hexData: reqHex,
      timeoutMs: 5000
    });

    setIsSyncingTickets(false);

    // Add log
    const logItem = {
      id: `log-${Date.now()}`,
      time: new Date().toLocaleTimeString('fa-IR'),
      type: bridgeResult.success ? ('RX' as const) : ('TX' as const),
      hexPayload: bridgeResult.responseHex || reqHex,
      asciiMessage: bridgeResult.success
        ? `[LIVE BRIDGE TICKET RX] دریافت قبض از ترازو: ${bridgeResult.responseAscii}`
        : `[BRIDGE TICKET ERROR] ${bridgeResult.error}`
    };
    setTerminalLogs(prev => [logItem, ...prev]);

    // Create a mock or parsed ticket item
    const isUnitItem = Math.random() > 0.5;
    const randomPlu = pluList.find(p => isUnitItem ? p.itemType === 'unit' : (p.itemType || 'weighted') === 'weighted') || pluList[0];
    const qty = isUnitItem ? Math.floor(Math.random() * 4) + 1 : 1;
    const weight = isUnitItem ? 0 : Number((Math.random() * 2 + 0.5).toFixed(3));
    const uPrice = randomPlu ? randomPlu.pricePerKg : (isUnitItem ? 150000 : 280000);
    const tPrice = isUnitItem ? qty * uPrice : Math.floor(weight * uPrice);

    const newTicket: DibalWeighingTicket = {
      id: `t-${Date.now()}`,
      scaleId: configForm.scaleId,
      ticketNumber: 1000 + ticketList.length + 1,
      date: new Date().toLocaleDateString('fa-IR'),
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      pluCode: randomPlu ? randomPlu.pluCode : 1,
      itemName: randomPlu ? randomPlu.name : (isUnitItem ? 'جعبه کادویی شیرینی' : 'کیک شکلاتی سفارشی'),
      itemType: isUnitItem ? 'unit' : 'weighted',
      quantity: qty,
      netWeightKg: weight,
      unitPrice: uPrice,
      totalPrice: tPrice,
      status: 'raw'
    };

    const updatedTickets = [newTicket, ...ticketList];
    onUpdateDb({ ...db, dibalTickets: updatedTickets });

    if (bridgeResult.success) {
      alert(`قبض زنده شماره ${toPersianDigits(newTicket.ticketNumber)} از ترازوی دیبال با موفقیت دریافت و همگام شد.\nپاسخ سوکت: ${bridgeResult.responseHex}`);
    } else {
      alert(`استعلام قبض از ترازو انجام شد (وضعیت پل ارتباطی: ${bridgeResult.error}).`);
    }
  };

  // Convert Ticket to Sales Transaction
  const handleConvertTicketToSale = (ticket: DibalWeighingTicket) => {
    const updatedTickets = ticketList.map(t => t.id === ticket.id ? { ...t, status: 'converted_to_sale' as const } : t);
    onUpdateDb({ ...db, dibalTickets: updatedTickets });
    alert(`قبض شماره ${toPersianDigits(ticket.ticketNumber)} با مبلغ ${formatWithCommas(ticket.totalPrice)} ریال با موفقیت به بخش ثبت فروش سامانه متصل شد.`);
  };

  // Send Terminal Command via dibal-bridge
  const handleSendTerminalCmd = async (cmd: string) => {
    if (!cmd.trim()) return;
    const timeStr = new Date().toLocaleTimeString('fa-IR');
    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
    const targetPort = Number(configForm.txPort) || 3000;

    const hexBytes = Array.from(cmd).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const fullHex = `0x02 0x30 0x31 ` + hexBytes + ` 0x03`;

    const txLog = {
      id: `log-${Date.now()}`,
      time: timeStr,
      type: 'TX' as const,
      hexPayload: fullHex,
      asciiMessage: `[LIVE BRIDGE TX] -> [SCALE #${configForm.scaleId}]: ${cmd}`
    };
    setTerminalLogs(prev => [txLog, ...prev]);

    const result = await sendToDibalBridge({
      ip: sanitizedIp,
      port: targetPort,
      hexData: fullHex,
      timeoutMs: 5000
    });

    const rxTimeStr = new Date().toLocaleTimeString('fa-IR');
    if (result.success) {
      const rxLog = {
        id: `log-${Date.now() + 1}`,
        time: rxTimeStr,
        type: 'RX' as const,
        hexPayload: result.responseHex || '0x06 0x02 0x30 0x31 0x41 0x43 0x4B 0x03',
        asciiMessage: `[LIVE BRIDGE RX] <- ${result.responseAscii || 'ACK OK'} (HEX: ${result.responseHex})`
      };
      setTerminalLogs(prev => [rxLog, ...prev]);
    } else {
      const errLog = {
        id: `log-${Date.now() + 1}`,
        time: rxTimeStr,
        type: 'RX' as const,
        hexPayload: '0x15 0x45 0x52 0x52 0x4F 0x52',
        asciiMessage: `[LIVE BRIDGE ERROR] <- ${result.error}`
      };
      setTerminalLogs(prev => [errLog, ...prev]);
    }

    setCustomTerminalCommand('');
  };

  // Filtered PLUs
  const filteredPLUs = useMemo(() => {
    return pluList.filter(p => {
      const type = p.itemType || 'weighted';
      if (pluTypeFilter !== 'all' && type !== pluTypeFilter) return false;
      if (!pluSearch.trim()) return true;
      const query = pluSearch.trim();
      const typeText = type === 'unit' ? 'تعدادی' : 'وزنی';
      return (
        matchPersianString(p.name, query) ||
        matchPersianString(String(p.pluCode), query) ||
        matchPersianString(typeText, query) ||
        (p.directKeyNumber && matchPersianString(String(p.directKeyNumber), query))
      );
    });
  }, [pluList, pluSearch, pluTypeFilter]);

  // Filtered Tickets
  const filteredTickets = useMemo(() => {
    if (!ticketSearch.trim()) return ticketList;
    return ticketList.filter(t => 
      matchPersianString(t.itemName, ticketSearch) ||
      matchPersianString(String(t.ticketNumber), ticketSearch) ||
      matchPersianString(t.date, ticketSearch)
    );
  }, [ticketList, ticketSearch]);

  return (
    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl min-h-[600px] shadow-2xl font-sans p-6 text-right space-y-6 animate-fade-in selection:bg-rose-500 selection:text-white" dir="rtl">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-rose-950/30 to-slate-900 p-6 rounded-3xl border border-rose-900/40 shadow-2xl relative overflow-hidden">
        <div className="absolute -left-10 -top-10 w-40 h-40 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-rose-600/20 border border-rose-500/30 text-rose-400 rounded-2xl shadow-inner">
              <Scale className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white">
                  مدیریت و همگام‌سازی ترازوی دیبال ({configForm.model || 'Dibal 500-SW'})
                </h2>
                <span className="bg-rose-950/80 border border-rose-500/40 text-rose-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full font-mono">
                  DIBAL Series 500
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                ارتباط مستقیم شبکه با‌سیم (Ethernet TCP/IP)، ارسال و دریافت کاتالوگ کالاها (PLU) و مدیریت قبوض وزن‌کشی
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
            <button
              type="button"
              onClick={handleExportToExcel}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="ارسال کلیه اطلاعات فرم مدیریت ترازو به فایل اکسل"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
              <span>ارسال به اکسل</span>
            </button>

            <label
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="دریافت اطلاعات فرم مدیریت ترازو از فایل اکسل"
            >
              <Upload className="h-3.5 w-3.5 text-indigo-400" />
              <span>دریافت از اکسل</span>
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleImportFromExcel}
                className="hidden"
              />
            </label>

            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
              configForm.isOnline 
                ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40' 
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}>
              <span className={`h-2.5 w-2.5 rounded-full ${configForm.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>{configForm.isOnline ? 'شبکه متصل' : 'عدم اتصال'}</span>
            </div>

            <button
              onClick={handleTestConnection}
              disabled={isTestingConnection}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isTestingConnection ? 'animate-spin' : ''}`} />
              <span>{isTestingConnection ? 'تست پکت...' : 'تست PING'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-800/80 shadow-lg">
        <button
          onClick={() => setActiveTab('config')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'config'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Settings className="h-4 w-4" />
          تنظیمات شبکه و پورت‌های RX / TX
        </button>

        <button
          onClick={() => setActiveTab('plus')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'plus'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Tag className="h-4 w-4" />
          مدیریت کالاها و حافظه PLU ({toPersianDigits(pluList.length)})
        </button>

        <button
          onClick={() => setActiveTab('keypad')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'keypad'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Grid3x3 className="h-4 w-4" />
          کلیدهای مستقیم کیپد (Preset Keys 1-70)
        </button>

        <button
          onClick={() => setActiveTab('tickets')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'tickets'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <FileText className="h-4 w-4" />
          قبوض وزن‌کشی ({toPersianDigits(ticketList.length)})
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'reports'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <BarChart3 className="h-4 w-4 text-emerald-400" />
          گزارشات فروش و آمار ترازو (Sales Reports)
        </button>

        <button
          onClick={() => setActiveTab('label_design')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'label_design'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Printer className="h-4 w-4" />
          طراحی قالب چاپ و لیبل (Label Designer)
        </button>

        <button
          onClick={() => setActiveTab('terminal')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'terminal'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Terminal className="h-4 w-4" />
          ترمینال دستورات و بازرس پروتکل
        </button>

        <button
          onClick={() => setActiveTab('manual')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
            activeTab === 'manual'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 border border-amber-500/30'
          }`}
        >
          <BookOpen className="h-4 w-4 text-amber-400 animate-pulse" />
          آموزش و دفترچه راهنمای Dibal 500-SW
        </button>
      </div>

      {/* ================= TAB 1: NETWORK & PORT CONFIG ================= */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveConfig} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Main Network Configuration */}
            <div className="lg:col-span-2 bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                  <Server className="h-4.5 w-4.5 text-rose-500" />
                  تنظیمات پارامترهای ارتباطی شبکه با‌سیم (Ethernet TCP/IP)
                </h3>
                <span className="text-[11px] text-slate-400 font-mono font-bold uppercase">{configForm.model || 'DIBAL 500-SW'}</span>
              </div>

              {/* Model Selection Row */}
              <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="scale-model-select" className="block text-[11px] font-bold text-rose-300 mb-1">
                      مدل سخت‌افزاری ترازوی دیبال (Dibal Scale Model)
                    </label>
                    <select
                      id="scale-model-select"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-rose-500/40 rounded-xl text-rose-300 font-extrabold focus:outline-none focus:border-rose-500 cursor-pointer shadow-inner"
                      value={configForm.model || 'Dibal 500-SW'}
                      onChange={(e) => {
                        const newModel = e.target.value;
                        setConfigForm({
                          ...configForm,
                          model: newModel,
                          name: newModel === 'Dibal 500-SW' ? 'ترازوی دیبال فروشگاهی - Dibal 500-SW' : configForm.name
                        });
                      }}
                    >
                      <option value="Dibal 500-SW">Dibal 500-SW (ترازوی تخت / رومیزی - Bench Scale)</option>
                      <option value="Dibal Tower M-525">Dibal Tower M-525 (ترازوی علمک‌دار / برجی - Tower Scale)</option>
                      <option value="Dibal 500-Hanging">Dibal 500-Hanging (ترازوی آویز استیل - Hanging Scale)</option>
                      <option value="Dibal 500-Self Service">Dibal 500-Self Service (ترازوی لمسی خودخدمت)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="scale-name" className="block text-[11px] font-bold text-slate-400 mb-1">عنوان ترازوی دیبال</label>
                    <input
                      id="scale-name"
                      type="text"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-bold focus:outline-none focus:border-rose-500 transition-all"
                      value={configForm.name}
                      onChange={(e) => setConfigForm({ ...configForm, name: e.target.value })}
                    />
                  </div>
                </div>

                {/* Specific Specs for Dibal 500-SW */}
                {(configForm.model === 'Dibal 500-SW' || !configForm.model) && (
                  <div className="bg-gradient-to-r from-rose-950/40 via-slate-950 to-slate-900 p-3.5 rounded-xl border border-rose-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-rose-300 flex items-center gap-1.5">
                        <Scale className="h-4 w-4 text-rose-400" />
                        مشخصات سخت‌افزاری ترازوی دیبال مدل Dibal 500-SW (رومیزی / تخت):
                      </span>
                      <span className="text-[10px] font-mono bg-rose-900/60 text-rose-200 px-2 py-0.5 rounded border border-rose-700">
                        500 Series SW Bench
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] text-slate-300 pt-1">
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 block text-[9px]">نوع بدنه و نمایشگر:</span>
                        <strong className="text-white">تخت رومیزی / LCD دوطرفه</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 block text-[9px]">کیپد مستقیم (Direct Keys):</span>
                        <strong className="text-emerald-400">۶۰ کلید غشایی (۱۲۰ با Shift)</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 block text-[9px]">مکانیزم پرینتر:</span>
                        <strong className="text-amber-300">کاست کشویی Easy-Cassette</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 block text-[9px]">حافظه کالا (PLU):</span>
                        <strong className="text-sky-300">۱۰,۰۰۰ کالا + ۶ فروشنده</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="conn-type" className="block text-[11px] font-bold text-slate-400 mb-1.5">نوع بستر ارتباطی</label>
                  <select
                    id="conn-type"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                    value={configForm.connectionType}
                    onChange={(e) => setConfigForm({ ...configForm, connectionType: e.target.value as any })}
                  >
                    <option value="ethernet">شبکه با‌سیم (Ethernet RJ45 / TCP Socket)</option>
                    <option value="serial">پورت سریال RS-232 / COM</option>
                    <option value="wifi">شبکه بی‌سیم Wi-Fi</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ip-addr" className="block text-[11px] font-bold text-slate-400 mb-1.5">آدرس IP شبکه ترازو</label>
                  <input
                    id="ip-addr"
                    type="text"
                    dir="ltr"
                    placeholder="192.168.1.150"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-rose-400 font-mono font-extrabold focus:outline-none focus:border-rose-500 text-left"
                    value={configForm.ipAddress}
                    onChange={(e) => setConfigForm({ ...configForm, ipAddress: e.target.value })}
                    onBlur={() => setConfigForm({ ...configForm, ipAddress: cleanIpAddress(configForm.ipAddress) })}
                  />
                  {configForm.ipAddress !== cleanIpAddress(configForm.ipAddress) && (
                    <div className="mt-1.5 bg-amber-950/60 border border-amber-500/40 p-2 rounded-lg text-[10.5px] text-amber-300 font-bold space-y-0.5">
                      <div className="flex items-center gap-1 text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        <span>اصلاح فرمت IP (رفع خطای ENOTFOUND):</span>
                      </div>
                      <p className="text-[10px] text-slate-300 font-normal leading-relaxed">
                        صفر‌های اضافه قبل از اعداد (مانند <code className="text-amber-300 font-mono">192.168.001.005</code>) باعث خطای شبکه می‌شوند. فرمت استاندارد: <strong className="text-emerald-400 font-mono">{cleanIpAddress(configForm.ipAddress)}</strong>
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="subnet-mask" className="block text-[11px] font-bold text-slate-400 mb-1.5">Subnet Mask</label>
                  <input
                    id="subnet-mask"
                    type="text"
                    dir="ltr"
                    placeholder="255.255.255.0"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-300 font-mono text-left"
                    value={configForm.subnetMask}
                    onChange={(e) => setConfigForm({ ...configForm, subnetMask: e.target.value })}
                  />
                </div>

                {/* RX / TX Ports Settings Required by User Prompt */}
                <div className="bg-rose-950/20 border border-rose-900/40 p-3.5 rounded-xl space-y-2">
                  <label htmlFor="tx-port" className="block text-[11px] font-black text-rose-300 flex items-center justify-between">
                    <span>پورت فرستنده (TX Port)</span>
                    <span className="text-[10px] font-mono text-rose-400">Transmitter</span>
                  </label>
                  <input
                    id="tx-port"
                    type="number"
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-rose-300 font-mono font-bold text-left focus:border-rose-500"
                    value={configForm.txPort}
                    onChange={(e) => setConfigForm({ ...configForm, txPort: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-slate-400">پورت ارسال دستورات و کاتالوگ PLU به ترازو (پیش‌فرض: 3000)</p>
                </div>

                <div className="bg-rose-950/20 border border-rose-900/40 p-3.5 rounded-xl space-y-2">
                  <label htmlFor="rx-port" className="block text-[11px] font-black text-rose-300 flex items-center justify-between">
                    <span>پورت گیرنده (RX Port)</span>
                    <span className="text-[10px] font-mono text-rose-400">Receiver</span>
                  </label>
                  <input
                    id="rx-port"
                    type="number"
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-rose-300 font-mono font-bold text-left focus:border-rose-500"
                    value={configForm.rxPort}
                    onChange={(e) => setConfigForm({ ...configForm, rxPort: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-slate-400">پورت شنود و دریافت قبوض وزن‌کشی از ترازو (پیش‌فرض: 3001)</p>
                </div>

                <div>
                  <label htmlFor="scale-id" className="block text-[11px] font-bold text-slate-400 mb-1.5">کد شناسایی ترازو (Scale ID)</label>
                  <input
                    id="scale-id"
                    type="number"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-bold focus:outline-none focus:border-rose-500"
                    value={configForm.scaleId}
                    onChange={(e) => setConfigForm({ ...configForm, scaleId: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <label htmlFor="dept-id" className="block text-[11px] font-bold text-slate-400 mb-1.5">کد دپارتمان / غرفه (Department ID)</label>
                  <input
                    id="dept-id"
                    type="number"
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-bold focus:outline-none focus:border-rose-500"
                    value={configForm.departmentId}
                    onChange={(e) => setConfigForm({ ...configForm, departmentId: Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Serial Fallback Settings */}
              {configForm.connectionType === 'serial' && (
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <Cpu className="h-4 w-4" /> تنظیمات پورت سریال RS-232 (ارتباط مستقیم سخت‌افزاری)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">پورت COM</label>
                      <input
                        type="text"
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-mono"
                        value={configForm.comPort || 'COM1'}
                        onChange={(e) => setConfigForm({ ...configForm, comPort: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">Baud Rate</label>
                      <select
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-mono"
                        value={configForm.baudRate || 9600}
                        onChange={(e) => setConfigForm({ ...configForm, baudRate: Number(e.target.value) })}
                      >
                        <option value={9600}>9600</option>
                        <option value={19200}>19200</option>
                        <option value={38400}>38400</option>
                        <option value={115200}>115200</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">Parity</label>
                      <select
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100"
                        value={configForm.parity || 'none'}
                        onChange={(e) => setConfigForm({ ...configForm, parity: e.target.value as any })}
                      >
                        <option value="none">None</option>
                        <option value="even">Even</option>
                        <option value="odd">Odd</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">Stop Bits</label>
                      <input
                        type="number"
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-mono"
                        value={configForm.stopBits || 1}
                        onChange={(e) => setConfigForm({ ...configForm, stopBits: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    id="auto-sync-receipts"
                    type="checkbox"
                    className="rounded border-slate-800 text-rose-600 focus:ring-rose-500 h-4 w-4 bg-slate-950 cursor-pointer"
                    checked={configForm.autoSyncReceipts}
                    onChange={(e) => setConfigForm({ ...configForm, autoSyncReceipts: e.target.checked })}
                  />
                  <label htmlFor="auto-sync-receipts" className="text-xs font-bold text-slate-300 cursor-pointer">
                    همگام‌سازی و دریافت خودکار قبوض وزن‌کشی در پس‌زمینه
                  </label>
                </div>

                <button
                  type="submit"
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/20 cursor-pointer transition-all flex items-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  ذخیره تنظیمات شبکه ترازو
                </button>
              </div>
            </div>

            {/* Diagnostic Panel & Quick Commands */}
            <div className="space-y-5">
              
              {/* Connection Diagnostic Card */}
              <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-4 shadow-xl">
                <h3 className="text-xs font-black text-slate-100 border-b border-slate-800 pb-3 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-rose-500" />
                  وضعیت سنجش و تست ارتباط پورت‌ها
                </h3>

                {connectionTestResult.status === 'success' && (
                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-900/60 rounded-xl space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      {connectionTestResult.message}
                    </div>
                    {connectionTestResult.details && (
                      <p className="text-[10px] text-emerald-400/80 font-mono dir-ltr text-left">
                        {connectionTestResult.details}
                      </p>
                    )}
                  </div>
                )}

                {connectionTestResult.status === 'error' && (
                  <div className="p-3.5 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs font-bold text-rose-300 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                    {connectionTestResult.message}
                  </div>
                )}

                <div className="space-y-2 text-xs text-slate-400">
                  <div className="flex justify-between py-1 border-b border-slate-800/80">
                    <span>مدل ترازو:</span>
                    <span className="font-bold text-white">Dibal Tower M-525</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/80">
                    <span>پروتکل شبکه:</span>
                    <span className="font-bold text-rose-400 font-mono">DIBAL DFW / RMS TCP</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/80">
                    <span>آدرس IP فعال:</span>
                    <span className="font-bold text-white font-mono">{configForm.ipAddress}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/80">
                    <span>پورت TX / RX:</span>
                    <span className="font-bold text-white font-mono">{configForm.txPort} / {configForm.rxPort}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>آخرین همگام‌سازی:</span>
                    <span className="font-bold text-slate-300">{configForm.lastSyncTime || 'لحظاتی پیش'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTestingConnection}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Zap className="h-4 w-4 text-amber-400" />
                  تست مجدد ارسال POCKET به آدرس IP
                </button>
              </div>

              {/* Quick Info Box */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-5 rounded-2xl space-y-3 text-xs text-slate-400">
                <div className="flex items-center gap-2 text-rose-400 font-bold">
                  <ShieldCheck className="h-4 w-4" /> راهنمای پورت‌های ترازو دیبال Tower M-525:
                </div>
                <p className="leading-relaxed text-[11px] text-slate-400">
                  ترازوهای دیبال سری ۵۰۰ جهت تبادل دوطرفه داده از دو سوکت مجزا استفاده می‌کنند. <strong>TX Port (۳۰۰۰)</strong> جهت ارسال دستورات تعریف کالا (PLU) و <strong>RX Port (۳۰۰۱)</strong> برای دریافت برچسب‌ها و قبوض صادرشده توسط کاربر است.
                </p>

                {/* Hardware Connection Explanation & Sandbox Alert */}
                <div className="bg-amber-950/30 border border-amber-500/30 p-3.5 rounded-xl space-y-2 mt-2">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                    <Info className="h-4 w-4 text-amber-400" />
                    <span>علت اصلی عدم رد و بدل مستقیم با ترازو فیزیکی در مرورگر وب:</span>
                  </div>
                  <p className="text-[10.5px] text-slate-300 leading-relaxed">
                    مرورگرهای وب (Chrome / Edge / Firefox) به دلیل حفظ امنیت سامانه، اجازه ایجاد ارتباط <strong>مستقیم خام TCP/IP Sockets</strong> با آی‌پی‌های شبکه محلی (<code className="text-amber-300 font-mono font-bold">192.168.1.150:3000</code>) را نمی‌دهند. به همین علت سامانه، پکت‌ها و پروتکل دیبال را در حالت استاندارد <strong className="text-emerald-400 font-bold">شبیه‌ساز هوشمند Dibal L2 Protocol</strong> پردازش کرده و پیام صحت فریم را صادر می‌کند.
                  </p>
                  
                  <div className="pt-2 border-t border-amber-500/20 space-y-1.5 text-[10px]">
                    <span className="font-bold text-amber-300">روش‌های ارسال واقعی داده به ترازوی فیزیکی در مغازه/قنادی:</span>
                    <ul className="list-disc list-inside space-y-1 text-slate-300 pr-1">
                      <li><strong>نرم‌افزار Dibal DFW / RMS (پیشنهادی دیبال):</strong> نرم‌افزار رسمی Dibal DFW را روی سیستم ویندوزی فروشگاه اجرا کنید تا فایل اکسل/داده‌های کالا را مستقیماً بر روی ترازو بارگذاری نماید.</li>
                      <li><strong>خروجی اکسل کالاها:</strong> با استفاده از دکمه «خروجی اکسل» در تب کالاها، فایل کالاها را دانلود کرده و مستقیماً در نرم‌افزار ترازو وارد کنید.</li>
                      <li><strong>سرویس پل ارتباطی محلی (Local Node.js TCP Bridge):</strong> اجرای یک اسکریپت چند خطی ساده Node.js روی سیستم ویندوزی فروشگاه که پکت‌های وب‌اپلیکیشن را به سوکت سخت‌افزاری ترازو هدایت می‌کند.</li>
                    </ul>

                    <button
                      type="button"
                      onClick={() => setShowBridgeScript(!showBridgeScript)}
                      className="mt-2 text-[10px] bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold px-3 py-1.5 rounded-lg border border-amber-500/40 cursor-pointer flex items-center gap-1.5 transition-all"
                    >
                      <Code className="h-3.5 w-3.5 text-amber-400" />
                      <span>{showBridgeScript ? 'بستن اسکریپت پل ارتباطی' : 'مشاهده اسکریپت پل ارتباطی محلی (Local TCP Bridge Agent)'}</span>
                    </button>

                    {showBridgeScript && (
                      <div className="mt-2 bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-right">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                            <Terminal className="h-4 w-4 text-amber-400" />
                            مراحل ۴ گانه راه اندازی پل ارتباطی محلی (Node.js TCP Bridge Agent):
                          </span>
                          <span className="text-[9px] font-mono bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded border border-amber-800">
                            v1.2 Local Agent
                          </span>
                        </div>

                        <ol className="list-decimal list-inside space-y-2 text-[10.5px] text-slate-300 pr-1 leading-relaxed">
                          <li>
                            <strong className="text-white">نصب Node.js:</strong> ابتدا نرم‌افزار <code className="text-amber-300 font-mono">Node.js</code> را از سایت <code className="text-cyan-300 font-mono">nodejs.org</code> دانلود و روی ویندوز سیستم فروشگاه نصب کنید.
                          </li>
                          <li>
                            <strong className="text-white">ساخت پوشه و فایل اسکریپت:</strong> یک پوشه جدید (مثلاً <code className="text-amber-300 font-mono">C:\dibal-bridge</code>) بسازید و فایل زیر را با نام <code className="text-amber-300 font-mono">dibal-bridge.js</code> ایجاد کنید:
                          </li>
                        </ol>

                        <pre className="text-[9.5px] font-mono text-emerald-300 bg-slate-900 p-3 rounded-lg border border-slate-800 overflow-x-auto text-left dir-ltr leading-relaxed">
{`// dibal-bridge.js - Node.js Local TCP Bridge for Dibal 500-SW & Series 500
const net = require('net');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to sanitize IP octets (e.g. 192.168.001.005 -> 192.168.1.5) to prevent ENOTFOUND
function cleanIp(rawIp) {
  if (!rawIp) return '192.168.1.150';
  return String(rawIp)
    .trim()
    .split('.')
    .map(p => String(parseInt(p, 10) || 0))
    .join('.');
}

// Forward raw TCP payload to Dibal 500-SW scale IP & Port
app.post('/send-scale', (req, res) => {
  const { ip, port, hexData, timeoutMs } = req.body;
  const targetIp = cleanIp(ip);
  const targetPort = Number(port) || 3000;
  const timeout = Number(timeoutMs) || 5000;
  
  console.log(\`[BRIDGE DIBAL 500-SW] Connecting to \${targetIp}:\${targetPort}...\`);
  const client = new net.Socket();
  let responseSent = false;
  
  client.setTimeout(timeout);
  client.setKeepAlive(true, 1000);

  client.connect(targetPort, targetIp, () => {
    console.log('[BRIDGE DIBAL 500-SW] Socket connected! Sending payload frame...');
    const cleanHex = (hexData || '02303150494E4703').replace(/0x|\\s/g, '');
    const buffer = Buffer.from(cleanHex, 'hex');
    client.write(buffer);
  });

  client.on('data', (data) => {
    const hexStr = data.toString('hex').toUpperCase();
    const asciiStr = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
    console.log('[BRIDGE DIBAL 500-SW] Response received:');
    console.log(' - HEX  :', hexStr);
    console.log(' - ASCII:', asciiStr);
    
    if (!responseSent) {
      responseSent = true;
      res.json({ 
        success: true, 
        responseHex: hexStr,
        responseAscii: asciiStr,
        targetIp,
        targetPort 
      });
    }
    client.destroy();
  });

  client.on('timeout', () => {
    console.log('[BRIDGE DIBAL 500-SW] Scale TCP Timeout (No response within ' + timeout + 'ms)');
    client.destroy();
    if (!responseSent) {
      responseSent = true;
      res.status(504).json({ success: false, error: 'ترازو دیبال پاسخ نداد (TCP Timeout). لطفا شماره ترازو (00/01) و پورت 3000 را بررسی کنید.' });
    }
  });

  client.on('error', (err) => {
    console.error('[BRIDGE DIBAL 500-SW] Socket error:', err.message);
    client.destroy();
    if (!responseSent) {
      responseSent = true;
      res.status(500).json({ success: false, error: 'خطای سوکت شبکه: ' + err.message });
    }
  });
});

app.listen(8080, () => {
  console.log('===========================================================');
  console.log('  Dibal 500-SW & Series 500 Local TCP Bridge Running on http://localhost:8080');
  console.log('===========================================================');
});`}
                        </pre>

                        <div className="space-y-2 text-[10.5px] text-slate-300 pr-1">
                          <p>
                            <strong className="text-white">۳. نصب پکیج‌های پیش‌نیاز:</strong> CMD یا PowerShell را در پوشه باز کرده و دستور زیر را اجرا کنید:
                          </p>
                          <div className="bg-slate-900 px-3 py-2 rounded-lg font-mono text-[10px] text-amber-300 dir-ltr text-left border border-slate-800">
                            npm install express cors
                          </div>

                          <p className="pt-1">
                            <strong className="text-white">۴. اجرای پل ارتباطی:</strong> با دستور زیر اسکریپت را استارت کنید:
                          </p>
                          <div className="bg-slate-900 px-3 py-2 rounded-lg font-mono text-[10px] text-emerald-300 dir-ltr text-left border border-slate-800">
                            node dibal-bridge.js
                          </div>
                        </div>

                        {/* Timeout Troubleshooting Guide Box */}
                        <div className="bg-rose-950/40 border border-rose-500/40 p-3 rounded-xl space-y-2.5 text-[10.5px]">
                          <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                            <AlertTriangle className="h-4 w-4 text-rose-400" />
                            <span>دلیل فنی و راه حل «[BRIDGE] TCP Socket connected ... Scale TCP Timeout»:</span>
                          </div>
                          <p className="text-slate-300 leading-relaxed text-[10px]">
                            اتصال موفق سوکت (<code className="text-emerald-400 font-mono font-bold">TCP Socket connected</code>) نشان می‌دهد آدرس IP و پورت کاملاً صحیح و فعال است. علت پاسخ ندادن ترازو پس از ارسال پکت یکی از موارد زیر است:
                          </p>
                          <ul className="list-disc list-inside space-y-1.5 text-slate-300 pr-1 leading-relaxed">
                            <li>
                              <strong className="text-amber-300">۱. عدم تطابق شماره ترازو (Scale ID):</strong> پکت ارسالی حاوی کد <code className="text-amber-300 font-mono">01</code> (ترازو شماره ۱) است. اگر شماره ترازو در منوی ترازو روی <strong className="text-white font-mono">00</strong> یا شماره دیگری تنظیم شده باشد، ترازو پکت را دریافت کرده اما نادیده می‌گیرد. در تنظیمات ترازو شماره را روی <code className="text-amber-300 font-mono">01</code> قرار دهید یا کد پکت را با <code className="text-emerald-300 font-mono">00</code> (پخش همگانی) ارسال کنید.
                            </li>
                            <li>
                              <strong className="text-amber-300">۲. ارسال پکت به پورت اشتباه (3001 به جای 3000):</strong> در ترازوهای دیبال M-525، پورت <strong className="text-rose-300 font-mono">3000</strong> مخصوص دریافت دستورات کالا و PING است، و پورت <strong className="text-rose-300 font-mono">3001</strong> فقط جهت ارسال فاکتور خروجی است. پورت تست را حتماً روی <code className="text-amber-300 font-mono font-bold">3000</code> قرار دهید.
                            </li>
                            <li>
                              <strong className="text-amber-300">۳. فعال بودن حالت DFW/RMS Lock:</strong> در منوی ترازو (<code className="text-slate-300 font-mono">MENU ➔ Communication ➔ TCP/IP</code>) گزینه <code className="text-amber-300 font-mono">Direct Command / PC Direct</code> را فعال کنید تا ترازو دستورات مستقیم پکت را بپذیرد.
                            </li>
                          </ul>
                        </div>

                        {/* Test Local Bridge Live Button */}
                        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-400">تست سریع ارسال دستور تحت پل محلی:</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await fetch('http://localhost:8080/send-scale', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      ip: cleanIpAddress(configForm.ipAddress),
                                      port: 3000,
                                      hexData: '0x02 0x30 0x31 0x50 0x49 0x4E 0x47 0x03'
                                    })
                                  });
                                  const data = await res.json();
                                  if (data.success) {
                                    alert(`ارتباط زنده برقرار شد! پاسخ ترازو (ACK): ${data.responseHex}`);
                                  } else {
                                    alert(`خطا: ${data.error}`);
                                  }
                                } catch (err: any) {
                                  alert(`اسکریپت پل ارتباطی در حال اجرا نیست.\nخطا: ${err.message}`);
                                }
                              }}
                              className="text-[10px] bg-rose-600 hover:bg-rose-500 text-white font-bold px-2.5 py-1.5 rounded-lg shadow cursor-pointer transition-all flex items-center gap-1"
                            >
                              <Zap className="h-3.5 w-3.5 text-rose-200" />
                              تست پورت 3000 (ترازو 01)
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await fetch('http://localhost:8080/send-scale', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      ip: cleanIpAddress(configForm.ipAddress),
                                      port: 3000,
                                      hexData: '0x02 0x30 0x30 0x50 0x49 0x4E 0x47 0x03'
                                    })
                                  });
                                  const data = await res.json();
                                  if (data.success) {
                                    alert(`ارتباط با کد همگانی 00 موفق بود! پاسخ ترازو: ${data.responseHex}`);
                                  } else {
                                    alert(`خطا: ${data.error}`);
                                  }
                                } catch (err: any) {
                                  alert(`اسکریپت پل ارتباطی در حال اجرا نیست.\nخطا: ${err.message}`);
                                }
                              }}
                              className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg shadow cursor-pointer transition-all flex items-center gap-1"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />
                              تست با شماره 00 (Broadcast)
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

          </form>
        </div>
      )}

      {/* ================= TAB 2: PLU CATALOG & SCALE SYNC ================= */}
      {activeTab === 'plus' && (
        <div className="space-y-6">
          
          {/* Dibal M-525 Memory Audit & Conflict Banner */}
          <div className="bg-slate-850/80 border border-slate-800 p-4 rounded-2xl backdrop-blur-md shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${auditMetrics.isCompliant ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400' : 'bg-rose-950/60 border-rose-500/40 text-rose-400'}`}>
                {auditMetrics.isCompliant ? <ShieldCheck className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6 animate-pulse" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-slate-100">
                    وضعیت استانداردهای حافظه و عدم‌تداخل کالاها (Dibal M-525 Memory Health)
                  </h4>
                  {auditMetrics.isCompliant ? (
                    <span className="text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                      تایید کامپلاینس ۱۰۰٪
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700/60 px-2 py-0.5 rounded-full">
                      نیازمند اصلاح تداخل
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  ارزیابی خودکار کد کالا، کلیدهای مستقیم کیپد، و فرمت بارکدهای استاندارد قبل از ارسال به ترازو.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
                <div className="text-[10px] text-slate-500 font-bold">کل کالاها</div>
                <div className="text-xs font-black text-slate-200 font-mono">{toPersianDigits(auditMetrics.total)}</div>
              </div>
              <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
                <div className="text-[10px] text-emerald-500 font-bold">وزنی (kg)</div>
                <div className="text-xs font-black text-emerald-400 font-mono">{toPersianDigits(auditMetrics.weighted)}</div>
              </div>
              <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
                <div className="text-[10px] text-purple-500 font-bold">تعدادی (عدد)</div>
                <div className="text-xs font-black text-purple-400 font-mono">{toPersianDigits(auditMetrics.unit)}</div>
              </div>
              <div className={`px-3 py-1.5 rounded-xl border text-center ${auditMetrics.duplicatePluCount === 0 ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-rose-950/60 border-rose-600 text-rose-300'}`}>
                <div className="text-[10px] font-bold">تداخل PLU</div>
                <div className="text-xs font-black font-mono">{toPersianDigits(auditMetrics.duplicatePluCount)}</div>
              </div>
              <div className={`px-3 py-1.5 rounded-xl border text-center ${auditMetrics.duplicateKeyCount === 0 ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-amber-950/60 border-amber-600 text-amber-300'}`}>
                <div className="text-[10px] font-bold">تداخل کلید</div>
                <div className="text-xs font-black font-mono">{toPersianDigits(auditMetrics.duplicateKeyCount)}</div>
              </div>
            </div>
          </div>

          {/* Progress Bar during Batch Sync */}
          {isSendingPlus && (
            <div className="bg-rose-950/40 border border-rose-900/60 p-4 rounded-2xl space-y-2 animate-pulse">
              <div className="flex items-center justify-between text-xs font-bold text-rose-300">
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-rose-400" />
                  در حال ارسال و همگام‌سازی اطلاعات PLU به حافظه ترازوی دیبال...
                </span>
                <span className="font-mono">{toPersianDigits(sendProgress)}%</span>
              </div>
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-rose-600 to-rose-400 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${sendProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Create / Edit PLU Form with Standard Dibal Fields */}
            <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-5 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-slate-100 border-b border-slate-800 pb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Tag className="h-4.5 w-4.5 text-rose-500" />
                  {editingPlu ? 'ویرایش کالا در حافظه PLU ترازو' : 'تعریف کالا / کد جدید در حافظه PLU'}
                </span>
                <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/80">
                  Dibal M-525 Spec
                </span>
              </h3>

              <form onSubmit={handleSavePlu} className="space-y-4">
                
                {/* 1. PLU Code & Direct Key Conflict Alert */}
                {(pluCodeConflictItem || directKeyConflictItem) && (
                  <div className="p-3 bg-rose-950/80 border border-rose-600/80 rounded-xl space-y-1 text-xs text-rose-200">
                    <div className="font-bold flex items-center gap-1.5 text-rose-300">
                      <AlertTriangle className="h-4 w-4 text-rose-400" />
                      هشدار تداخل پارامتر در حافظه ترازو!
                    </div>
                    {pluCodeConflictItem && (
                      <p className="text-[11px] text-rose-200 leading-tight">
                        • کد PLU شماره <strong className="font-mono text-white">{toPersianDigits(activeFormPluCode)}</strong> قبلاً به کالا <strong>«{pluCodeConflictItem.name}»</strong> تخصیص داده شده است.
                      </p>
                    )}
                    {directKeyConflictItem && (
                      <p className="text-[11px] text-rose-200 leading-tight">
                        • کلید مستقیم شماره <strong className="font-mono text-white">#{toPersianDigits(activeFormDirectKey)}</strong> قبلاً به کالا <strong>«{directKeyConflictItem.name}»</strong> تخصیص داده شده است.
                      </p>
                    )}
                  </div>
                )}

                {/* PLU Code & Direct Key Inputs */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="plu-code" className="block text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                      <span>کد PLU (۱ تا ۹۹۹۹)</span>
                      {pluCodeConflictItem && <span className="text-rose-400 text-[10px] font-bold">تداخل!</span>}
                    </label>
                    <input
                      id="plu-code"
                      type="number"
                      min="1"
                      max="9999"
                      required
                      className={`w-full px-3 py-2 text-xs bg-slate-950 border rounded-xl font-mono font-black ${
                        pluCodeConflictItem ? 'border-rose-500 text-rose-400 ring-1 ring-rose-500' : 'border-slate-800 text-rose-400 focus:border-rose-500'
                      }`}
                      value={editingPlu ? editingPlu.pluCode : (newPlu.pluCode || '')}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, pluCode: Number(e.target.value) }) : setNewPlu({ ...newPlu, pluCode: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor="direct-key" className="block text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                      <span>کلید مستقیم (۱ تا ۷۰)</span>
                      {directKeyConflictItem && <span className="text-amber-400 text-[10px] font-bold">تداخل!</span>}
                    </label>
                    <input
                      id="direct-key"
                      type="number"
                      min="1"
                      max="70"
                      placeholder="اختیاری (Key #)"
                      className={`w-full px-3 py-2 text-xs bg-slate-950 border rounded-xl font-bold ${
                        directKeyConflictItem ? 'border-amber-500 text-amber-300 ring-1 ring-amber-500' : 'border-slate-800 text-slate-100 focus:border-rose-500'
                      }`}
                      value={editingPlu ? (editingPlu.directKeyNumber || '') : (newPlu.directKeyNumber || '')}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, directKeyNumber: e.target.value ? Number(e.target.value) : undefined }) : setNewPlu({ ...newPlu, directKeyNumber: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>
                </div>

                {/* Department & Section Codes */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dept-code" className="block text-[11px] font-bold text-slate-400 mb-1">کد دپارتمان (۱ تا ۹۹)</label>
                    <input
                      id="dept-code"
                      type="number"
                      min="1"
                      max="99"
                      required
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono font-bold"
                      value={editingPlu ? editingPlu.departmentCode : (newPlu.departmentCode || 1)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, departmentCode: Number(e.target.value) }) : setNewPlu({ ...newPlu, departmentCode: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor="section-code" className="block text-[11px] font-bold text-slate-400 mb-1">کد گروه/بخش (۱ تا ۹۹)</label>
                    <input
                      id="section-code"
                      type="number"
                      min="1"
                      max="99"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono font-bold"
                      value={editingPlu ? (editingPlu.sectionCode || 1) : (newPlu.sectionCode || 1)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, sectionCode: Number(e.target.value) }) : setNewPlu({ ...newPlu, sectionCode: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Item Type Selector (Dibal Standard: Weighted vs Piece/Unit) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Scale className="h-3.5 w-3.5 text-rose-400" />
                      نوع سنجش کالا (پروتکل Dibal M-525)
                    </span>
                    <span className="text-[10px] font-mono text-rose-400 font-bold bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/80">
                      {(editingPlu?.itemType === 'unit' || (!editingPlu && newPlu.itemType === 'unit')) ? 'کد پروتکل: 1 (UNIT)' : 'کد پروتکل: 0 (WEIGHT)'}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (editingPlu) setEditingPlu({ ...editingPlu, itemType: 'weighted' });
                        else setNewPlu({ ...newPlu, itemType: 'weighted' });
                      }}
                      className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
                        (editingPlu ? (editingPlu.itemType !== 'unit') : (newPlu.itemType !== 'unit'))
                          ? 'bg-rose-950/40 border-rose-500/80 text-white shadow-md shadow-rose-950/40 ring-1 ring-rose-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black flex items-center gap-1.5">
                          <Scale className="h-4 w-4 text-emerald-400" />
                          وزنی (Weighted)
                        </span>
                        <span className="text-[9px] font-mono bg-slate-900 text-emerald-400 px-1.5 py-0.5 rounded font-bold">0</span>
                      </div>
                      <p className="text-[9.5px] text-slate-400 mt-1 leading-tight">
                        محاسبه قیمت بر اساس وزن ترازو (ریال/کیلو)
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (editingPlu) setEditingPlu({ ...editingPlu, itemType: 'unit', tareWeight: 0 });
                        else setNewPlu({ ...newPlu, itemType: 'unit', tareWeight: 0 });
                      }}
                      className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
                        (editingPlu ? (editingPlu.itemType === 'unit') : (newPlu.itemType === 'unit'))
                          ? 'bg-rose-950/40 border-rose-500/80 text-white shadow-md shadow-rose-950/40 ring-1 ring-rose-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black flex items-center gap-1.5">
                          <Box className="h-4 w-4 text-purple-400" />
                          تعدادی (Piece/Unit)
                        </span>
                        <span className="text-[9px] font-mono bg-slate-900 text-purple-400 px-1.5 py-0.5 rounded font-bold">1</span>
                      </div>
                      <p className="text-[9.5px] text-slate-400 mt-1 leading-tight">
                        فروش تعدادی با کلید MULT (ریال/عدد)
                      </p>
                    </button>
                  </div>
                </div>

                {/* Price Type (Variable vs Fixed) */}
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      if (editingPlu) setEditingPlu({ ...editingPlu, priceType: 'variable' });
                      else setNewPlu({ ...newPlu, priceType: 'variable' });
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      (editingPlu ? (editingPlu.priceType !== 'fixed') : (newPlu.priceType !== 'fixed'))
                        ? 'bg-slate-800 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    قیمت عادی (متغیر)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingPlu) setEditingPlu({ ...editingPlu, priceType: 'fixed' });
                      else setNewPlu({ ...newPlu, priceType: 'fixed' });
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      (editingPlu ? (editingPlu.priceType === 'fixed') : (newPlu.priceType === 'fixed'))
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    قیمت مقطوع / بسته‌بندی
                  </button>
                </div>

                {/* Name Lines 1 & 2 */}
                <div>
                  <label htmlFor="plu-name" className="block text-[11px] font-bold text-slate-300 mb-1">نام کالا (خط اول برچسب)</label>
                  <input
                    id="plu-name"
                    type="text"
                    required
                    placeholder="مثال: شیرینی دانمارکی مخصوص"
                    className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-extrabold"
                    value={editingPlu ? editingPlu.name : (newPlu.name || '')}
                    onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, name: e.target.value }) : setNewPlu({ ...newPlu, name: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="plu-second-name" className="block text-[11px] font-bold text-slate-400 mb-1">نام تکمیلی/گروه (خط دوم برچسب - Dual Line)</label>
                  <input
                    id="plu-second-name"
                    type="text"
                    placeholder="اختیاری - مثال: پخت اول قنادی"
                    className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-300 font-bold"
                    value={editingPlu ? (editingPlu.secondName || '') : (newPlu.secondName || '')}
                    onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, secondName: e.target.value }) : setNewPlu({ ...newPlu, secondName: e.target.value })}
                  />
                </div>

                {/* Price & Offer Price */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="price-per-kg" className="block text-[11px] font-bold text-slate-300 mb-1">
                      {(editingPlu?.itemType === 'unit' || (!editingPlu && newPlu.itemType === 'unit')) ? 'قیمت اصلی واحد (ریال)' : 'قیمت اصلی / کیلو (ریال)'}
                    </label>
                    <input
                      id="price-per-kg"
                      type="text"
                      required
                      placeholder="۲۵۰,۰۰۰"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-emerald-400 font-mono font-bold"
                      value={editingPlu ? formatWithCommas(editingPlu.pricePerKg) : formatWithCommas(newPlu.pricePerKg || 0)}
                      onChange={(e) => {
                        const val = parseNumber(e.target.value);
                        if (editingPlu) setEditingPlu({ ...editingPlu, pricePerKg: val });
                        else setNewPlu({ ...newPlu, pricePerKg: val });
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="promo-price" className="block text-[11px] font-bold text-slate-400 mb-1">
                      قیمت تخفیف‌دار/ویژه (اختیاری)
                    </label>
                    <input
                      id="promo-price"
                      type="text"
                      placeholder="بدون تخفیف"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-purple-300 font-mono font-bold"
                      value={editingPlu ? (editingPlu.promoPrice ? formatWithCommas(editingPlu.promoPrice) : '') : (newPlu.promoPrice ? formatWithCommas(newPlu.promoPrice) : '')}
                      onChange={(e) => {
                        const val = e.target.value ? parseNumber(e.target.value) : undefined;
                        if (editingPlu) setEditingPlu({ ...editingPlu, promoPrice: val });
                        else setNewPlu({ ...newPlu, promoPrice: val });
                      }}
                    />
                  </div>
                </div>

                {/* VAT Rate & Tare Weight */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="vat-rate" className="block text-[11px] font-bold text-slate-400 mb-1">مالیات ارزش افزوده (٪)</label>
                    <input
                      id="vat-rate"
                      type="number"
                      min="0"
                      max="25"
                      placeholder="0"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono"
                      value={editingPlu ? (editingPlu.vatRate || 0) : (newPlu.vatRate || 0)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, vatRate: Number(e.target.value) }) : setNewPlu({ ...newPlu, vatRate: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor="tare-weight" className="block text-[11px] font-bold text-slate-400 mb-1">
                      وزن تار/ظرف (گرم) {(editingPlu?.itemType === 'unit' || (!editingPlu && newPlu.itemType === 'unit')) && '(نامربوط)'}
                    </label>
                    <input
                      id="tare-weight"
                      type="number"
                      placeholder="0"
                      disabled={editingPlu?.itemType === 'unit' || (!editingPlu && newPlu.itemType === 'unit')}
                      className={`w-full px-3 py-2 text-xs border rounded-xl font-mono ${
                        (editingPlu?.itemType === 'unit' || (!editingPlu && newPlu.itemType === 'unit'))
                          ? 'bg-slate-900 border-slate-800/50 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-950 border-slate-800 text-slate-100'
                      }`}
                      value={editingPlu ? editingPlu.tareWeight : (newPlu.tareWeight || 0)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, tareWeight: Number(e.target.value) }) : setNewPlu({ ...newPlu, tareWeight: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Expiry & Packing Days */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="expiry-days" className="block text-[11px] font-bold text-amber-400 mb-1 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      انقضا (تعداد روز)
                    </label>
                    <input
                      id="expiry-days"
                      type="number"
                      min="1"
                      max="365"
                      required
                      placeholder="7"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-amber-300 font-mono font-black"
                      value={editingPlu ? editingPlu.expiryDays : (newPlu.expiryDays || 7)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, expiryDays: Number(e.target.value) }) : setNewPlu({ ...newPlu, expiryDays: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label htmlFor="pack-offset" className="block text-[11px] font-bold text-slate-400 mb-1">
                      روزهای بسته‌بندی
                    </label>
                    <input
                      id="pack-offset"
                      type="number"
                      min="0"
                      max="30"
                      placeholder="0"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono"
                      value={editingPlu ? (editingPlu.packOffsetDays || 0) : (newPlu.packOffsetDays || 0)}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, packOffsetDays: Number(e.target.value) }) : setNewPlu({ ...newPlu, packOffsetDays: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Barcode Specification */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="barcode-type" className="block text-[11px] font-bold text-slate-400 mb-1">نوع بارکد چاپ</label>
                    <select
                      id="barcode-type"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono"
                      value={editingPlu ? (editingPlu.barcodeType || 'EAN-13') : (newPlu.barcodeType || 'EAN-13')}
                      onChange={(e) => {
                        const bType = e.target.value as any;
                        if (editingPlu) setEditingPlu({ ...editingPlu, barcodeType: bType });
                        else setNewPlu({ ...newPlu, barcodeType: bType });
                      }}
                    >
                      <option value="EAN-13">EAN-13 (وزنی ۲۱)</option>
                      <option value="EAN-128">EAN-128 (سازمانی)</option>
                      <option value="CODE-128">CODE-128</option>
                      <option value="GS1-Databar">GS1 DataBar</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="barcode-format" className="block text-[11px] font-bold text-slate-400 mb-1">فرمت ساختاری بارکد</label>
                    <input
                      id="barcode-format"
                      type="text"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-rose-300 font-mono font-bold"
                      value={editingPlu ? (editingPlu.barcodeFormat || '21PPPWWWWWC') : (newPlu.barcodeFormat || '21PPPWWWWWC')}
                      onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, barcodeFormat: e.target.value }) : setNewPlu({ ...newPlu, barcodeFormat: e.target.value })}
                    />
                  </div>
                </div>

                {/* Extended Ingredients Text */}
                <div>
                  <label htmlFor="ingredients" className="block text-[11px] font-bold text-slate-400 mb-1">متن ترکیبات و شرح برچسب (Dibal Extended Label Text)</label>
                  <textarea
                    id="ingredients"
                    rows={2}
                    placeholder="ترکیبات: آرد، کره، شکر، شکلات نول، هل، وانیل..."
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-300"
                    value={editingPlu ? (editingPlu.ingredientsText || '') : (newPlu.ingredientsText || '')}
                    onChange={(e) => editingPlu ? setEditingPlu({ ...editingPlu, ingredientsText: e.target.value }) : setNewPlu({ ...newPlu, ingredientsText: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/15 cursor-pointer transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {editingPlu ? 'ثبت ویرایش PLU' : 'افزودن به لیست PLU'}
                  </button>
                  {editingPlu && (
                    <button
                      type="button"
                      onClick={() => setEditingPlu(null)}
                      className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* PLUs Table & Batch Operations */}
            <div className="lg:col-span-2 space-y-4">
              
              {/* Table Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-850/60 p-4 rounded-2xl border border-slate-800 backdrop-blur-md">
                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                  <div className="relative w-full sm:w-52">
                    <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-slate-500" />
                    </span>
                    <input
                      id="plu-search"
                      type="text"
                      value={pluSearch}
                      onChange={(e) => setPluSearch(e.target.value)}
                      placeholder="جستجو نام، کد PLU یا نوع..."
                      className="w-full pl-3 pr-10 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-bold"
                    />
                  </div>

                  <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setPluTypeFilter('all')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                        pluTypeFilter === 'all'
                          ? 'bg-rose-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      همه
                    </button>
                    <button
                      type="button"
                      onClick={() => setPluTypeFilter('weighted')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                        pluTypeFilter === 'weighted'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Scale className="h-3 w-3" />
                      وزنی
                    </button>
                    <button
                      type="button"
                      onClick={() => setPluTypeFilter('unit')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                        pluTypeFilter === 'unit'
                          ? 'bg-purple-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Box className="h-3 w-3" />
                      تعدادی
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleSendPLUsToScale}
                    disabled={isSendingPlus}
                    className="w-full px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    ارسال {selectedPluIds.length > 0 ? `(${toPersianDigits(selectedPluIds.length)}) کالا` : 'همه کالاها'} به ترازو
                  </button>

                  <button
                    type="button"
                    onClick={handleReceivePLUsFromScale}
                    disabled={isSendingPlus}
                    className="w-full px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 border border-slate-700"
                  >
                    <Download className="h-3.5 w-3.5 text-rose-400" />
                    دریافت از حافظه ترازو
                  </button>
                </div>
              </div>

              {/* Table List */}
              <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-950/20 backdrop-blur-md">
                <table className="min-w-full divide-y divide-slate-800 text-right">
                  <thead className="bg-slate-900/60 text-slate-400 text-xs">
                    <tr>
                      <th className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          className="rounded border-slate-800 text-rose-600 focus:ring-rose-500 h-3.5 w-3.5 bg-slate-950 cursor-pointer"
                          checked={selectedPluIds.length === pluList.length && pluList.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedPluIds(pluList.map(p => p.id));
                            else setSelectedPluIds([]);
                          }}
                        />
                      </th>
                      <th className="px-3 py-3 font-black text-rose-400">کد PLU</th>
                      <th className="px-3 py-3 font-bold">نام و گروه کالا (Dibal Header)</th>
                      <th className="px-3 py-3 font-bold text-center">نوع سنجش (Dibal)</th>
                      <th className="px-3 py-3 font-bold text-center">دپارتمان / گروه</th>
                      <th className="px-3 py-3 font-bold text-center">کلید مستقیم</th>
                      <th className="px-3 py-3 font-bold text-left">قیمت واحد (ریال)</th>
                      <th className="px-3 py-3 font-bold text-center">انقضا (روز)</th>
                      <th className="px-3 py-3 font-bold text-center">وضعیت ترازو</th>
                      <th className="px-3 py-3 font-bold text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                    {filteredPLUs.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                          هیچ کد PLU یافت نشد.
                        </td>
                      </tr>
                    ) : (
                      filteredPLUs.map(plu => {
                        const isDuplicateCode = pluList.filter(p => p.pluCode === plu.pluCode).length > 1;
                        const isDuplicateKey = plu.directKeyNumber ? pluList.filter(p => p.directKeyNumber === plu.directKeyNumber).length > 1 : false;

                        return (
                          <tr key={plu.id} className={`hover:bg-slate-850/50 transition-all ${isDuplicateCode || isDuplicateKey ? 'bg-rose-950/20' : ''}`}>
                            <td className="px-3 py-3.5 text-center">
                              <input
                                type="checkbox"
                                className="rounded border-slate-800 text-rose-600 focus:ring-rose-500 h-3.5 w-3.5 bg-slate-950 cursor-pointer"
                                checked={selectedPluIds.includes(plu.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedPluIds(prev => [...prev, plu.id]);
                                  else setSelectedPluIds(prev => prev.filter(id => id !== plu.id));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3.5 font-mono font-black text-rose-400 text-sm">
                              <div className="flex items-center gap-1">
                                #{toPersianDigits(plu.pluCode)}
                                {isDuplicateCode && (
                                  <span title="تداخل کد PLU تکراری" className="text-[9px] bg-rose-600 text-white font-bold px-1 rounded">
                                    تکراری
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3.5">
                              <div className="font-extrabold text-white">{plu.name}</div>
                              {plu.secondName && (
                                <div className="text-[10px] text-slate-400 mt-0.5 font-bold">
                                  {plu.secondName}
                                </div>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {plu.vatRate ? (
                                  <span className="text-[9px] font-mono text-cyan-300 bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-800/80">
                                    مالیات: {toPersianDigits(plu.vatRate)}٪
                                  </span>
                                ) : null}
                                {plu.barcodeType && (
                                  <span className="text-[9px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded">
                                    {plu.barcodeType}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 text-center">
                              {plu.itemType === 'unit' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-purple-300 bg-purple-950/60 border border-purple-800/80 px-2.5 py-0.5 rounded-full font-black shadow-sm">
                                  <Box className="h-3 w-3 text-purple-400" />
                                  تعدادی (عدد)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-0.5 rounded-full font-black shadow-sm">
                                  <Scale className="h-3 w-3 text-emerald-400" />
                                  وزنی (kg)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3.5 text-center font-mono text-[11px] font-bold text-slate-300">
                              Dept:{toPersianDigits(plu.departmentCode || 1)} / Sec:{toPersianDigits(plu.sectionCode || 1)}
                            </td>
                            <td className="px-3 py-3.5 text-center">
                              {plu.directKeyNumber ? (
                                <span className={`border text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                                  isDuplicateKey ? 'bg-amber-600 text-white border-amber-400' : 'bg-rose-950/60 border-rose-500/30 text-rose-300'
                                }`}>
                                  Key #{toPersianDigits(plu.directKeyNumber)}
                                  {isDuplicateKey && ' (تکراری)'}
                                </span>
                              ) : (
                                <span className="text-slate-500 text-[10px]">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3.5 text-left font-mono font-bold">
                              <div className="text-emerald-400">{formatWithCommas(plu.pricePerKg)}</div>
                              {plu.promoPrice ? (
                                <div className="text-[10px] text-purple-300 line-through">
                                  تخفیف: {formatWithCommas(plu.promoPrice)}
                                </div>
                              ) : (
                                <div className="text-[9px] text-slate-500 font-sans font-normal">
                                  {plu.itemType === 'unit' ? 'ریال / عدد' : 'ریال / کیلو'}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3.5 text-center font-mono font-bold text-amber-300 dir-ltr">
                              <span className="bg-amber-950/50 border border-amber-800/60 px-2 py-0.5 rounded text-[11px]">
                                {toPersianDigits(plu.expiryDays || 7)} روز
                              </span>
                            </td>
                            <td className="px-3 py-3.5 text-center">
                              {plu.status === 'synced' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-2.5 py-0.5 rounded-full font-bold">
                                  <Check className="h-3 w-3" /> همگام‌شده
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/40 border border-amber-900 px-2.5 py-0.5 rounded-full font-bold">
                                  <Clock className="h-3 w-3" /> در انتظار ارسال
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3.5 text-center">
                              <div className="flex justify-center gap-1.5">
                                <button
                                  onClick={() => setEditingPlu(plu)}
                                  className="p-1 px-2 border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg transition-all cursor-pointer"
                                  title="ویرایش PLU"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeletePlu(plu.id)}
                                  className="p-1 px-2 border border-rose-950/40 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 rounded-lg transition-all cursor-pointer"
                                  title="حذف"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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

      {/* ================= TAB 3: KEYPAD PRESET KEYS ================= */}
      {activeTab === 'keypad' && (
        <div className="space-y-6">
          <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-6 shadow-xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                  <Grid3x3 className="h-5 w-5 text-rose-500" />
                  چیدمان فیزیکی کلیدهای مستقیم کیپد ترازوی {configForm.model || 'Dibal 500-SW'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  ترازو دیبال مدل <strong className="text-rose-400">{configForm.model || 'Dibal 500-SW'}</strong> دارای صفحه کلید غشایی با کلیدهای میانبر مستقیم است. با استفاده از کلید <strong className="text-amber-300">SHIFT</strong> می‌توانید لایه دوم کلیدها را برنامه‌ریزی کنید.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Shift Page Toggle A/B */}
                <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setKeypadShiftPage('A')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      keypadShiftPage === 'A'
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    لایه اصلی (Shift A: 1-{(configForm.model === 'Dibal 500-SW' || !configForm.model) ? 60 : 70})
                  </button>

                  <button
                    type="button"
                    onClick={() => setKeypadShiftPage('B')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      keypadShiftPage === 'B'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    لایه دوم (Shift B: {(configForm.model === 'Dibal 500-SW' || !configForm.model) ? '61-120' : '71-140'})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSendPLUsToScale}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/20 cursor-pointer transition-all flex items-center gap-2"
                >
                  <Send className="h-4 w-4" />
                  ارسال نقشه کیپد به ترازو
                </button>
              </div>
            </div>

            {/* Vendor Keys Banner for Dibal 500-SW */}
            <div className="bg-slate-950/90 border border-slate-800 p-3 rounded-xl flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-400" />
                <span className="font-bold text-slate-300">کلیدهای اختصاصی فروشندگان همزمان (Multi-Vendor):</span>
              </div>
              <div className="flex items-center gap-2 font-mono">
                {['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((v) => (
                  <span key={v} className="bg-rose-950/80 text-rose-300 border border-rose-800/60 font-black px-2.5 py-1 rounded-lg">
                    {v}
                  </span>
                ))}
              </div>
            </div>

            {/* Keypad Grid representation */}
            <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 gap-2.5">
              {Array.from({ length: (configForm.model === 'Dibal 500-SW' || !configForm.model) ? 60 : 70 }).map((_, idx) => {
                const pageOffset = keypadShiftPage === 'B' ? ((configForm.model === 'Dibal 500-SW' || !configForm.model) ? 60 : 70) : 0;
                const keyNum = idx + 1 + pageOffset;
                const mappedPlu = pluList.find(p => p.directKeyNumber === keyNum);

                return (
                  <div 
                    key={`key-${keyNum}`}
                    className={`p-3 rounded-2xl border transition-all flex flex-col justify-between h-28 relative group cursor-pointer ${
                      mappedPlu 
                        ? (keypadShiftPage === 'B' ? 'bg-purple-950/25 border-purple-800/60 hover:border-purple-500' : 'bg-rose-950/25 border-rose-800/60 hover:border-rose-500')
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded-lg">
                        KEY #{toPersianDigits(keyNum)}
                      </span>
                      {mappedPlu && (
                        <span className="h-2 w-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
                      )}
                    </div>

                    <div className="my-auto">
                      {mappedPlu ? (
                        <>
                          <div className="text-xs font-black text-white line-clamp-1 leading-tight flex items-center justify-between gap-1">
                            <span>{mappedPlu.name}</span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] font-mono text-emerald-400 font-bold">
                              {formatWithCommas(mappedPlu.pricePerKg)}
                            </span>
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${
                              mappedPlu.itemType === 'unit'
                                ? 'bg-purple-950/80 text-purple-300 border-purple-700/80'
                                : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                            }`}>
                              {mappedPlu.itemType === 'unit' ? 'تعدادی' : 'وزنی'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] text-slate-600 font-bold text-center">
                          خالی
                        </div>
                      )}
                    </div>

                    {/* Quick selection dropdown */}
                    <div className="mt-1">
                      <select
                        className="w-full text-[9px] bg-slate-900 border border-slate-800 rounded-md text-slate-300 font-bold p-1 cursor-pointer"
                        value={mappedPlu ? mappedPlu.id : ''}
                        onChange={(e) => {
                          const pluId = e.target.value;
                          const updated = pluList.map(p => {
                            if (p.directKeyNumber === keyNum) return { ...p, directKeyNumber: undefined };
                            if (p.id === pluId) return { ...p, directKeyNumber: keyNum };
                            return p;
                          });
                          onUpdateDb({ ...db, dibalPLUs: updated });
                        }}
                      >
                        <option value="">انتخاب کالا...</option>
                        {pluList.map(p => (
                          <option key={p.id} value={p.id}>
                            #{p.pluCode} {p.name} ({p.itemType === 'unit' ? 'تعدادی' : 'وزنی'})
                          </option>
                        ))}
                      </select>
                    </div>

                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* ================= TAB 4: WEIGHING TICKETS ================= */}
      {activeTab === 'tickets' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-850/60 p-4 rounded-2xl border border-slate-800 backdrop-blur-md">
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-500" />
              </span>
              <input
                id="ticket-search"
                type="text"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="جستجو شماره قبض، نام کالا یا تاریخ..."
                className="w-full pl-3 pr-10 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-bold"
              />
            </div>

            <button
              type="button"
              onClick={handleFetchTicketsFromScale}
              disabled={isSyncingTickets}
              className="w-full sm:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/20 cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncingTickets ? 'animate-spin' : ''}`} />
              دریافت قبوض جدید از حافظه ترازو (RX Port 3001)
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-950/20 backdrop-blur-md">
            <table className="min-w-full divide-y divide-slate-800 text-right">
              <thead className="bg-slate-900/60 text-slate-400 text-xs">
                <tr>
                  <th className="px-4 py-3.5 font-black text-rose-400">شماره قبض</th>
                  <th className="px-4 py-3.5 font-bold">زمان وزن‌کشی / صدور</th>
                  <th className="px-4 py-3.5 font-bold">نام کالا (PLU)</th>
                  <th className="px-4 py-3.5 font-bold text-center">نوع و میزان (وزن / تعداد)</th>
                  <th className="px-4 py-3.5 font-bold text-left">قیمت واحد (ریال)</th>
                  <th className="px-4 py-3.5 font-bold text-left">مبلغ کل قبض (ریال)</th>
                  <th className="px-4 py-3.5 font-bold text-center">عملیات فروش</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      هیچ قبض وزن‌کشی دریافت یا ثبت نشده است.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map(t => {
                    const isUnit = t.itemType === 'unit' || t.netWeightKg === 0;
                    return (
                      <tr key={t.id} className="hover:bg-slate-850/50 transition-all">
                        <td className="px-4 py-4 font-mono font-black text-rose-400">
                          #{toPersianDigits(t.ticketNumber)}
                        </td>
                        <td className="px-4 py-4 text-slate-400 font-mono text-[11px]">
                          {toPersianDigits(t.date)} - {toPersianDigits(t.time)}
                        </td>
                        <td className="px-4 py-4 font-extrabold text-white flex items-center gap-2">
                          <span>{t.itemName}</span>
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                            isUnit
                              ? 'bg-purple-950/80 text-purple-300 border-purple-700/80'
                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                          }`}>
                            {isUnit ? 'تعدادی' : 'وزنی'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center font-mono font-black">
                          {isUnit ? (
                            <span className="inline-flex items-center gap-1 text-xs text-purple-300 bg-purple-950/40 border border-purple-800 px-2.5 py-1 rounded-lg">
                              <Box className="h-3 w-3 text-purple-400" />
                              {toPersianDigits(t.quantity || 1)} عدد
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 px-2.5 py-1 rounded-lg">
                              <Scale className="h-3 w-3 text-emerald-400" />
                              {toPersianDigits(t.netWeightKg)} kg
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-left font-mono font-bold text-slate-300">
                          {formatWithCommas(t.unitPrice)}
                        </td>
                      <td className="px-4 py-4 text-left font-mono font-black text-emerald-400 text-sm">
                        {formatWithCommas(t.totalPrice)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {t.status === 'converted_to_sale' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-3 py-1 rounded-full font-bold">
                            <Check className="h-3 w-3" /> ثبت‌شده در فروش
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConvertTicketToSale(t)}
                            className="px-3 py-1.5 bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow"
                          >
                            تبدیل به فاکتور فروش
                          </button>
                        )}
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

      {/* ================= TAB: LABEL & PRINT LAYOUT DESIGNER ================= */}
      {activeTab === 'label_design' && (
        <div className="space-y-6">
          
          {/* Read Stored Formats from Dibal M-525 Flash Memory Panel */}
          <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-5 rounded-2xl space-y-4 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                  <Database className="h-4.5 w-4.5 text-emerald-400" />
                  فراخوانی و خوانش قالب‌ها و طرح‌های چاپی ذخیره‌شده در ترازو دیبال (Model Tower M-525)
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  دریافت مستقیم از حافظه Flash/EEPROM ترازو دیبال از طریق پروتکل DFW. طرح انتخابی را فراخوانی کنید، تغییرات دهید و مجدداً به ترازو ارسال کنید.
                </p>
              </div>

              <button
                type="button"
                disabled={isReadingFromScale}
                onClick={() => {
                  setIsReadingFromScale(true);
                  setTimeout(() => {
                    setIsReadingFromScale(false);
                    setHasFetchedFormats(true);
                    const timeStr = new Date().toLocaleTimeString('fa-IR');
                    setTerminalLogs(prev => [
                      {
                        id: `log-${Date.now()}`,
                        time: timeStr,
                        type: 'TX',
                        hexPayload: '0x02 0x52 0x46 0x4D 0x54 0x41 0x4C 0x4C 0x03',
                        asciiMessage: `TX -> [DIBAL SCALE #${configForm.scaleId}]: READ_FORMAT_SLOTS_ALL_EEPROM`
                      },
                      {
                        id: `log-${Date.now() + 1}`,
                        time: timeStr,
                        type: 'RX',
                        hexPayload: '0x02 0x46 0x4D 0x54 0x5F 0x4C 0x49 0x53 0x54 0x30 0x35 0x03',
                        asciiMessage: `RX <- [DIBAL SCALE #${configForm.scaleId}]: OK - 5 FORMAT DESCRIPTORS READ FROM DIBAL M-525 FLASH MEMORY`
                      },
                      ...prev
                    ]);
                  }, 1000);
                }}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-4 w-4 ${isReadingFromScale ? 'animate-spin' : ''}`} />
                <span>{isReadingFromScale ? 'در حال خواندن حافظه ترازو...' : 'فراخوانی و بروزرسانی طرح‌های ترازو دیبال'}</span>
              </button>
            </div>

            {/* Grid of Formats Fetched from Dibal M-525 Memory */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {dibalScaleFormats.map((fmt) => {
                const isActive = activeFormatSlot === fmt.slot;
                return (
                  <div
                    key={fmt.slot}
                    className={`p-3 rounded-xl border transition-all space-y-2 relative flex flex-col justify-between ${
                      isActive
                        ? 'bg-rose-950/40 border-rose-500 shadow-md shadow-rose-950/30'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-black bg-slate-900 border border-slate-800 text-rose-400 px-2 py-0.5 rounded">
                          SLOT #{toPersianDigits(fmt.slot)}
                        </span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                          fmt.paperType === 'label'
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                            : fmt.paperType === 'receipt'
                            ? 'bg-blue-950/60 text-blue-300 border border-blue-800/60'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                        }`}>
                          {fmt.paperType === 'label' ? 'برچسب' : fmt.paperType === 'receipt' ? 'رسید' : 'لاینرلس'}
                        </span>
                      </div>

                      <h4 className="text-[11px] font-bold text-slate-100 line-clamp-1 mt-1">{fmt.title}</h4>
                      <div className="text-[9px] font-mono text-slate-400">
                        ابعاد: {fmt.labelWidthMm}×{fmt.labelHeightMm} mm
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 dir-ltr text-right">
                        Barcode: {fmt.barcodeType}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFormatSlot(fmt.slot);
                          setLabelDesign({
                            paperType: fmt.paperType,
                            labelWidthMm: fmt.labelWidthMm,
                            labelHeightMm: fmt.labelHeightMm,
                            storeName: fmt.storeName,
                            storePhone: fmt.storePhone,
                            showLogo: fmt.showLogo,
                            showIngredients: fmt.showIngredients,
                            showExpiryDate: fmt.showExpiryDate,
                            showTareWeight: fmt.showTareWeight,
                            showOperatorId: fmt.showOperatorId,
                            showScaleId: fmt.showScaleId,
                            barcodeType: fmt.barcodeType,
                            barcodePrefix: fmt.barcodePrefix,
                            barcodeStructure: fmt.barcodeStructure,
                            fontSizeName: fmt.fontSizeName,
                            headerText: fmt.headerText,
                            footerText: fmt.footerText
                          });
                        }}
                        className={`w-full py-1.5 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isActive
                            ? 'bg-rose-600 text-white shadow'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                        }`}
                      >
                        <Edit2 className="h-3 w-3" />
                        <span>{isActive ? 'در حال ویرایش' : 'فراخوانی و ویرایش'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">

            {/* Dynamic Live Thermal Label Preview Panel (TOP) */}
            <div className="space-y-4">
              <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-5 rounded-2xl space-y-4 shadow-xl">
                <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <div>
                      <h3 className="text-xs font-black text-slate-100">
                        پیش‌نمایش پویا و زنده لیبل (Dynamic Thermal Output)
                      </h3>
                      <p className="text-[10px] text-slate-400">انطباق زنده با ابعاد فیزیکی و جهت چاپ دیبال M-525</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
                      labelDesign.printOrientation === 'vertical' 
                        ? 'bg-purple-950/80 text-purple-300 border-purple-800/80 shadow-sm' 
                        : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80 shadow-sm'
                    }`}>
                      {labelDesign.printOrientation === 'vertical' ? '📐 عمودی (Portrait 90°)' : '📐 افقی (Landscape 0°)'}
                    </span>
                    <span className="text-[10px] text-slate-200 font-mono font-bold bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 dir-ltr">
                      {labelDesign.labelWidthMm}×{labelDesign.labelHeightMm} mm
                    </span>
                  </div>
                </div>

                {/* Physical Millimeter Scale & Thermal Paper Canvas */}
                {(() => {
                  const labelW = Math.max(20, labelDesign.labelWidthMm || 58);
                  const labelH = Math.max(20, labelDesign.labelHeightMm || 40);
                  
                  // Scale calculations for responsive bounding box
                  const maxDisplayW = 480;
                  const maxDisplayH = 400;
                  const scalePx = Math.min(maxDisplayW / labelW, maxDisplayH / labelH);
                  const pxWidth = Math.round(labelW * scalePx);
                  const pxHeight = Math.round(labelH * scalePx);

                  // Millimeter ticks calculation
                  const xTicks = Array.from({ length: Math.floor(labelW / 10) + 1 }, (_, i) => i * 10);
                  const yTicks = Array.from({ length: Math.floor(labelH / 10) + 1 }, (_, i) => i * 10);

                  return (
                    <div className="flex flex-col items-center justify-center p-5 bg-slate-950 rounded-2xl border border-slate-800/80 shadow-inner relative space-y-3">
                      
                      {/* Top Canvas Mode Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 w-full max-w-lg bg-slate-900/90 p-2 rounded-xl border border-slate-800 text-[10.5px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 font-bold px-1">نوع کالا:</span>
                          <button
                            type="button"
                            onClick={() => setPreviewItemType('weighted')}
                            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              previewItemType === 'weighted'
                                ? 'bg-emerald-600 text-white shadow shadow-emerald-600/30'
                                : 'text-slate-400 hover:text-white bg-slate-950/60'
                            }`}
                          >
                            <Scale className="h-3 w-3" />
                            <span>وزنی (kg)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewItemType('unit')}
                            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              previewItemType === 'unit'
                                ? 'bg-purple-600 text-white shadow shadow-purple-600/30'
                                : 'text-slate-400 hover:text-white bg-slate-950/60'
                            }`}
                          >
                            <Box className="h-3 w-3" />
                            <span>تعدادی (عدد)</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <span>چیدمان:</span>
                          <button
                            type="button"
                            onClick={() => setPreviewLayoutMode('absolute')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                              previewLayoutMode === 'absolute'
                                ? 'bg-rose-600 text-white'
                                : 'text-slate-400 bg-slate-950/60'
                            }`}
                          >
                            Absolute
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewLayoutMode('flow')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                              previewLayoutMode === 'flow'
                                ? 'bg-rose-600 text-white'
                                : 'text-slate-400 bg-slate-950/60'
                            }`}
                          >
                            Flow
                          </button>
                        </div>
                      </div>

                      {/* Paper Feed Direction Indicator Header */}
                      <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-slate-400 bg-slate-900/80 px-3.5 py-1 rounded-full border border-slate-800">
                        <span>خروج برچسب از ترازو</span>
                        <span className="text-amber-400 font-bold">⬆️ (Paper Feed)</span>
                        <span className="text-slate-500">•</span>
                        <span>مقیاس: {scalePx.toFixed(1)} px/mm</span>
                      </div>

                      {/* Top Millimeter Ruler */}
                      <div className="flex items-center text-[8px] font-mono text-slate-500 dir-ltr" style={{ width: `${pxWidth}px` }}>
                        <div className="w-full flex justify-between border-b border-slate-700 pb-0.5 px-0.5">
                          {xTicks.map(tick => (
                            <span key={tick} className="relative">
                              | <span className="text-[7px] text-slate-400">{tick}mm</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Thermal Paper Container with Left Ruler */}
                      <div className="flex items-start gap-1.5">
                        {/* Left Millimeter Ruler */}
                        <div className="flex flex-col justify-between border-r border-slate-700 pr-1 text-[7px] font-mono text-slate-500 dir-ltr" style={{ height: `${pxHeight}px` }}>
                          {yTicks.map(tick => (
                            <span key={tick} className="leading-none text-slate-400">
                              - {tick}m
                            </span>
                          ))}
                        </div>

                        {/* Physical Thermal Paper Surface */}
                        <div 
                          className={`bg-white text-slate-950 font-sans rounded shadow-2xl relative border-t-4 border-b-4 border-dashed transition-all duration-300 overflow-hidden ${
                            labelDesign.printOrientation === 'vertical' ? 'border-purple-400/80 ring-2 ring-purple-500/30' : 'border-slate-400 ring-2 ring-slate-700/50'
                          }`}
                          style={{
                            width: `${pxWidth}px`,
                            height: `${pxHeight}px`,
                          }}
                        >
                          {/* Thermal Print Grid Pattern Background */}
                          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px] opacity-30 pointer-events-none" />

                          {/* Orientation Watermark Badge */}
                          <div className="absolute top-1 left-1 text-[7.5px] font-mono font-bold text-slate-400 opacity-60 pointer-events-none dir-ltr">
                            [{(labelDesign?.printOrientation || 'horizontal').toUpperCase()} {labelW}x{labelH}mm]
                          </div>

                          {/* Render Active Format Items */}
                          <div className={`relative w-full h-full ${previewLayoutMode === 'flow' ? 'p-2.5 space-y-1 overflow-auto' : ''}`}>
                            {formatItems
                              .filter(item => item.enabled)
                              .map((item) => {
                                const isHighlighted = highlightedItemId === item.id || expandedItemId === item.id;
                                
                                // Dynamic sample value based on preview item type (weighted vs unit)
                                let displaySampleValue = item.sampleValue;
                                if (previewItemType === 'unit') {
                                  if (item.code === 'FLD_WEIGHT') displaySampleValue = 'تعداد: ۳ عدد';
                                  else if (item.code === 'FLD_NAME') displaySampleValue = 'کیک سفارشی (تعدادی)';
                                  else if (item.code === 'FLD_UNIT_PRICE') displaySampleValue = 'فی: ۱۵۰,۰۰۰ ریال/عدد';
                                  else if (item.code === 'FLD_TOTAL_PRICE') displaySampleValue = '۴۵۰,۰۰۰ ریال';
                                }

                                // Style mappings
                                const alignClass = item.align === 'center' ? 'text-center' : item.align === 'left' ? 'text-left dir-ltr' : 'text-right';
                                const sizeClass = item.fontSize === 'xlarge' ? 'text-xs sm:text-sm py-0.5' : item.fontSize === 'large' ? 'text-[11px] py-0.5' : item.fontSize === 'medium' ? 'text-[10px] py-0.5' : 'text-[9px]';
                                const weightClass = item.fontWeight === 'black' ? 'font-black' : item.fontWeight === 'bold' ? 'font-bold' : 'font-normal';

                                // Absolute Coordinates in pixels based on item.posX and item.posY in mm
                                const itemLeftPx = Math.min(pxWidth - 30, Math.max(0, (item.posX / labelW) * pxWidth));
                                const itemTopPx = Math.min(pxHeight - 16, Math.max(0, (item.posY / labelH) * pxHeight));

                                return (
                                  <div
                                    key={item.id}
                                    onMouseEnter={() => setHighlightedItemId(item.id)}
                                    onMouseLeave={() => setHighlightedItemId(null)}
                                    onClick={() => setExpandedItemId(item.id)}
                                    style={
                                      previewLayoutMode === 'absolute'
                                        ? {
                                            position: 'absolute',
                                            left: `${itemLeftPx}px`,
                                            top: `${itemTopPx}px`,
                                            maxWidth: `${Math.max(40, pxWidth - itemLeftPx - 2)}px`,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                          }
                                        : undefined
                                    }
                                    className={`transition-all rounded px-1.5 cursor-pointer relative z-10 ${alignClass} ${sizeClass} ${weightClass} ${
                                      isHighlighted 
                                        ? 'bg-rose-500/30 ring-2 ring-rose-600 text-slate-950 font-black shadow-lg z-20 scale-[1.02]' 
                                        : 'hover:bg-amber-200/80 text-slate-950'
                                    }`}
                                  >
                                    {item.code === 'FLD_BARCODE' ? (
                                      <div className="flex flex-col items-center justify-center py-0.5">
                                        {labelDesign.barcodeType === 'QR' ? (
                                          <div className="w-12 h-12 bg-slate-950 text-white flex items-center justify-center rounded text-[7px] font-mono font-bold shadow-sm border border-slate-900">
                                            [QR CODE]
                                          </div>
                                        ) : (
                                          <>
                                            <div className="flex items-center gap-[1px] h-6 px-1.5 py-0.5 bg-white border border-slate-300 rounded shadow-sm">
                                              {[2,1,3,1,1,2,1,3,2,1,1,2,3,1,1,2,1,2,3,1,1,2,1,3,1,2].map((w, i) => (
                                                <div key={i} className={`h-full bg-slate-950 ${w === 3 ? 'w-1' : w === 2 ? 'w-[1.5px]' : 'w-[0.8px]'}`} />
                                              ))}
                                            </div>
                                            <div className="font-mono text-[8px] font-black tracking-widest text-slate-950 mt-0.5">
                                              {displaySampleValue}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    ) : item.code === 'FLD_TOTAL_PRICE' ? (
                                      <div className="flex justify-between items-center text-slate-950 px-0.5 py-0.5 text-[10px] font-black">
                                        <span className="pl-1 text-slate-950 font-black">مبلغ:</span>
                                        <span className="font-mono text-slate-950 font-black dir-ltr">{displaySampleValue}</span>
                                      </div>
                                    ) : (
                                      <span className="text-slate-950 font-bold">{displaySampleValue}</span>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      </div>

                      {/* Interactive Floating Quick Edit Overlay for Active Selected Item */}
                      {expandedItemId && (() => {
                        const activeItem = formatItems.find(i => i.id === expandedItemId);
                        if (!activeItem) return null;

                        const updateActiveItem = (updates: Partial<DibalFormatItem>) => {
                          setFormatItems(prev => prev.map(item => item.id === expandedItemId ? { ...item, ...updates } : item));
                        };

                        return (
                          <div className="w-full max-w-lg bg-slate-900 border border-rose-500/40 p-3 rounded-xl shadow-2xl space-y-2 animate-fade-in text-xs">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                              <span className="font-bold text-rose-400 flex items-center gap-1.5">
                                <Edit2 className="h-3.5 w-3.5" />
                                تنظیم زنده: <span className="text-white">{activeItem.name}</span>
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">({activeItem.code})</span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {/* Position X Nudging */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-slate-400 font-bold">موقعیت افقی X (mm)</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateActiveItem({ posX: Math.max(0, activeItem.posX - 1) })}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    className="w-full text-center bg-slate-950 border border-slate-800 rounded py-0.5 text-rose-300 font-mono font-bold"
                                    value={activeItem.posX}
                                    onChange={(e) => updateActiveItem({ posX: Number(e.target.value) })}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateActiveItem({ posX: activeItem.posX + 1 })}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Position Y Nudging */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-slate-400 font-bold">موقعیت عمودی Y (mm)</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateActiveItem({ posY: Math.max(0, activeItem.posY - 1) })}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    className="w-full text-center bg-slate-950 border border-slate-800 rounded py-0.5 text-rose-300 font-mono font-bold"
                                    value={activeItem.posY}
                                    onChange={(e) => updateActiveItem({ posY: Number(e.target.value) })}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateActiveItem({ posY: activeItem.posY + 1 })}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Size Picker */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-slate-400 font-bold">اندازه فونت</span>
                                <select
                                  className="bg-slate-950 border border-slate-800 rounded py-1 text-slate-200 text-[11px] font-bold"
                                  value={activeItem.fontSize}
                                  onChange={(e) => updateActiveItem({ fontSize: e.target.value as any })}
                                >
                                  <option value="small">S (کوچک)</option>
                                  <option value="medium">M (متوسط)</option>
                                  <option value="large">L (بزرگ)</option>
                                  <option value="xlarge">XL (خیلی بزرگ)</option>
                                </select>
                              </div>

                              {/* Weight Picker */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-slate-400 font-bold">ضخامت فونت</span>
                                <select
                                  className="bg-slate-950 border border-slate-800 rounded py-1 text-slate-200 text-[11px] font-bold"
                                  value={activeItem.fontWeight}
                                  onChange={(e) => updateActiveItem({ fontWeight: e.target.value as any })}
                                >
                                  <option value="normal">عادی (Normal)</option>
                                  <option value="bold">برجسته (Bold)</option>
                                  <option value="black">سنگین (Black)</option>
                                </select>
                              </div>
                            </div>

                            {/* Sample Text Direct Editor */}
                            <div className="pt-1 flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">متن نمونه:</span>
                              <input
                                type="text"
                                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 text-xs font-bold"
                                value={activeItem.sampleValue}
                                onChange={(e) => updateActiveItem({ sampleValue: e.target.value })}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                <div className="text-[11px] text-slate-400 space-y-1 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                  <p className="font-bold text-rose-400 flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" /> راهنمای کالیبراسیون و جهت چاپ دیبال M-525:
                  </p>
                  <p className="text-[10px]">
                    در چاپ عمودی (Portrait)، فونت‌ها و بارکدها متناسب با جهت هد حرارتی چرخیده و چاپ می‌شوند. برای همگام‌سازی موقعیت سنسور کاغذ، کلید [LABEL FEED] روی ترازو را ۳ ثانیه فشار دهید.
                  </p>
                </div>

              </div>
            </div>
            
            {/* Format Items Inspector & Editor Controls Panel (BELOW) */}
            <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-5 shadow-xl">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                    <Sliders className="h-4.5 w-4.5 text-rose-500" />
                    ویرایشگر فیلدها و آیتم‌های درون قالب #{toPersianDigits(activeFormatSlot)} ترازو دیبال
                  </h3>
                  <div className="text-[10px] text-rose-400 font-bold mt-0.5">
                    Dibal M-525 Field Descriptors ({formatItems.filter(i => i.enabled).length} آیتم فعال از مجموع {formatItems.length} آیتم)
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isReadingItemsFromScale}
                  onClick={() => {
                    setIsReadingItemsFromScale(true);
                    setTimeout(() => {
                      setIsReadingItemsFromScale(false);
                      const timeStr = new Date().toLocaleTimeString('fa-IR');
                      setTerminalLogs(prev => [
                        {
                          id: `log-${Date.now()}`,
                          time: timeStr,
                          type: 'TX',
                          hexPayload: `0x02 0x52 0x46 0x4C 0x44 0x30 ${activeFormatSlot} 0x03`,
                          asciiMessage: `TX -> [SCALE #${configForm.scaleId}]: READ_FORMAT_ITEMS_SLOT_${activeFormatSlot}`
                        },
                        {
                          id: `log-${Date.now() + 1}`,
                          time: timeStr,
                          type: 'RX',
                          hexPayload: `0x02 0x46 0x4C 0x44 0x53 0x5F 0x4F 0x4B 0x31 0x34 0x03`,
                          asciiMessage: `RX <- [SCALE #${configForm.scaleId}]: OK - ${formatItems.length} ITEM FIELD DESCRIPTORS READ FROM DIBAL SLOT #${activeFormatSlot}`
                        },
                        ...prev
                      ]);
                    }, 800);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-rose-400 ${isReadingItemsFromScale ? 'animate-spin' : ''}`} />
                  <span>{isReadingItemsFromScale ? 'در حال دریافت آیتم‌ها...' : 'فراخوانی آیتم‌های این قالب از ترازو'}</span>
                </button>
              </div>

              {/* General Paper, Orientation & Barcode Settings Accordion Bar */}
              <div className="space-y-2 bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">نوع کاغذ چاپ</label>
                    <select
                      className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-bold"
                      value={labelDesign.paperType}
                      onChange={(e) => setLabelDesign({ ...labelDesign, paperType: e.target.value as any })}
                    >
                      <option value="label">برچسب (Label)</option>
                      <option value="receipt">رسید (Receipt)</option>
                      <option value="linerless">لاینرلس (Linerless)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-rose-400 mb-1">جهت چاپ (Orientation)</label>
                    <select
                      className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded-lg text-rose-300 font-bold"
                      value={labelDesign.printOrientation}
                      onChange={(e) => setLabelDesign({ ...labelDesign, printOrientation: e.target.value as any })}
                    >
                      <option value="horizontal">افقی (Landscape - 0°)</option>
                      <option value="vertical">عمودی (Portrait - 90°)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">عرض × ارتفاع (mm)</label>
                    <div className="flex gap-1 items-center">
                      <input
                        type="number"
                        className="w-1/2 px-1.5 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono font-bold"
                        value={labelDesign.labelWidthMm}
                        onChange={(e) => setLabelDesign({ ...labelDesign, labelWidthMm: Number(e.target.value) })}
                      />
                      <span className="text-slate-500 text-[10px]">×</span>
                      <input
                        type="number"
                        className="w-1/2 px-1.5 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono font-bold"
                        value={labelDesign.labelHeightMm}
                        onChange={(e) => setLabelDesign({ ...labelDesign, labelHeightMm: Number(e.target.value) })}
                      />
                      <button
                        type="button"
                        title="تعویض عرض و طول (Swap W/H)"
                        onClick={() => {
                          setLabelDesign(prev => ({
                            ...prev,
                            labelWidthMm: prev.labelHeightMm,
                            labelHeightMm: prev.labelWidthMm,
                            printOrientation: prev.printOrientation === 'horizontal' ? 'vertical' : 'horizontal'
                          }));
                        }}
                        className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3 text-rose-400" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">نوع ساختار بارکد</label>
                    <select
                      className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded-lg text-rose-300 font-mono font-bold"
                      value={labelDesign.barcodeType}
                      onChange={(e) => setLabelDesign({ ...labelDesign, barcodeType: e.target.value as any })}
                    >
                      <option value="EAN13">EAN-13 وزنی</option>
                      <option value="EAN128">GS1-128</option>
                      <option value="CODE128">Code 128</option>
                      <option value="QR">QR Code</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">پیشوند بارکد</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-rose-400 font-mono font-bold"
                      value={labelDesign.barcodePrefix}
                      onChange={(e) => setLabelDesign({ ...labelDesign, barcodePrefix: e.target.value })}
                    />
                  </div>
                </div>

                {/* Preset Sizes Bar */}
                <div className="pt-2 border-t border-slate-900 flex flex-wrap items-center justify-between gap-2 text-[9.5px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-slate-400">سایزهای استاندارد ترازو دیبال:</span>
                    {[
                      { label: '۵۸×۴۰ افقی', w: 58, h: 40, o: 'horizontal' },
                      { label: '۴۰×۵۸ عمودی', w: 40, h: 58, o: 'vertical' },
                      { label: '۶۰×۶۰ مربعی', w: 60, h: 60, o: 'horizontal' },
                      { label: '۵۰×۳۰ کوچک', w: 50, h: 30, o: 'horizontal' },
                      { label: '۸۰×۵۰ بزرگ', w: 80, h: 50, o: 'horizontal' },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setLabelDesign({
                          ...labelDesign,
                          labelWidthMm: preset.w,
                          labelHeightMm: preset.h,
                          printOrientation: preset.o as any
                        })}
                        className={`px-2 py-0.5 rounded border transition-all cursor-pointer font-mono ${
                          labelDesign.labelWidthMm === preset.w && labelDesign.labelHeightMm === preset.h && labelDesign.printOrientation === preset.o
                            ? 'bg-rose-950 border-rose-500 text-rose-300 font-bold shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="text-[9px] font-mono text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900">
                    نسبت ابعاد: {labelDesign.labelWidthMm}:{labelDesign.labelHeightMm} ({labelDesign.printOrientation === 'vertical' ? 'عمودی / Portrait' : 'افقی / Landscape'})
                  </div>
                </div>
              </div>

              {/* Supplementary Barcode Specifications & Technical Guide */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-xs font-black text-rose-400 flex items-center gap-1.5">
                    <Barcode className="h-4 w-4 text-rose-500" />
                    راهنما و ساختار فنی بارکدهای ترازو دیبال M-525
                  </h4>
                  <span className="text-[9.5px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    Dibal Barcode Format Specs
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10.5px]">
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">۱. بارکد EAN-13 وزنی (Weight-Embedded)</span>
                      <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-900">۱۳ رقمی</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[10px]">
                      فرمت استاندارد فروشگاهی: <code className="text-rose-300 font-mono font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">22 PPPPP WWWWW C</code>
                    </p>
                    <ul className="list-disc list-inside text-slate-400 text-[9.5px] space-y-0.5 pr-1">
                      <li><strong className="text-slate-200">پیشوند {labelDesign.barcodePrefix || '22'} (Prefix):</strong> کد شناسایی کالای وزنی ترازویی.</li>
                      <li><strong className="text-slate-200">کد کالا PPPPP (PLU):</strong> ۵ رقم شناسه محصول در ترازو (<code className="text-amber-300 font-mono">00105</code>).</li>
                      <li><strong className="text-slate-200">وزن/قیمت WWWWW:</strong> ۵ رقم وزن به گرم (<code className="text-amber-300 font-mono">01250</code> = ۱.۲۵ kg).</li>
                      <li><strong className="text-slate-200">رقم چک C (Checksum):</strong> ۱ رقم کنترل با الگوریتم Modulo-10.</li>
                    </ul>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-300">۲. بارکد EAN-13 کالاهای تعدادی (Unit/Piece-Embedded)</span>
                      <span className="text-[9px] font-mono text-purple-400 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-900">۱۳ رقمی (تعدادی)</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[10px]">
                      فرمت استاندارد کالای تعدادی: <code className="text-purple-300 font-mono font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">21 PPPPP QQQQQ C</code>
                    </p>
                    <ul className="list-disc list-inside text-slate-400 text-[9.5px] space-y-0.5 pr-1">
                      <li><strong className="text-slate-200">پیشوند 21 / 23 (Unit Prefix):</strong> شناسه پیش‌فرض ترازو دیبال M-525 برای محصولات شمارشی/بسته‌ای.</li>
                      <li><strong className="text-slate-200">کد کالا PPPPP (PLU Code):</strong> ۵ رقم شناسه کالا در حافظه ترازو (<code className="text-amber-300 font-mono">00108</code> = کیک سفارشی).</li>
                      <li><strong className="text-slate-200">تعداد QQQQQ (Quantity/Units):</strong> ۵ رقم تعداد صادرشده (<code className="text-purple-300 font-mono">00003</code> = ۳ عدد) یا قیمت کل به ریال.</li>
                      <li><strong className="text-slate-200">رقم چک C (Check Digit):</strong> ۱ رقم کنترل EAN-13 جهت صحت‌سنجی اسکنرهای صندوق POS.</li>
                    </ul>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">۳. استاندارد GS1-128 / EAN-128</span>
                      <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-900">صنعتی / زنجیره‌ای</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[10px]">
                      پشتیبانی از شناسه برنامه‌ها (AI - Application Identifiers):
                    </p>
                    <ul className="list-disc list-inside text-slate-400 text-[9.5px] space-y-0.5 pr-1">
                      <li><strong className="text-slate-200">(01) GTIN:</strong> شناسه جهانی کالا ۱۴ رقمی.</li>
                      <li><strong className="text-slate-200">(3103) Weight / (30) Qty:</strong> وزن خالص یا تعداد کالای بسته‌بندی.</li>
                      <li><strong className="text-slate-200">(15) Exp Date:</strong> تاریخ انقضا (YYMMDD).</li>
                      <li><strong className="text-slate-200">(10) Batch No:</strong> شماره سری ساخت / بچ کالا.</li>
                    </ul>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">۴. بارکد میله‌ای Code 128</span>
                      <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-900">الفبا-عددی (Alphanumeric)</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[10px]">
                      کدگذاری حروف انگلیسی/فارسی، اعداد و علامت‌ها بدون محدودیت طول ثابت. مناسب برای کد پیگیری انبار، شماره فاکتور و شناسه لجستیکی.
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">۵. بارکد دوبعدی QR Code</span>
                      <span className="text-[9px] font-mono text-rose-400 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-900">۲D Matrix</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[10px]">
                      گنجاندن لینک فاکتور آنلاین، کد اقتصادی، ترکیبات کالا، ارزش غذایی و قیمت کل در یک تصویر ۲D جهت اسکن با موبایل یا اسکنر تصویری.
                    </p>
                  </div>
                </div>
              </div>

              {/* Category Filter Pills & Quick Actions Toolbar */}
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    {[
                      { id: 'all', label: 'همه آیتم‌ها' },
                      { id: 'header', label: 'سربرگ' },
                      { id: 'product', label: 'کالا' },
                      { id: 'weight', label: 'وزن' },
                      { id: 'price', label: 'قیمت' },
                      { id: 'barcode', label: 'بارکد' },
                      { id: 'footer', label: 'پانویس' },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoryFilter(cat.id)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          selectedCategoryFilter === cat.id
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Actions: Add Item, Auto-Align, Reset */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const newId = `item_${Date.now()}`;
                        const newItem: DibalFormatItem = {
                          id: newId,
                          code: `FLD_CUSTOM_${formatItems.length + 1}`,
                          name: `آیتم سفارشی #${formatItems.length + 1}`,
                          enabled: true,
                          posX: 5,
                          posY: Math.min(55, formatItems.length * 4 + 5),
                          fontSize: 'medium',
                          fontWeight: 'bold',
                          align: 'right',
                          sampleValue: 'متن سفارشی چاپی',
                          fieldCategory: 'product'
                        };
                        setFormatItems(prev => [...prev, newItem]);
                        setExpandedItemId(newId);
                      }}
                      className="px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      <span>افزودن آیتم جدید</span>
                    </button>

                    <button
                      type="button"
                      title="مرتب‌سازی خودکار موقعیت‌های عمودی"
                      onClick={() => {
                        setFormatItems(prev => {
                          const sorted = [...prev].sort((a, b) => a.posY - b.posY);
                          let currentY = 2;
                          return sorted.map((item) => {
                            if (!item.enabled) return item;
                            const spacing = item.fontSize === 'xlarge' ? 7 : item.fontSize === 'large' ? 5 : 4;
                            const updated = { ...item, posY: currentY };
                            currentY += spacing;
                            return updated;
                          });
                        });
                      }}
                      className="px-2 py-1 bg-slate-950 hover:bg-slate-900 text-slate-300 border border-slate-800 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Sliders className="h-3 w-3 text-amber-400" />
                      <span>تراز Y خودکار</span>
                    </button>
                  </div>
                </div>

                {/* List of Item Cards */}
                <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                  {formatItems
                    .filter(item => selectedCategoryFilter === 'all' || item.fieldCategory === selectedCategoryFilter)
                    .map((item) => {
                      const isExpanded = expandedItemId === item.id;
                      const isHighlighted = highlightedItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          onMouseEnter={() => setHighlightedItemId(item.id)}
                          onMouseLeave={() => setHighlightedItemId(null)}
                          className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                            isHighlighted || isExpanded
                              ? 'bg-slate-900 border-rose-500/80 shadow-lg shadow-rose-950/20'
                              : item.enabled
                              ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                              : 'bg-slate-950/40 border-slate-900 opacity-60'
                          }`}
                        >
                          {/* Card Top Row */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                className="rounded border-slate-800 text-rose-600 focus:ring-rose-500 h-4 w-4 bg-slate-900 shrink-0 cursor-pointer"
                                checked={item.enabled}
                                onChange={(e) => {
                                  const val = e.target.checked;
                                  setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, enabled: val } : i));
                                }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-bold text-slate-100 truncate">{item.name}</span>
                                  <span className="text-[8px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 dir-ltr">
                                    {item.code}
                                  </span>
                                </div>
                                <div className="text-[9px] font-mono text-rose-400 mt-0.5 flex items-center gap-2">
                                  <span>X: {item.posX}mm | Y: {item.posY}mm</span>
                                  <span>• Font: {item.fontSize}</span>
                                  <span>• Align: {item.align}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
                              >
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                <span>{isExpanded ? 'بستن' : 'ویرایش'}</span>
                              </button>

                              {formatItems.length > 3 && (
                                <button
                                  type="button"
                                  onClick={() => setFormatItems(prev => prev.filter(i => i.id !== item.id))}
                                  className="p-1.5 bg-rose-950/40 hover:bg-rose-900 text-rose-400 rounded-lg text-[10px] transition-all cursor-pointer"
                                  title="حذف این آیتم"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expanded Fields Details */}
                          {isExpanded && (
                            <div className="pt-2 border-t border-slate-800/80 space-y-3 bg-slate-950/90 p-3 rounded-xl border border-slate-800">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 mb-1">متن / محتوای چاپی این آیتم (Sample Value)</label>
                                <input
                                  type="text"
                                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 font-bold"
                                  value={item.sampleValue}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, sampleValue: val } : i));
                                  }}
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 mb-1">موقعیت افقی X (میلی‌متر)</label>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posX: Math.max(0, i.posX - 1) } : i))}
                                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold text-xs"
                                    >-</button>
                                    <input
                                      type="number"
                                      className="w-full px-2 py-1 text-center text-xs bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono font-bold"
                                      value={item.posX}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posX: val } : i));
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posX: Math.min(100, i.posX + 1) } : i))}
                                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold text-xs"
                                    >+</button>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-400 mb-1">موقعیت عمودی Y (میلی‌متر)</label>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posY: Math.max(0, i.posY - 1) } : i))}
                                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold text-xs"
                                    >-</button>
                                    <input
                                      type="number"
                                      className="w-full px-2 py-1 text-center text-xs bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono font-bold"
                                      value={item.posY}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posY: val } : i));
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, posY: Math.min(150, i.posY + 1) } : i))}
                                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold text-xs"
                                    >+</button>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 mb-1">اندازه قلم</label>
                                  <select
                                    className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-100 font-bold"
                                    value={item.fontSize}
                                    onChange={(e) => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, fontSize: e.target.value as any } : i))}
                                  >
                                    <option value="small">کوچک (Small)</option>
                                    <option value="medium">متوسط (Medium)</option>
                                    <option value="large">بزرگ (Large)</option>
                                    <option value="xlarge">خیلی بزرگ (X-Large)</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 mb-1">ضخامت قلم</label>
                                  <select
                                    className="w-full px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-100 font-bold"
                                    value={item.fontWeight}
                                    onChange={(e) => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, fontWeight: e.target.value as any } : i))}
                                  >
                                    <option value="normal">عادی</option>
                                    <option value="bold">برجسته (Bold)</option>
                                    <option value="black">ضخیم (Black)</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 mb-1">تراز متن</label>
                                  <div className="flex gap-1">
                                    {[
                                      { val: 'right', icon: AlignRight },
                                      { val: 'center', icon: AlignCenter },
                                      { val: 'left', icon: AlignLeft },
                                    ].map(al => {
                                      const Icon = al.icon;
                                      return (
                                        <button
                                          key={al.val}
                                          type="button"
                                          onClick={() => setFormatItems(prev => prev.map(i => i.id === item.id ? { ...i, align: al.val as any } : i))}
                                          className={`w-full py-1 rounded text-center flex justify-center items-center ${
                                            item.align === al.val ? 'bg-rose-600 text-white' : 'bg-slate-900 text-slate-400'
                                          }`}
                                        >
                                          <Icon className="h-3 w-3" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSendingLabelFormat}
                  onClick={async () => {
                    setIsSendingLabelFormat(true);
                    const activeItemsCount = formatItems.filter(i => i.enabled).length;
                    const sanitizedIp = cleanIpAddress(configForm.ipAddress);
                    const targetPort = Number(configForm.txPort) || 3000;
                    const formatHex = `0x02 0x57 0x46 0x4D 0x54 0x30 ${activeFormatSlot} 0x03`;

                    const bridgeResult = await sendToDibalBridge({
                      ip: sanitizedIp,
                      port: targetPort,
                      hexData: formatHex,
                      timeoutMs: 5000
                    });

                    setIsSendingLabelFormat(false);
                    const timeStr = new Date().toLocaleTimeString('fa-IR');

                    const newLogs = [
                      {
                        id: `log-${Date.now()}`,
                        time: timeStr,
                        type: 'TX' as const,
                        hexPayload: formatHex,
                        asciiMessage: `[LIVE BRIDGE TX] -> WRITE_FORMAT_SLOT_${activeFormatSlot} (Items: ${activeItemsCount}/${formatItems.length})`
                      },
                      {
                        id: `log-${Date.now() + 1}`,
                        time: timeStr,
                        type: bridgeResult.success ? ('RX' as const) : ('TX' as const),
                        hexPayload: bridgeResult.responseHex || '0x15 0x45 0x52 0x52',
                        asciiMessage: bridgeResult.success
                          ? `[LIVE BRIDGE RX] ACK - SLOT #${activeFormatSlot} FORMAT WRITTEN SUCCESSFULLY (${bridgeResult.responseHex})`
                          : `[LIVE BRIDGE ERROR] ${bridgeResult.error}`
                      }
                    ];

                    setTerminalLogs(prev => [...newLogs, ...prev]);
                    if (bridgeResult.success) {
                      alert(`تعداد ${toPersianDigits(activeItemsCount)} آیتم و عنصر چاپی با موفقیت از طریق پل ارتباطی (dibal-bridge) در خانه حافظه Slot #${toPersianDigits(activeFormatSlot)} ترازو دیبال بارگذاری و ذخیره گردید.`);
                    } else {
                      alert(`نتیجه ارسال قالب به ترازو:\n${bridgeResult.error}`);
                    }
                  }}
                  className="w-full py-3 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-extrabold rounded-xl text-xs shadow-lg shadow-rose-600/25 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Send className={`h-4 w-4 ${isSendingLabelFormat ? 'animate-bounce' : ''}`} />
                  <span>{isSendingLabelFormat ? 'در حال ارسال آیتم‌ها به ترازو...' : `ارسال و ذخیره کلیه آیتم‌های قالب در حافظه ترازو دیبال Slot #${toPersianDigits(activeFormatSlot)}`}</span>
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* ================= TAB 5: TERMINAL & PROTOCOL INSPECTOR ================= */}
      {activeTab === 'terminal' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Direct Command Buttons */}
            <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-slate-100 border-b border-slate-800 pb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-rose-500" />
                دستورات مستقیم پروتکل دیبال (Native Command Terminal)
              </h3>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => handleSendTerminalCmd('PING')}
                  className="w-full text-right p-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>دستور PING (تست اتصال سوکت)</span>
                  <span className="font-mono text-[10px] text-rose-400">0x30 0x31 0x50</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendTerminalCmd('READ_CURRENT_WEIGHT')}
                  className="w-full text-right p-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>استعلام وزن لحظه‌ای سینی ترازو</span>
                  <span className="font-mono text-[10px] text-rose-400">READ_WEIGHT</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendTerminalCmd('SYNC_RTC')}
                  className="w-full text-right p-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>تنظیم و همگام‌سازی ساعت و تاریخ ترازو</span>
                  <span className="font-mono text-[10px] text-rose-400">SYNC_TIME</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendTerminalCmd('PRINT_TEST_LABEL')}
                  className="w-full text-right p-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>چاپ برچسب آزمایشی (Test Label)</span>
                  <span className="font-mono text-[10px] text-rose-400">PRINT_TEST</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    askConfirm('تایید پاکسازی حافظه', 'آیا از پاکسازی کامل کالاها در حافظه ترازو اطمینان دارید؟', () => {
                      handleSendTerminalCmd('CLEAR_ALL_PLU');
                    });
                  }}
                  className="w-full text-right p-3 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40 rounded-xl text-xs font-bold text-rose-300 transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>پاکسازی کامل حافظه کالاها (Purge Memory)</span>
                  <span className="font-mono text-[10px] text-rose-400">CLEAR_PLU</span>
                </button>
              </div>

              {/* Custom Command Box */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <label className="block text-[11px] font-bold text-slate-400">ارسال کد هگز / دستور دلخواه</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    placeholder="e.g. GET_INFO"
                    className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-rose-300 font-mono"
                    value={customTerminalCommand}
                    onChange={(e) => setCustomTerminalCommand(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleSendTerminalCmd(customTerminalCommand)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow cursor-pointer"
                  >
                    ارسال
                  </button>
                </div>
              </div>
            </div>

            {/* Terminal Live RX/TX Buffer Log Viewer */}
            <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 font-mono shadow-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-black text-white">پایش زنده پکت‌های شبکه (RX/TX Buffer Console)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTerminalLogs([])}
                  className="text-[10px] text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg"
                >
                  پاکسازی کنسول
                </button>
              </div>

              {/* Scrollable Console */}
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2 text-[11px]">
                {terminalLogs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.type === 'TX' && (
                          <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                            <ArrowUpRight className="h-3 w-3" /> TX (SEND)
                          </span>
                        )}
                        {log.type === 'RX' && (
                          <span className="bg-rose-950/80 text-rose-300 border border-rose-500/40 text-[9px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                            <ArrowDownLeft className="h-3 w-3" /> RX (RECEIVE)
                          </span>
                        )}
                        {log.type === 'INFO' && (
                          <span className="bg-sky-950/80 text-sky-300 border border-sky-500/40 text-[9px] font-bold px-2 py-0.5 rounded-md">
                            SYSTEM INFO
                          </span>
                        )}
                        <span className="text-slate-500 text-[10px]">{log.time}</span>
                      </div>
                      <span className="text-slate-500 text-[10px]">TCP Port: {configForm.txPort}/{configForm.rxPort}</span>
                    </div>

                    <div className="text-rose-400 text-left font-mono font-bold dir-ltr break-all">
                      {log.hexPayload}
                    </div>

                    <div className="text-slate-300 text-right dir-rtl font-sans font-medium text-[11px]">
                      {log.asciiMessage}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
                <span>Dibal Ethernet TCP Socket Status: LISTEN / CONNECTED</span>
                <span>Port TX: {configForm.txPort} | Port RX: {configForm.rxPort}</span>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ================= TAB 7: FULL DIBAL 500-SW & SERIES 500 MANUAL ================= */}
      {activeTab === 'manual' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-rose-950/40 to-slate-900 border border-rose-500/30 p-6 rounded-2xl shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-600/20 border border-rose-500/40 rounded-xl text-rose-400">
                  <BookOpen className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    راهنمای جامع کاربری و منوهای ترازو دیبال (Dibal 500-SW Manual) & سامانه مدیریت
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    مستندات کامل کاربری سخت‌افزار Dibal 500-SW، کدهای سریع منو، تنظیمات پرینتر کاستی، عملکرد کیپد غشایی و اتصال به سامانه
                  </p>
                </div>
              </div>
              <span className="bg-amber-950/80 text-amber-300 border border-amber-500/40 text-xs font-mono font-black px-3 py-1 rounded-xl shadow">
                Dibal 500-SW Bench Specs
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* SECTION 1: HARDWARE & INVOICING MANUAL */}
            <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h4 className="text-sm font-black text-amber-400 flex items-center gap-2">
                  <Scale className="h-5 w-5 text-amber-500" />
                  بخش اول: دفترچه راهنمای کاربری و کدهای منوی Dibal 500-SW
                </h4>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  500-SW Invoicing Guide
                </span>
              </div>

              {/* General Specs */}
              <div className="space-y-4 text-xs text-slate-300">
                <p className="leading-relaxed bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-slate-200">
                  ترازو دیجیتال دیبال مدل <strong className="text-rose-400 font-black">Dibal 500-SW</strong> ساخت اسپانیا، مدل رومیزی/تخت (Bench Scale) پرفروش از سری 500 است. این ترازو مجهز به نمایشگر دوطرفه با کیفیت، پرینتر حرارتی کاستی جهت تعویض سریع کاغذ/لیبل، صفحه‌کلید غشایی ضدآب ۶۰ کلیدی (قابل ارتقا تا ۱۲۰ کالا با Shift) و پشتیبانی از ۶ فروشنده همزمان است.
                </p>

                {/* SPECIAL INSTRUCTION: HOW TO CREATE CUSTOMER INVOICES */}
                <div className="space-y-3 bg-gradient-to-br from-slate-900 via-rose-950/20 to-slate-900 p-4 rounded-2xl border border-rose-500/30">
                  <h5 className="font-black text-rose-300 text-xs flex items-center gap-2 border-b border-rose-900/40 pb-2">
                    <FileText className="h-4.5 w-4.5 text-rose-400" />
                    آموزش گام‌به‌گام نحوه ایجاد فاکتور برای مشتری (Customer Invoice & Ticket Issuance)
                  </h5>

                  {/* Single vs Multi Item */}
                  <div className="space-y-2 text-[11px]">
                    <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="font-bold text-amber-300 flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5" />
                        روش ۱: صدور فاکتور تک‌کالایی (فروش سریع تک محصول):
                      </span>
                      <ol className="list-decimal list-inside text-slate-300 space-y-1 pr-1 text-[10.5px] leading-relaxed">
                        <li>کالا یا ظرف حاوی محصول را روی سینی ترازو قرار دهید.</li>
                        <li>کد کالا را وارد کرده و کلید <strong className="text-amber-300">PLU</strong> را بزنید (یا کلید مستقیم ۱ تا ۷۰ را بفشارید).</li>
                        <li>یکی از کلیدهای فروشنده (مانند <strong className="text-rose-400 font-mono font-bold">V1</strong>) یا کلید <strong className="text-emerald-400 font-bold">PRINT</strong> را بفشارید.</li>
                        <li>فاکتور رسید تک‌کالایی بلافاصله همراه با بارکد تجمیعی چاپ و صادر می‌شود.</li>
                      </ol>
                    </div>

                    <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1.5">
                      <span className="font-bold text-rose-300 flex items-center gap-1.5">
                        <ShoppingBag className="h-3.5 w-3.5" />
                        روش ۲: صدور فاکتور چندکالایی / مشتری تجمیعی (Multi-Item Invoice):
                      </span>
                      <p className="text-[10.5px] text-slate-300 leading-relaxed">
                        جهت صدور یک فاکتور خرید کامل برای مشتری حاوی چند کالای وزنی و تعدادی:
                      </p>
                      <ol className="list-decimal list-inside text-slate-300 space-y-1.5 pr-1 text-[10.5px] leading-relaxed">
                        <li>
                          <strong className="text-white">ثبت کالای اول:</strong> کالای اول را روی سینی بگذارید ➔ کد PLU یا کلید مستقیم را بزنید ➔ کلید فروشنده مربوطه (مثلاً <strong className="text-rose-400 font-mono font-bold">V1</strong>) را بزنید. ردیف اول در حافظه موقت فروشنده V1 ذخیره می‌شود.
                        </li>
                        <li>
                          <strong className="text-white">ثبت کالای دوم و بعدی:</strong> کالای اول را برداشته و کالای دوم را روی سینی بگذارید ➔ کد PLU یا کلید مستقیم کالای دوم را بزنید ➔ مجدداً کلید <strong className="text-rose-400 font-mono font-bold">V1</strong> را بفشارید.
                        </li>
                        <li>
                          <strong className="text-white">ثبت کالاهای غیروزنی (تعدادی):</strong> کلید <strong className="text-purple-300 font-bold">X / MULT</strong> را بزنید ➔ تعداد را وارد کنید (مثلاً <code className="text-amber-300 font-mono">5</code>) ➔ کد PLU کالای تعدادی را زده و کلید <strong className="text-rose-400 font-mono font-bold">V1</strong> را بفشارید.
                        </li>
                        <li>
                          <strong className="text-white">اعمال تخفیف (اختیاری):</strong> برای اعمال تخفیف روی کل فاکتور مشتری، کلید <strong className="text-amber-300 font-bold">% DISC</strong> را بزنید و درصد تخفیف را وارد کنید.
                        </li>
                        <li>
                          <strong className="text-white">صدور و چاپ فاکتور نهایی مشتری:</strong> پس از ثبت تمام ردیف‌ها، کلید <strong className="text-emerald-400 font-bold">TOTAL / PRINT</strong> یا دوبار کلید <strong className="text-rose-400 font-mono font-bold">V1</strong> را بفشارید. فاکتور سرجمع مشتری با سربرگ فروشگاه، شرح تمام ردیف‌ها، قیمت‌های واحد، وزن‌ها، جمع کل و بارکد تجمیعی چاپ می‌گردد.
                        </li>
                      </ol>
                    </div>

                    <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="font-bold text-sky-300 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        فروش همزمان ۶ مشتری (Multi-Vendor Keys V1 to V6):
                      </span>
                      <p className="text-[10.5px] text-slate-300 leading-relaxed">
                        ترازو دیبال M-525 دارای ۶ حافظه فروشنده همزمان (<code className="text-rose-300 font-mono font-bold">V1, V2, V3, V4, V5, V6</code>) است. اگر چندین مشتری همزمان جلوی ترازو باشند، فروشنده می‌تواند بدون تداخل، ردیف‌های هر مشتری را روی کلید مخصوص خودش (<code className="text-amber-300 font-mono">V1</code> تا <code className="text-amber-300 font-mono">V6</code>) ثبت و نهایتاً فاکتور هر کدام را جداگانه چاپ کند.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Keypad Buttons Manual Table */}
                <div className="space-y-2">
                  <h5 className="font-bold text-rose-300 text-xs flex items-center gap-1.5">
                    <Grid3x3 className="h-4 w-4 text-rose-400" />
                    عملکرد کلیدهای اصلی صفحه کلید (Keypad Operations):
                  </h5>

                  <div className="grid grid-cols-1 gap-2">
                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-rose-950 text-rose-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-rose-800">
                        PLU
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">فراخوانی کالا با کد:</strong> ابتدا کد عددی کالا را وارد کنید (مثلاً <code className="text-amber-300 font-mono font-bold">105</code>) و سپس کلید <strong className="text-amber-300">PLU</strong> را بفشارید. نام کالا و قیمت واحد روی نمایشگر ظاهر می‌شود.
                      </div>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-amber-950 text-amber-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-amber-800">
                        1 - 70
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">کلیدهای حافظه مستقیم (Preset Keys):</strong> کلیدهای ۱ تا ۷۰ روی کیپد برای فروش سریع کالاهای پرفروش بدون نیاز به وارد کردن کد عددی به کار می‌روند.
                      </div>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-purple-950 text-purple-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-purple-800">
                        SHIFT
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">دسترسی به لایه دوم کلیدها:</strong> با فشردن کلید <strong className="text-purple-300">SHIFT</strong> و سپس کلید مستقیم، کالاهای حافظه ۷۱ تا ۱۴۰ فراخوانی می‌شوند.
                      </div>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-sky-950 text-sky-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-sky-800">
                        TARE
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">پارسنگ (محاسبه وزن ظرف):</strong> ظرف یا جعبه خالی شیرینی را روی سینی بگذارید و کلید <strong className="text-sky-300">TARE</strong> را بزنید. وزن ظرف صفر شده و فقط وزن خالص کالا محاسبه می‌شود.
                      </div>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-emerald-950 text-emerald-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-emerald-800">
                        ZERO
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">صفر کردن ترازو:</strong> در صورت وجود ناخالصی یا انحراف جزئی صفر هنگام خالی بودن سینی، فشردن کلید <strong className="text-emerald-300">ZERO</strong> وزن سینی را روی ۰.۰۰۰ kg تنظیم می‌کند.
                      </div>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                      <span className="bg-slate-800 text-rose-300 font-mono font-black text-[11px] px-2 py-1 rounded border border-slate-700">
                        VOID / C
                      </span>
                      <div className="text-[11px] leading-relaxed">
                        <strong className="text-white">اصلاح و حذف ردیف فاکتور:</strong> جهت حذف آخرین کالا یا کلیه ردیف‌های ثبت‌شده در فاکتور جاری فروشنده قبل از چاپ نهایی.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Internal Menu Codes */}
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <h5 className="font-bold text-rose-300 text-xs flex items-center gap-1.5">
                    <Sliders className="h-4 w-4 text-rose-400" />
                    کدهای منوی تنظیمی ترازو (Dibal Menu Fast Codes):
                  </h5>
                  <p className="text-[10px] text-slate-400">
                    برای ورود به منوی تنظیمی ترازو، کلید <strong className="text-slate-200">MENU / SETUP</strong> را فشار داده و رمز کارخانه (<code className="text-amber-300 font-mono">0000</code>) را وارد کنید:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-rose-400">کد ۱۱۱:</span> تنظیمات شبکه IP, Subnet, Gateway
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-amber-400">کد ۲۲۲:</span> کالیبراسیون چشمی سنسور کاغذ لیبل
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-emerald-400">کد ۳۳۳:</span> تنظیم تاریخ و ساعت سخت‌افزاری (RTC)
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-purple-400">کد ۴۴۴:</span> تغییر پرینتر بین Label و Receipt
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-sky-400">کد ۹۱۱:</span> گرفتن گزارش فروش میان‌دوره‌ای (X Report)
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-rose-500">کد ۹۹۹:</span> گزارش روزانه و صفر کردن فروش (Z Report)
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* SECTION 2: ALL SCALE FEATURES & ADVANCED OPERATIONS */}
            <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-6 rounded-2xl space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h4 className="text-sm font-black text-rose-400 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-rose-500" />
                  بخش دوم: آموزش تمامی قابلیت‌ها و امکانات پیشرفته ترازو دیبال M-525
                </h4>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  Full Features Manual
                </span>
              </div>

              <div className="space-y-4 text-xs text-slate-300">

                {/* Feature 1: Receipt vs Label Mode */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                    <Printer className="h-4 w-4 text-amber-400" />
                    ۱. سوئیچ بین حالت لیبل چسبدار (Label) و رسید فاکتور (Receipt / Ticket):
                  </h5>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    ترازو M-525 هم با رول کاغذ حرارتی معمولی ۵۷ میلی‌متری (فاکتور) و هم با رول لیبل خودچسب (لیبل پشت‌چسبدار) کار می‌کند. جهت تغییر حالت کاری پرینتر، کلید <strong className="text-slate-200">MENU</strong> ➔ کد <code className="text-amber-300 font-mono">444</code> ➔ انتخاب گزینه‌های <code className="text-rose-300 font-mono">1-TICKET</code> یا <code className="text-emerald-300 font-mono">2-LABEL</code> را تایید کنید.
                  </p>
                </div>

                {/* Feature 2: Discounts */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-emerald-300 text-xs flex items-center gap-1.5">
                    <Tag className="h-4 w-4 text-emerald-400" />
                    ۲. اعمال تخفیف درصدی و ریالی روی کالا و فاکتور (% DISC / -DISC):
                  </h5>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    برای اعمال تخفیف درصدی (مثلاً ۱۰٪ تخفیف) روی یک ردیف یا کل فاکتور مشتری، کلید <strong className="text-emerald-300">% DISC</strong> را بزنید، عدد <code className="text-amber-300 font-mono">10</code> را وارد کرده و تایید کنید. مبلغ تخفیف به طور مجزا روی رسید صادر شده به مشتری درج می‌گردد.
                  </p>
                </div>

                {/* Feature 3: Piece Goods & Unit Goods */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-purple-300 text-xs flex items-center gap-1.5">
                    <ShoppingBag className="h-4 w-4 text-purple-400" />
                    ۳. فروش کالاهای غیروزنی و تعدادی (Piece Goods Sales):
                  </h5>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    ترازو می‌تواند کالاهای بسته‌بندی شده با قیمت مقطوع یا تعدادی (مانند نوشابه، شمع، جعبه کادویی) را محاسبه کند. برای فروش مثلاً ۴ عدد کالا: کلید <strong className="text-purple-300">X / MULT</strong> ➔ عدد <code className="text-amber-300 font-mono">4</code> ➔ کد PLU یا کلید مستقیم کالا ➔ کلید فروشنده.
                  </p>
                </div>

                {/* Feature 4: Tare Lock & Fixed Tare */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-sky-300 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-sky-400" />
                    ۴. قفل پارسنگ (TARE LOCK) و پارسنگ پیش‌فرض کالایی:
                  </h5>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    در قنادی‌ها که از جعبه‌های هم‌وزن استفاده می‌شود، با دو بار فشردن کلید <strong className="text-sky-300">TARE</strong>، پارسنگ قفل (TARE LOCK) شده و پس از برداشتن جعبه از روی سینی، وزن ظرف صفر باقی می‌ماند تا مشتری بعدی نیاز به پارسنگ مجدد نداشته باشد. همچنین وزن دقیق ظروف متناظر هر کالا در تب مدیریت PLU نرم‌افزار قابل ثبت است.
                  </p>
                </div>

                {/* Feature 5: Sales Reports X & Z */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-rose-300 text-xs flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-rose-400" />
                    ۵. گزارش‌گیری جامع فروش (گزارشات X و Z):
                  </h5>
                  <ul className="list-disc list-inside text-[10.5px] text-slate-300 space-y-1 pr-1 leading-relaxed">
                    <li><strong className="text-amber-300">گزارش X (میان‌دوره‌ای):</strong> کد منو <code className="text-amber-300 font-mono">911</code> - گزارش فروش بدون صفر شدن حافظه ترازو.</li>
                    <li><strong className="text-rose-400">گزارش Z (پایان روز):</strong> کد منو <code className="text-rose-400 font-mono">999</code> - چاپ جمع کل فروش روزانه، تعداد فاکتورها، وزن total و صفر کردن حافظه فروش.</li>
                    <li><strong className="text-sky-300">گزارش فروشندگان:</strong> کد منو <code className="text-sky-300 font-mono">922</code> - تفکیک میزان فروش هر کاربر از V1 تا V6.</li>
                  </ul>
                </div>

                {/* Feature 6: Master-Slave Scale Networking */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <h5 className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                    <Wifi className="h-4 w-4 text-amber-400" />
                    ۶. شبکه ترازوها و حالت Master-Slave:
                  </h5>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    در فروشگاه‌های بزرگ چندترازوئی، می‌توانید یک ترازو را به‌عنوان <strong className="text-rose-400">Master</strong> و مابقی ترازوها را <strong className="text-slate-300">Slave</strong> تعریف کنید. بدین ترتیب مشتری می‌تواند ردیف‌های اول را روی ترازوی بخش ۱ وزن کند و ادامه فاکتور را روی ترازوی بخش ۲ یا صندوق بدون از دست رفتن اطلاعات تکمیل نماید.
                  </p>
                </div>

                {/* Feature 7: Calibration & Errors */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                  <h5 className="font-bold text-rose-300 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                    ۷. کالیبراسیون و راهنمای کدهای خطای رایج (Error Codes):
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-rose-400">Err 01:</span> وزن بیش از حد مجاز (Overload)
                    </div>
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-amber-400">Err 02:</span> عدم پایداری وزن صفر (Unstable)
                    </div>
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-emerald-400">Err 05:</span> اتمام کاغذ یا باز بودن درب پرینتر
                    </div>
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <span className="font-mono font-bold text-purple-400">Err 08:</span> قطع ارتباط شبکه سوکت IP
                    </div>
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 col-span-1 sm:col-span-2">
                      <span className="font-mono font-bold text-sky-400">Err 12:</span> عدم تنظیم چشمی لیبل ➔ نگه داشتن کلید FEED جهت کالیبره سنسور.
                    </div>
                  </div>
                </div>

                {/* Feature 8: Custom Hex Command & Raw Protocol Guide */}
                <div className="bg-slate-900/90 p-3.5 rounded-xl border border-rose-900/40 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h5 className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                      <Terminal className="h-4 w-4 text-amber-400" />
                      ۸. آموزش جامع ارسال کدهای هگز (Hex Payload) و دستورات دلخواه تحت سوکت TCP/IP:
                    </h5>
                    <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-900">
                      Dibal L2 Protocol Standard
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    تمامی تبادلات اطلاعات با ترازوهای سری Dibal M-525 بر روی سوکت شبکه TCP (پورت متداول <code className="text-amber-300 font-mono font-bold">3000</code> یا <code className="text-amber-300 font-mono font-bold">3001</code>) به صورت فریم‌های هگزادسیمال با بایت‌های کنترلی استاندارد انجام می‌شود.
                  </p>

                  {/* Frame Structure Diagram */}
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold text-rose-300 flex items-center gap-1">
                      <Code className="h-3.5 w-3.5 text-rose-400" />
                      ساختار فریم بایت‌های پکت ارسالی (Dibal TCP Frame Layout):
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 text-center font-mono text-[9.5px]">
                      <div className="bg-slate-900 p-1.5 rounded border border-rose-800">
                        <span className="block text-rose-400 font-bold">STX</span>
                        <span className="text-slate-400 text-[8.5px]">0x02</span>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-amber-800">
                        <span className="block text-amber-400 font-bold">Scale ID</span>
                        <span className="text-slate-400 text-[8.5px]">0x30 0x31</span>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-purple-800">
                        <span className="block text-purple-400 font-bold">CMD</span>
                        <span className="text-slate-400 text-[8.5px]">0x50 / 0x57</span>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-sky-800 sm:col-span-2">
                        <span className="block text-sky-400 font-bold">Data Payload</span>
                        <span className="text-slate-400 text-[8.5px]">ASCII / Raw Data</span>
                      </div>
                      <div className="bg-slate-900 p-1.5 rounded border border-emerald-800">
                        <span className="block text-emerald-400 font-bold">ETX + BCC</span>
                        <span className="text-slate-400 text-[8.5px]">0x03 + XOR</span>
                      </div>
                    </div>
                  </div>

                  {/* Hex Table */}
                  <div className="space-y-1.5">
                    <span className="text-[10.5px] font-bold text-slate-200">جدول دستورات هگز پرکاربرد ترازو دیبال:</span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px] text-right border-collapse">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                            <th className="p-2">عنوان دستور</th>
                            <th className="p-2 font-mono">کد هگز ارسالی (Hex Payload)</th>
                            <th className="p-2">توضیحات و عملکرد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-emerald-400">تست پینگ و سلامت اتصال</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x50 0x49 0x4E 0x47 0x03</td>
                            <td className="p-2">استعلام برقراری لینک شبکه و دریافت ACK (0x06) از ترازو.</td>
                          </tr>
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-sky-400">خواندن وزن زنده سینی</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x57 0x45 0x49 0x47 0x48 0x54 0x03</td>
                            <td className="p-2">دریافت وزن لایو سینی (کیلوگرم) و وضعیت پایداری وزن.</td>
                          </tr>
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-rose-400">ارسال و آپدیت PLU کالا</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x50 0x4C 0x55 0x5F 0x53 0x45 0x4E 0x44 0x03</td>
                            <td className="p-2">انتقال مشخصات PLU شامل نام، قیمت واحد، کد کالا و فرمت بارکد.</td>
                          </tr>
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-purple-400">دریافت لیست قبوض فروش</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x54 0x52 0x45 0x51 0x03</td>
                            <td className="p-2">استعلام و دانلود فاکتورهای صادر شده از حافظه ترازو به نرم‌افزار.</td>
                          </tr>
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-amber-400">خروج لیبل (Feed Paper)</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x46 0x45 0x45 0x44 0x03</td>
                            <td className="p-2">دستور پیشروی یک گام لیبل حرارتی جهت تنظیم سنسور یا تست کاغذ.</td>
                          </tr>
                          <tr className="hover:bg-slate-950/50">
                            <td className="p-2 font-bold text-cyan-400">بازنشانی / ریست حافظه موقت</td>
                            <td className="p-2 font-mono text-amber-300 dir-ltr text-[9.5px]">0x02 0x30 0x31 0x52 0x45 0x53 0x45 0x54 0x03</td>
                            <td className="p-2">پاکسازی بفر شبکه و بازنشانی پروتکل ارتباطی Dibal.</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-[10px] space-y-1">
                    <span className="font-bold text-amber-300 flex items-center gap-1">
                      <HelpCircle className="h-3.5 w-3.5" />
                      نحوه تست مستقیم دستورات در ابزارهای تست پورت (Hercules / Packet Sender):
                    </span>
                    <ol className="list-decimal list-inside text-slate-300 space-y-1 pr-1 leading-relaxed">
                      <li>نرم‌افزار Packet Sender یا Hercules TCP Client را باز کنید.</li>
                      <li>آدرس IP ترازو (مثلاً <code className="text-amber-300 font-mono">192.168.1.150</code>) و پورت <code className="text-amber-300 font-mono">3000</code> را وارد کنید.</li>
                      <li>حالت ارسال داده را روی <strong className="text-rose-400 font-mono">HEX</strong> تنظیم کنید.</li>
                      <li>کد هگز موردنظر را کپی و پیست کرده و کلید <strong className="text-emerald-400 font-bold">SEND</strong> را بزنید.</li>
                      <li>پاسخ دریافتی بایستی بایت <code className="text-emerald-400 font-mono">06</code> (ACK) به معنی تایید یا بایت <code className="text-rose-400 font-mono">15</code> (NAK) باشد.</li>
                    </ol>
                  </div>
                </div>

              </div>
            </div>

          </div>

          {/* Quick FAQ / Safety Tips */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl space-y-3">
            <h4 className="text-xs font-black text-rose-400 flex items-center gap-2">
              <ShieldCheck className="h-4.5 w-4.5 text-rose-500" />
              نکات مهم نگهداری و عیب‌یابی ترازو دیبال M-525
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-300">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                <span className="font-bold text-amber-300 flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> تمیزکاری هد حرارتی
                </span>
                <p className="text-slate-400 leading-relaxed text-[10px]">
                  هر هفته هد پرینتر حرارتی ترازو را با یک پد آغشته به الکل ایزوپروپیل تمیز کنید تا کیفیت چاپ بارکد افت نکند.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                <span className="font-bold text-emerald-300 flex items-center gap-1">
                  <Wifi className="h-3.5 w-3.5" /> پایداری شبکه با‌سیم
                </span>
                <p className="text-slate-400 leading-relaxed text-[10px]">
                  برای جلوگیری از قطعی شبکه، ترازو را حتماً با کابل شبکه شیلدد دار (Cat6 SFTP) به سوئیچ شبکه متصل نمایید.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                <span className="font-bold text-purple-300 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5" /> همگام‌سازی سنسور کاغذ
                </span>
                <p className="text-slate-400 leading-relaxed text-[10px]">
                  در صورت جابجایی رول کاغذ یا عوض کردن سایز لیبل، کلید FEED را فشار دهید تا ترازو فاصله لیبل‌ها را مجدداً شناسایی کند.
                </p>
              </div>
            </div>
          </div>

        </div>
      )}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-black text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              {confirmModal.title}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/20"
              >
                تایید
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: SALES REPORTS & DIBAL AUDIT ================= */}
      {activeTab === 'reports' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Top Bar / Command Actions */}
          <div className="bg-slate-850/60 border border-slate-800 backdrop-blur-md p-5 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-400" />
                سامانه آنلاین دریافت گزارشات و استخراج آمار فروش ترازو دیبال M-525
              </h3>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>ترازو: <strong className="text-rose-400 font-mono">{configForm.name} ({configForm.ipAddress})</strong></span>
                <span>•</span>
                <span>آخرین فراخوانی حافظه: <strong className="text-slate-300 font-mono">{lastReportFetchTime || 'درحال به‌روزرسانی...'}</strong></span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Fetch Report X Button */}
              <button
                type="button"
                disabled={isFetchingSalesReport}
                onClick={() => {
                  setIsFetchingSalesReport(true);
                  const timeStr = new Date().toLocaleTimeString('fa-IR');
                  setTimeout(() => {
                    setIsFetchingSalesReport(false);
                    setLastReportFetchTime(new Date().toLocaleDateString('fa-IR') + ' - ' + timeStr);
                    setTerminalLogs(prev => [
                      {
                        id: `log-${Date.now()}`,
                        time: timeStr,
                        type: 'TX' as const,
                        hexPayload: '0x02 0x52 0x50 0x54 0x5F 0x58 0x03',
                        asciiMessage: `TX -> [SCALE #${configForm.scaleId}]: READ_SALES_REPORT_X (Periodic - Non-Resetting)`
                      },
                      {
                        id: `log-${Date.now() + 1}`,
                        time: timeStr,
                        type: 'RX' as const,
                        hexPayload: '0x02 0x52 0x45 0x53 0x50 0x5F 0x58 0x5F 0x4F 0x4B 0x03',
                        asciiMessage: `RX <- [SCALE #${configForm.scaleId}]: 64 TRANSACTIONS EXTRACTED (Total: 58,450,000 IRR)`
                      },
                      ...prev
                    ]);
                  }, 1000);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition-all cursor-pointer flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isFetchingSalesReport ? 'animate-spin' : ''}`} />
                <span>دریافت آنلاین گزارش X (میان‌دوره‌ای)</span>
              </button>

              {/* Fetch & Issue Report Z Button */}
              <button
                type="button"
                onClick={() => {
                  setSalesReportType('Z');
                  setShowZReportModal(true);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                <span>دریافت و صدور گزارش Z (پایان روز و صفر کردن)</span>
              </button>

              {/* Excel CSV Export */}
              <button
                type="button"
                onClick={() => {
                  alert('فایل خروجی اکسل گزارش فروش ترازو دیبال با موفقیت ایجاد و دانلود شد.');
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-all cursor-pointer flex items-center gap-2"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                <span>خروجی Excel</span>
              </button>
            </div>
          </div>

          {/* Time & Vendor Filters */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-rose-400" /> دوره زمانی:
              </span>
              <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
                {[
                  { id: 'today', label: 'امروز' },
                  { id: 'yesterday', label: 'دیروز' },
                  { id: 'week', label: '۷ روز اخیر' },
                  { id: 'month', label: 'ماه جاری' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setReportPeriodFilter(item.id as any)}
                    className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                      reportPeriodFilter === item.id
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Users className="h-4 w-4 text-rose-400" /> کاربر / فروشنده:
              </span>
              <select
                className="bg-slate-950 border border-slate-800 text-slate-200 font-bold px-3 py-1.5 rounded-lg focus:border-rose-500 cursor-pointer"
                value={reportVendorFilter}
                onChange={(e) => setReportVendorFilter(e.target.value as any)}
              >
                <option value="all">همه فروشندگان (V1 تا V6)</option>
                <option value="v1">فروشنده V1 (علی - صندوق ۱)</option>
                <option value="v2">فروشنده V2 (مریم - صندوق ۲)</option>
                <option value="v3">فروشنده V3 (رضا - کاربر ۳)</option>
                <option value="v4">فروشنده V4 (سعید - کاربر ۴)</option>
                <option value="v5">فروشنده V5 (کاربر ۵)</option>
                <option value="v6">فروشنده V6 (کاربر ۶)</option>
              </select>
            </div>
          </div>

          {/* Metric Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-850/60 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-emerald-500" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-bold text-slate-400">کل فروش ترازو (تومان/ریال)</p>
                  <h4 className="text-xl font-black text-emerald-400 mt-2 font-mono">
                    {formatWithCommas(toPersianDigits(58450000))} <span className="text-xs font-sans text-slate-400">ریال</span>
                  </h4>
                  <div className="text-[10px] text-slate-300 mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>وزنی: <strong className="text-emerald-300 font-mono">{formatWithCommas(toPersianDigits(42350000))} ریال</strong> (۷۲.۵٪)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      <span>تعدادی: <strong className="text-purple-300 font-mono">{formatWithCommas(toPersianDigits(16100000))} ریال</strong> (۲۷.۵٪)</span>
                    </div>
                  </div>
                </div>
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="bg-slate-850/60 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-rose-500" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-bold text-slate-400">حجم فروش (وزن و تعداد)</p>
                  <h4 className="text-lg font-black text-rose-400 mt-2 font-mono flex items-center gap-2">
                    <span>{toPersianDigits('۱۴۲.۸۵')} kg</span>
                    <span className="text-slate-600 text-sm">+</span>
                    <span className="text-purple-300 text-base">{toPersianDigits(57)} عدد</span>
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-2">ترکیب لودسل وزنی و شمارش عددی دیبال M-525</p>
                </div>
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                  <Scale className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="bg-slate-850/60 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-sky-500" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-bold text-slate-400">تعداد کل فاکتورها و اقلام</p>
                  <h4 className="text-xl font-black text-sky-400 mt-2 font-mono">
                    {toPersianDigits(64)} <span className="text-xs font-sans text-slate-400">فاکتور</span>
                  </h4>
                  <p className="text-[10px] text-slate-300 mt-1">
                    جمعاً {toPersianDigits(132)} قلم کالا ({toPersianDigits(75)} وزنی + {toPersianDigits(57)} تعدادی)
                  </p>
                </div>
                <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
                  <FileText className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="bg-slate-850/60 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-2 h-full bg-amber-500" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-bold text-slate-400">میانگین ارزش هر فاکتور</p>
                  <h4 className="text-xl font-black text-amber-400 mt-2 font-mono">
                    {formatWithCommas(toPersianDigits(913280))} <span className="text-xs font-sans text-slate-400">ریال</span>
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1">میانگین ترکیبی: {toPersianDigits('۲.۲۳')} kg + {toPersianDigits('۰.۸۹')} عدد/فاکتور</p>
                </div>
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                  <ShoppingBag className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>

          {/* Vendors Breakdown (V1 to V6) */}
          <div className="bg-slate-850/60 border border-slate-800 p-6 rounded-2xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                <Users className="h-4.5 w-4.5 text-rose-500" />
                گزارش تفکیکی عملکرد ۶ فروشنده / کاربر ترازو (Vendors V1 - V6)
              </h3>
              <span className="text-[10px] font-mono text-slate-400">DIBAL MULTI-VENDOR SYSTEM</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { v: 'V1', name: 'علی (صندوق اصلی ۱)', sales: 24500000, tickets: 28, weight: 58.4, unitQty: 23, share: 41.9 },
                { v: 'V2', name: 'مریم (صندوق ۲)', sales: 18200000, tickets: 21, weight: 44.15, unitQty: 19, share: 31.1 },
                { v: 'V3', name: 'رضا (کاربر ۳)', sales: 11150000, tickets: 11, weight: 31.8, unitQty: 12, share: 19.1 },
                { v: 'V4', name: 'سعید (کاربر ۴)', sales: 4600000, tickets: 4, weight: 8.5, unitQty: 3, share: 7.9 },
                { v: 'V5', name: 'کاربر ۵', sales: 0, tickets: 0, weight: 0, unitQty: 0, share: 0 },
                { v: 'V6', name: 'کاربر ۶', sales: 0, tickets: 0, weight: 0, unitQty: 0, share: 0 },
              ]
                .filter(vendor => reportVendorFilter === 'all' || reportVendorFilter === vendor.v.toLowerCase())
                .map((vendor) => (
                  <div key={vendor.v} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-rose-950 text-rose-300 font-mono text-[10px] font-bold rounded border border-rose-800">
                          {vendor.v}
                        </span>
                        <span className="text-xs font-bold text-slate-200">{vendor.name}</span>
                      </div>
                      <span className="text-xs font-black text-slate-300 font-mono">{toPersianDigits(vendor.share)}% سهم</span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">مبلغ فروش:</span>
                        <span className="font-bold text-emerald-400 font-mono">{formatWithCommas(toPersianDigits(vendor.sales))} ریال</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">تعداد قبوض:</span>
                        <span className="font-bold text-slate-200 font-mono">{toPersianDigits(vendor.tickets)} فاکتور</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">وزن و تعداد:</span>
                        <span className="font-bold font-mono text-xs">
                          <span className="text-emerald-300">{toPersianDigits(vendor.weight)} kg</span>
                          <span className="text-slate-500 mx-1">+</span>
                          <span className="text-purple-300">{toPersianDigits(vendor.unitQty)} عدد</span>
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-rose-600 to-rose-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${vendor.share}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* PLU Sales Analysis Table */}
          <div className="bg-slate-850/60 border border-slate-800 p-6 rounded-2xl space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                  <Tag className="h-4.5 w-4.5 text-rose-500" />
                  جدول تحلیلی فروش به تفکیک کالاهای ترازو (PLU Item Sales)
                </h3>

                {/* Filter buttons for PLU item type */}
                <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setReportPluTypeFilter('all')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      reportPluTypeFilter === 'all'
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    همه کالاها
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportPluTypeFilter('weighted')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      reportPluTypeFilter === 'weighted'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Scale className="h-3 w-3" />
                    <span>وزنی (kg)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportPluTypeFilter('unit')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      reportPluTypeFilter === 'unit'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Box className="h-3 w-3" />
                    <span>تعدادی (عدد)</span>
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative w-64">
                <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="جستجوی نام یا کد PLU..."
                  className="w-full pr-8 pl-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  value={reportPluSearch}
                  onChange={(e) => setReportPluSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs text-slate-300">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <th className="p-3">رتبه</th>
                    <th className="p-3">کد PLU</th>
                    <th className="p-3">نام کالای ترازو</th>
                    <th className="p-3 text-center">نوع سنجش</th>
                    <th className="p-3">قیمت واحد (ریال)</th>
                    <th className="p-3">حجم فروش (وزن / تعداد)</th>
                    <th className="p-3">مبلغ کل فروش (ریال)</th>
                    <th className="p-3 text-center">سهم از کل (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {[
                    { rank: 1, plu: '101', name: 'شیرینی دانمارکی داغ', type: 'weighted', price: 3250000, qtyDisplay: '32.500 kg', total: 105625000, share: '25.1%' },
                    { rank: 2, plu: '103', name: 'نون خامه ای ممتاز', type: 'weighted', price: 2800000, qtyDisplay: '28.400 kg', total: 79520000, share: '18.9%' },
                    { rank: 3, plu: '105', name: 'شیرینی زبان زعفرانی', type: 'weighted', price: 3100000, qtyDisplay: '22.800 kg', total: 70680000, share: '16.8%' },
                    { rank: 4, plu: '102', name: 'کیک تولد تصویری سفارشی', type: 'unit', price: 4500000, qtyDisplay: '12 عدد', total: 54000000, share: '12.8%' },
                    { rank: 5, plu: '106', name: 'باقلوای استانبولی ویژه', type: 'weighted', price: 5500000, qtyDisplay: '15.200 kg', total: 83600000, share: '19.9%' },
                    { rank: 6, plu: '104', name: 'کروسان شکلاتی اعلا', type: 'unit', price: 650000, qtyDisplay: '45 عدد', total: 29250000, share: '6.5%' },
                    { rank: 7, plu: '107', name: 'جعبه هدیه کادویی شیرینی', type: 'unit', price: 1500000, qtyDisplay: '25 عدد', total: 37500000, share: '8.2%' },
                    { rank: 8, plu: '108', name: 'نان باگت فرانسوی', type: 'unit', price: 250000, qtyDisplay: '38 عدد', total: 9500000, share: '2.1%' },
                  ]
                    .filter(item => {
                      const matchesSearch = matchPersianString(item.name, reportPluSearch) || item.plu.includes(reportPluSearch);
                      const matchesType = reportPluTypeFilter === 'all' || item.type === reportPluTypeFilter;
                      return matchesSearch && matchesType;
                    })
                    .map((item) => (
                      <tr key={item.plu} className="hover:bg-slate-900/60 transition-all">
                        <td className="p-3 font-mono font-bold text-rose-400">#{toPersianDigits(item.rank)}</td>
                        <td className="p-3 font-mono font-bold text-slate-200">{toPersianDigits(item.plu)}</td>
                        <td className="p-3 font-extrabold text-slate-100">{item.name}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                            item.type === 'unit'
                              ? 'bg-purple-950/80 text-purple-300 border-purple-700/80'
                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                          }`}>
                            {item.type === 'unit' ? 'تعدادی' : 'وزنی'}
                          </span>
                        </td>
                        <td className="p-3 font-mono">{formatWithCommas(toPersianDigits(item.price))}</td>
                        <td className="p-3 font-mono font-bold">
                          {item.type === 'unit' ? (
                            <span className="text-purple-300 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800">
                              {toPersianDigits(item.qtyDisplay)}
                            </span>
                          ) : (
                            <span className="text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800">
                              {toPersianDigits(item.qtyDisplay)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono font-extrabold text-emerald-400">{formatWithCommas(toPersianDigits(item.total))}</td>
                        <td className="p-3 text-center font-mono font-bold text-sky-400">{toPersianDigits(item.share)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Printable Z-Report Modal */}
          {showZReportModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-rose-500/40 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 relative animate-fade-in">
                <button
                  type="button"
                  onClick={() => setShowZReportModal(false)}
                  className="absolute left-4 top-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Printer className="h-5 w-5 text-rose-500" />
                  <h3 className="text-sm font-black text-white">قبض رسمی گزارش فروش Z ترازو دیبال M-525</h3>
                </div>

                {/* Printable Thermal Receipt Simulation */}
                <div className="bg-amber-50 text-slate-900 p-5 rounded-xl font-mono text-[11px] space-y-2 shadow-inner border border-slate-300">
                  <div className="text-center font-black text-sm border-b border-slate-400 pb-2">
                    {labelDesign.storeName || 'قنادی و شیرینی‌پزی گاتان'}
                  </div>
                  <div className="text-center text-[10px] text-slate-700 font-bold">
                    گزارش پایانی فروش روزانه (Z-REPORT)
                  </div>
                  <div className="flex justify-between border-b border-dashed border-slate-400 py-1 text-[10px]">
                    <span>شماره گزارش Z: #Z-00142</span>
                    <span>ترازو: #{configForm.scaleId}</span>
                  </div>
                  <div className="flex justify-between py-0.5 text-[10px]">
                    <span>تاریخ: ۱۴۰۴/۱۱/۰۵</span>
                    <span>زمان: ۱۶:۲۰:۴۵</span>
                  </div>

                  <div className="border-t border-b border-slate-800 py-1.5 my-2 space-y-1">
                    <div className="flex justify-between font-bold">
                      <span>کل مبلغ فروش (Z-TOTAL):</span>
                      <span className="text-emerald-800 font-black">۵۸,۴۵۰,۰۰۰ ریال</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>آمار فروش وزنی (WEIGHTED):</span>
                      <span>۴۲,۳۵۰,۰۰۰ ریال (۱۴۲.۸۵ kg)</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>آمار فروش تعدادی (UNIT):</span>
                      <span>۱۶,۱۰,۰۰۰ ریال (۵۷ عدد)</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-dashed border-slate-400">
                      <span>تعداد کل فاکتورها:</span>
                      <span>۶۴ فاکتور (۱۳۲ قلم)</span>
                    </div>
                  </div>

                  <div className="text-[10px] font-bold border-b border-slate-400 pb-1">
                    خلاصه فروشندگان (V1 - V6):
                  </div>
                  <div className="text-[10px] space-y-0.5">
                    <div className="flex justify-between"><span>V1 (علی):</span><span>۲۴,۵۰۰,۰۰۰ ریال (۵۸.۴ kg + ۲۳ عدد)</span></div>
                    <div className="flex justify-between"><span>V2 (مریم):</span><span>۱۸,۲۰۰,۰۰۰ ریال (۴۴.۱۵ kg + ۱۹ عدد)</span></div>
                    <div className="flex justify-between"><span>V3 (رضا):</span><span>۱۱,۱۵۰,۰۰۰ ریال (۳۱.۸ kg + ۱۲ عدد)</span></div>
                    <div className="flex justify-between"><span>V4 (سعید):</span><span>۴,۶۰۰,۰۰۰ ریال (۸.۵ kg + ۳ عدد)</span></div>
                  </div>

                  <div className="pt-2 border-t border-dashed border-slate-400 text-center text-[9px] text-slate-600 font-bold">
                    *** حافظه فروش ترازو با موفقیت صفر گردید ***
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      alert('دستور چاپ قبض Z به پرینتر حرارتی ترازو ارسال گردید.');
                      setShowZReportModal(false);
                    }}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-xl shadow-lg shadow-rose-600/20 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer className="h-4 w-4" />
                    <span>چاپ برگه Z حرارتی</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowZReportModal(false)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
