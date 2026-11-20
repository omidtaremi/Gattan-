import { Item } from '../types';
import { toEnglishDigits } from './persianUtils';

/**
 * ISO/IEC 15417 Code 128B encoding table (patterns of 11 modules for values 0..105,
 * plus 13-module Stop pattern at index 106).
 * Code 128B encodes all printable ASCII characters (32..126), including 0-9, A-Z, a-z, '-' etc.,
 * and is universally supported by laser, CCD, and camera USB barcode scanners.
 */
const CODE128_PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '1100011101011',
];

const START_B_CODE = 104;
const START_C_CODE = 105;
const STOP_CODE = 106;

const escapeXml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Encodes an ASCII string into Code 128 binary modules (0 = space, 1 = bar).
 * Uses compact Code 128C when the entire value is an even-length all-digit string (>= 4 digits),
 * which yields narrower, easier-to-scan bars on dense A4 sheets; falls back to Code 128B otherwise.
 */
const encodeCode128Bits = (raw: string): string | null => {
  const normalized = toEnglishDigits(raw || '').trim();
  if (!normalized) return null;

  // Validate ASCII 32..126
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code < 32 || code > 126) return null;
  }

  const useCodeC = /^\d+$/.test(normalized) && normalized.length >= 4 && normalized.length % 2 === 0;
  const codes: number[] = [];

  if (useCodeC) {
    codes.push(START_C_CODE);
    for (let i = 0; i < normalized.length; i += 2) {
      codes.push(parseInt(normalized.slice(i, i + 2), 10));
    }
  } else {
    codes.push(START_B_CODE);
    for (let i = 0; i < normalized.length; i++) {
      codes.push(normalized.charCodeAt(i) - 32);
    }
  }

  // Compute Mod 103 checksum
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i;
  }
  codes.push(checksum % 103);
  codes.push(STOP_CODE);

  return codes.map((c) => CODE128_PATTERNS[c]).join('');
};

export interface Code128SvgOptions {
  height?: number;
  moduleWidth?: number;
  quietZoneModules?: number;
  showText?: boolean;
  fontSize?: number;
  maxWidthPx?: number;
}

/**
 * Generates an inline, offline-safe, scanner-accurate Code 128 SVG markup string.
 */
export const generateCode128SvgString = (
  value: string,
  options: Code128SvgOptions = {}
): string => {
  const normalized = toEnglishDigits(value || '').trim();
  if (!normalized) return '';

  const bits = encodeCode128Bits(normalized);
  if (!bits) {
    return `<span style="font-family:monospace;font-size:9px;direction:ltr;display:inline-block;">${escapeXml(normalized)}</span>`;
  }

  const height = options.height ?? 28;
  const moduleWidth = options.moduleWidth ?? 1.2;
  const quietZone = options.quietZoneModules ?? 8;
  const showText = options.showText ?? true;
  const fontSize = options.fontSize ?? 8;

  const totalModules = bits.length + quietZone * 2;
  const viewWidth = Number((totalModules * moduleWidth).toFixed(2));
  const textAreaHeight = showText ? Math.ceil(fontSize + 4) : 0;
  const viewHeight = height + textAreaHeight;

  // Merge consecutive '1' bars into single <rect> elements for smaller, sharper SVG
  const rects: string[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const start = i;
      while (i < bits.length && bits[i] === '1') i++;
      const runLen = i - start;
      const x = Number(((quietZone + start) * moduleWidth).toFixed(2));
      const w = Number((runLen * moduleWidth).toFixed(2));
      rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`);
    } else {
      i++;
    }
  }

  const textEl = showText
    ? `<text x="${(viewWidth / 2).toFixed(2)}" y="${height + fontSize + 1}" text-anchor="middle" font-family="monospace, sans-serif" font-size="${fontSize}" font-weight="700" fill="#111" letter-spacing="0.8">${escapeXml(normalized)}</text>`
    : '';

  const maxWidthStyle = options.maxWidthPx ? `max-width:${options.maxWidthPx}px;` : 'max-width:100%;';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" width="${viewWidth}" height="${viewHeight}" shape-rendering="crispEdges" style="display:block;margin:0 auto;height:auto;${maxWidthStyle}background:#fff;"><rect x="0" y="0" width="${viewWidth}" height="${viewHeight}" fill="#fff"/>${rects.join('')}${textEl}</svg>`;
};

/**
 * Generates the next unique 8-digit numeric system barcode (starting at 90000001).
 * Numeric-only values avoid Persian/English keyboard layout mismatches on USB barcode scanners
 * and benefit from ultra-compact Code 128C encoding.
 */
export const generateNextSystemBarcode = (
  existingItems: Item[],
  extraUsed?: Set<string>
): string => {
  const used = new Set<string>();
  let maxNum = 90000000;

  for (const item of existingItems) {
    const sys = toEnglishDigits(item.systemBarcode || '').trim();
    if (sys) {
      used.add(sys);
      if (/^\d{8}$/.test(sys)) {
        const n = parseInt(sys, 10);
        if (n > maxNum && n < 99999999) maxNum = n;
      }
    }
    const bar = toEnglishDigits(item.barcode || '').trim();
    if (bar) used.add(bar);
  }

  if (extraUsed) {
    extraUsed.forEach((v) => {
      const clean = toEnglishDigits(v || '').trim();
      if (clean) {
        used.add(clean);
        if (/^\d{8}$/.test(clean)) {
          const n = parseInt(clean, 10);
          if (n > maxNum && n < 99999999) maxNum = n;
        }
      }
    });
  }

  let candidate = maxNum + 1;
  while (used.has(String(candidate))) {
    candidate += 1;
  }
  return String(candidate);
};
