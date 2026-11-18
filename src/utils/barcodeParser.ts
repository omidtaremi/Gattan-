import { Product, BarcodeSettings, BarcodeProfile } from '../types';

export interface ParsedBarcodeResult {
  rawBarcode: string;
  isVariable: boolean;
  type: 'weighted' | 'count' | 'simple' | 'unknown';
  prefix?: string;
  itemCode?: string;
  extractedWeightKg?: number; // وزن خالص استخراج شده برحسب کیلوگرم
  extractedWeightGram?: number; // وزن به گرم
  extractedCount?: number; // تعداد عددی
  checkDigit?: string;
  matchedProduct?: Product;
  matchedProfile?: BarcodeProfile;
  error?: string;
}

export const DEFAULT_BARCODE_PROFILES: BarcodeProfile[] = [
  {
    id: 'prof-dibal-weighted-ean13',
    name: 'ترازوی دیبال (EAN-13 وزنی برحسب گرم)',
    type: 'weighted',
    symbology: 'EAN-13',
    prefix: '20',
    itemCodeLength: 5,
    valueLength: 5,
    hasCheckDigit: true,
    unitMultiplier: 1000, // گرم به کیلوگرم
    description: 'فرمت استاندارد 20CCCCWWWWWC (پیش‌کد 20، 5 رقم کد کالا، 5 رقم وزن به گرم، 1 رقم چک‌سام)',
    isDefault: true,
    patternSample: '20 00123 01500 4 (کد ۱۲۳ با وزن ۱.۵۰۰ کیلوگرم)'
  },
  {
    id: 'prof-dibal-weighted-alt-ean13',
    name: 'ترازوی دیبال ۲ (EAN-13 با پیش‌کد ۲۱)',
    type: 'weighted',
    symbology: 'EAN-13',
    prefix: '21',
    itemCodeLength: 5,
    valueLength: 5,
    hasCheckDigit: true,
    unitMultiplier: 1000,
    description: 'فرمت پیش‌کد جایگزین ۲۱ برای غرفه‌ها یا ترازوهای سری دوم',
    isDefault: false,
    patternSample: '21 00045 00750 8 (کد ۴۵ با وزن ۷۵۰ گرم)'
  },
  {
    id: 'prof-dibal-count-ean13',
    name: 'ترازوی دیبال (EAN-13 تعدادی / بسته‌ای)',
    type: 'count',
    symbology: 'EAN-13',
    prefix: '22',
    itemCodeLength: 5,
    valueLength: 5,
    hasCheckDigit: true,
    unitMultiplier: 1,
    description: 'فرمت استاندارد 22CCCCQQQQQC (پیش‌کد 22، 5 رقم کد کالا، 5 رقم تعداد عددی)',
    isDefault: true,
    patternSample: '22 00088 00004 2 (کد ۸۸ با تعداد ۴ عدد/بسته)'
  },
  {
    id: 'prof-simple-ean13',
    name: 'بارکد ثابت شرکتی (EAN-13 / EAN-8 / Code-128)',
    type: 'simple',
    symbology: 'EAN-13',
    prefix: '',
    itemCodeLength: 13,
    valueLength: 0,
    hasCheckDigit: true,
    unitMultiplier: 1,
    description: 'بارکد ثابت چاپی روی بسته‌بندی کالا بدون داده متغیر وزن',
    isDefault: true,
    patternSample: '6260123456789 (بارکد استاندارد کالا)'
  }
];

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  defaultWeightedPrefix: '20',
  defaultCountPrefix: '22',
  defaultSimpleLength: 13,
  autoParseOnScan: true,
  enableSoundOnScan: true,
  profiles: DEFAULT_BARCODE_PROFILES
};

// تابع محاسبه Check Digit الگوریتم EAN-13
export function calculateEAN13CheckDigit(code12Digits: string): number {
  if (code12Digits.length < 12) return 0;
  const digits = code12Digits.slice(0, 12).split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += i % 2 === 0 ? digits[i] : digits[i] * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

// تابع ساخت بارکد نمونه وزنی ترازوی دیبال
export function generateSampleDibalBarcode(
  itemCode: string | number,
  weightInGramsOrCount: number,
  type: 'weighted' | 'count' = 'weighted',
  prefix: string = type === 'weighted' ? '20' : '22'
): string {
  const cleanItem = String(itemCode).replace(/\D/g, '').padStart(5, '0').slice(-5);
  const cleanVal = String(Math.round(weightInGramsOrCount)).replace(/\D/g, '').padStart(5, '0').slice(-5);
  const base12 = `${prefix}${cleanItem}${cleanVal}`;
  const checkDigit = calculateEAN13CheckDigit(base12);
  return `${base12}${checkDigit}`;
}

// تابع آنالیزور و دیکودر جامع بارکد ورودی با تطبیق کاتالوگ محصولات
export function parseScannedBarcode(
  rawInput: string,
  products: Product[] = [],
  settings: BarcodeSettings = DEFAULT_BARCODE_SETTINGS
): ParsedBarcodeResult {
  const cleanCode = (rawInput || '').trim().replace(/[\s\-_]/g, '');

  if (!cleanCode) {
    return {
      rawBarcode: rawInput,
      isVariable: false,
      type: 'unknown',
      error: 'بارکد وارد شده خالی است.'
    };
  }

  // ۱. بررسی تطابق دقیق با بارکد ثابت محصولات
  const exactMatch = products.find(p => p.barcode && p.barcode.trim() === cleanCode);
  if (exactMatch && exactMatch.barcodeType !== 'weighted_composite' && exactMatch.barcodeType !== 'count_composite') {
    return {
      rawBarcode: cleanCode,
      isVariable: false,
      type: 'simple',
      itemCode: exactMatch.sku || exactMatch.id,
      matchedProduct: exactMatch
    };
  }

  // ۲. بررسی بارکدهای متغیر وزنی یا تعدادی بر اساس پروفایل‌ها
  const profiles = settings?.profiles && settings.profiles.length > 0 ? settings.profiles : DEFAULT_BARCODE_PROFILES;

  for (const prof of profiles) {
    if (prof.type === 'simple') continue;

    const prefix = prof.prefix;
    if (prefix && cleanCode.startsWith(prefix)) {
      const pLen = prefix.length;
      const codeLen = prof.itemCodeLength || 5;
      const valLen = prof.valueLength || 5;
      const expectedTotal = pLen + codeLen + valLen + (prof.hasCheckDigit ? 1 : 0);

      // اگر طول بارکد منطبق با الگوی متغیر باشد
      if (cleanCode.length >= pLen + codeLen + valLen) {
        const itemCodePart = cleanCode.slice(pLen, pLen + codeLen);
        const itemCodeNum = parseInt(itemCodePart, 10);
        const valuePart = cleanCode.slice(pLen + codeLen, pLen + codeLen + valLen);
        const rawValueNum = parseInt(valuePart, 10);
        const checkDigit = prof.hasCheckDigit ? cleanCode.slice(pLen + codeLen + valLen, pLen + codeLen + valLen + 1) : undefined;

        // جستجوی کالا بر اساس فیلدهای مختلف
        const matched = products.find(p => {
          // تطابق با کد شناسایی اختصاصی بارکد متغیر
          if (p.itemIdentifierCode && p.itemIdentifierCode.trim() === itemCodePart) return true;
          if (p.itemIdentifierCode && parseInt(p.itemIdentifierCode, 10) === itemCodeNum) return true;
          // تطابق با کد PLU ترازوی دیبال
          if (p.dibalPluCode && p.dibalPluCode === itemCodeNum) return true;
          // تطابق با کد کالا (SKU)
          if (p.sku && p.sku.replace(/\D/g, '') === String(itemCodeNum)) return true;
          // تطابق با بخشی از فیلد بارکد ثبت شده
          if (p.barcode && p.barcode.replace(/\D/g, '') === itemCodePart) return true;
          return false;
        });

        if (prof.type === 'weighted') {
          const weightGram = rawValueNum;
          const weightKg = Number((weightGram / (prof.unitMultiplier || 1000)).toFixed(3));
          return {
            rawBarcode: cleanCode,
            isVariable: true,
            type: 'weighted',
            prefix,
            itemCode: itemCodePart,
            extractedWeightGram: weightGram,
            extractedWeightKg: weightKg,
            checkDigit,
            matchedProduct: matched,
            matchedProfile: prof
          };
        } else if (prof.type === 'count') {
          return {
            rawBarcode: cleanCode,
            isVariable: true,
            type: 'count',
            prefix,
            itemCode: itemCodePart,
            extractedCount: rawValueNum,
            checkDigit,
            matchedProduct: matched,
            matchedProfile: prof
          };
        }
      }
    }
  }

  // ۳. اگر الگوی متغیری یافت نشد، تلاش مجدد برای پیدا کردن در کالاهای ثبت شده
  const fallbackProduct = products.find(p => p.barcode === cleanCode || p.sku === cleanCode);
  return {
    rawBarcode: cleanCode,
    isVariable: false,
    type: fallbackProduct ? 'simple' : 'unknown',
    itemCode: cleanCode,
    matchedProduct: fallbackProduct,
    error: fallbackProduct ? undefined : 'کالایی با این بارکد یا کد متغیر در سیستم یافت نشد.'
  };
}
