/**
 * Pure offline ISO/IEC 15417 Code 128B linear barcode SVG generator & unique system barcode generator.
 * Produces crisp, scanner-ready vector barcodes for shelf labels, warehouse count sheets, and printouts.
 */

import { toEnglishDigits } from './persianUtils';

// Code 128 bar/space width patterns (indices 0..106)
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112'
];

const START_B = 104;
const STOP = 106;

export interface BarcodeSvgOptions {
  height?: number;
  moduleWidth?: number;
  quietZoneModules?: number;
  showText?: boolean;
  fontSize?: number;
  maxWidth?: string;
  maxWidthPx?: number;
}

/**
 * Generates an inline SVG string for a scannable Code 128B linear barcode.
 */
export function generateCode128Svg(rawValue: string, options: BarcodeSvgOptions = {}): string {
  const cleaned = toEnglishDigits(String(rawValue || ''))
    .trim()
    .replace(/[^\x20-\x7E]/g, '');

  if (!cleaned) return '';

  const barHeight = options.height ?? 26;
  const moduleWidth = options.moduleWidth ?? 1;
  const quietZone = options.quietZoneModules ?? 6;
  const showText = options.showText ?? true;
  const fontSize = options.fontSize ?? 8;

  // Build Code 128B symbol list
  const codes: number[] = [START_B];
  let checksum = START_B;

  for (let i = 0; i < cleaned.length; i++) {
    const val = cleaned.charCodeAt(i) - 32;
    codes.push(val);
    checksum += val * (i + 1);
  }

  codes.push(checksum % 103);
  codes.push(STOP);

  let x = quietZone * moduleWidth;
  const rects: string[] = [];

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) continue;
    for (let j = 0; j < pattern.length; j++) {
      const width = parseInt(pattern[j], 10) * moduleWidth;
      if (j % 2 === 0) {
        rects.push(`<rect x="${Number(x.toFixed(2))}" y="0" width="${Number(width.toFixed(2))}" height="${barHeight}" fill="#000000" />`);
      }
      x += width;
    }
  }

  const totalWidth = Number((x + quietZone * moduleWidth).toFixed(2));
  const textAreaHeight = showText ? Math.max(10, Math.round(fontSize * 1.25)) : 0;
  const totalHeight = barHeight + textAreaHeight;

  const escapedText = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const widthStyle = options.maxWidthPx
    ? `width: ${Math.min(totalWidth, options.maxWidthPx)}px; max-width: 100%;`
    : `width: ${options.maxWidth ?? '100%'};`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" style="${widthStyle} height: ${totalHeight}px; display: block; margin: 0 auto; direction: ltr;" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff" />
    ${rects.join('')}
    ${showText ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${barHeight + textAreaHeight - 1.5}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="700" fill="#000000" letter-spacing="0.8">${escapedText}</text>` : ''}
  </svg>`;
}

/**
 * Alias preserving compatibility with existing warehouse/item management imports.
 */
export const generateCode128SvgString = generateCode128Svg;

/**
 * Generates the next unique 8-digit numeric system barcode (starting at 90000001).
 */
export function generateNextSystemBarcode(
  items: Array<{ systemBarcode?: string; barcode?: string }>,
  excludeSet?: Set<string>
): string {
  const used = new Set<string>();
  let maxNum = 90000000;

  const registerCode = (raw?: string) => {
    const clean = toEnglishDigits(String(raw || '')).trim();
    if (!clean) return;
    used.add(clean.toLowerCase());
    if (/^\d{8,}$/.test(clean)) {
      const n = parseInt(clean, 10);
      if (n >= 90000000 && n < 99999999 && n > maxNum) {
        maxNum = n;
      }
    }
  };

  (items || []).forEach(item => {
    registerCode(item.systemBarcode);
    registerCode(item.barcode);
  });

  if (excludeSet) {
    excludeSet.forEach(code => registerCode(code));
  }

  let candidate = maxNum + 1;
  while (used.has(String(candidate))) {
    candidate += 1;
  }
  return String(candidate);
}
