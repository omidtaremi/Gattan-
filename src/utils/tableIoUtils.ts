import * as XLSX from 'xlsx';
import { decodeFileBuffer, parseCSVText } from './csvUtils';

/**
 * Exports an array of flat Persian-keyed objects to an RTL-friendly .xlsx workbook.
 */
export function exportRowsToExcel(
  rows: Record<string, string | number | boolean | null | undefined>[],
  sheetName: string,
  fileName: string
): void {
  const safeSheetName = (sheetName || 'گزارش').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet1';
  const safeRows = rows.length > 0 ? rows : [{ 'پیام': 'اطلاعاتی برای خروجی وجود ندارد' }];
  const ws = XLSX.utils.json_to_sheet(safeRows);
  ws['!views'] = [{ RTL: true }];
  const keys = Object.keys(safeRows[0] || {});
  ws['!cols'] = keys.map(k => ({ wch: Math.max(16, Math.min(38, k.length + 10)) }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
  const finalName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  XLSX.writeFile(wb, finalName);
}

/**
 * Downloads a ready-to-fill Excel (.xlsx) sample template with Persian headers and optional sample rows.
 */
export function downloadTemplateExcel(
  headers: string[],
  sampleRows: Record<string, string | number>[],
  sheetName: string,
  fileName: string
): void {
  const safeSheetName = (sheetName || 'قالب_نمونه').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Template';
  const rowsToWrite =
    sampleRows.length > 0
      ? sampleRows
      : [Object.fromEntries(headers.map(h => [h, '']))];
  const ws = XLSX.utils.json_to_sheet(rowsToWrite, { header: headers });
  ws['!views'] = [{ RTL: true }];
  ws['!cols'] = headers.map(h => ({ wch: Math.max(18, Math.min(36, h.length + 10)) }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
  const finalName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  XLSX.writeFile(wb, finalName);
}

/**
 * Reads an uploaded .xlsx, .xls, or .csv file into normalized array of key-value records.
 */
export async function readSpreadsheetRows(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = decodeFileBuffer(buffer);
    const matrix = parseCSVText(text);
    if (matrix.length < 2) return [];
    const headers = matrix[0].map(h => h.trim());
    return matrix
      .slice(1)
      .filter(r => r.some(cell => String(cell ?? '').trim() !== ''))
      .map(r => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          if (h) obj[h] = String(r[idx] ?? '').trim();
        });
        return obj;
      });
  }

  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rawRows
    .map(row => {
      const normalized: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => {
        const cleanKey = String(k).trim();
        if (cleanKey) normalized[cleanKey] = String(v ?? '').trim();
      });
      return normalized;
    })
    .filter(row => Object.values(row).some(v => v !== ''));
}

/**
 * Picks the first non-empty string value from a row using multiple candidate column headers.
 */
export function pickRowField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  const normalizedEntries = Object.entries(row).map(([k, v]) => [k.replace(/\s+/g, '').toLowerCase(), v] as const);
  for (const key of keys) {
    const target = key.replace(/\s+/g, '').toLowerCase();
    const hit = normalizedEntries.find(([k]) => k === target || k.includes(target));
    if (hit && String(hit[1]).trim() !== '') {
      return String(hit[1]).trim();
    }
  }
  return '';
}
