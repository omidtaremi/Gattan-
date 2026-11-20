import { AttendanceRecord, PayrollCalculationRules, Personnel, ProductionSection, Shift } from '../types';
import { toEnglishDigits } from './persianUtils';

export type SmartShiftSourceCategory =
  | 'mismatch'
  | 'no_shift'
  | 'approved_improvement'
  | 'unauthorized_needs_approval';

export type SmartShiftActionMode = 'assign_best_shift' | 'approve_with_best_shift';

export interface CandidateShiftDef {
  id: string;
  name: string;
  startTime: string; // HH:MM in English digits
  endTime: string;   // HH:MM in English digits
}

export interface EvaluatedShiftCandidate {
  shiftId: string;
  name: string;
  startTime: string;
  endTime: string;
  entryDiff: number;
  exitDiff: number;
  diffSum: number;
  delayMin: number;
  unauthorizedPresenceMin: number;
  isMismatch: boolean;
  hasExcessiveDelay: boolean;
  hasExcessiveUnauthorized: boolean;
  isCleanMatch: boolean;
  isSinglePunch: boolean;
}

export interface DiagnosticInputItem {
  employee: Personnel;
  dayNum: number;
  dateStr: string;
  weekday: string;
  firstEntry: string;
  lastExit: string;
  shift: { startTime: string; endTime: string; name?: string } | null;
  entryDiff: number | null;
  exitDiff: number | null;
  delayMin: number;
  unauthorizedPresenceMin: number;
  currentSectionId: string;
  isNoShift?: boolean;
  hasExcessiveDelay?: boolean;
  hasExcessiveUnauthorized?: boolean;
  isAlsoMismatch?: boolean;
  approvalKey?: string;
  approvalKind?: 'mismatch' | 'anomaly';
}

export interface SmartShiftDiagnosticCandidate {
  key: string; // `${employee.id}-${dateStr}`
  sourceCategory: SmartShiftSourceCategory;
  actionMode: SmartShiftActionMode;
  requiresUserApproval: boolean;
  isSameShiftAsCurrent: boolean;
  approvalKeysToAdd: string[];
  mismatch: DiagnosticInputItem & {
    rawTimes: string[];
    currentDiffSum: number | null;
    currentIsAuthorized: boolean;
  };
  suggestedShift: EvaluatedShiftCandidate;
}

export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = toEnglishDigits(timeStr).trim();
  const parts = clean.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function getCircularMinutesDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

export function resolveEntryExitTimesForShift(
  rawTimes: string[],
  shiftStartStr?: string,
  shiftEndStr?: string
): {
  firstEntry: string;
  lastExit: string;
  firstEntryMins: number;
  lastExitMins: number;
  shiftStartMins: number;
  shiftEndMins: number;
  sortedTimes: string[];
} {
  const cleaned = (rawTimes || []).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      firstEntry: '',
      lastExit: '',
      firstEntryMins: 0,
      lastExitMins: 0,
      shiftStartMins: 0,
      shiftEndMins: 0,
      sortedTimes: []
    };
  }

  const sStartRaw = shiftStartStr ? timeToMinutes(toEnglishDigits(shiftStartStr).trim()) : 0;
  const sEndRaw = shiftEndStr ? timeToMinutes(toEnglishDigits(shiftEndStr).trim()) : 0;
  const isOvernight = Boolean(shiftStartStr && shiftEndStr && sEndRaw <= sStartRaw);

  if (isOvernight) {
    const pivot = Math.floor((sStartRaw + sEndRaw) / 2);
    const toTimeline = (t: string) => {
      const m = timeToMinutes(t);
      return m < pivot ? m + 1440 : m;
    };
    const sorted = [...cleaned].sort((a, b) => toTimeline(a) - toTimeline(b));
    return {
      firstEntry: sorted[0],
      lastExit: sorted[sorted.length - 1],
      firstEntryMins: toTimeline(sorted[0]),
      lastExitMins: toTimeline(sorted[sorted.length - 1]),
      shiftStartMins: sStartRaw,
      shiftEndMins: sEndRaw + 1440,
      sortedTimes: sorted
    };
  }

  const sorted = [...cleaned].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  return {
    firstEntry: sorted[0],
    lastExit: sorted[sorted.length - 1],
    firstEntryMins: timeToMinutes(sorted[0]),
    lastExitMins: timeToMinutes(sorted[sorted.length - 1]),
    shiftStartMins: sStartRaw,
    shiftEndMins: sEndRaw,
    sortedTimes: sorted
  };
}

export function buildCandidateShiftsPool(
  productionSections: ProductionSection[] | undefined,
  shifts: Shift[] | undefined
): CandidateShiftDef[] {
  const pool: CandidateShiftDef[] = [];
  const seenIds = new Set<string>();

  (productionSections || []).forEach(sec => {
    if (sec.startTime && sec.endTime && !seenIds.has(sec.id)) {
      seenIds.add(sec.id);
      pool.push({
        id: sec.id,
        name: sec.name,
        startTime: toEnglishDigits(sec.startTime).trim(),
        endTime: toEnglishDigits(sec.endTime).trim()
      });
    }
  });

  const defaultShifts = shifts || [
    { id: 'sh-1', name: 'شیفت صبح', startTime: '06:00', endTime: '14:00' },
    { id: 'sh-2', name: 'شیفت عصر', startTime: '14:00', endTime: '22:00' },
    { id: 'sh-3', name: 'شیفت شب', startTime: '22:00', endTime: '06:00' }
  ];

  defaultShifts.forEach(sh => {
    if (sh.startTime && sh.endTime && !seenIds.has(sh.id)) {
      seenIds.add(sh.id);
      pool.push({
        id: sh.id,
        name: sh.name,
        startTime: toEnglishDigits(sh.startTime).trim(),
        endTime: toEnglishDigits(sh.endTime).trim()
      });
    }
  });

  return pool;
}

export function evaluateShiftCandidate(
  rawTimes: string[],
  cand: CandidateShiftDef,
  rules?: Partial<PayrollCalculationRules>
): EvaluatedShiftCandidate | null {
  const cleaned = (rawTimes || []).map(t => toEnglishDigits(String(t || '')).trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const calcEarlyOt = rules?.calculateEarlyOvertime ?? true;
  const calcLateOt = rules?.calculateLateOvertime ?? true;

  if (cleaned.length === 1) {
    const punchMins = timeToMinutes(cleaned[0]);
    const sStart = timeToMinutes(cand.startTime);
    const sEnd = timeToMinutes(cand.endTime);
    const entryDiff = getCircularMinutesDiff(punchMins, sStart);
    const exitDiff = getCircularMinutesDiff(punchMins, sEnd);
    const diffSum = Math.min(entryDiff, exitDiff);
    const isMismatch = entryDiff > 60 && exitDiff > 60;
    return {
      shiftId: cand.id,
      name: cand.name,
      startTime: cand.startTime,
      endTime: cand.endTime,
      entryDiff,
      exitDiff,
      diffSum,
      delayMin: 0,
      unauthorizedPresenceMin: 0,
      isMismatch,
      hasExcessiveDelay: false,
      hasExcessiveUnauthorized: false,
      isCleanMatch: !isMismatch,
      isSinglePunch: true
    };
  }

  const resolved = resolveEntryExitTimesForShift(cleaned, cand.startTime, cand.endTime);
  const entryDiff = getCircularMinutesDiff(resolved.firstEntryMins, resolved.shiftStartMins);
  const exitDiff = getCircularMinutesDiff(resolved.lastExitMins, resolved.shiftEndMins);
  const diffSum = entryDiff + exitDiff;

  let delayMin = 0;
  let overtimeEarlyMin = 0;
  let overtimeLateMin = 0;
  if (resolved.sortedTimes.length >= 2) {
    if (resolved.firstEntryMins > resolved.shiftStartMins) {
      delayMin = resolved.firstEntryMins - resolved.shiftStartMins;
    }
    if (resolved.firstEntryMins < resolved.shiftStartMins) {
      overtimeEarlyMin = resolved.shiftStartMins - resolved.firstEntryMins;
    }
    if (resolved.shiftEndMins && resolved.lastExitMins > resolved.shiftEndMins) {
      overtimeLateMin = resolved.lastExitMins - resolved.shiftEndMins;
    }
  }
  const unauthorizedPresenceMin = (calcEarlyOt ? 0 : overtimeEarlyMin) + (calcLateOt ? 0 : overtimeLateMin);
  const isMismatch = entryDiff > 60 && exitDiff > 60;
  const hasExcessiveDelay = delayMin > 120;
  const hasExcessiveUnauthorized = unauthorizedPresenceMin > 120;

  return {
    shiftId: cand.id,
    name: cand.name,
    startTime: cand.startTime,
    endTime: cand.endTime,
    entryDiff,
    exitDiff,
    diffSum,
    delayMin,
    unauthorizedPresenceMin,
    isMismatch,
    hasExcessiveDelay,
    hasExcessiveUnauthorized,
    isCleanMatch: !isMismatch && !hasExcessiveDelay && !hasExcessiveUnauthorized,
    isSinglePunch: false
  };
}

function compareEvaluatedCandidates(
  a: EvaluatedShiftCandidate,
  b: EvaluatedShiftCandidate,
  currentSectionId: string
): number {
  if (a.isCleanMatch !== b.isCleanMatch) return a.isCleanMatch ? -1 : 1;
  if (a.isMismatch !== b.isMismatch) return !a.isMismatch ? -1 : 1;
  if (a.diffSum !== b.diffSum) return a.diffSum - b.diffSum;

  const penaltyA = a.delayMin + a.unauthorizedPresenceMin;
  const penaltyB = b.delayMin + b.unauthorizedPresenceMin;
  if (penaltyA !== penaltyB) return penaltyA - penaltyB;

  if (a.shiftId === currentSectionId && b.shiftId !== currentSectionId) return -1;
  if (b.shiftId === currentSectionId && a.shiftId !== currentSectionId) return 1;
  return 0;
}

function isStrictlyBetterForApproved(
  best: EvaluatedShiftCandidate,
  currentEval: EvaluatedShiftCandidate | null,
  currentSectionId: string,
  currentIsAuthorized: boolean
): boolean {
  if (!currentSectionId || currentSectionId === 'none') return true;
  if (!currentIsAuthorized) return best.shiftId !== currentSectionId;
  if (!currentEval) return best.shiftId !== currentSectionId;
  if (best.shiftId === currentSectionId) return false;

  if (!currentEval.isCleanMatch && best.isCleanMatch) return true;
  if (currentEval.isMismatch && !best.isMismatch) return true;
  if (best.isMismatch && !currentEval.isMismatch) return false;
  if (best.diffSum < currentEval.diffSum) return true;
  if (best.diffSum === currentEval.diffSum) {
    const bestPenalty = best.delayMin + best.unauthorizedPresenceMin;
    const curPenalty = currentEval.delayMin + currentEval.unauthorizedPresenceMin;
    return bestPenalty < curPenalty;
  }
  return false;
}

export interface RunSmartShiftDiagnosticParams {
  activeMismatches: DiagnosticInputItem[];
  activeAnomalies: DiagnosticInputItem[];
  approvedItems: DiagnosticInputItem[];
  candidateShiftsPool: CandidateShiftDef[];
  getAuthorizedCapabilities: (emp: Personnel) => string[];
  getRawTimesForDay?: (emp: Personnel, dateStr: string) => string[];
  rules?: Partial<PayrollCalculationRules>;
}

export function runSmartShiftDiagnosticEngine({
  activeMismatches,
  activeAnomalies,
  approvedItems,
  candidateShiftsPool,
  getAuthorizedCapabilities,
  getRawTimesForDay,
  rules
}: RunSmartShiftDiagnosticParams): SmartShiftDiagnosticCandidate[] {
  interface MergedBucket {
    key: string;
    baseItem: DiagnosticInputItem;
    fromMismatch: boolean;
    fromNoShift: boolean;
    fromAnomalyDeviation: boolean;
    fromApproved: boolean;
  }

  const buckets = new Map<string, MergedBucket>();

  const ensureBucket = (item: DiagnosticInputItem): MergedBucket => {
    const key = `${item.employee.id}-${item.dateStr}`;
    let existing = buckets.get(key);
    if (!existing) {
      existing = {
        key,
        baseItem: item,
        fromMismatch: false,
        fromNoShift: false,
        fromAnomalyDeviation: false,
        fromApproved: false
      };
      buckets.set(key, existing);
    }
    return existing;
  };

  activeMismatches.forEach(m => {
    const b = ensureBucket(m);
    b.baseItem = m;
    b.fromMismatch = true;
  });

  activeAnomalies.forEach(a => {
    const b = ensureBucket(a);
    // Prefer mismatch base if already present, otherwise use anomaly base
    if (!b.fromMismatch) {
      b.baseItem = a;
    }
    if (a.isNoShift) {
      b.fromNoShift = true;
    }
    if (a.hasExcessiveDelay || a.hasExcessiveUnauthorized) {
      b.fromAnomalyDeviation = true;
    }
    if (a.isAlsoMismatch) {
      b.fromMismatch = true;
    }
  });

  approvedItems.forEach(ap => {
    const b = ensureBucket(ap);
    b.fromApproved = true;
  });

  const results: SmartShiftDiagnosticCandidate[] = [];

  buckets.forEach(bucket => {
    const { key, baseItem, fromMismatch, fromNoShift, fromAnomalyDeviation, fromApproved } = bucket;
    const empCapabilities = getAuthorizedCapabilities(baseItem.employee);

    // STRICT CAPABILITY MATRIX CHECK: employee must have at least one authorized shift
    if (!empCapabilities || empCapabilities.length === 0) return;

    const authorizedPool = candidateShiftsPool.filter(c => empCapabilities.includes(c.id));
    if (authorizedPool.length === 0) return;

    const fallbackTimes = [baseItem.firstEntry, baseItem.lastExit].filter(Boolean);
    const lookedUpTimes = getRawTimesForDay ? getRawTimesForDay(baseItem.employee, baseItem.dateStr) : [];
    const rawTimes = lookedUpTimes && lookedUpTimes.length > 0 ? lookedUpTimes : fallbackTimes;
    if (rawTimes.length === 0) return;

    const evaluatedAuthorized = authorizedPool
      .map(cand => evaluateShiftCandidate(rawTimes, cand, rules))
      .filter((x): x is EvaluatedShiftCandidate => x !== null);

    if (evaluatedAuthorized.length === 0) return;

    evaluatedAuthorized.sort((a, b) => compareEvaluatedCandidates(a, b, baseItem.currentSectionId));
    const best = evaluatedAuthorized[0];

    const currentSectionId = baseItem.currentSectionId || 'none';
    const currentIsAuthorized = currentSectionId !== 'none' && empCapabilities.includes(currentSectionId);

    let currentEval: EvaluatedShiftCandidate | null = null;
    if (currentSectionId !== 'none' && baseItem.shift?.startTime && baseItem.shift?.endTime) {
      currentEval = evaluateShiftCandidate(
        rawTimes,
        {
          id: currentSectionId,
          name: baseItem.shift.name || '',
          startTime: toEnglishDigits(baseItem.shift.startTime).trim(),
          endTime: toEnglishDigits(baseItem.shift.endTime).trim()
        },
        rules
      );
    }

    const hasActiveUnapprovedIssue = fromMismatch || fromNoShift || fromAnomalyDeviation;

    if (hasActiveUnapprovedIssue) {
      if (best.isCleanMatch) {
        // Best authorized shift cleanly resolves the mismatch or no-shift attendance!
        if (best.shiftId === currentSectionId && currentIsAuthorized && !fromNoShift) {
          return;
        }
        const sourceCategory: SmartShiftSourceCategory = fromNoShift ? 'no_shift' : 'mismatch';
        results.push({
          key,
          sourceCategory,
          actionMode: 'assign_best_shift',
          requiresUserApproval: false,
          isSameShiftAsCurrent: best.shiftId === currentSectionId,
          approvalKeysToAdd: [],
          mismatch: {
            ...baseItem,
            rawTimes,
            currentDiffSum: currentEval ? currentEval.diffSum : null,
            currentIsAuthorized
          },
          suggestedShift: best
        });
        return;
      }

      // Even the best authorized shift still has mismatch (>60m entry & exit) OR >2h delay OR >2h unauthorized.
      // It is an unauthorized deviation needing user approval -> select best authorized shift as "شیفت قابل تایید"!
      const approvalKeys: string[] = [];
      if (best.isMismatch || (fromMismatch && best.isMismatch)) {
        approvalKeys.push(key);
      }
      if (best.hasExcessiveDelay || best.hasExcessiveUnauthorized) {
        approvalKeys.push(`anomaly-${key}`);
      }
      // Fallback safety: if neither flag tripped on best (rare single-punch edge), preserve source approval scope
      if (approvalKeys.length === 0) {
        if (fromMismatch) approvalKeys.push(key);
        if (fromAnomalyDeviation || fromNoShift) approvalKeys.push(`anomaly-${key}`);
      }

      results.push({
        key,
        sourceCategory: 'unauthorized_needs_approval',
        actionMode: 'approve_with_best_shift',
        requiresUserApproval: true,
        isSameShiftAsCurrent: best.shiftId === currentSectionId,
        approvalKeysToAdd: approvalKeys,
        mismatch: {
          ...baseItem,
          rawTimes,
          currentDiffSum: currentEval ? currentEval.diffSum : null,
          currentIsAuthorized
        },
        suggestedShift: best
      });
      return;
    }

    // Previously approved item ONLY: check if there is a better authorized shift to assign
    if (fromApproved) {
      if (!isStrictlyBetterForApproved(best, currentEval, currentSectionId, currentIsAuthorized)) {
        return;
      }
      results.push({
        key,
        sourceCategory: 'approved_improvement',
        actionMode: 'assign_best_shift',
        requiresUserApproval: false,
        isSameShiftAsCurrent: best.shiftId === currentSectionId,
        approvalKeysToAdd: [],
        mismatch: {
          ...baseItem,
          rawTimes,
          currentDiffSum: currentEval ? currentEval.diffSum : null,
          currentIsAuthorized
        },
        suggestedShift: best
      });
    }
  });

  // Sort: clean fixes first, then approved improvements, then items requiring approval, sorted by day & name
  const categoryOrder: Record<SmartShiftSourceCategory, number> = {
    mismatch: 1,
    no_shift: 2,
    approved_improvement: 3,
    unauthorized_needs_approval: 4
  };
  results.sort((a, b) => {
    const catDiff = categoryOrder[a.sourceCategory] - categoryOrder[b.sourceCategory];
    if (catDiff !== 0) return catDiff;
    if (a.mismatch.dayNum !== b.mismatch.dayNum) return a.mismatch.dayNum - b.mismatch.dayNum;
    return (a.mismatch.employee.fullName || '').localeCompare(b.mismatch.employee.fullName || '', 'fa');
  });

  return results;
}
