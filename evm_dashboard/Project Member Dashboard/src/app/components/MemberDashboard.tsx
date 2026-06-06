import { useState } from "react";
import {
  AlertTriangle, ChevronRight, Clock, TrendingDown, BarChart2,
  Calendar, Info, Eye, EyeOff, ChevronDown, ChevronUp, Users,
} from "lucide-react";

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0B0F19",
  card: "#161B26",
  cardAlt: "#111520",
  cardBorder: "#1F2736",
  rowHover: "#1A2133",
  accent: "#00E676",
  danger: "#FF4D4D",
  blue: "#3B82F6",
  warning: "#F59E0B",
  purple: "#A78BFA",
  textPrimary: "#E8EDF5",
  textMuted: "#8A94A6",
  textDim: "#3D4A5C",
  barPlanned: "#3B82F6",
  barForecast: "#FF6B6B",
  inputBg: "#0E1320",
  inputBorder: "#1E2A3A",
};

// ── fixed column widths ───────────────────────────────────────────────────────
const TASK_COL_W = 248; // px — left "task info" column
const DATE_COL_W = 72;  // px — each date column

// ── types ────────────────────────────────────────────────────────────────────
interface DayLog {
  hours: number | null;
  progress: number | null;
  submitted: boolean;
}

interface Task {
  id: string;
  name: string;
  category: string;
  spi: number;
  cpi: number;
  delayed: boolean;
  plannedStart: number;
  plannedEnd: number;
  forecastEnd: number;
  completionPct: number;
  logs: DayLog[];
  status: "進行中" | "遅延" | "完了";
}

interface Member {
  id: string;
  name: string;
  nameEn: string;
  role: string;
  avatarColor: [string, string];
  tasks: Task[];
}

// ── date labels ───────────────────────────────────────────────────────────────
const DATES = ["5/26", "5/27", "5/28", "5/29", "5/30", "6/2", "6/3", "6/4", "6/5", "6/6"];
const TODAY_IDX = 9;

// ── data ─────────────────────────────────────────────────────────────────────
const MEMBERS: Member[] = [
  {
    id: "m1",
    name: "鈴木 一郎",
    nameEn: "Ichiro Suzuki",
    role: "シニアエンジニア",
    avatarColor: ["#3B82F6", "#8B5CF6"],
    tasks: [
      {
        id: "#104", name: "アルバム一覧画面", category: "フロントエンド",
        spi: 0.80, cpi: 0.90, delayed: true, plannedStart: 0, plannedEnd: 5,
        forecastEnd: 8, completionPct: 48, status: "遅延",
        logs: [
          { hours: 6, progress: 15, submitted: true },
          { hours: 5, progress: 20, submitted: true },
          { hours: 4, progress: 28, submitted: true },
          { hours: 3, progress: 35, submitted: true },
          { hours: 4, progress: 42, submitted: true },
          { hours: 2, progress: 48, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
      {
        id: "#108", name: "アルバム詳細画面", category: "フロントエンド",
        spi: 0.72, cpi: 0.85, delayed: true, plannedStart: 2, plannedEnd: 7,
        forecastEnd: 9, completionPct: 30, status: "遅延",
        logs: [
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: 5, progress: 10, submitted: true },
          { hours: 4, progress: 18, submitted: true },
          { hours: 3, progress: 25, submitted: true },
          { hours: 4, progress: 30, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
      {
        id: "#115", name: "認証・セッション管理", category: "バックエンド",
        spi: 1.10, cpi: 1.08, delayed: false, plannedStart: 0, plannedEnd: 4,
        forecastEnd: 4, completionPct: 100, status: "完了",
        logs: [
          { hours: 7, progress: 25, submitted: true },
          { hours: 8, progress: 52, submitted: true },
          { hours: 7, progress: 75, submitted: true },
          { hours: 6, progress: 90, submitted: true },
          { hours: 4, progress: 100, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
    ],
  },
  {
    id: "m2",
    name: "田中 花子",
    nameEn: "Hanako Tanaka",
    role: "エンジニア",
    avatarColor: ["#10B981", "#06B6D4"],
    tasks: [
      {
        id: "#112", name: "検索・フィルタAPI", category: "バックエンド",
        spi: 1.05, cpi: 1.02, delayed: false, plannedStart: 1, plannedEnd: 6,
        forecastEnd: 6, completionPct: 78, status: "進行中",
        logs: [
          { hours: null, progress: null, submitted: false },
          { hours: 6, progress: 20, submitted: true },
          { hours: 7, progress: 35, submitted: true },
          { hours: 6, progress: 52, submitted: true },
          { hours: 5, progress: 65, submitted: true },
          { hours: 6, progress: 78, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
      {
        id: "#119", name: "通知システム", category: "バックエンド",
        spi: 0.88, cpi: 0.91, delayed: false, plannedStart: 4, plannedEnd: 9,
        forecastEnd: 9, completionPct: 22, status: "進行中",
        logs: [
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: 5, progress: 10, submitted: true },
          { hours: 4, progress: 22, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
      {
        id: "#122", name: "UIコンポーネント整備", category: "フロントエンド",
        spi: 1.15, cpi: 1.10, delayed: false, plannedStart: 0, plannedEnd: 3,
        forecastEnd: 3, completionPct: 100, status: "完了",
        logs: [
          { hours: 6, progress: 40, submitted: true },
          { hours: 7, progress: 75, submitted: true },
          { hours: 5, progress: 100, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
    ],
  },
  {
    id: "m3",
    name: "山本 太郎",
    nameEn: "Taro Yamamoto",
    role: "QAエンジニア",
    avatarColor: ["#F59E0B", "#EF4444"],
    tasks: [
      {
        id: "#125", name: "E2Eテスト設計", category: "QA",
        spi: 0.78, cpi: 0.82, delayed: true, plannedStart: 0, plannedEnd: 5,
        forecastEnd: 7, completionPct: 40, status: "遅延",
        logs: [
          { hours: 5, progress: 10, submitted: true },
          { hours: 4, progress: 20, submitted: true },
          { hours: 5, progress: 28, submitted: true },
          { hours: 3, progress: 35, submitted: true },
          { hours: 4, progress: 40, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
      {
        id: "#128", name: "結合テスト実施", category: "QA",
        spi: 0.95, cpi: 0.97, delayed: false, plannedStart: 3, plannedEnd: 8,
        forecastEnd: 9, completionPct: 18, status: "進行中",
        logs: [
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: 4, progress: 8, submitted: true },
          { hours: 3, progress: 14, submitted: true },
          { hours: 3, progress: 18, submitted: true },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
          { hours: null, progress: null, submitted: false },
        ],
      },
    ],
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────
function statusColor(s: Task["status"]) {
  return s === "完了" ? C.accent : s === "遅延" ? C.danger : C.blue;
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const clr = statusColor(status);
  return (
    <span style={{
      background: `${clr}18`, color: clr, border: `1px solid ${clr}40`,
      borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.04em",
    }}>
      {status}
    </span>
  );
}

function Chip({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      background: "rgba(255,255,255,0.04)", borderRadius: 3,
      padding: "1px 6px", fontSize: 10, color: C.textMuted,
      border: `1px solid ${C.cardBorder}`,
    }}>
      <span style={{ color: C.textDim }}>{label}:</span>
      <span style={{ color: good ? C.accent : C.danger, fontWeight: 700 }}>{value.toFixed(2)}</span>
    </span>
  );
}

function MemberAvatar({ member, size = 32 }: { member: Member; size?: number }) {
  const initials = member.name.split(" ").map(s => s[0]).join("");
  return (
    <div style={{
      width: size, height: size,
      background: `linear-gradient(135deg, ${member.avatarColor[0]}, ${member.avatarColor[1]})`,
      borderRadius: "50%", display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#fff",
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function DayCell({ log, colIdx }: { log: DayLog; colIdx: number }) {
  const active = log.hours !== null;
  const isToday = colIdx === TODAY_IDX;
  return (
    <div style={{
      width: DATE_COL_W, flexShrink: 0,
      background: active ? "rgba(59,130,246,0.07)" : C.inputBg,
      border: `1px solid ${!active && !log.submitted && colIdx < TODAY_IDX ? "transparent"
        : isToday ? `${C.accent}50`
        : C.inputBorder}`,
      borderRadius: 5, padding: "5px 4px", textAlign: "center", position: "relative",
    }}>
      {active ? (
        <>
          <div style={{ fontSize: 11, color: C.textPrimary, fontWeight: 700, lineHeight: 1.2 }}>{log.hours}h</div>
          <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.2 }}>{log.progress}%</div>
          {!log.submitted && (
            <div style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, background: C.warning, borderRadius: 99, border: "1px solid #0B0F19" }} />
          )}
        </>
      ) : (
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 2 }}>—</div>
      )}
    </div>
  );
}

// GAP between date cells (must match the `gap` value used in the day-cells flex container)
const CELL_GAP = 4;
// total pixel width of the 10-column date area (cells + gaps)
const DATE_AREA_W = DATE_COL_W * DATES.length + CELL_GAP * (DATES.length - 1);
// width reserved for the "計画"/"予測" row-label (+ gap) inside GanttBar
const GANTT_LABEL_W = 26 + 6; // label width + gap

function GanttBar({ task }: { task: Task }) {
  // pixel-accurate positioning: each column is (DATE_COL_W + CELL_GAP) wide
  const colStep = DATE_COL_W + CELL_GAP;
  const pxStart = task.plannedStart * colStep;
  const pxPlan  = (task.plannedEnd - task.plannedStart) * colStep - CELL_GAP;
  const pxFore  = (task.forecastEnd - task.plannedStart) * colStep - CELL_GAP;
  const slip    = task.forecastEnd - task.plannedEnd;

  return (
    <div style={{ paddingTop: 6, paddingBottom: 8, display: "flex", flexDirection: "column", gap: 5 }}>
      {/* planned bar — full date-area width, bars positioned by pixel */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>計画</span>
        <div style={{ position: "relative", width: DATE_AREA_W - GANTT_LABEL_W, height: 8, background: "#151E2D", borderRadius: 99, flexShrink: 0, overflow: "hidden" }}>
          <div style={{
            position: "absolute", left: pxStart, width: pxPlan, height: "100%",
            background: C.barPlanned, borderRadius: 99, boxShadow: `0 0 6px ${C.barPlanned}55`,
          }} />
          {task.completionPct > 0 && task.completionPct < 100 && (
            <div style={{
              position: "absolute", left: pxStart,
              width: pxPlan * task.completionPct / 100, height: "100%",
              background: "rgba(255,255,255,0.28)", borderRadius: 99,
            }} />
          )}
        </div>
        {slip > 0 && (
          <span style={{ fontSize: 9, color: C.danger, display: "flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
            <TrendingDown size={9} />+{slip}日
          </span>
        )}
      </div>
      {/* forecast bar */}
      {slip > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>予測</span>
          <div style={{ position: "relative", width: DATE_AREA_W - GANTT_LABEL_W, height: 8, background: "#151E2D", borderRadius: 99, flexShrink: 0, overflow: "hidden" }}>
            <div style={{
              position: "absolute", left: pxStart, width: pxPlan, height: "100%",
              background: "rgba(255,107,107,0.35)", borderRadius: "99px 0 0 99px",
            }} />
            <div style={{
              position: "absolute", left: pxStart + pxPlan, width: pxFore - pxPlan, height: "100%",
              background: C.barForecast, borderRadius: "0 99px 99px 0",
              boxShadow: `0 0 6px ${C.barForecast}55`,
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── member section ────────────────────────────────────────────────────────────
function MemberSection({ member }: { member: Member }) {
  const [collapsed, setCollapsed] = useState(false);

  const delayedCount = member.tasks.filter(t => t.delayed).length;
  const avgSPI = member.tasks.reduce((s, t) => s + t.spi, 0) / member.tasks.length;
  const avgCPI = member.tasks.reduce((s, t) => s + t.cpi, 0) / member.tasks.length;
  const totalH = member.tasks.flatMap(t => t.logs).reduce((s, l) => s + (l.hours ?? 0), 0);

  return (
    <div style={{ marginBottom: 20 }}>
      {/* member header bar */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          background: C.card, border: `1px solid ${C.cardBorder}`,
          borderBottom: collapsed ? undefined : "none",
          borderRadius: collapsed ? 8 : "8px 8px 0 0",
          padding: "10px 16px", display: "flex", alignItems: "center",
          gap: 12, cursor: "pointer", userSelect: "none",
        }}
      >
        <MemberAvatar member={member} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 700 }}>{member.name}</span>
            <span style={{ fontSize: 11, color: C.textMuted }}>{member.nameEn}</span>
            <span style={{
              fontSize: 10, color: C.textMuted, background: "#1F2736",
              border: `1px solid ${C.cardBorder}`, borderRadius: 4, padding: "1px 7px",
            }}>{member.role}</span>
            {delayedCount > 0 && (
              <span style={{
                fontSize: 10, color: C.warning, background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "1px 7px",
                display: "flex", alignItems: "center", gap: 3, fontWeight: 600,
              }}>
                <AlertTriangle size={9} /> 遅延 {delayedCount}件
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 3, fontSize: 11, color: C.textMuted }}>
            <span>タスク: <strong style={{ color: C.textPrimary }}>{member.tasks.length}件</strong></span>
            <span>SPI: <strong style={{ color: avgSPI >= 1 ? C.accent : C.danger }}>{avgSPI.toFixed(2)}</strong></span>
            <span>CPI: <strong style={{ color: avgCPI >= 1 ? C.accent : C.warning }}>{avgCPI.toFixed(2)}</strong></span>
            <span>工数: <strong style={{ color: C.textPrimary }}>{totalH}h</strong></span>
          </div>
        </div>
        <div style={{ color: C.textMuted }}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </div>

      {/* table */}
      {!collapsed && (
        <div style={{ border: `1px solid ${C.cardBorder}`, borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          {/* date header row */}
          <div style={{
            display: "flex", alignItems: "center",
            borderBottom: `1px solid ${C.cardBorder}`,
            background: "#0F1520",
          }}>
            {/* task column header */}
            <div style={{
              width: TASK_COL_W, flexShrink: 0, padding: "8px 14px",
              fontSize: 10, color: C.textDim, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              borderRight: `1px solid ${C.cardBorder}`,
            }}>
              タスク情報
            </div>
            {/* date columns + gantt label area */}
            <div style={{ display: "flex", flexDirection: "column", padding: "0 8px" }}>
              {/* date labels */}
              <div style={{ display: "flex", gap: CELL_GAP }}>
                {DATES.map((d, i) => (
                  <div key={d} style={{
                    width: DATE_COL_W, flexShrink: 0, textAlign: "center",
                    padding: "8px 4px",
                    fontSize: 11, fontWeight: 700,
                    color: i === TODAY_IDX ? C.accent : C.textMuted,
                  }}>
                    {d}
                    {i === TODAY_IDX && (
                      <div style={{ fontSize: 8, color: C.accent, fontWeight: 700, letterSpacing: "0.05em" }}>TODAY</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* task rows */}
          {member.tasks.map((task, ti) => (
            <div key={task.id} style={{
              borderTop: ti > 0 ? `1px solid ${C.cardBorder}` : undefined,
              background: ti % 2 === 0 ? C.card : C.cardAlt,
            }}>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                {/* left: task info */}
                <div style={{
                  width: TASK_COL_W, flexShrink: 0, padding: "10px 14px",
                  borderRight: `1px solid ${C.cardBorder}`,
                  borderLeft: `3px solid ${statusColor(task.status)}`,
                }}>
                  {/* id + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: C.textDim, fontWeight: 700 }}>{task.id}</span>
                    <StatusBadge status={task.status} />
                    {task.delayed && (
                      <span style={{ fontSize: 9, color: C.warning, display: "flex", alignItems: "center", gap: 2 }}>
                        <AlertTriangle size={9} />遅延
                      </span>
                    )}
                  </div>
                  {/* name */}
                  <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 600, marginBottom: 5, lineHeight: 1.3 }}>
                    {task.name}
                  </div>
                  {/* chips */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                    <Chip label="SPI" value={task.spi} good={task.spi >= 1} />
                    <Chip label="CPI" value={task.cpi} good={task.cpi >= 1} />
                    <span style={{
                      fontSize: 10, color: C.textDim,
                      background: "rgba(255,255,255,0.03)", borderRadius: 3,
                      padding: "1px 6px", border: `1px solid ${C.cardBorder}`,
                    }}>{task.category}</span>
                  </div>
                  {/* progress */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 9, color: C.textDim }}>進捗率</span>
                      <span style={{ fontSize: 9, color: statusColor(task.status), fontWeight: 700 }}>{task.completionPct}%</span>
                    </div>
                    <div style={{ height: 3, background: "#1F2736", borderRadius: 99 }}>
                      <div style={{
                        width: `${task.completionPct}%`, height: "100%", borderRadius: 99,
                        background: statusColor(task.status),
                      }} />
                    </div>
                  </div>
                </div>

                {/* right: day cells + gantt bars stacked */}
                <div style={{ display: "flex", flexDirection: "column", padding: "10px 8px" }}>
                  {/* day cells row */}
                  <div style={{ display: "flex", gap: CELL_GAP }}>
                    {task.logs.map((log, ci) => (
                      <DayCell key={ci} log={log} colIdx={ci} />
                    ))}
                  </div>
                  {/* gantt bars — pixel-aligned to the cells above */}
                  <GanttBar task={task} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── top stat pill ─────────────────────────────────────────────────────────────
function StatPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8,
      padding: "10px 16px", display: "flex", flexDirection: "column", gap: 2,
    }}>
      <span style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 18, color: accent, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function MemberDashboard() {
  const [visibleMembers, setVisibleMembers] = useState<Set<string>>(
    new Set(MEMBERS.map(m => m.id))
  );

  const toggleMember = (id: string) => {
    setVisibleMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allTasks = MEMBERS.flatMap(m => m.tasks);
  const delayedTotal = allTasks.filter(t => t.delayed).length;
  const avgSPI = (allTasks.reduce((s, t) => s + t.spi, 0) / allTasks.length).toFixed(2);
  const avgCPI = (allTasks.reduce((s, t) => s + t.cpi, 0) / allTasks.length).toFixed(2);
  const totalH = allTasks.flatMap(t => t.logs).reduce((s, l) => s + (l.hours ?? 0), 0);

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      fontFamily: "'Inter', 'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif",
      color: C.textPrimary,
    }}>
      {/* ── top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.cardBorder}`,
        padding: "0 24px", height: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
          <BarChart2 size={14} style={{ color: C.accent }} />
          <span>プロジェクト</span>
          <ChevronRight size={12} />
          <span>スプリント管理</span>
          <ChevronRight size={12} />
          <span>スプリント07 – 2026年6月</span>
          <ChevronRight size={12} />
          <span style={{ color: C.textPrimary, fontWeight: 600 }}>メンバー別進捗</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: C.textMuted }}>
          <Calendar size={12} />
          <span>2026/5/26 – 6/6</span>
          <span style={{ color: C.textDim }}>|</span>
          <span style={{ color: C.accent, fontWeight: 600 }}>スプリント07</span>
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* ── page title ───────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Users size={18} style={{ color: C.accent }} />
              <h1 style={{ fontSize: 18, color: C.textPrimary, fontWeight: 700, margin: 0 }}>
                メンバー別進捗ダッシュボード
              </h1>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
              スプリント07 · {MEMBERS.length}名 · タスク{allTasks.length}件 · 遅延<span style={{ color: C.danger, fontWeight: 600 }}>{delayedTotal}件</span>
            </p>
          </div>

          {/* summary pills */}
          <div style={{ display: "flex", gap: 10 }}>
            <StatPill label="平均SPI" value={avgSPI} accent={parseFloat(avgSPI) >= 1 ? C.accent : C.danger} />
            <StatPill label="平均CPI" value={avgCPI} accent={parseFloat(avgCPI) >= 1 ? C.accent : C.warning} />
            <StatPill label="総工数" value={`${totalH}h`} accent="#60A5FA" />
            <StatPill label="遅延タスク" value={`${delayedTotal}件`} accent={delayedTotal > 0 ? C.danger : C.accent} />
          </div>
        </div>

        {/* ── member visibility toggles ─────────────────────────────────────── */}
        <div style={{
          background: C.card, border: `1px solid ${C.cardBorder}`,
          borderRadius: 8, padding: "12px 16px", marginBottom: 20,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginRight: 4 }}>
            表示切替
          </span>
          {MEMBERS.map(member => {
            const visible = visibleMembers.has(member.id);
            return (
              <button
                key={member.id}
                onClick={() => toggleMember(member.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: visible ? `${member.avatarColor[0]}15` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${visible ? member.avatarColor[0] + "50" : C.cardBorder}`,
                  borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                  transition: "all 0.15s", color: visible ? C.textPrimary : C.textMuted,
                  fontSize: 12, fontWeight: visible ? 600 : 400,
                }}
              >
                <MemberAvatar member={member} size={22} />
                <span>{member.name}</span>
                <span style={{ fontSize: 10, color: C.textDim }}>{member.role}</span>
                <span style={{ color: visible ? member.avatarColor[0] : C.textDim, marginLeft: 2 }}>
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </span>
              </button>
            );
          })}
          <div style={{ marginLeft: "auto", fontSize: 10, color: C.textDim, display: "flex", alignItems: "center", gap: 4 }}>
            <Info size={11} style={{ color: C.warning }} />
            <span style={{ color: C.warning }}>オレンジ点</span> = 未提出
          </div>
        </div>

        {/* ── legend ───────────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 20,
          marginBottom: 16, fontSize: 11, color: C.textMuted, flexWrap: "wrap",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 20, height: 5, background: C.barPlanned, borderRadius: 99, display: "inline-block" }} />
            計画期間
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 20, height: 5, background: C.barForecast, borderRadius: 99, display: "inline-block" }} />
            予測期間（遅延）
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, background: C.accent, borderRadius: "50%", display: "inline-block" }} />
            完了
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, background: C.blue, borderRadius: "50%", display: "inline-block" }} />
            進行中
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, background: C.danger, borderRadius: "50%", display: "inline-block" }} />
            遅延
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.textDim }}>
            <Clock size={11} />
            各セル: 工数(h) / 進捗率(%)
          </span>
        </div>

        {/* ── member sections ───────────────────────────────────────────────── */}
        {MEMBERS.filter(m => visibleMembers.has(m.id)).map(member => (
          <MemberSection key={member.id} member={member} />
        ))}

        {visibleMembers.size === 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 8, padding: "48px 24px", textAlign: "center",
            color: C.textDim, fontSize: 14,
          }}>
            <EyeOff size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <div>すべてのメンバーが非表示です。上の「表示切替」からメンバーを選択してください。</div>
          </div>
        )}
      </div>
    </div>
  );
}
