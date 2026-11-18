/**
 * Utility for robust CSV reading and decoding, supporting Persian Windows-1256 ANSI, UTF-8, and UTF-16 encoding,
 * and automatic delimiter detection (comma, semicolon, or tab) which is typical for Excel Persian environments.
 */

/**
 * Decodes an ArrayBuffer (from FileReader.readAsArrayBuffer) into a proper JavaScript string.
 * It automatically handles UTF-8 (with or without BOM), UTF-16 LE, and Windows-1256 (ANSI Persian).
 */
export function decodeFileBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // 1. Check for UTF-8 BOM (Byte Order Mark)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes.subarray(3));
  }

  // 2. Check for UTF-16 LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    const decoder = new TextDecoder('utf-16le');
    return decoder.decode(bytes.subarray(2));
  }

  // 3. Try to decode with UTF-8 (set fatal to true to throw on invalid byte sequences)
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(bytes);
  } catch (e) {
    // If it fails, it means there are non-UTF-8 bytes (such as Windows-1256 Persian ANSI characters).
    // Let's decode it using Windows-1256.
    try {
      const win1256Decoder = new TextDecoder('windows-1256');
      return win1256Decoder.decode(bytes);
    } catch (err) {
      // Fallback to standard UTF-8 if all else fails
      const fallbackDecoder = new TextDecoder('utf-8');
      return fallbackDecoder.decode(bytes);
    }
  }
}

/**
 * Parses CSV/spreadsheet text into rows of string arrays.
 * It automatically detects the correct delimiter (comma, semicolon, or tab).
 */
export function parseCSVText(text: string): string[][] {
  // Normalize newline sequences and filter out empty lines
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Determine the delimiter (Excel in Persian windows often uses semicolon ';')
  const firstLine = lines[0];
  let delimiter = ',';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    delimiter = ';';
  } else if (tabCount > commaCount && tabCount > semicolonCount) {
    delimiter = '\t';
  }

  return lines.map(line => parseCSVRow(line, delimiter));
}

/**
 * Parses a single CSV row respecting quotation boundaries and double-quote escapes.
 */
export function parseCSVRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let currentWord = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentWord += '"'; // Escaped quotation mark
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(currentWord.trim());
      currentWord = '';
    } else {
      currentWord += char;
    }
  }
  result.push(currentWord.trim());
  return result;
}
