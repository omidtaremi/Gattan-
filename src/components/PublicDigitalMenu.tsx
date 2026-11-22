/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Search, X, RefreshCw } from 'lucide-react';
import defaultCafeCover from '../assets/images/gatan_cafe_menu_cover_1795330536825.jpg';
import {
  ALLERGEN_OPTIONS,
  DIETARY_OPTIONS,
  buildPublicDigitalMenuPayload,
  type DigitalMenuLanguage,
  type PublicDigitalMenuPayload,
  type PublicMenuCategory,
  type PublicMenuProduct,
} from '../shared/digitalMenu';
import { fetchPublicDigitalMenu } from '../services/postgresSyncService';
import { loadDatabaseAsync } from '../db';
import { toPersianDigits } from '../utils/persianUtils';

const LANG_STORAGE_KEY = 'gatan_public_menu_lang';

const UI_COPY = {
  fa: {
    allCategories: 'همه',
    searchPlaceholder: 'جستجو در منو...',
    searchAria: 'جستجو در منو',
    clearSearch: 'پاک کردن جستجو',
    featuredTitle: 'پیشنهاد سرآشپز',
    featuredSubtitle: 'منتخب روزانه گاتان',
    unavailableLabel: 'موقتاً ناموجود',
    featuredLabel: 'پیشنهاد ویژه',
    currencyToman: 'تومان',
    currencyRial: 'ریال',
    unitPiece: 'عدد',
    unitKg: 'کیلوگرم',
    weightUnit: 'گرم',
    priceAskWaiter: 'استعلام از سالن',
    allergensTitle: 'مواد حساسیت‌زا',
    dietaryTitle: 'ویژگی‌ها',
    closeModal: 'بستن',
    emptySearchTitle: 'موردی یافت نشد',
    emptySearchBody: 'عبارت دیگری جستجو کنید یا دسته‌بندی دیگری را ببینید.',
    resetFilters: 'نمایش تمام منو',
    emptyMenuTitle: 'منو در حال آماده‌سازی است',
    emptyMenuBody: 'برای آشنایی با محصولات تازه امروز، از همکاران سالن راهنمایی بخواهید.',
    disabledTitle: 'منوی دیجیتال موقتاً در دسترس نیست',
    disabledBody: 'لطفاً برای مشاهده منوی امروز با همکاران سالن گفتگو بفرمایید.',
    errorTitle: 'خطا در بارگذاری منو',
    retry: 'تلاش مجدد',
    loadingText: 'در حال آماده‌سازی منو...',
    perUnitPrefix: 'هر',
  },
  en: {
    allCategories: 'All',
    searchPlaceholder: 'Search the menu...',
    searchAria: 'Search menu',
    clearSearch: 'Clear search',
    featuredTitle: "Chef's Selection",
    featuredSubtitle: 'Daily artisanal highlights',
    unavailableLabel: 'Unavailable',
    featuredLabel: 'Signature',
    currencyToman: 'Toman',
    currencyRial: 'IRR',
    unitPiece: 'pc',
    unitKg: 'kg',
    weightUnit: 'g',
    priceAskWaiter: 'Ask server',
    allergensTitle: 'Allergens',
    dietaryTitle: 'Notes',
    closeModal: 'Close',
    emptySearchTitle: 'No matching items',
    emptySearchBody: 'Try a different keyword or browse another category.',
    resetFilters: 'View full menu',
    emptyMenuTitle: 'Our menu is being curated',
    emptyMenuBody: 'Please ask our café team about today’s freshly baked selection.',
    disabledTitle: 'Digital menu is temporarily paused',
    disabledBody: 'Please ask a member of our café team for today’s menu.',
    errorTitle: 'Unable to load the menu',
    retry: 'Try again',
    loadingText: 'Preparing the menu...',
    perUnitPrefix: 'per',
  },
} as const;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(hex: string, fallback: RgbColor): RgbColor {
  const cleaned = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallback;
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixRgb(a: RgbColor, b: RgbColor, weightB: number): RgbColor {
  const w = Math.max(0, Math.min(1, weightB));
  return {
    r: a.r * (1 - w) + b.r * w,
    g: a.g * (1 - w) + b.g * w,
    b: a.b * (1 - w) + b.b * w,
  };
}

function rgbaString(c: RgbColor, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

interface DerivedMenuTheme {
  canvas: string;
  canvasFrosted: string;
  surface: string;
  surfaceSoft: string;
  placeholderStart: string;
  placeholderEnd: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  accent: string;
  accentSoft: string;
  hairline: string;
  cardShadow: string;
  cardShadowHover: string;
  buttonText: string;
  isDarkCanvas: boolean;
}

/**
 * Derives a cohesive, calm editorial palette from the admin's chosen 3 colors:
 * background (default warm milky cream), primary text (default deep espresso),
 * and accent (default soft caramel bronze).
 */
function deriveMenuTheme(bgHex: string, inkHex: string, accentHex: string): DerivedMenuTheme {
  const bgRgb = parseHexColor(bgHex, { r: 248, g: 243, b: 235 });
  const inkRgb = parseHexColor(inkHex, { r: 54, g: 36, b: 25 });
  const accentRgb = parseHexColor(accentHex, { r: 184, g: 129, b: 77 });
  const white: RgbColor = { r: 255, g: 255, b: 255 };

  const bgLum = relativeLuminance(bgRgb);
  const isDarkCanvas = bgLum < 0.42;

  // Card surface gently lifts from canvas without needing heavy borders
  const surfaceRgb = isDarkCanvas ? mixRgb(bgRgb, white, 0.07) : mixRgb(bgRgb, white, 0.78);
  const surfaceSoftRgb = mixRgb(bgRgb, inkRgb, isDarkCanvas ? 0.12 : 0.045);
  const placeholderStartRgb = mixRgb(bgRgb, white, isDarkCanvas ? 0.04 : 0.35);
  const placeholderEndRgb = mixRgb(bgRgb, inkRgb, isDarkCanvas ? 0.14 : 0.075);

  const inkMutedRgb = mixRgb(inkRgb, bgRgb, 0.3);
  const inkSubtleRgb = mixRgb(inkRgb, bgRgb, 0.48);

  const inkLum = relativeLuminance(inkRgb);
  const buttonText = inkLum > 0.55 ? '#221812' : '#FCF9F4';

  return {
    canvas: rgbToHex(bgRgb),
    canvasFrosted: rgbaString(bgRgb, 0.92),
    surface: rgbToHex(surfaceRgb),
    surfaceSoft: rgbToHex(surfaceSoftRgb),
    placeholderStart: rgbToHex(placeholderStartRgb),
    placeholderEnd: rgbToHex(placeholderEndRgb),
    ink: rgbToHex(inkRgb),
    inkMuted: rgbToHex(inkMutedRgb),
    inkSubtle: rgbToHex(inkSubtleRgb),
    accent: rgbToHex(accentRgb),
    accentSoft: rgbaString(accentRgb, 0.12),
    hairline: rgbaString(inkRgb, isDarkCanvas ? 0.14 : 0.085),
    cardShadow: isDarkCanvas
      ? `0 12px 30px -16px rgba(0, 0, 0, 0.55), 0 0 0 1px ${rgbaString(inkRgb, 0.08)}`
      : `0 10px 30px -20px ${rgbaString(inkRgb, 0.18)}, 0 1px 2px ${rgbaString(inkRgb, 0.04)}`,
    cardShadowHover: isDarkCanvas
      ? `0 18px 38px -18px rgba(0, 0, 0, 0.7), 0 0 0 1px ${rgbaString(accentRgb, 0.25)}`
      : `0 18px 38px -20px ${rgbaString(inkRgb, 0.26)}, 0 2px 6px ${rgbaString(inkRgb, 0.06)}`,
    buttonText,
    isDarkCanvas,
  };
}

function getSavedLanguage(): DigitalMenuLanguage | null {
  try {
    const val = localStorage.getItem(LANG_STORAGE_KEY);
    if (val === 'fa' || val === 'en') return val;
  } catch {
    // ignore storage restriction
  }
  return null;
}

function saveLanguage(lang: DigitalMenuLanguage): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // ignore storage restriction
  }
}

function getAllergenLabel(id: string, lang: DigitalMenuLanguage): string {
  const found = ALLERGEN_OPTIONS.find((a) => a.id === id);
  if (!found) return id;
  return lang === 'en' ? found.labelEn : found.labelFa;
}

function getDietaryLabel(id: string, lang: DigitalMenuLanguage): string {
  const found = DIETARY_OPTIONS.find((d) => d.id === id);
  if (!found) return id;
  return lang === 'en' ? found.labelEn : found.labelFa;
}

export default function PublicDigitalMenu() {
  const [menu, setMenu] = useState<PublicDigitalMenuPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<DigitalMenuLanguage>(() => getSavedLanguage() || 'fa');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeProduct, setActiveProduct] = useState<PublicMenuProduct | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [failedProductImages, setFailedProductImages] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiRes = await fetchPublicDigitalMenu();
      if (apiRes.ok && apiRes.mode === 'postgres' && apiRes.menu) {
        setMenu(apiRes.menu);
        if (!getSavedLanguage() && apiRes.menu.appearance.defaultLanguage) {
          setLang(apiRes.menu.appearance.defaultLanguage);
        }
        setLoading(false);
        return;
      }

      // Local preview / offline fallback using the exact same sanitized public projection
      const localDb = await loadDatabaseAsync();
      const localMenu = buildPublicDigitalMenuPayload({
        periods: localDb.periods,
        productCategories: localDb.productCategories,
        products: localDb.products,
        digitalMenu: localDb.digitalMenu,
      });
      setMenu(localMenu);
      if (!getSavedLanguage() && localMenu.appearance.defaultLanguage) {
        setLang(localMenu.appearance.defaultLanguage);
      }
    } catch (err: any) {
      setError(err?.message || 'خطا در بارگذاری اطلاعات منو');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const theme = useMemo(
    () =>
      deriveMenuTheme(
        menu?.appearance.backgroundColor || '#F8F3EB',
        menu?.appearance.primaryColor || '#362419',
        menu?.appearance.secondaryColor || '#B8814D'
      ),
    [
      menu?.appearance.backgroundColor,
      menu?.appearance.primaryColor,
      menu?.appearance.secondaryColor,
    ]
  );

  // Isolate /menu completely from ERP dark/light global overrides & sync document body canvas
  useEffect(() => {
    const html = document.documentElement;
    const prevClasses = html.className;
    const prevDir = html.getAttribute('dir') || 'rtl';
    const prevLang = html.getAttribute('lang') || 'fa';
    const prevTitle = document.title;
    const prevBodyBg = document.body.style.backgroundColor;
    const prevBodyColor = document.body.style.color;

    html.classList.remove('dark', 'light');
    html.classList.add('public-menu-mode');

    return () => {
      html.className = prevClasses;
      html.setAttribute('dir', prevDir);
      html.setAttribute('lang', prevLang);
      document.title = prevTitle;
      document.body.style.backgroundColor = prevBodyBg;
      document.body.style.color = prevBodyColor;
    };
  }, []);

  useEffect(() => {
    document.body.style.backgroundColor = theme.canvas;
    document.body.style.color = theme.ink;
  }, [theme.canvas, theme.ink]);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    html.setAttribute('lang', lang);
    if (menu) {
      document.title =
        lang === 'en'
          ? `${menu.appearance.cafeNameEn} — Menu`
          : `${menu.appearance.cafeNameFa} | منو`;
    }
  }, [lang, menu]);

  useEffect(() => {
    if (searchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [searchOpen]);

  // Close product detail sheet on Escape and lock body scroll while open
  useEffect(() => {
    if (!activeProduct) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveProduct(null);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeProduct]);

  const handleLanguageChange = (nextLang: DigitalMenuLanguage) => {
    setLang(nextLang);
    saveLanguage(nextLang);
  };

  const handleSelectCategory = (catId: string) => {
    setSelectedCategoryId(catId);
    const btn = tabButtonRefs.current[catId];
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  const t = UI_COPY[lang];
  const isRtl = lang === 'fa';

  const getCategoryTitle = useCallback(
    (cat: PublicMenuCategory) => {
      if (lang === 'en') return cat.nameEn || cat.nameFa;
      return cat.nameFa;
    },
    [lang]
  );

  const getCategoryDesc = useCallback(
    (cat: PublicMenuCategory) => {
      if (lang === 'en') return cat.descriptionEn || '';
      return cat.descriptionFa || '';
    },
    [lang]
  );

  const getProductTitle = useCallback(
    (prod: PublicMenuProduct) => {
      if (lang === 'en') return prod.nameEn || prod.nameFa;
      return prod.nameFa;
    },
    [lang]
  );

  const getProductDesc = useCallback(
    (prod: PublicMenuProduct) => {
      if (lang === 'en') return prod.descriptionEn || prod.descriptionFa || '';
      return prod.descriptionFa || '';
    },
    [lang]
  );

  const formatPrice = useCallback(
    (prod: PublicMenuProduct) => {
      if (!menu?.appearance.showPrices) return null;
      if (!prod.displayPrice || prod.displayPrice <= 0) {
        return { amount: t.priceAskWaiter, unit: '' };
      }
      const formattedNumber =
        lang === 'fa'
          ? toPersianDigits(prod.displayPrice.toLocaleString('en-US'))
          : prod.displayPrice.toLocaleString('en-US');
      const currency =
        menu.appearance.currencyMode === 'rial' ? t.currencyRial : t.currencyToman;
      return { amount: formattedNumber, unit: currency };
    },
    [lang, menu?.appearance.currencyMode, menu?.appearance.showPrices, t]
  );

  const formatUnitText = useCallback(
    (prod: PublicMenuProduct) => {
      const unitWord = prod.unit === 'کیلو' ? t.unitKg : t.unitPiece;
      const weightText =
        prod.weightGrams && prod.weightGrams > 0
          ? lang === 'fa'
            ? `${toPersianDigits(prod.weightGrams)} ${t.weightUnit}`
            : `${prod.weightGrams}${t.weightUnit}`
          : '';
      if (weightText) {
        return `${t.perUnitPrefix} ${unitWord} · ${weightText}`;
      }
      return `${t.perUnitPrefix} ${unitWord}`;
    },
    [lang, t]
  );

  const categoryMap = useMemo(() => {
    const map = new Map<string, PublicMenuCategory>();
    if (menu) {
      for (const c of menu.categories) {
        map.set(c.id, c);
      }
    }
    return map;
  }, [menu]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredProducts = useMemo(() => {
    if (!menu) return [];
    return menu.products.filter((prod) => {
      if (selectedCategoryId !== 'all' && prod.categoryId !== selectedCategoryId) {
        return false;
      }
      if (!normalizedQuery) return true;
      const cat = categoryMap.get(prod.categoryId);
      const haystack = [
        prod.nameFa,
        prod.nameEn,
        prod.descriptionFa,
        prod.descriptionEn,
        cat?.nameFa || '',
        cat?.nameEn || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [menu, selectedCategoryId, normalizedQuery, categoryMap]);

  const featuredProducts = useMemo(() => {
    if (!menu || !menu.appearance.showFeaturedSection) return [];
    if (normalizedQuery || selectedCategoryId !== 'all') return [];
    return menu.products.filter((p) => p.featured);
  }, [menu, normalizedQuery, selectedCategoryId]);

  const groupedSections = useMemo(() => {
    if (!menu) return [];
    const byCat = new Map<string, PublicMenuProduct[]>();
    for (const p of filteredProducts) {
      const key = p.categoryId || '__uncategorized__';
      const arr = byCat.get(key) || [];
      arr.push(p);
      byCat.set(key, arr);
    }

    const sections: Array<{
      id: string;
      title: string;
      description: string;
      products: PublicMenuProduct[];
    }> = [];

    for (const cat of menu.categories) {
      const items = byCat.get(cat.id);
      if (items && items.length > 0) {
        sections.push({
          id: cat.id,
          title: getCategoryTitle(cat),
          description: getCategoryDesc(cat),
          products: items,
        });
        byCat.delete(cat.id);
      }
    }

    for (const [key, items] of byCat.entries()) {
      if (items.length > 0) {
        sections.push({
          id: key,
          title: lang === 'en' ? 'More' : 'سایر موارد',
          description: '',
          products: items,
        });
      }
    }

    return sections;
  }, [menu, filteredProducts, getCategoryTitle, getCategoryDesc, lang]);

  // Loading Skeleton (calm warm cream canvas)
  if (loading) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="min-h-screen flex flex-col"
        style={{ backgroundColor: theme.canvas, color: theme.ink }}
      >
        <div className="max-w-5xl w-full mx-auto px-5 sm:px-8 py-6 flex items-center justify-between">
          <div
            className="h-5 w-32 rounded-md animate-pulse"
            style={{ backgroundColor: theme.surfaceSoft }}
          />
          <div
            className="h-5 w-16 rounded-md animate-pulse"
            style={{ backgroundColor: theme.surfaceSoft }}
          />
        </div>
        <div className="max-w-5xl w-full mx-auto px-5 sm:px-8 space-y-8">
          <div
            className="h-56 sm:h-72 rounded-[24px] animate-pulse"
            style={{ backgroundColor: theme.surfaceSoft }}
          />
          <div className="flex gap-6 overflow-hidden">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="h-4 w-20 rounded animate-pulse shrink-0"
                style={{ backgroundColor: theme.surfaceSoft }}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="rounded-[20px] overflow-hidden"
                style={{ backgroundColor: theme.surface, boxShadow: theme.cardShadow }}
              >
                <div
                  className="aspect-[4/3] animate-pulse"
                  style={{ backgroundColor: theme.surfaceSoft }}
                />
                <div className="p-5 space-y-3">
                  <div
                    className="h-4 w-2/3 rounded animate-pulse"
                    style={{ backgroundColor: theme.surfaceSoft }}
                  />
                  <div
                    className="h-3 w-full rounded animate-pulse"
                    style={{ backgroundColor: theme.surfaceSoft }}
                  />
                  <div
                    className="h-4 w-1/3 rounded animate-pulse mt-3"
                    style={{ backgroundColor: theme.surfaceSoft }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-center text-xs py-10" style={{ color: theme.inkSubtle }}>
          {t.loadingText}
        </p>
      </div>
    );
  }

  // Error State
  if (error || !menu) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: theme.canvas, color: theme.ink }}
      >
        <div className="max-w-sm w-full text-center space-y-5">
          <h1 className="text-xl font-semibold">{t.errorTitle}</h1>
          {error && (
            <p className="text-xs leading-relaxed" style={{ color: theme.inkMuted }}>
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={loadMenu}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer transition-opacity hover:opacity-90"
            style={{ backgroundColor: theme.ink, color: theme.buttonText }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t.retry}</span>
          </button>
        </div>
      </div>
    );
  }

  // Temporarily Disabled State
  if (!menu.enabled) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
        style={{ backgroundColor: theme.canvas, color: theme.ink }}
      >
        <div className="max-w-md w-full space-y-5">
          <div
            className="w-8 h-[1.5px] mx-auto"
            style={{ backgroundColor: theme.accent }}
          />
          <h1
            className={`font-semibold ${
              lang === 'en'
                ? 'menu-display-en text-4xl tracking-wide'
                : 'menu-display-fa text-2xl'
            }`}
          >
            {lang === 'en' ? menu.appearance.cafeNameEn : menu.appearance.cafeNameFa}
          </h1>
          <p className="text-sm font-medium">{t.disabledTitle}</p>
          <p className="text-xs leading-relaxed" style={{ color: theme.inkMuted }}>
            {t.disabledBody}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleLanguageChange(lang === 'fa' ? 'en' : 'fa')}
              className="text-xs font-medium underline underline-offset-4 cursor-pointer transition-opacity hover:opacity-75"
              style={{ color: theme.accent }}
            >
              {lang === 'fa' ? 'English' : 'فارسی'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cafeTitle = lang === 'en' ? menu.appearance.cafeNameEn : menu.appearance.cafeNameFa;
  const cafeTagline = lang === 'en' ? menu.appearance.taglineEn : menu.appearance.taglineFa;
  const cafeHours = lang === 'en' ? menu.appearance.hoursEn : menu.appearance.hoursFa;
  const cafeAddress = lang === 'en' ? menu.appearance.addressEn : menu.appearance.addressFa;
  const waiterNotice = lang === 'en' ? menu.appearance.waiterNoticeEn : menu.appearance.waiterNoticeFa;
  const resolvedCoverSrc =
    menu.appearance.coverImageUrl && !coverFailed ? menu.appearance.coverImageUrl : defaultCafeCover;

  const monogramLabel = (menu.appearance.cafeNameEn || cafeTitle || 'G').trim().charAt(0).toUpperCase();

  const renderProductCard = (product: PublicMenuProduct, idx: number, compactFeatured = false) => {
    const title = getProductTitle(product);
    const description = getProductDesc(product);
    const price = formatPrice(product);
    const hasImage = Boolean(product.imageUrl) && !failedProductImages[product.id];
    const dietaryTexts = product.dietaryLabels
      .slice(0, 2)
      .map((id) => getDietaryLabel(id, lang));
    const cardKey = `${compactFeatured ? 'feat-' : ''}${product.id}`;
    const isHovered = hoveredCardId === cardKey;

    return (
      <article
        key={cardKey}
        onClick={() => setActiveProduct(product)}
        onMouseEnter={() => setHoveredCardId(cardKey)}
        onMouseLeave={() => setHoveredCardId(null)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveProduct(product);
          }
        }}
        className={`group dm-fade-up rounded-[20px] overflow-hidden cursor-pointer focus-visible:outline-none flex flex-col transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 ${
          !product.isAvailable ? 'opacity-70' : ''
        } ${compactFeatured ? 'w-[276px] sm:w-[304px] shrink-0' : 'w-full'}`}
        style={{
          backgroundColor: theme.surface,
          boxShadow: isHovered ? theme.cardShadowHover : theme.cardShadow,
          animationDelay: `${Math.min(idx, 8) * 35}ms`,
        }}
      >
        {/* Large Edge-to-Edge Product Photo (4:3) */}
        <div
          className="relative aspect-[4/3] w-full overflow-hidden"
          style={{ backgroundColor: theme.surfaceSoft }}
        >
          {hasImage ? (
            <img
              src={product.imageUrl}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() =>
                setFailedProductImages((prev) => ({ ...prev, [product.id]: true }))
              }
              className={`w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035] ${
                !product.isAvailable ? 'grayscale-[40%]' : ''
              }`}
            />
          ) : (
            <div
              className="w-full h-full flex flex-col items-center justify-center px-6 text-center select-none"
              style={{
                background: `linear-gradient(145deg, ${theme.placeholderStart} 0%, ${theme.placeholderEnd} 100%)`,
              }}
            >
              <span
                className="menu-display-en text-4xl font-normal tracking-widest opacity-25"
                style={{ color: theme.accent }}
                aria-hidden="true"
              >
                {monogramLabel}
              </span>
              <span
                className={`mt-1.5 text-[11px] opacity-35 line-clamp-1 ${
                  lang === 'en' ? 'menu-display-en text-sm italic tracking-wide' : 'font-normal'
                }`}
                style={{ color: theme.ink }}
              >
                {cafeTitle}
              </span>
            </div>
          )}

          {/* Quiet frosted status indicator ONLY when an item is temporarily unavailable */}
          {!product.isAvailable && (
            <div
              className={`absolute top-3 ${
                isRtl ? 'right-3' : 'left-3'
              } px-2.5 py-1 rounded-lg text-[11px] font-medium backdrop-blur-sm`}
              style={{
                backgroundColor: 'rgba(28, 19, 14, 0.76)',
                color: '#FAF6F0',
              }}
            >
              {t.unavailableLabel}
            </div>
          )}
        </div>

        {/* Clean, Breathable Card Content (Zero Borders, Zero Clutter) */}
        <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            {product.featured && !compactFeatured && product.isAvailable && (
              <div
                className="text-[11px] font-medium tracking-wide"
                style={{ color: theme.accent }}
              >
                {t.featuredLabel}
              </div>
            )}

            <h3
              className={`leading-snug line-clamp-2 ${
                lang === 'en'
                  ? 'text-[17px] font-semibold tracking-[-0.015em]'
                  : 'text-[15.5px] sm:text-[16px] font-semibold'
              }`}
              style={{ color: theme.ink }}
            >
              {title}
            </h3>

            {description && (
              <p
                className="text-[12.5px] sm:text-[13px] leading-[1.7] line-clamp-2"
                style={{ color: theme.inkMuted }}
              >
                {description}
              </p>
            )}

            {dietaryTexts.length > 0 && (
              <p
                className="text-[11px] font-medium pt-0.5"
                style={{ color: theme.accent }}
              >
                {dietaryTexts.join(' · ')}
              </p>
            )}
          </div>

          {/* Live ERP Price & Serving Unit (Strictly View-Only) */}
          <div className="flex items-baseline justify-between gap-3 pt-1">
            {price ? (
              <div className="flex items-baseline gap-1.5 tabular-nums">
                <span
                  className="text-[16px] sm:text-[17px] font-bold tracking-tight"
                  style={{ color: theme.ink }}
                >
                  {price.amount}
                </span>
                {price.unit && (
                  <span
                    className="text-[11.5px] font-medium"
                    style={{ color: theme.accent }}
                  >
                    {price.unit}
                  </span>
                )}
              </div>
            ) : (
              <span />
            )}

            <span
              className="text-[11px] tabular-nums shrink-0"
              style={{ color: theme.inkSubtle }}
            >
              {formatUnitText(product)}
            </span>
          </div>
        </div>
      </article>
    );
  };

  const footerMetaItems: Array<{ key: string; node: React.ReactNode }> = [];
  if (cafeHours) {
    footerMetaItems.push({ key: 'hours', node: <span>{cafeHours}</span> });
  }
  if (menu.appearance.phoneDisplay) {
    footerMetaItems.push({
      key: 'phone',
      node: (
        <a
          href={`tel:${menu.appearance.phoneDisplay.replace(/[^+\d]/g, '')}`}
          className="hover:underline underline-offset-4 tabular-nums transition-opacity hover:opacity-80"
          dir="ltr"
        >
          {menu.appearance.phoneDisplay}
        </a>
      ),
    });
  }
  if (menu.appearance.instagramHandle) {
    footerMetaItems.push({
      key: 'ig',
      node: (
        <a
          href={`https://instagram.com/${encodeURIComponent(menu.appearance.instagramHandle)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline underline-offset-4 transition-opacity hover:opacity-80"
          dir="ltr"
        >
          @{menu.appearance.instagramHandle}
        </a>
      ),
    });
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: theme.canvas, color: theme.ink }}
    >
      {/* ================= MINIMAL EDITORIAL HEADER ================= */}
      <header className="w-full">
        <div className="max-w-5xl mx-auto h-16 sm:h-[72px] px-5 sm:px-8 flex items-center justify-between gap-4">
          {/* Clean Brand Wordmark (Optional uploaded logo only, zero generic icons) */}
          <div className="flex items-center gap-3 min-w-0">
            {menu.appearance.logoUrl && !logoFailed && (
              <img
                src={menu.appearance.logoUrl}
                alt={cafeTitle}
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-9 w-9 rounded-full object-cover shrink-0"
              />
            )}
            <span
              className={`truncate ${
                lang === 'en'
                  ? 'menu-display-en text-2xl sm:text-[26px] font-semibold tracking-wide'
                  : 'menu-display-fa text-[16px] sm:text-lg font-bold tracking-tight'
              }`}
              style={{ color: theme.ink }}
            >
              {cafeTitle}
            </span>
          </div>

          {/* Quiet Interactive Utilities: Search Toggle + Clean Typographic FA / EN */}
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (searchOpen && searchQuery) {
                  setSearchQuery('');
                }
                setSearchOpen((prev) => !prev);
              }}
              aria-label={t.searchAria}
              aria-expanded={searchOpen}
              className="h-10 w-10 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-70 focus-visible:outline-none"
              style={{ color: searchOpen ? theme.accent : theme.ink }}
            >
              {searchOpen ? <X className="h-[18px] w-[18px]" /> : <Search className="h-[18px] w-[18px]" />}
            </button>

            <div
              className="flex items-center gap-2 text-xs select-none"
              role="group"
              aria-label="Language switcher"
            >
              <button
                type="button"
                onClick={() => handleLanguageChange('fa')}
                className="py-2 px-1 cursor-pointer transition-opacity hover:opacity-100 whitespace-nowrap"
                style={{
                  color: lang === 'fa' ? theme.ink : theme.inkSubtle,
                  fontWeight: lang === 'fa' ? 700 : 400,
                }}
              >
                فارسی
              </button>
              <span aria-hidden="true" style={{ color: theme.hairline }}>
                /
              </span>
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className="py-2 px-1 cursor-pointer transition-opacity hover:opacity-100 whitespace-nowrap tracking-wide"
                style={{
                  color: lang === 'en' ? theme.ink : theme.inkSubtle,
                  fontWeight: lang === 'en' ? 600 : 400,
                }}
              >
                EN
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Minimal Search Bar (hidden by default for zero visual clutter) */}
        {(searchOpen || searchQuery.length > 0) && (
          <div className="max-w-5xl mx-auto px-5 sm:px-8 pb-4 dm-fade-up">
            <div className="relative max-w-lg">
              <Search
                className={`h-4 w-4 absolute top-1/2 -translate-y-1/2 pointer-events-none ${
                  isRtl ? 'right-4' : 'left-4'
                }`}
                style={{ color: theme.inkSubtle }}
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                className={`w-full h-11 rounded-2xl text-sm focus:outline-none transition-shadow ${
                  isRtl ? 'pr-11 pl-10' : 'pl-11 pr-10'
                }`}
                style={{
                  backgroundColor: theme.surface,
                  color: theme.ink,
                  boxShadow: theme.cardShadow,
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={t.clearSearch}
                  className={`h-8 w-8 rounded-full flex items-center justify-center absolute top-1/2 -translate-y-1/2 cursor-pointer transition-opacity hover:opacity-70 ${
                    isRtl ? 'left-2' : 'right-2'
                  }`}
                  style={{ color: theme.inkSubtle }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ================= SERENE EDITORIAL HERO PHOTOGRAPH ================= */}
      <section className="max-w-5xl w-full mx-auto px-4 sm:px-8 pt-1 pb-6 sm:pb-8">
        <div className="relative rounded-[24px] overflow-hidden min-h-[220px] sm:min-h-[300px] flex items-end">
          <img
            src={resolvedCoverSrc}
            alt={cafeTitle}
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(26, 18, 13, 0.04) 0%, rgba(26, 18, 13, 0.28) 48%, rgba(22, 15, 10, 0.78) 100%)',
            }}
          />

          <div className="relative z-10 w-full p-6 sm:p-9 text-[#FAF6F0] space-y-2">
            <h1
              className={`leading-tight [text-wrap:balance] ${
                lang === 'en'
                  ? 'menu-display-en text-4xl sm:text-5xl font-medium tracking-wide'
                  : 'menu-display-fa text-2xl sm:text-[34px] font-bold'
              }`}
            >
              {cafeTitle}
            </h1>

            {cafeTagline && (
              <p className="text-xs sm:text-sm text-[#F5EFE7]/90 max-w-xl leading-relaxed font-normal">
                {cafeTagline}
              </p>
            )}

            {cafeHours && (
              <p className="pt-1 text-[11.5px] sm:text-xs text-[#E8DDD0]/90 tracking-wide">
                {cafeHours}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ================= STICKY MINIMAL SCROLLABLE CATEGORIES (<= 52px) ================= */}
      {menu.categories.length > 0 && (
        <nav
          aria-label="Menu categories"
          className="sticky top-0 z-30 backdrop-blur-md"
          style={{
            backgroundColor: theme.canvasFrosted,
            borderBottom: `1px solid ${theme.hairline}`,
          }}
        >
          <div className="max-w-5xl mx-auto px-5 sm:px-8">
            <div
              className="flex items-center gap-7 sm:gap-9 overflow-x-auto no-scrollbar scroll-smooth"
              role="tablist"
            >
              <button
                ref={(el) => {
                  tabButtonRefs.current['all'] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selectedCategoryId === 'all'}
                onClick={() => handleSelectCategory('all')}
                className="relative shrink-0 h-[50px] inline-flex items-center text-[13.5px] sm:text-sm whitespace-nowrap cursor-pointer transition-colors duration-200 focus-visible:outline-none"
                style={{
                  color: selectedCategoryId === 'all' ? theme.ink : theme.inkSubtle,
                  fontWeight: selectedCategoryId === 'all' ? 600 : 400,
                }}
              >
                <span>{t.allCategories}</span>
                <span
                  className="absolute bottom-0 inset-x-0 h-[2px] rounded-full transition-opacity duration-200"
                  style={{
                    backgroundColor: theme.accent,
                    opacity: selectedCategoryId === 'all' ? 1 : 0,
                  }}
                />
              </button>

              {menu.categories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    ref={(el) => {
                      tabButtonRefs.current[cat.id] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSelectCategory(cat.id)}
                    className="relative shrink-0 h-[50px] inline-flex items-center text-[13.5px] sm:text-sm whitespace-nowrap cursor-pointer transition-colors duration-200 focus-visible:outline-none"
                    style={{
                      color: active ? theme.ink : theme.inkSubtle,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span>{getCategoryTitle(cat)}</span>
                    <span
                      className="absolute bottom-0 inset-x-0 h-[2px] rounded-full transition-opacity duration-200"
                      style={{
                        backgroundColor: theme.accent,
                        opacity: active ? 1 : 0,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      )}

      {/* ================= MAIN MENU GALLERY ================= */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-6 space-y-12 sm:space-y-14">
        {/* Chef's Selection Horizontal Showcase (Only when unfiltered and featured items exist) */}
        {featuredProducts.length > 0 && (
          <section className="space-y-5">
            <div className="px-1 space-y-1">
              <div
                className="text-[11px] font-medium tracking-wider"
                style={{ color: theme.accent }}
              >
                {t.featuredSubtitle}
              </div>
              <h2
                className={`${
                  lang === 'en'
                    ? 'menu-display-en text-3xl sm:text-[34px] font-medium'
                    : 'menu-display-fa text-xl sm:text-2xl font-bold'
                }`}
                style={{ color: theme.ink }}
              >
                {t.featuredTitle}
              </h2>
            </div>

            <div className="flex gap-5 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">
              {featuredProducts.map((prod, idx) => renderProductCard(prod, idx, true))}
            </div>
          </section>
        )}

        {/* Categorized Product Grid */}
        {menu.products.length === 0 ? (
          <div className="py-20 text-center space-y-3 max-w-sm mx-auto">
            <div
              className="w-8 h-[1.5px] mx-auto mb-4"
              style={{ backgroundColor: theme.accent }}
            />
            <h2 className="text-base font-semibold" style={{ color: theme.ink }}>
              {t.emptyMenuTitle}
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: theme.inkMuted }}>
              {t.emptyMenuBody}
            </p>
          </div>
        ) : groupedSections.length === 0 ? (
          <div className="py-16 text-center space-y-4 max-w-sm mx-auto">
            <h2 className="text-base font-semibold" style={{ color: theme.ink }}>
              {t.emptySearchTitle}
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: theme.inkMuted }}>
              {t.emptySearchBody}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategoryId('all');
              }}
              className="mt-2 px-5 py-2.5 rounded-full text-xs font-medium cursor-pointer transition-opacity hover:opacity-85"
              style={{ backgroundColor: theme.ink, color: theme.buttonText }}
            >
              {t.resetFilters}
            </button>
          </div>
        ) : (
          <div className="space-y-12 sm:space-y-16">
            {groupedSections.map((section) => (
              <section key={section.id} className="space-y-5 sm:space-y-6">
                <div className="px-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <h2
                      className={`${
                        lang === 'en'
                          ? 'menu-display-en text-3xl sm:text-[34px] font-medium'
                          : 'menu-display-fa text-xl sm:text-2xl font-bold'
                      }`}
                      style={{ color: theme.ink }}
                    >
                      {section.title}
                    </h2>
                    <span
                      className="flex-1 h-[1px]"
                      style={{ backgroundColor: theme.hairline }}
                      aria-hidden="true"
                    />
                  </div>
                  {section.description && (
                    <p
                      className="text-xs sm:text-[13px] leading-relaxed max-w-xl"
                      style={{ color: theme.inkMuted }}
                    >
                      {section.description}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
                  {section.products.map((prod, idx) => renderProductCard(prod, idx, false))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* ================= QUIET MINIMAL EDITORIAL FOOTER ================= */}
      <footer
        className="mt-14 sm:mt-20"
        style={{ borderTop: `1px solid ${theme.hairline}` }}
      >
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-12 space-y-5 text-center sm:text-start">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div
                className={`${
                  lang === 'en'
                    ? 'menu-display-en text-2xl font-semibold'
                    : 'menu-display-fa text-base font-bold'
                }`}
                style={{ color: theme.ink }}
              >
                {cafeTitle}
              </div>
              {waiterNotice && (
                <p
                  className="text-xs leading-relaxed max-w-md mx-auto sm:mx-0"
                  style={{ color: theme.inkMuted }}
                >
                  {waiterNotice}
                </p>
              )}
            </div>

            {footerMetaItems.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-center sm:justify-end gap-x-2.5 gap-y-1.5 text-xs"
                style={{ color: theme.inkMuted }}
              >
                {footerMetaItems.map((item, idx) => (
                  <React.Fragment key={item.key}>
                    {idx > 0 && (
                      <span aria-hidden="true" style={{ color: theme.accent }}>
                        ·
                      </span>
                    )}
                    {item.node}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {cafeAddress && (
            <p className="text-xs leading-relaxed" style={{ color: theme.inkSubtle }}>
              {cafeAddress}
            </p>
          )}

          <div
            className="pt-4 flex items-center justify-center sm:justify-between gap-4 text-[11.5px]"
            style={{
              borderTop: `1px solid ${theme.hairline}`,
              color: theme.inkSubtle,
            }}
          >
            {cafeTagline && <span className="hidden sm:inline truncate max-w-md">{cafeTagline}</span>}
            <button
              type="button"
              onClick={() => handleLanguageChange(lang === 'fa' ? 'en' : 'fa')}
              className="cursor-pointer transition-opacity hover:opacity-75 font-medium"
              style={{ color: theme.accent }}
            >
              {lang === 'fa' ? 'English Menu' : 'منوی فارسی'}
            </button>
          </div>
        </div>
      </footer>

      {/* ================= PRODUCT DETAIL SHEET (MOBILE BOTTOM SHEET / DESKTOP MODAL) ================= */}
      {activeProduct && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 dm-backdrop-in"
          style={{ backgroundColor: 'rgba(20, 14, 10, 0.56)', backdropFilter: 'blur(4px)' }}
          onClick={() => setActiveProduct(null)}
          role="dialog"
          aria-modal="true"
          aria-label={getProductTitle(activeProduct)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[500px] max-h-[90vh] overflow-y-auto rounded-t-[28px] sm:rounded-[26px] flex flex-col dm-sheet-up"
            style={{
              backgroundColor: theme.canvas,
              color: theme.ink,
              boxShadow: '0 24px 64px -20px rgba(15, 10, 6, 0.45)',
            }}
          >
            {/* Large Product Photograph */}
            <div
              className="relative aspect-[4/3] w-full shrink-0 overflow-hidden"
              style={{ backgroundColor: theme.surfaceSoft }}
            >
              {activeProduct.imageUrl && !failedProductImages[activeProduct.id] ? (
                <img
                  src={activeProduct.imageUrl}
                  alt={getProductTitle(activeProduct)}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setFailedProductImages((prev) => ({
                      ...prev,
                      [activeProduct.id]: true,
                    }))
                  }
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center select-none"
                  style={{
                    background: `linear-gradient(145deg, ${theme.placeholderStart} 0%, ${theme.placeholderEnd} 100%)`,
                  }}
                >
                  <span
                    className="menu-display-en text-6xl font-normal tracking-widest opacity-25"
                    style={{ color: theme.accent }}
                    aria-hidden="true"
                  >
                    {monogramLabel}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => setActiveProduct(null)}
                aria-label={t.closeModal}
                className={`absolute top-4 ${
                  isRtl ? 'left-4' : 'right-4'
                } h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md cursor-pointer transition-opacity hover:opacity-90`}
                style={{
                  backgroundColor: 'rgba(26, 18, 13, 0.58)',
                  color: '#FAF6F0',
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Clean Editorial Product Information */}
            <div className="p-6 sm:p-7 space-y-5">
              {/* Quiet Category & Availability Line */}
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium tracking-wide" style={{ color: theme.accent }}>
                  {categoryMap.get(activeProduct.categoryId)
                    ? getCategoryTitle(categoryMap.get(activeProduct.categoryId)!)
                    : ''}
                </span>
                {!activeProduct.isAvailable && (
                  <span className="font-medium" style={{ color: theme.inkMuted }}>
                    {t.unavailableLabel}
                  </span>
                )}
              </div>

              {/* Title & Secondary Language Subtitle */}
              <div className="space-y-1">
                <h2
                  className={`leading-snug ${
                    lang === 'en'
                      ? 'menu-display-en text-3xl sm:text-[34px] font-semibold'
                      : 'menu-display-fa text-xl sm:text-2xl font-bold'
                  }`}
                  style={{ color: theme.ink }}
                >
                  {getProductTitle(activeProduct)}
                </h2>
                {lang === 'fa' && activeProduct.nameEn && (
                  <p
                    className="menu-display-en text-base italic"
                    style={{ color: theme.inkSubtle }}
                    dir="ltr"
                  >
                    {activeProduct.nameEn}
                  </p>
                )}
                {lang === 'en' &&
                  activeProduct.nameEn &&
                  activeProduct.nameFa !== activeProduct.nameEn && (
                    <p className="text-xs" style={{ color: theme.inkSubtle }} dir="rtl">
                      {activeProduct.nameFa}
                    </p>
                  )}
              </div>

              {/* Live ERP Price & Serving Unit */}
              {formatPrice(activeProduct) && (
                <div
                  className="flex items-baseline justify-between gap-4 py-4"
                  style={{
                    borderTop: `1px solid ${theme.hairline}`,
                    borderBottom: `1px solid ${theme.hairline}`,
                  }}
                >
                  <div className="flex items-baseline gap-2 tabular-nums">
                    <span className="text-2xl font-bold" style={{ color: theme.ink }}>
                      {formatPrice(activeProduct)!.amount}
                    </span>
                    {formatPrice(activeProduct)!.unit && (
                      <span
                        className="text-xs font-medium"
                        style={{ color: theme.accent }}
                      >
                        {formatPrice(activeProduct)!.unit}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: theme.inkSubtle }}
                  >
                    {formatUnitText(activeProduct)}
                  </span>
                </div>
              )}

              {/* Product Description */}
              {getProductDesc(activeProduct) && (
                <p
                  className="text-[13.5px] sm:text-sm leading-[1.85] whitespace-pre-line"
                  style={{ color: theme.inkMuted }}
                >
                  {getProductDesc(activeProduct)}
                </p>
              )}

              {/* Dietary Notes & Allergens (Unboxed, Clean Typography) */}
              {(activeProduct.dietaryLabels.length > 0 || activeProduct.allergens.length > 0) && (
                <div className="space-y-3 pt-1">
                  {activeProduct.dietaryLabels.length > 0 && (
                    <div className="space-y-1">
                      <div
                        className="text-[11px] font-medium"
                        style={{ color: theme.inkSubtle }}
                      >
                        {t.dietaryTitle}
                      </div>
                      <p className="text-xs font-medium" style={{ color: theme.accent }}>
                        {activeProduct.dietaryLabels
                          .map((id) => getDietaryLabel(id, lang))
                          .join(' · ')}
                      </p>
                    </div>
                  )}

                  {activeProduct.allergens.length > 0 && (
                    <div className="space-y-1">
                      <div
                        className="text-[11px] font-medium"
                        style={{ color: theme.inkSubtle }}
                      >
                        {t.allergensTitle}
                      </div>
                      <p className="text-xs" style={{ color: theme.inkMuted }}>
                        {activeProduct.allergens
                          .map((id) => getAllergenLabel(id, lang))
                          .join(' · ')}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Quiet Hospitality Footer Note (Strictly View-Only) */}
              {waiterNotice && (
                <p
                  className="pt-3 text-[11.5px] leading-relaxed"
                  style={{
                    borderTop: `1px solid ${theme.hairline}`,
                    color: theme.inkSubtle,
                  }}
                >
                  {waiterNotice}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
