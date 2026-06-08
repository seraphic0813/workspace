import { clamp } from './constants';

// ── avatar color palette ──────────────────────────────────────────────────────
const AVATAR_PALETTE: [string, string][] = [
  ['#3B82F6', '#8B5CF6'],
  ['#10B981', '#06B6D4'],
  ['#F59E0B', '#EF4444'],
  ['#EC4899', '#A78BFA'],
  ['#14B8A6', '#22D3EE'],
  ['#F97316', '#FBBF24'],
];

// ── local types ───────────────────────────────────────────────────────────────
export interface DayLog {
  hours: number | null;
  progress: number | null;
  submitted: boolean;
  isFuture: boolean; // true = date after baseDateIso (no actual data expected)
}

export interface Task {
  id: string;
  name: string;
  category?: string;
  spi?: number;
  cpi?: number;
  delayed?: boolean;
  plannedStart: number; // column index
  plannedEnd: number;   // column index (inclusive end index)
  actualStart: number | null;  // column index of first activity (fractional or integer)
  actualEnd: number | null;    // column index of actual completion (null if not completed)
  actualEndIso?: string;       // ISO date of actual completion
  forecastEnd: number;  // column index of forecast completion (fractional number)
  forecastEndIso?: string; // ISO date of forecast completion
  forecastEndMax?: number; // Conservative forecast end index (fractional number)
  forecastEndMaxIso?: string; // Conservative forecast end ISO date
  completionPct: number;
  status?: string;
  logs: DayLog[];
  estimatedHours?: number;
  actualHours?: number;
  // ── リスクスコア（RS）: 後続タスクへの遅延延焼リスク ──
  // RS = |SV| × (1 + 後続タスクの総人日) × (1 - 現在の生産性)
  riskScore?: number;        // 算出されたリスクスコア
  riskLeverage?: number;     // 影響度の倍率（1 + 後続タスクの総人日）
  successorManDays?: number; // 後続タスクの総人日
}

export interface Member {
  id: string | number;
  name: string;
  nameEn?: string;
  role?: string;
  avatarColor: [string, string];
  tasks: Task[];
  // stats from member_stats
  spi?: number;
  cpi?: number;
  sv?: number;
  cv?: number;
  totalHours?: number;
  forecastEnd?: number;      // column index of forecast completion
  forecastEndIso?: string;   // ISO date of forecast completion
  logs?: DayLog[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toIsoDate(dateStr: string) {
  return dateStr;
}

function diffDays(startIso: string, iso: string) {
  const a = new Date(startIso + 'T00:00:00Z');
  const b = new Date(iso + 'T00:00:00Z');
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function normalizeName(n: string) {
  return n ? n.trim().replace(/\s+/g, ' ') : n;
}

function findHours(workLogs: any[], dateIso: string, memberName: string): number | null {
  const entry = workLogs.find((w: any) => w.date === dateIso);
  if (!entry || !entry.hours) return null;
  const val = entry.hours[memberName] ?? entry.hours[normalizeName(memberName)];
  return typeof val === 'number' ? val : null;
}

function findIssueHours(timeEntries: any[], issueId: any, dateIso: string): number | null {
  const targetId = Number(issueId);
  const sum = timeEntries
    .filter((e: any) => Number(e.issue_id) === targetId && e.spent_on === dateIso)
    .reduce((s: number, e: any) => s + (parseFloat(e.hours) || 0.0), 0.0);
  return sum > 0 ? sum : null;
}

function countBusinessDays(fromIso: string, toIso: string): number {
  if (fromIso >= toIso) return 0;
  const cur = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  let count = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      count++;
    }
  }
  return count;
}

function getDateIdx(dateIso: string, displayDates: string[]): number {
  const idx = displayDates.indexOf(dateIso);
  if (idx >= 0) return idx;

  const displayStart = displayDates[0];
  if (dateIso < displayStart) return 0;

  const displayEnd = displayDates[displayDates.length - 1];
  if (dateIso > displayEnd) {
    return displayDates.length - 1 + countBusinessDays(displayEnd, dateIso);
  }

  const nextWorkingDate = displayDates.find(d => d > dateIso);
  if (nextWorkingDate) {
    return displayDates.indexOf(nextWorkingDate);
  }

  return 0;
}

function deriveStatus(completionPct: number, delayed?: boolean): '進行中' | '遅延' | '完了' {
  if (completionPct >= 100) return '完了';
  if (delayed) return '遅延';
  return '進行中';
}

/**
 * Add N business days (Mon–Fri) after startIso, returning ISO date strings.
 */
export function addBusinessDays(fromIso: string, days: number): string {
  const d = new Date(fromIso + 'T00:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a list of business-day dates from the day AFTER startIso (exclusive)
 * up to and including endIso.
 */
export function businessDayRange(afterIso: string, upToIso: string): string[] {
  const result: string[] = [];
  const end = new Date(upToIso + 'T00:00:00Z');
  const cur = new Date(afterIso + 'T00:00:00Z');
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

/**
 * Estimate the forecast completion date based on actual progress velocity.
 *
 * Algorithm:
 *   velocity = completionPct / workingDaysElapsed (from first activity to today)
 *   remainingWorkingDays = ceil((100 - completionPct) / velocity)
 *   forecastDate = today + remainingWorkingDays business days
 *
 * Returns null if completion is already 100 or velocity can't be determined.
 */
export function estimateForecastIso(
  completionPct: number,
  displayDates: string[],
  baseDateIso: string,
  firstActiveDateIso: string | null,
): string | null {
  if (completionPct >= 100) return null;
  if (completionPct <= 0) return null;

  const todayIdx = displayDates.indexOf(baseDateIso);
  if (todayIdx < 0) return null;

  const startIso = firstActiveDateIso || displayDates[0];
  const startIdx = displayDates.indexOf(startIso);
  if (startIdx < 0) return null;

  // Count working days elapsed from startIdx to todayIdx in the visible array
  // (each slot in displayDates is already a working day, so distance = todayIdx - startIdx)
  const elapsedWorkingDays = Math.max(1, todayIdx - startIdx);
  const velocity = completionPct / elapsedWorkingDays; // % per working day
  if (velocity <= 0) return null;

  const remaining = 100 - completionPct;
  const remainingWorkingDays = Math.ceil(remaining / velocity);

  return addBusinessDays(baseDateIso, remainingWorkingDays);
}

// ── main transform ────────────────────────────────────────────────────────────
export function transformApiToMembers(apiData: any, displayDates: string[], baseDateIso: string): Member[] {
  const displayStart = displayDates[0];
  const numCols = displayDates.length;
  const workLogs = apiData.member_work_logs || [];
  const memberStatsList: any[] = apiData.member_stats || [];
  const membersOut: Member[] = [];
  const byMember = apiData.member_issue_progress || [];

  for (let mIdx = 0; mIdx < byMember.length; mIdx++) {
    const m = byMember[mIdx];
    const memberName = normalizeName(m.member_name || m.member || m.memberName || '');
    const memberId = m.member_id ?? memberName;
    const tasks: Task[] = [];

    // Find member_stats entry
    const statEntry = memberStatsList.find((s: any) =>
      s.id === memberId || normalizeName(s.name || '') === memberName
    );

    for (const issue of (m.issues || [])) {
      // Build logs for each display date
      const logs: DayLog[] = displayDates.map((d: string) => {
        const isFuture = d > baseDateIso;
        const hours = isFuture ? null : findIssueHours(apiData.time_entries || [], issue.issue_id, d);
        const progress = issue.progress_by_date ? (issue.progress_by_date[d] ?? null) : null;

        let submitted = false;
        if (!isFuture) {
          if (apiData.daily_submissions && apiData.daily_submissions[memberId]?.[d] !== undefined) {
            submitted = Boolean(apiData.daily_submissions[memberId][d]);
          } else {
            submitted = (hours !== null || progress !== null);
          }
        }
        return { hours, progress, submitted, isFuture };
      });

      // Latest non-null progress (descending date order within progress_by_date)
      const progressEntries = Object.entries(issue.progress_by_date || {})
        .sort(([a], [b]) => b.localeCompare(a));
      const latestProgressEntry = progressEntries.find(([, v]) => v !== null && v !== undefined);
      const completionPct = typeof latestProgressEntry?.[1] === 'number'
        ? (latestProgressEntry[1] as number)
        : 0;

      // Planned indexes
      let plannedStartIdx = 0;
      let plannedEndIdx = Math.max(0, numCols - 1);

      if (issue.planned_start_date) {
        plannedStartIdx = clamp(getDateIdx(toIsoDate(issue.planned_start_date), displayDates), 0, numCols - 1);
      } else {
        // Infer from first date with actual progress or hours
        const firstActive = displayDates.find(d =>
          (issue.progress_by_date?.[d] != null) ||
          findHours(workLogs, d, memberName) != null
        );
        if (firstActive) plannedStartIdx = clamp(getDateIdx(firstActive, displayDates), 0, numCols - 1);
      }

      if (issue.planned_end_date) {
        plannedEndIdx = clamp(getDateIdx(toIsoDate(issue.planned_end_date), displayDates), 0, numCols - 1);
      } else {
        // Infer from last date with non-null progress
        const lastActive = [...displayDates].reverse().find(d =>
          issue.progress_by_date?.[d] != null && d <= baseDateIso
        );
        if (lastActive) plannedEndIdx = clamp(getDateIdx(lastActive, displayDates), 0, numCols - 1);
      }

      // Actual start (first date with actual work entry)
      // 実績工数（time_entries）が1件も存在しないチケットは実績開始インデックスを null とする
      let actualStartIdx: number | null = null;
      if (issue.first_actual_date) {
        actualStartIdx = getDateIdx(toIsoDate(issue.first_actual_date), displayDates);
      }

      // 実際の完了日（進捗100%に達した、あるいは100%時の最後の活動日）
      let actualEndIdx: number | null = null;
      let actualEndIso: string | undefined;
      if (completionPct >= 100) {
        // 完了マーカーは「このチケット固有」の実績（time_entries）または進捗履歴の最終日で決める。
        // メンバー全体の稼働日（findHours）を使うと、別タスクで稼働した日に引っ張られる誤マッピングが発生するため使用しない。
        const lastActiveDate = [...displayDates].reverse().find(d =>
          (issue.progress_by_date?.[d] != null && d <= baseDateIso) ||
          (findIssueHours(apiData.time_entries || [], issue.issue_id, d) !== null && d <= baseDateIso)
        );
        actualEndIdx = lastActiveDate ? getDateIdx(lastActiveDate, displayDates) : plannedEndIdx;
        actualEndIso = lastActiveDate || undefined;
      }

      const todayIdx = displayDates.indexOf(baseDateIso);
      const currentEndIdx = completionPct >= 100 ? (actualEndIdx ?? plannedEndIdx) : Math.max(todayIdx + 1, plannedEndIdx);
      const delayed = currentEndIdx > (plannedEndIdx + 1);
      const status = deriveStatus(completionPct, delayed);

      // Per-member total hours for this task
      const memberTotalHoursForTask = displayDates.reduce((sum, d) => {
        return sum + (findHours(workLogs, d, memberName) ?? 0);
      }, 0);

      const pv = issue.pv ?? 0;
      const ac = issue.ac ?? 0;
      const ev = issue.ev ?? 0;

      let taskSpi = pv > 0 ? ev / pv : 1.0;
      let taskCpi = ac > 0 ? ev / ac : 1.0;

      if (completionPct >= 100) {
        taskSpi = 1.0;
      }

      const targetIssueId = Number(issue.issue_id);
      const taskActualHours = (apiData.time_entries || [])
        .filter((e: any) => Number(e.issue_id) === targetIssueId && (!e.spent_on || e.spent_on <= baseDateIso) && (typeof e.hours === 'number' || typeof e.hours === 'string'))
        .reduce((sum: number, e: any) => sum + (parseFloat(e.hours) || 0.0), 0.0);

      // ── リスクスコア（RS）の算出 ──────────────────────────────────────────
      // 後続タスク = 同一メンバーで、本タスクより計画開始日が後のタスク群。
      // その総人日が大きいほど、本タスクの遅延が将来へ延焼するレバレッジが高い。
      const successorManDays = (m.issues || []).reduce((sum: number, other: any) => {
        if (
          other !== issue &&
          other.planned_start_date && issue.planned_start_date &&
          other.planned_start_date > issue.planned_start_date
        ) {
          return sum + (Number(other.estimated_hours) || 0) / 8.0;
        }
        return sum;
      }, 0);
      // SV（スケジュール差異, 人日）= EV - PV。負（遅延）のときにリスクが立ち上がる。
      const taskSv = ev - pv;
      // 現在の生産性 = タスクのSPI（完了タスクは 1.0 に固定済 → (1 - 1) = 0 でリスク0）。
      // SPI > 1（前倒し）でも (1 - SPI) が負となり RS は正にならないため、遅延タスクのみが発火する。
      const riskLeverage = 1 + successorManDays;
      const riskScore = Math.abs(taskSv) * riskLeverage * (1 - taskSpi);

      tasks.push({
        id: `#${issue.issue_id ?? issue.id ?? '0'}`,
        name: issue.subject || issue.name || 'Untitled',
        category: issue.category || '',
        spi: Number(taskSpi.toFixed(2)),
        cpi: Number(taskCpi.toFixed(2)),
        delayed,
        plannedStart: plannedStartIdx,
        plannedEnd: plannedEndIdx,
        actualStart: actualStartIdx,
        actualEnd: actualEndIdx,
        actualEndIso,
        forecastEnd: actualEndIdx ?? plannedEndIdx,
        forecastEndIso: actualEndIso,
        completionPct,
        status,
        logs,
        estimatedHours: issue.estimated_hours ?? 0,
        actualHours: taskActualHours,
        riskScore: Number(riskScore.toFixed(2)),
        riskLeverage: Number(riskLeverage.toFixed(1)),
        successorManDays: Number(successorManDays.toFixed(1)),
      });
    }

    // Total hours for member across all display dates
    const totalHours = displayDates.reduce((sum, d) => {
      return sum + (findHours(workLogs, d, memberName) ?? 0);
    }, 0);

    // メンバー全体の統計から SPI, CPI を算出
    let memberBAC = 0;
    let memberPV = 0;
    let memberAC = 0;
    let memberEV = 0;
    let allCompleted = true;

    for (const issue of (m.issues || [])) {
      const est = issue.estimated_hours ?? 0;
      const estMd = est / 8.0;
      memberBAC += estMd;
      memberPV += issue.pv ?? 0;
      memberAC += issue.ac ?? 0;
      memberEV += issue.ev ?? 0;

      const progressEntries = Object.entries(issue.progress_by_date || {})
        .sort(([a], [b]) => b.localeCompare(a));
      const latestProgressEntry = progressEntries.find(([, v]) => v !== null && v !== undefined);
      const pct = typeof latestProgressEntry?.[1] === 'number' ? (latestProgressEntry[1] as number) : 0;
      if (pct < 100) {
        allCompleted = false;
      }
    }

    const todayIdx = displayDates.indexOf(baseDateIso);
    let mSpi = memberPV > 0 ? memberEV / memberPV : 1.0;
    let mCpi = memberAC > 0 ? memberEV / memberAC : 1.0;

    if (statEntry) {
      mSpi = statEntry.spi ?? mSpi;
      mCpi = statEntry.cpi ?? mCpi;
    }

    const factor = mSpi * mCpi;

    // メンバー全体の最終完了予測日時
    let forecastEndIso = baseDateIso;
    let forecastEndIdx = todayIdx;

    if (allCompleted) {
      let maxLastActive = displayDates[0];
      for (const issue of (m.issues || [])) {
        const lastActiveDate = [...displayDates].reverse().find(d =>
          ((issue.progress_by_date?.[d] != null && d <= baseDateIso) ||
          (findHours(workLogs, d, memberName) !== null && d <= baseDateIso))
        );
        if (lastActiveDate && lastActiveDate > maxLastActive) {
          maxLastActive = lastActiveDate;
        }
      }
      forecastEndIso = maxLastActive;
      forecastEndIdx = getDateIdx(forecastEndIso, displayDates);
    } else {
      let maxPlannedEndIso = "2026-06-10";
      for (const issue of (m.issues || [])) {
        if (issue.planned_end_date && issue.planned_end_date > maxPlannedEndIso) {
          maxPlannedEndIso = issue.planned_end_date;
        }
      }
      const maxPlannedEndIdx = getDateIdx(maxPlannedEndIso, displayDates);
      const todayIdx = displayDates.indexOf(baseDateIso);
      const remainingPlannedDays = Math.max(0, maxPlannedEndIdx - todayIdx);

      // 完了予測日（スケジュール予測）の算出には、CPIを掛けずSPI単体をベロシティとして用いる
      const velocity = mSpi > 0 ? mSpi : 1.0;
      const remainingWorkingDays = remainingPlannedDays / Math.max(0.01, velocity);
      const ceilRemainingDays = Math.round(remainingWorkingDays);

      const forecastEndIdxVal = todayIdx + ceilRemainingDays;
      if (forecastEndIdxVal < displayDates.length) {
        forecastEndIso = displayDates[forecastEndIdxVal];
        forecastEndIdx = forecastEndIdxVal;
      } else {
        forecastEndIso = addBusinessDays(baseDateIso, ceilRemainingDays);
        forecastEndIdx = getDateIdx(forecastEndIso, displayDates);
      }
    }

    const memberLogs: DayLog[] = displayDates.map((d: string) => {
      const isFuture = d > baseDateIso;
      const hours = isFuture ? null : findHours(workLogs, d, memberName);
      let submitted = false;
      if (!isFuture) {
        if (apiData.daily_submissions && apiData.daily_submissions[memberId]?.[d] !== undefined) {
          submitted = Boolean(apiData.daily_submissions[memberId][d]);
        } else {
          submitted = (hours !== null);
        }
      }
      return { hours, progress: null, submitted, isFuture };
    });

    membersOut.push({
      id: memberId,
      name: memberName,
      avatarColor: AVATAR_PALETTE[mIdx % AVATAR_PALETTE.length],
      tasks,
      spi: mSpi,
      cpi: mCpi,
      sv: statEntry?.sv,
      cv: statEntry?.cv,
      totalHours,
      forecastEnd: forecastEndIdx,
      forecastEndIso,
      logs: memberLogs,
    });
  }

  return membersOut;
}
