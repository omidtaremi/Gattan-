/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DigitalMenuLanguage = 'fa' | 'en';
export type DigitalMenuCurrencyMode = 'toman' | 'rial';
export type DigitalMenuUnavailableMode = 'badge' | 'hide';

export interface BilingualOption {
  id: string;
  labelFa: string;
  labelEn: string;
}

export const ALLERGEN_OPTIONS: BilingualOption[] = [
  { id: 'gluten', labelFa: 'گلوتن (گندم)', labelEn: 'Gluten' },
  { id: 'dairy', labelFa: 'لبنیات', labelEn: 'Dairy' },
  { id: 'nuts', labelFa: 'مغزیجات', labelEn: 'Tree Nuts' },
  { id: 'eggs', labelFa: 'تخم‌مرغ', labelEn: 'Eggs' },
  { id: 'sesame', labelFa: 'کنجد', labelEn: 'Sesame' },
  { id: 'soy', labelFa: 'سویا', labelEn: 'Soy' },
  { id: 'peanuts', labelFa: 'بادام‌زمینی', labelEn: 'Peanuts' },
];

export const DIETARY_OPTIONS: BilingualOption[] = [
  { id: 'signature', labelFa: 'ویژه گاتان', labelEn: 'House Signature' },
  { id: 'fresh_daily', labelFa: 'پخت تازه روزانه', labelEn: 'Baked Fresh Daily' },
  { id: 'vegetarian', labelFa: 'گیاهی', labelEn: 'Vegetarian' },
  { id: 'vegan', labelFa: 'وگان', labelEn: 'Vegan' },
  { id: 'sugar_free', labelFa: 'بدون قند افزوده', labelEn: 'No Added Sugar' },
  { id: 'gluten_free', labelFa: 'بدون گلوتن', labelEn: 'Gluten-Free' },
];

export interface DigitalMenuAppearance {
  cafeNameFa: string;
  cafeNameEn: string;
  taglineFa: string;
  taglineEn: string;
  logoUrl: string;
  coverImageUrl: string;
  backgroundColor: string;
  primaryColor: string;
  secondaryColor: string;
  defaultLanguage: DigitalMenuLanguage;
  currencyMode: DigitalMenuCurrencyMode;
  unavailableBehavior: DigitalMenuUnavailableMode;
  showPrices: boolean;
  showFeaturedSection: boolean;
  publicBaseUrl: string;
  sourcePeriodId: string;
  addressFa: string;
  addressEn: string;
  hoursFa: string;
  hoursEn: string;
  instagramHandle: string;
  phoneDisplay: string;
  waiterNoticeFa: string;
  waiterNoticeEn: string;
}

/**
 * Dedicated customer-facing category owned exclusively by the Digital Menu
 * (independent of internal ERP ProductCategory / production departments).
 */
export interface DigitalMenuCategory {
  id: string;
  nameFa: string;
  nameEn: string;
  descriptionFa?: string;
  descriptionEn?: string;
  visible: boolean;
  displayOrder: number;
}

/**
 * Legacy type retained only for backward-compatibility with older backups.
 */
export interface DigitalMenuCategorySetting {
  categoryId: string;
  visible: boolean;
  displayOrder: number;
  nameFaOverride?: string;
  nameEn?: string;
  descriptionFa?: string;
  descriptionEn?: string;
}

/**
 * Opt-in reference to an existing ERP Product (single source of truth for pricing).
 * Only products explicitly added to `config.products` are included in the Digital Menu.
 */
export interface DigitalMenuProductSetting {
  productId: string;
  menuCategoryId: string;
  visible: boolean;
  featured: boolean;
  isAvailable: boolean;
  displayOrder: number;
  imageUrl?: string;
  nameFaOverride?: string;
  nameEn?: string;
  descriptionFa?: string;
  descriptionEn?: string;
  allergens?: string[];
  dietaryLabels?: string[];
}

export interface DigitalMenuConfig {
  enabled: boolean;
  updatedAt?: string;
  appearance: DigitalMenuAppearance;
  menuCategories: DigitalMenuCategory[];
  /** @deprecated Legacy ERP category overrides (unused in standalone menu-category mode) */
  categories?: Record<string, DigitalMenuCategorySetting>;
  /** Opt-in map of ERP productId -> Digital Menu display settings & assigned menuCategoryId */
  products: Record<string, DigitalMenuProductSetting>;
}

export interface PublicMenuCategory {
  id: string;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  descriptionEn: string;
  displayOrder: number;
  productCount: number;
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  code: string;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  descriptionEn: string;
  imageUrl: string;
  priceRials: number;
  displayPrice: number;
  unit: string;
  weightGrams: number | null;
  featured: boolean;
  isAvailable: boolean;
  displayOrder: number;
  allergens: string[];
  dietaryLabels: string[];
}

export interface PublicDigitalMenuPayload {
  enabled: boolean;
  generatedAt: string;
  updatedAt: string;
  sourcePeriodId: string;
  sourcePeriodName: string;
  appearance: {
    cafeNameFa: string;
    cafeNameEn: string;
    taglineFa: string;
    taglineEn: string;
    logoUrl: string;
    coverImageUrl: string;
    backgroundColor: string;
    primaryColor: string;
    secondaryColor: string;
    defaultLanguage: DigitalMenuLanguage;
    currencyMode: DigitalMenuCurrencyMode;
    unavailableBehavior: DigitalMenuUnavailableMode;
    showPrices: boolean;
    showFeaturedSection: boolean;
    addressFa: string;
    addressEn: string;
    hoursFa: string;
    hoursEn: string;
    instagramHandle: string;
    phoneDisplay: string;
    waiterNoticeFa: string;
    waiterNoticeEn: string;
  };
  categories: PublicMenuCategory[];
  products: PublicMenuProduct[];
}

export const DEFAULT_DIGITAL_MENU_CATEGORIES: DigitalMenuCategory[] = [
  {
    id: 'dmcat-hot-coffee',
    nameFa: 'قهوه گرم',
    nameEn: 'Hot Coffee',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 10,
  },
  {
    id: 'dmcat-iced-coffee',
    nameFa: 'قهوه سرد',
    nameEn: 'Iced Coffee',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 20,
  },
  {
    id: 'dmcat-tea-infusions',
    nameFa: 'چای و دمنوش',
    nameEn: 'Tea & Infusions',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 30,
  },
  {
    id: 'dmcat-cold-drinks',
    nameFa: 'نوشیدنی‌های سرد',
    nameEn: 'Cold Drinks',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 40,
  },
  {
    id: 'dmcat-pastries',
    nameFa: 'کروسان و شیرینی',
    nameEn: 'Pastries',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 50,
  },
  {
    id: 'dmcat-cakes-desserts',
    nameFa: 'کیک و دسر',
    nameEn: 'Cakes & Desserts',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 60,
  },
  {
    id: 'dmcat-breakfast',
    nameFa: 'صبحانه',
    nameEn: 'Breakfast',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 70,
  },
  {
    id: 'dmcat-sandwiches',
    nameFa: 'ساندویچ و غذاهای سبک',
    nameEn: 'Sandwiches & Light Meals',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 80,
  },
  {
    id: 'dmcat-finger-food',
    nameFa: 'فینگر فود و اسنک',
    nameEn: 'Finger Food & Snacks',
    descriptionFa: '',
    descriptionEn: '',
    visible: true,
    displayOrder: 90,
  },
];

export const DEFAULT_DIGITAL_MENU_APPEARANCE: DigitalMenuAppearance = {
  cafeNameFa: 'نان، شیرینی و کافه گاتان',
  cafeNameEn: 'Gatan Bakery & Café',
  taglineFa: 'پخت تازه روزانه نان‌های آرتیزان، شیرینی‌های فرانسوی، فینگرفود و قهوه تخصصی',
  taglineEn: 'Daily artisan breads, French patisserie, handcrafted finger food & specialty coffee',
  logoUrl: '',
  coverImageUrl: '',
  backgroundColor: '#F8F3EB',
  primaryColor: '#362419',
  secondaryColor: '#B8814D',
  defaultLanguage: 'fa',
  currencyMode: 'toman',
  unavailableBehavior: 'badge',
  showPrices: true,
  showFeaturedSection: true,
  publicBaseUrl: '',
  sourcePeriodId: '',
  addressFa: '',
  addressEn: '',
  hoursFa: 'همه‌روزه از ۸:۰۰ تا ۲۲:۳۰',
  hoursEn: 'Daily, 08:00 – 22:30',
  instagramHandle: '',
  phoneDisplay: '',
  waiterNoticeFa: 'برای ثبت سفارش، لطفاً با همکاران سالن کافه هماهنگ بفرمایید.',
  waiterNoticeEn: 'To place your order, please speak with a member of our café team.',
};

export const DEFAULT_DIGITAL_MENU_CONFIG: DigitalMenuConfig = {
  enabled: true,
  appearance: { ...DEFAULT_DIGITAL_MENU_APPEARANCE },
  menuCategories: DEFAULT_DIGITAL_MENU_CATEGORIES.map((c) => ({ ...c })),
  products: {},
};

const VALID_ALLERGEN_IDS = new Set(ALLERGEN_OPTIONS.map((a) => a.id));
const VALID_DIETARY_IDS = new Set(DIETARY_OPTIONS.map((d) => d.id));

const SAFE_DATA_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: unknown): boolean {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim());
}

/**
 * Validates image URLs strictly to prevent XSS (blocks javascript:, data:text/html, data:image/svg+xml, etc.).
 */
export function isSafeMenuImageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 3_500_000) return false;
  if (SAFE_DATA_IMAGE_REGEX.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('..')) {
    return /^\/[A-Za-z0-9/_\-.%]+$/.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSafePublicBaseUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 300) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function clampString(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLen);
}

function clampOrder(value: unknown, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(-9999, Math.min(99999, Math.round(num)));
}

export function sanitizeDigitalMenuConfig(input: unknown): DigitalMenuConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<DigitalMenuConfig>;
  const rawApp = (raw.appearance && typeof raw.appearance === 'object'
    ? raw.appearance
    : {}) as Partial<DigitalMenuAppearance>;

  const logoCandidate = typeof rawApp.logoUrl === 'string' ? rawApp.logoUrl.trim() : '';
  const coverCandidate = typeof rawApp.coverImageUrl === 'string' ? rawApp.coverImageUrl.trim() : '';
  const baseUrlCandidate = typeof rawApp.publicBaseUrl === 'string' ? rawApp.publicBaseUrl.trim().replace(/\/+$/, '') : '';

  const appearance: DigitalMenuAppearance = {
    cafeNameFa: clampString(rawApp.cafeNameFa, 120, DEFAULT_DIGITAL_MENU_APPEARANCE.cafeNameFa) || DEFAULT_DIGITAL_MENU_APPEARANCE.cafeNameFa,
    cafeNameEn: clampString(rawApp.cafeNameEn, 120, DEFAULT_DIGITAL_MENU_APPEARANCE.cafeNameEn) || DEFAULT_DIGITAL_MENU_APPEARANCE.cafeNameEn,
    taglineFa: clampString(rawApp.taglineFa, 240, DEFAULT_DIGITAL_MENU_APPEARANCE.taglineFa),
    taglineEn: clampString(rawApp.taglineEn, 240, DEFAULT_DIGITAL_MENU_APPEARANCE.taglineEn),
    logoUrl: isSafeMenuImageUrl(logoCandidate) ? logoCandidate : '',
    coverImageUrl: isSafeMenuImageUrl(coverCandidate) ? coverCandidate : '',
    backgroundColor: isValidHexColor(rawApp.backgroundColor)
      ? rawApp.backgroundColor!.trim()
      : DEFAULT_DIGITAL_MENU_APPEARANCE.backgroundColor,
    primaryColor: isValidHexColor(rawApp.primaryColor)
      ? rawApp.primaryColor!.trim()
      : DEFAULT_DIGITAL_MENU_APPEARANCE.primaryColor,
    secondaryColor: isValidHexColor(rawApp.secondaryColor)
      ? rawApp.secondaryColor!.trim()
      : DEFAULT_DIGITAL_MENU_APPEARANCE.secondaryColor,
    defaultLanguage: rawApp.defaultLanguage === 'en' ? 'en' : 'fa',
    currencyMode: rawApp.currencyMode === 'rial' ? 'rial' : 'toman',
    unavailableBehavior: rawApp.unavailableBehavior === 'hide' ? 'hide' : 'badge',
    showPrices: rawApp.showPrices !== false,
    showFeaturedSection: rawApp.showFeaturedSection !== false,
    publicBaseUrl: isSafePublicBaseUrl(baseUrlCandidate) ? baseUrlCandidate : '',
    sourcePeriodId: clampString(rawApp.sourcePeriodId, 64, ''),
    addressFa: clampString(rawApp.addressFa, 220, ''),
    addressEn: clampString(rawApp.addressEn, 220, ''),
    hoursFa: clampString(rawApp.hoursFa, 120, DEFAULT_DIGITAL_MENU_APPEARANCE.hoursFa),
    hoursEn: clampString(rawApp.hoursEn, 120, DEFAULT_DIGITAL_MENU_APPEARANCE.hoursEn),
    instagramHandle: clampString(rawApp.instagramHandle, 80, '').replace(/^@+/, ''),
    phoneDisplay: clampString(rawApp.phoneDisplay, 60, ''),
    waiterNoticeFa:
      clampString(rawApp.waiterNoticeFa, 200, DEFAULT_DIGITAL_MENU_APPEARANCE.waiterNoticeFa) ||
      DEFAULT_DIGITAL_MENU_APPEARANCE.waiterNoticeFa,
    waiterNoticeEn:
      clampString(rawApp.waiterNoticeEn, 200, DEFAULT_DIGITAL_MENU_APPEARANCE.waiterNoticeEn) ||
      DEFAULT_DIGITAL_MENU_APPEARANCE.waiterNoticeEn,
  };

  // Standalone Digital Menu Categories: seed defaults ONLY when undefined (never overwrite an intentional empty list)
  let menuCategories: DigitalMenuCategory[];
  if (Array.isArray(raw.menuCategories)) {
    const seenCatIds = new Set<string>();
    menuCategories = [];
    raw.menuCategories.forEach((cat, idx) => {
      if (!cat || typeof cat !== 'object') return;
      const id = clampString(cat.id, 120) || `dmcat-${idx + 1}`;
      if (seenCatIds.has(id)) return;
      const nameFa = clampString(cat.nameFa, 120, '');
      const nameEn = clampString(cat.nameEn, 120, '');
      if (!nameFa && !nameEn) return;
      seenCatIds.add(id);
      menuCategories.push({
        id,
        nameFa: nameFa || nameEn,
        nameEn,
        descriptionFa: clampString(cat.descriptionFa, 260, ''),
        descriptionEn: clampString(cat.descriptionEn, 260, ''),
        visible: cat.visible !== false,
        displayOrder: clampOrder(cat.displayOrder, (idx + 1) * 10),
      });
    });
    menuCategories.sort((a, b) => a.displayOrder - b.displayOrder);
  } else {
    menuCategories = DEFAULT_DIGITAL_MENU_CATEGORIES.map((c) => ({ ...c }));
  }

  const products: Record<string, DigitalMenuProductSetting> = {};
  if (raw.products && typeof raw.products === 'object') {
    for (const [key, val] of Object.entries(raw.products)) {
      const prodId = clampString(key, 120);
      if (!prodId || !val || typeof val !== 'object') continue;
      const entry = val as Partial<DigitalMenuProductSetting>;
      const imgCandidate = typeof entry.imageUrl === 'string' ? entry.imageUrl.trim() : '';
      const allergens = Array.isArray(entry.allergens)
        ? Array.from(new Set(entry.allergens.filter((a): a is string => typeof a === 'string' && VALID_ALLERGEN_IDS.has(a))))
        : [];
      const dietaryLabels = Array.isArray(entry.dietaryLabels)
        ? Array.from(new Set(entry.dietaryLabels.filter((d): d is string => typeof d === 'string' && VALID_DIETARY_IDS.has(d))))
        : [];
      products[prodId] = {
        productId: prodId,
        menuCategoryId: clampString(entry.menuCategoryId, 120, ''),
        visible: entry.visible !== false,
        featured: Boolean(entry.featured),
        isAvailable: entry.isAvailable !== false,
        displayOrder: clampOrder(entry.displayOrder, 0),
        imageUrl: isSafeMenuImageUrl(imgCandidate) ? imgCandidate : '',
        nameFaOverride: clampString(entry.nameFaOverride, 140, ''),
        nameEn: clampString(entry.nameEn, 140, ''),
        descriptionFa: clampString(entry.descriptionFa, 600, ''),
        descriptionEn: clampString(entry.descriptionEn, 600, ''),
        allergens,
        dietaryLabels,
      };
    }
  }

  return {
    enabled: raw.enabled !== false,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : new Date().toISOString(),
    appearance,
    menuCategories,
    products,
  };
}

export interface ErpPeriodLike {
  id: string;
  name: string;
  isActive?: boolean;
}

export interface ErpCategoryLike {
  id: string;
  periodId: string;
  name: string;
}

export interface ErpProductLike {
  id: string;
  periodId: string;
  code?: string;
  name: string;
  categoryId: string;
  unit?: string;
  salePrice?: number;
  approvedPrice?: number;
  weight?: number;
  isWip?: boolean;
}

/**
 * Single-source-of-truth live price calculation directly from ERP Product record.
 * Approved price takes priority when > 0; otherwise uses ERP salePrice.
 */
export function resolveLiveErpPriceRials(product: Pick<ErpProductLike, 'salePrice' | 'approvedPrice'>): number {
  const approved = Number(product.approvedPrice || 0);
  if (Number.isFinite(approved) && approved > 0) {
    return Math.round(approved);
  }
  const sale = Number(product.salePrice || 0);
  return Number.isFinite(sale) && sale > 0 ? Math.round(sale) : 0;
}

export function convertPriceForDisplay(priceRials: number, currencyMode: DigitalMenuCurrencyMode): number {
  if (!Number.isFinite(priceRials) || priceRials <= 0) return 0;
  return currencyMode === 'toman' ? Math.round(priceRials / 10) : Math.round(priceRials);
}

/**
 * Determines which ERP period should supply live product prices to the public menu.
 */
export function resolveDigitalMenuPeriod(
  periods: ErpPeriodLike[],
  products: ErpProductLike[],
  preferredPeriodId?: string
): { id: string; name: string } {
  const safePeriods = Array.isArray(periods) ? periods : [];
  if (preferredPeriodId) {
    const matched = safePeriods.find((p) => p.id === preferredPeriodId);
    if (matched) return { id: matched.id, name: matched.name };
  }

  const nonWipByPeriod = new Set(
    (Array.isArray(products) ? products : [])
      .filter((p) => !p.isWip && p.periodId)
      .map((p) => p.periodId)
  );

  const activeWithProducts = [...safePeriods]
    .reverse()
    .find((p) => p.isActive !== false && nonWipByPeriod.has(p.id));
  if (activeWithProducts) {
    return { id: activeWithProducts.id, name: activeWithProducts.name };
  }

  const anyWithProducts = [...safePeriods].reverse().find((p) => nonWipByPeriod.has(p.id));
  if (anyWithProducts) {
    return { id: anyWithProducts.id, name: anyWithProducts.name };
  }

  const firstActive = safePeriods.find((p) => p.isActive !== false) || safePeriods[0];
  if (firstActive) {
    return { id: firstActive.id, name: firstActive.name };
  }

  return { id: '', name: '' };
}

/**
 * Pure projection builder:
 * - Uses ONLY standalone Digital Menu categories (`config.menuCategories`) — NOT ERP product categories or production departments.
 * - Uses ONLY opt-in products explicitly added to `config.products` (zero ERP products shown by default).
 * - Resolves live ERP price & metadata directly from the original ERP Product record (single source of truth).
 * - NEVER exposes cogsPrice, accountId, barcode, targetMargin, suppliers, users, or internal notes.
 */
export function buildPublicDigitalMenuPayload(input: {
  periods?: ErpPeriodLike[];
  productCategories?: ErpCategoryLike[];
  products?: ErpProductLike[];
  digitalMenu?: DigitalMenuConfig | null;
}): PublicDigitalMenuPayload {
  const config = sanitizeDigitalMenuConfig(input.digitalMenu || DEFAULT_DIGITAL_MENU_CONFIG);
  const periods = Array.isArray(input.periods) ? input.periods : [];
  const allProducts = Array.isArray(input.products) ? input.products : [];

  const resolvedPeriod = resolveDigitalMenuPeriod(
    periods,
    allProducts,
    config.appearance.sourcePeriodId
  );

  // Build fast lookup map of non-WIP ERP products, preferring the resolved period when IDs match
  const erpProductById = new Map<string, ErpProductLike>();
  for (const p of allProducts) {
    if (!p || !p.id || p.isWip) continue;
    const existing = erpProductById.get(p.id);
    if (!existing || (resolvedPeriod.id && p.periodId === resolvedPeriod.id)) {
      erpProductById.set(p.id, p);
    }
  }

  // Visible standalone Digital Menu categories in configured order
  const visibleMenuCategories = config.menuCategories
    .filter((c) => c.visible !== false)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const visibleCategoryIdSet = new Set(visibleMenuCategories.map((c) => c.id));

  // Project ONLY opt-in products explicitly added to the Digital Menu
  const projectedProducts: Array<PublicMenuProduct & { _origIdx: number }> = [];
  const productSettingsList = Object.values(config.products);

  for (let idx = 0; idx < productSettingsList.length; idx++) {
    const setting = productSettingsList[idx];
    if (!setting || !setting.productId || !setting.visible) continue;
    if (!setting.menuCategoryId || !visibleCategoryIdSet.has(setting.menuCategoryId)) {
      continue;
    }

    const erpProd = erpProductById.get(setting.productId);
    if (!erpProd) continue;

    const isAvailable = setting.isAvailable !== false;
    if (!isAvailable && config.appearance.unavailableBehavior === 'hide') {
      continue;
    }

    const priceRials = resolveLiveErpPriceRials(erpProd);
    const displayPrice = convertPriceForDisplay(priceRials, config.appearance.currencyMode);
    const nameFa = (setting.nameFaOverride || '').trim() || erpProd.name;
    const nameEn = (setting.nameEn || '').trim();
    const weightNum = Number(erpProd.weight || 0);

    projectedProducts.push({
      id: erpProd.id,
      categoryId: setting.menuCategoryId,
      code: String(erpProd.code || '').trim(),
      nameFa,
      nameEn,
      descriptionFa: (setting.descriptionFa || '').trim(),
      descriptionEn: (setting.descriptionEn || '').trim(),
      imageUrl: setting.imageUrl && isSafeMenuImageUrl(setting.imageUrl) ? setting.imageUrl : '',
      priceRials,
      displayPrice,
      unit: erpProd.unit === 'کیلو' ? 'کیلو' : 'عدد',
      weightGrams: Number.isFinite(weightNum) && weightNum > 0 ? Math.round(weightNum) : null,
      featured: Boolean(setting.featured),
      isAvailable,
      displayOrder: setting.displayOrder,
      allergens: Array.isArray(setting.allergens) ? setting.allergens : [],
      dietaryLabels: Array.isArray(setting.dietaryLabels) ? setting.dietaryLabels : [],
      _origIdx: idx,
    });
  }

  projectedProducts.sort((a, b) => a.displayOrder - b.displayOrder || a._origIdx - b._origIdx);

  const countByCategory = new Map<string, number>();
  for (const p of projectedProducts) {
    countByCategory.set(p.categoryId, (countByCategory.get(p.categoryId) || 0) + 1);
  }

  const finalCategories: PublicMenuCategory[] = visibleMenuCategories
    .map((c) => ({
      id: c.id,
      nameFa: c.nameFa,
      nameEn: c.nameEn,
      descriptionFa: (c.descriptionFa || '').trim(),
      descriptionEn: (c.descriptionEn || '').trim(),
      displayOrder: c.displayOrder,
      productCount: countByCategory.get(c.id) || 0,
    }))
    .filter((c) => c.productCount > 0);

  const finalProducts: PublicMenuProduct[] = projectedProducts.map(({ _origIdx: _ignored, ...rest }) => rest);

  return {
    enabled: config.enabled,
    generatedAt: new Date().toISOString(),
    updatedAt: config.updatedAt || new Date().toISOString(),
    sourcePeriodId: resolvedPeriod.id,
    sourcePeriodName: resolvedPeriod.name,
    appearance: {
      cafeNameFa: config.appearance.cafeNameFa,
      cafeNameEn: config.appearance.cafeNameEn,
      taglineFa: config.appearance.taglineFa,
      taglineEn: config.appearance.taglineEn,
      logoUrl: config.appearance.logoUrl,
      coverImageUrl: config.appearance.coverImageUrl,
      backgroundColor: config.appearance.backgroundColor,
      primaryColor: config.appearance.primaryColor,
      secondaryColor: config.appearance.secondaryColor,
      defaultLanguage: config.appearance.defaultLanguage,
      currencyMode: config.appearance.currencyMode,
      unavailableBehavior: config.appearance.unavailableBehavior,
      showPrices: config.appearance.showPrices,
      showFeaturedSection: config.appearance.showFeaturedSection,
      addressFa: config.appearance.addressFa,
      addressEn: config.appearance.addressEn,
      hoursFa: config.appearance.hoursFa,
      hoursEn: config.appearance.hoursEn,
      instagramHandle: config.appearance.instagramHandle,
      phoneDisplay: config.appearance.phoneDisplay,
      waiterNoticeFa: config.appearance.waiterNoticeFa,
      waiterNoticeEn: config.appearance.waiterNoticeEn,
    },
    categories: finalCategories,
    products: finalProducts,
  };
}
