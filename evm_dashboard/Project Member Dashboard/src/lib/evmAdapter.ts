import { DATE_COL_W, CELL_GAP, COL_STEP, clamp } from './constants';

// local types (kept minimal to avoid coupling with component file)
export interface DayLog {
  hours: number | null;
  progress: number | null;
  submitted: boolean;
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
  forecastEnd: number;  // column index
  completionPct: number;
  status?: string;
  logs: DayLog[];
}

export interface Member {
  id: string | number;
  name: string;
  nameEn?: string;
  role?: string;
  avatarColor?: [string, string];
  tasks: Task[];
}

function toIsoDate(dateStr: string) {
  // assume input like 'YYYY-MM-DD' already
  return dateStr;
}

function diffDays(startIso: string, iso: string) {
  const a = new Date(startIso + 'T00:00:00Z');
  const b = new Date(iso + 'T00:00:00Z');
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function normalizeName(n: string) {
  return n ? n.trim().replace(/\s+/g, ' ') : n;
}

function findHours(workLogs: any[], dateIso: string, memberName: string) {
  const entry = workLogs.find((w: any) => w.date === dateIso);
  if (!entry || !entry.hours) return null;
  const val = entry.hours[memberName];
  return typeof val === 'number' ? val : null;
}

export function transformApiToMembers(apiData: any, displayDates: string[], baseDateIso: string): Member[] {
  const displayStart = displayDates[0];
  const numCols = displayDates.length;
  const workLogs = apiData.member_work_logs || [];
  const membersOut: Member[] = [];

  const byMember = apiData.member_issue_progress || [];

  for (const m of byMember) {
    const memberName = normalizeName(m.member_name || m.member_name || m.member || m.memberName || '');
    const memberId = m.member_id ?? memberName;
    const tasks: Task[] = [];

    for (const issue of (m.issues || [])) {
      const logs: DayLog[] = displayDates.map((d: string) => {
        const hours = findHours(workLogs, d, memberName);
        const progress = issue.progress_by_date ? (issue.progress_by_date[d] ?? null) : null;
        // submitted if server says so (daily_submissions) — prefer server data when available
        let submitted = false;
        if (apiData.daily_submissions && apiData.daily_submissions[memberId] && apiData.daily_submissions[memberId][d] !== undefined) {
          submitted = Boolean(apiData.daily_submissions[memberId][d]);
        } else {
          submitted = (hours !== null || progress !== null);
        }
        return { hours, progress, submitted };
      });

      // completion: latest non-null progress in display window
      const latestProgress = [...(Object.entries(issue.progress_by_date || {})).reverse()].map(([k, v]) => v).find(v => v !== null && v !== undefined);
      const completionPct = typeof latestProgress === 'number' ? latestProgress : 0;

      // planned/forecast indexes — if API provides dates, convert; otherwise default to 0..numCols-1
      let plannedStartIdx = 0;
      let plannedEndIdx = Math.max(0, numCols - 1);
      let forecastEndIdx = plannedEndIdx;
      if (issue.planned_start_date) plannedStartIdx = clamp(diffDays(displayStart, toIsoDate(issue.planned_start_date)), 0, numCols - 1);
      if (issue.planned_end_date) plannedEndIdx = clamp(diffDays(displayStart, toIsoDate(issue.planned_end_date)), 0, numCols - 1);
      if (issue.forecast_end_date) forecastEndIdx = clamp(diffDays(displayStart, toIsoDate(issue.forecast_end_date)), 0, numCols - 1);

      tasks.push({
        id: `#${issue.issue_id ?? issue.id ?? '0'}`,
        name: issue.subject || issue.name || 'Untitled',
        category: issue.category || '',
        spi: issue.spi, cpi: issue.cpi, delayed: issue.delayed || false,
        plannedStart: plannedStartIdx,
        plannedEnd: plannedEndIdx,
        forecastEnd: forecastEndIdx,
        completionPct: completionPct,
        status: issue.status || '進行中',
        logs
      });
    }

    membersOut.push({ id: memberId, name: memberName, tasks });
  }

  return membersOut;
}
