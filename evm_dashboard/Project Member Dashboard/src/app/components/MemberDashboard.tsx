import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, ChevronRight, Clock, TrendingDown, BarChart2,
  Calendar, Info, Eye, EyeOff, ChevronDown, ChevronUp,
  RefreshCw, Loader2, TrendingUp,
} from "lucide-react";
import { DATE_COL_W, CELL_GAP, COL_STEP } from "@/lib/constants";
import {
  transformApiToMembers, Member, Task, DayLog,
  businessDayRange,
} from "@/lib/evmAdapter";

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0B0F19",
  card: "#161B26",
  cardAlt: "#111520",
  cardBorder: "#1F2736",
  accent: "#00E676",
  danger: "#FF4D4D",
  blue: "#3B82F6",
  warning: "#F59E0B",
  textPrimary: "#E8EDF5",
  textMuted: "#8A94A6",
  textDim: "#3D4A5C",
  barPlanned: "#3B82F6",
  barForecast: "#FF6B6B",
  inputBg: "#0E1320",
  inputBorder: "#1E2A3A",
  todayBg: "#00E67614",
  todayBorder: "#00E67650",
  futureBg: "#0D1628",
  futureBorder: "#1A2436",
};

const TASK_COL_W = 248;
const GANTT_LABEL_W = 26 + 6;

// ── helpers ───────────────────────────────────────────────────────────────────
function statusColor(s?: string) {
  if (s === "完了") return C.accent;
  if (s === "遅延") return C.danger;
  return C.blue;
}

function StatusBadge({ status }: { status?: string }) {
  const clr = statusColor(status);
  return (
    <span style={{
      background: `${clr}18`, color: clr, border: `1px solid ${clr}40`,
      borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.04em",
    }}>
      {status || "進行中"}
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
  const parts = member.name.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? parts[0][0] + parts[1][0]
    : (member.name[0] ?? "?");
  const [c0, c1] = member.avatarColor;
  return (
    <div style={{
      width: size, height: size,
      background: `linear-gradient(135deg, ${c0}, ${c1})`,
      borderRadius: "50%", display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#fff",
      flexShrink: 0, letterSpacing: "-0.02em",
    }}>
      {initials}
    </div>
  );
}

function DayCell({ log, isToday }: { log: DayLog; colIdx: number; isToday: boolean }) {
  const active = !log.isFuture && (log.hours !== null || log.progress !== null);
  const showOrangeDot = !log.submitted && active && !log.isFuture;

  return (
    <div style={{
      width: DATE_COL_W, flexShrink: 0,
      background: isToday
        ? C.todayBg
        : log.isFuture
          ? C.futureBg
          : active ? "rgba(59,130,246,0.07)" : C.inputBg,
      border: `1px solid ${isToday ? C.todayBorder : log.isFuture ? C.futureBorder : active ? "#2A3A56" : C.inputBorder}`,
      borderRadius: 5, padding: "5px 4px", textAlign: "center", position: "relative",
      transition: "background 0.15s",
      opacity: log.isFuture ? 0.5 : 1,
    }}>
      {active ? (
        <>
          {log.hours !== null && (
            <div style={{ fontSize: 11, color: C.textPrimary, fontWeight: 700, lineHeight: 1.3 }}>
              {log.hours}h
            </div>
          )}
          {log.progress !== null && (
            <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.3 }}>
              {log.progress}%
            </div>
          )}
          {showOrangeDot && (
            <div style={{
              position: "absolute", top: -3, right: -3,
              width: 7, height: 7,
              background: C.warning, borderRadius: 99,
              border: "1.5px solid #0B0F19",
            }} />
          )}
        </>
      ) : (
        <div style={{
          fontSize: 10, color: log.isFuture ? "#2A3850" : C.textDim, lineHeight: 2.2,
        }}>
          {log.isFuture ? "予" : "—"}
        </div>
      )}
    </div>
  );
}

// ── Member Gantt bar ──────────────────────────────────────────────────────────
// ── Member Gantt bar ──────────────────────────────────────────────────────────
function MemberGanttBar({ member, displayDates, todayIdx }: { member: Member; displayDates: string[]; todayIdx: number }) {
  const numCols = displayDates.length;
  const dateAreaW = DATE_COL_W * numCols + CELL_GAP * (numCols - 1);
  const usableW = dateAreaW - GANTT_LABEL_W;
  const COL_STEP = DATE_COL_W + CELL_GAP;

  const getLeftPx = (x: number) => {
    const n = Math.floor(x);
    const f = x - n;
    return n * COL_STEP + f * DATE_COL_W;
  };

  // 全メンバー共通で【6/1 〜 6/10】をベース（基準線）とする
  const plannedEndIso = "2026-06-10";
  const plannedEndIdx = displayDates.indexOf(plannedEndIso) >= 0 
    ? displayDates.indexOf(plannedEndIso) 
    : (member.tasks.map(t => t.plannedEnd).length > 0 ? Math.max(...member.tasks.map(t => t.plannedEnd)) : numCols - 1);

  const mPlannedStart = 0;
  const mPlannedEnd = plannedEndIdx;

  const pxPlanStart = Math.min(getLeftPx(mPlannedStart), usableW);
  const pxPlanEnd = Math.min(getLeftPx(mPlannedEnd + 1) - CELL_GAP, usableW);
  const pxPlanWidth = Math.max(pxPlanEnd - pxPlanStart, DATE_COL_W);

  // 予測完了インデックス
  const mForecastEnd = member.forecastEnd ?? mPlannedEnd;
  const pxForeEnd = Math.min(getLeftPx(mForecastEnd + 1) - CELL_GAP, usableW);

  // 前倒しか遅延か
  const slip = mForecastEnd - mPlannedEnd;
  const isAhead = slip < -0.05;
  const isDelayed = slip > 0.05;

  // 予測バーの幅（6/1から予測完了日まで）
  const pxForecastWidth = Math.min(pxForeEnd - pxPlanStart, usableW);

  // 相対遅延ラベルの作成
  let relativeLabel = "";
  if (isDelayed) {
    relativeLabel = `(${Math.ceil(slip)}日遅れ)`;
  } else if (isAhead) {
    relativeLabel = `(${Math.abs(Math.floor(slip))}日前倒し)`;
  } else {
    relativeLabel = "(予定通り)";
  }

  // 突き抜けた赤ストライプの開始・幅
  const pxRedStart = pxPlanEnd;
  const pxRedWidth = isDelayed ? Math.max(0, pxForeEnd - pxPlanEnd) : 0;

  // 予定期間内の予測バーの幅
  const pxPlannedForecastWidth = isAhead ? pxForecastWidth : pxPlanWidth;
  const forecastColor = isAhead ? "rgba(0, 230, 118, 0.4)" : "rgba(59, 130, 246, 0.4)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      {/* 1本化されたバー */}
      <div style={{
        position: "relative", width: usableW, height: 10,
        background: "#151E2D", borderRadius: 99, flexShrink: 0,
      }}>
        {/* ベースとなる計画期間バー（6/1〜6/10）ソリッド */}
        <div style={{
          position: "absolute", left: pxPlanStart, width: pxPlanWidth, height: "100%",
          background: "#1F293D", // ソリッドなバー（落ち着いたダークグレー）
          borderRadius: 99,
          border: "1px solid rgba(255, 255, 255, 0.05)",
        }} />

        {/* 予測バー（ベースバーの上に重ねる） */}
        {pxPlannedForecastWidth > 0 && (
          <div style={{
            position: "absolute", left: pxPlanStart, width: pxPlannedForecastWidth, height: "100%",
            background: forecastColor,
            borderRadius: isAhead ? 99 : "99px 0 0 99px",
          }} />
        )}

        {/* 遅延突き抜け部分（薄い赤ストライプ） */}
        {pxRedWidth > 0 && (
          <div style={{
            position: "absolute", left: pxRedStart, width: pxRedWidth, height: "100%",
            background: `repeating-linear-gradient(45deg, rgba(255,77,77,0.15), rgba(255,77,77,0.15) 4px, rgba(255,77,77,0.3) 4px, rgba(255,77,77,0.3) 8px)`,
            borderRadius: "0 99px 99px 0",
            border: `1px solid ${C.danger}30`,
            boxShadow: `0 0 4px ${C.danger}22`,
          }} />
        )}
      </div>
      
      {member.forecastEndIso ? (
        <span style={{ fontSize: 10, color: isDelayed ? C.danger : (isAhead ? C.accent : C.blue), whiteSpace: "nowrap", fontWeight: 700 }}>
          {member.forecastEndIso.slice(5).replace("-", "/")}完 {relativeLabel}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: C.textDim, whiteSpace: "nowrap" }}>—</span>
      )}
    </div>
  );
}

// ── Gantt bar ─────────────────────────────────────────────────────────────────
function GanttBar({ task, displayDates, todayIdx }: { task: Task; displayDates: string[]; todayIdx: number }) {
  const numCols = displayDates.length;
  const dateAreaW = DATE_COL_W * numCols + CELL_GAP * (numCols - 1);
  const usableW = dateAreaW - GANTT_LABEL_W;
  const COL_STEP = DATE_COL_W + CELL_GAP;

  const getLeftPx = (x: number) => {
    const n = Math.floor(x);
    const f = x - n;
    return n * COL_STEP + f * DATE_COL_W;
  };

  const pxPlanStart = Math.min(getLeftPx(task.plannedStart), usableW);
  const pxPlanEnd = Math.min(getLeftPx(task.plannedEnd + 1) - CELL_GAP, usableW);
  const pxPlanWidth = Math.max(pxPlanEnd - pxPlanStart, DATE_COL_W);

  // 実績工数 (time_entries) が存在する最新の日付インデックスを検索
  let lastActualLogIdx = -1;
  for (let i = task.logs.length - 1; i >= 0; i--) {
    const log = task.logs[i];
    if (log.hours !== null && log.hours > 0) {
      lastActualLogIdx = i;
      break;
    }
  }

  const hasActual = task.actualStart !== null && task.actualStart !== undefined && lastActualLogIdx !== -1;

  if (!hasActual) {
    return (
      <div style={{ paddingTop: 6, paddingBottom: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>計画</span>
          <div style={{
            position: "relative", width: usableW, height: 8,
            background: "#151E2D", borderRadius: 99, flexShrink: 0, overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: pxPlanStart, width: pxPlanWidth, height: "100%",
              background: C.barPlanned,
              borderRadius: 99,
            }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>実績</span>
          <span style={{ fontSize: 9, color: C.textDim, whiteSpace: "nowrap" }}>未着手</span>
        </div>
      </div>
    );
  }

  const pxActStart = Math.min(getLeftPx(task.actualStart!), usableW);
  const isCompleted = task.completionPct >= 100;
  
  const actEndIdx = lastActualLogIdx + 1;
  const pxActEnd = Math.min(getLeftPx(actEndIdx) - CELL_GAP, usableW);
  const pxActWidth = Math.max(0, pxActEnd - pxActStart);

  // 進捗率連動グラデーションカラー
  const pxEvWidth = pxPlanWidth * (task.completionPct / 100.0);
  const evPctInActual = pxActWidth > 0 ? Math.min(100, Math.max(0, (pxEvWidth / pxActWidth) * 100.0)) : 0;
  const gradientBg = `linear-gradient(90deg, ${C.accent} 0%, ${C.accent} ${evPctInActual}%, rgba(16, 185, 129, 0.2) ${evPctInActual}%, rgba(16, 185, 129, 0.2) 100%)`;

  return (
    <div style={{ paddingTop: 6, paddingBottom: 8, display: "flex", flexDirection: "column", gap: 5 }}>
      {/* planned bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>計画</span>
        <div style={{
          position: "relative", width: usableW, height: 8,
          background: "#151E2D", borderRadius: 99, flexShrink: 0, overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", left: pxPlanStart, width: pxPlanWidth, height: "100%",
            background: C.barPlanned,
            borderRadius: 99,
          }} />
        </div>
      </div>

      {/* actual bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 9, color: C.textDim, width: 26, flexShrink: 0, textAlign: "right" }}>実績</span>
        <div style={{
          position: "relative", width: usableW, height: 8,
          background: "#151E2D", borderRadius: 99, flexShrink: 0, overflow: "hidden",
        }}>
          {pxActWidth > 0 && (
            <div style={{
              position: "absolute", left: pxActStart, width: pxActWidth, height: "100%",
              background: gradientBg,
              borderRadius: 99,
              boxShadow: `0 0 6px ${C.accent}33`,
            }} />
          )}
        </div>
        <span style={{ fontSize: 9, color: isCompleted ? C.accent : C.textMuted, whiteSpace: "nowrap" }}>
          {isCompleted ? "完了" : `進捗 ${task.completionPct}%`}
        </span>
      </div>
    </div>
  );
}

// ── member section ────────────────────────────────────────────────────────────
function MemberSection({
  member, displayDates, todayIdx,
}: { member: Member; displayDates: string[]; todayIdx: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const numCols = displayDates.length;

  const delayedCount = member.tasks.filter(t => t.delayed).length;
  const avgSPI = member.spi ?? null;
  const avgCPI = member.cpi ?? null;
  const totalH = member.totalHours ?? 0;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* member header bar */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          background: C.card, border: `1px solid ${C.cardBorder}`,
          borderBottom: collapsed ? undefined : "none",
          borderRadius: collapsed ? 8 : "8px 8px 0 0",
          display: "flex", alignItems: "center",
          cursor: "pointer", userSelect: "none",
        }}
      >
        {/* 左側：メンバー情報 (TASK_COL_W とアライメントを揃える) - sticky列固定 */}
        <div style={{
          width: TASK_COL_W, flexShrink: 0, display: "flex", alignItems: "center", gap: 12,
          position: "sticky", left: 0, zIndex: 10, background: C.card,
          padding: "10px 14px", borderRight: `1px solid ${C.cardBorder}`
        }}>
          <MemberAvatar member={member} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, color: C.textPrimary, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.name}</span>
              {delayedCount > 0 && (
                <span style={{
                  fontSize: 8, color: C.warning, background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "1px 4px",
                  display: "flex", alignItems: "center", gap: 2, fontWeight: 600, whiteSpace: "nowrap"
                }}>
                  <AlertTriangle size={8} /> 遅延 {delayedCount}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 10, color: C.textMuted }}>
              {avgSPI != null && (
                <span>SPI: <strong style={{ color: avgSPI >= 1 ? C.accent : C.danger }}>{avgSPI.toFixed(2)}</strong></span>
              )}
              {avgCPI != null && (
                <span>CPI: <strong style={{ color: avgCPI >= 1 ? C.accent : C.warning }}>{avgCPI.toFixed(2)}</strong></span>
              )}
              <span>{totalH}h</span>
            </div>
          </div>
        </div>

        {/* 右側：メンバー全体の予測バー (日付列とアライメントを揃える) */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 40, paddingRight: 14, minWidth: 0, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <MemberGanttBar member={member} displayDates={displayDates} todayIdx={todayIdx} />
          </div>
          <div style={{ color: C.textMuted, flexShrink: 0, paddingRight: 8 }}>
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </div>
        </div>
      </div>

      {/* expanded table */}
      {!collapsed && (
        <div style={{ border: `1px solid ${C.cardBorder}`, borderTop: "none", borderRadius: "0 0 8px 8px" }}>
          {/* ⓑ メンバー全体の当日の実績工数セルの行 */}
          <div style={{
            display: "flex", alignItems: "stretch",
            background: "#0F1520", borderBottom: `1px solid ${C.cardBorder}`
          }}>
            {/* 左側：実績工数ラベル - sticky列固定 */}
            <div style={{
              width: TASK_COL_W, flexShrink: 0, padding: "12px 14px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderRight: `1px solid ${C.cardBorder}`,
              borderLeft: `3px solid ${C.accent}`,
              position: "sticky", left: 0, zIndex: 10, background: "#0F1520",
            }}>
              <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 700 }}>日別稼働実績</span>
              <span style={{ fontSize: 10, color: C.textMuted, background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 }}>合計: {totalH}h</span>
            </div>
            {/* 右側：実績工数セル */}
            <div style={{ display: "flex", alignItems: "center", padding: "10px 8px" }}>
              <div style={{ display: "flex", gap: CELL_GAP, paddingLeft: 32 }}>
                {(member.logs || []).map((log, ci) => (
                  <DayCell key={ci} log={log} colIdx={ci} isToday={ci === todayIdx} />
                ))}
              </div>
            </div>
          </div>

          {/* ⓒ チケット毎の行 */}
          {member.tasks.map((task, ti) => (
            <div key={task.id} style={{
              borderTop: ti > 0 ? `1px solid ${C.cardBorder}` : undefined,
              background: ti % 2 === 0 ? C.card : C.cardAlt,
            }}>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                {/* left: task info card - sticky列固定 */}
                <div style={{
                  width: TASK_COL_W, flexShrink: 0, padding: "10px 14px",
                  borderRight: `1px solid ${C.cardBorder}`,
                  borderLeft: `3px solid ${statusColor(task.status)}`,
                  position: "sticky", left: 0, zIndex: 10, background: ti % 2 === 0 ? C.card : C.cardAlt,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.textDim, fontWeight: 700 }}>{task.id}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>
                    {task.name}
                  </div>
                  {/* 「予定: 〇〇h / 実績: 〇〇h」のテキスト表示 */}
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>
                    予定: {task.estimatedHours?.toFixed(1) ?? "0.0"}h / 実績: {task.actualHours?.toFixed(1) ?? "0.0"}h
                  </div>
                  {/* リスクスコア（RS）バッジ: 後続タスクへの遅延延焼リスクが高い場合に警告 */}
                  {(task.riskScore ?? 0) > 1.0 && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: "rgba(255,77,77,0.12)", border: `1px solid ${C.danger}55`,
                      borderRadius: 4, padding: "2px 7px", marginBottom: 6,
                      fontSize: 9.5, fontWeight: 700, color: C.danger, whiteSpace: "nowrap",
                    }}
                      title={`リスクスコア RS=${(task.riskScore ?? 0).toFixed(2)}（|SV| × (1+後続${task.successorManDays ?? 0}人日) × (1-生産性)）`}
                    >
                      <AlertTriangle size={10} />
                      将来影響度：高（レバレッジ {(task.riskScore ?? 0).toFixed(1)}倍）
                    </div>
                  )}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 9, color: C.textDim }}>進捗率</span>
                      <span style={{ fontSize: 9, color: statusColor(task.status), fontWeight: 700 }}>
                        {task.completionPct}%
                      </span>
                    </div>
                    <div style={{ height: 3, background: "#1F2736", borderRadius: 99 }}>
                      <div style={{
                        width: `${task.completionPct}%`, height: "100%", borderRadius: 99,
                        background: statusColor(task.status),
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                </div>

                {/* right: gantt bar only (セル行は排除) */}
                <div style={{ display: "flex", alignItems: "center", padding: "10px 8px", flex: 1 }}>
                  <div style={{ paddingLeft: 0 }}>
                    <GanttBar task={task} displayDates={displayDates} todayIdx={todayIdx} />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {member.tasks.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: C.textDim, fontSize: 13 }}>
              担当タスクがありません
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8,
      padding: "8px 14px", display: "flex", flexDirection: "column", gap: 1, minWidth: 80,
    }}>
      <span style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 16, color: accent, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ── loading / error ───────────────────────────────────────────────────────────
function LoadingOverlay() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "60vh", gap: 16, color: C.textMuted,
    }}>
      <Loader2 size={36} style={{ color: C.accent, animation: "spin 1s linear infinite" }} />
      <span style={{ fontSize: 14 }}>データを読み込み中...</span>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

function ErrorMessage({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
      padding: "32px 24px", textAlign: "center", margin: "32px auto", maxWidth: 480,
    }}>
      <AlertTriangle size={32} style={{ color: C.danger, margin: "0 auto 12px" }} />
      <div style={{ color: C.textPrimary, fontWeight: 600, marginBottom: 8, fontSize: 15 }}>データの取得に失敗しました</div>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 20, wordBreak: "break-all" }}>{msg}</div>
      <button onClick={onRetry} style={{
        background: C.blue, border: "none", borderRadius: 6, color: "#fff",
        padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <RefreshCw size={13} /> 再試行
      </button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function MemberDashboard() {
  const [members, setMembers] = useState<Member[]>([]);
  const [displayDates, setDisplayDates] = useState<string[]>([]);
  const [baseDateIso, setBaseDateIso] = useState<string>("");
  const [todayIdx, setTodayIdx] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [sprintInfo, setSprintInfo] = useState<string>("");
  const [visibleMembers, setVisibleMembers] = useState<Set<string | number>>(new Set());

  const getUrlDate = () => {
    try { return new URLSearchParams(window.location.search).get("date") || ""; }
    catch { return ""; }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const urlDate = getUrlDate();
      let apiUrl = "/api/evm-data?t=" + Date.now();
      if (urlDate) apiUrl += "&date=" + encodeURIComponent(urlDate);

      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      processApiData(data);
    } catch (e: any) {
      if (typeof (window as any).EVM_DATA !== "undefined") {
        processApiData((window as any).EVM_DATA);
      } else {
        setError(e.message || "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function processApiData(data: any) {
    const summary = data.project_summary || {};
    const baseDateStr: string = summary.base_date || new Date().toISOString().slice(0, 10);
    setBaseDateIso(baseDateStr);
    setLastUpdated(summary.last_synced || "");

    // ── STEP 1: Collect historical dates ──
    const dateSet = new Set<string>();
    (data.member_work_logs || []).forEach((w: any) => dateSet.add(w.date as string));
    (data.member_issue_progress || []).forEach((m: any) => {
      (m.issues || []).forEach((issue: any) => {
        Object.keys(issue.progress_by_date || {}).forEach(d => dateSet.add(d));
      });
    });
    const historicalDates = Array.from(dateSet).sort();

    // ── STEP 2: First-pass transform to discover forecast dates ──
    const firstPass = transformApiToMembers(data, historicalDates, baseDateStr);

    // Collect the furthest target date (planned end, forecast end, or project ends)
    let maxDisplayIso = baseDateStr;

    if (summary.planned_end_date && summary.planned_end_date > maxDisplayIso) {
      maxDisplayIso = summary.planned_end_date;
    }
    if (summary.forecast_end_date && summary.forecast_end_date > maxDisplayIso) {
      maxDisplayIso = summary.forecast_end_date;
    }

    (data.member_issue_progress || []).forEach((m: any) => {
      (m.issues || []).forEach((issue: any) => {
        if (issue.planned_end_date && issue.planned_end_date > maxDisplayIso) {
          maxDisplayIso = issue.planned_end_date;
        }
        if (issue.forecast_end_date && issue.forecast_end_date > maxDisplayIso) {
          maxDisplayIso = issue.forecast_end_date;
        }
      });
    });

    firstPass.forEach(m => {
      m.tasks.forEach(t => {
        if (t.forecastEndIso && t.forecastEndIso > maxDisplayIso) {
          maxDisplayIso = t.forecastEndIso;
        }
        if (t.forecastEndMaxIso && t.forecastEndMaxIso > maxDisplayIso) {
          maxDisplayIso = t.forecastEndMaxIso;
        }
      });
    });

    // ── STEP 3: Extend displayDates with future business days up to maxDisplayIso ──
    const lastHistorical = historicalDates[historicalDates.length - 1] || baseDateStr;
    const futureDates = businessDayRange(lastHistorical, maxDisplayIso);
    const allDates = [...historicalDates, ...futureDates];

    // ── STEP 4: Second-pass with extended dates ──
    const transformed = transformApiToMembers(data, allDates, baseDateStr);

    const todayI = allDates.indexOf(baseDateStr);
    setTodayIdx(todayI);
    setDisplayDates(allDates);

    // Sprint info
    const timeSeries = data.time_series || [];
    if (timeSeries.length >= 2) {
      const fmt = (iso: string) => `${parseInt(iso.slice(5, 7))}/${parseInt(iso.slice(8, 10))}`;
      setSprintInfo(`${fmt(timeSeries[0].date)} – ${fmt(timeSeries[timeSeries.length - 1].date)}`);
    }

    setMembers(transformed);
    setVisibleMembers(new Set(transformed.map(m => m.id)));
  }

  useEffect(() => {
    fetchData();
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "date-change" && e.data.date) {
        window.history.replaceState({}, "", `?date=${e.data.date}`);
        fetchData();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [fetchData]);

  const toggleMember = (id: string | number) => {
    setVisibleMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Summary stats
  const allTasks = members.flatMap(m => m.tasks);
  const delayedTotal = allTasks.filter(t => t.delayed).length;
  const spiVals = members.filter(m => m.spi != null).map(m => m.spi as number);
  const cpiVals = members.filter(m => m.cpi != null).map(m => m.cpi as number);
  const avgSPIStr = spiVals.length > 0 ? (spiVals.reduce((s, v) => s + v, 0) / spiVals.length).toFixed(2) : "--";
  const avgCPIStr = cpiVals.length > 0 ? (cpiVals.reduce((s, v) => s + v, 0) / cpiVals.length).toFixed(2) : "--";
  const totalH = members.reduce((s, m) => s + (m.totalHours ?? 0), 0);
  const avgSPINum = parseFloat(avgSPIStr);
  const avgCPINum = parseFloat(avgCPIStr);
  const todayLabel = baseDateIso ? baseDateIso.slice(5).replace("-", "/").replace(/^0/, "") : "";

  return (
    <div style={{
      background: C.bg, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column",
      fontFamily: "'Inter', 'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif",
      color: C.textPrimary,
    }}>
      {/* ── breadcrumb / header bar ──────────────────────────────────────────── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.cardBorder}`,
        padding: "0 24px", height: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
          <BarChart2 size={14} style={{ color: C.accent }} />
          <span>EVM Dashboard</span>
          <ChevronRight size={12} />
          <span style={{ color: C.textPrimary, fontWeight: 600 }}>稼働実績・日報</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: C.textMuted }}>
          {sprintInfo && (
            <>
              <Calendar size={12} />
              <span>{sprintInfo}</span>
              <span style={{ color: C.textDim }}>|</span>
            </>
          )}
          {baseDateIso && (
            <span style={{ color: C.accent, fontWeight: 600 }}>基準日: {todayLabel}</span>
          )}
          <button onClick={fetchData} title="データを再読み込み" style={{
            background: "none", border: `1px solid ${C.cardBorder}`, borderRadius: 5,
            color: C.textMuted, cursor: "pointer", padding: "3px 8px",
            display: "flex", alignItems: "center", gap: 4, fontSize: 11,
          }}>
            <RefreshCw size={11} /> 更新
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 24px 24px", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ── loading / error ──────────────────────────────────────────────────── */}
        {loading && <LoadingOverlay />}
        {!loading && error && <ErrorMessage msg={error} onRetry={fetchData} />}

        {!loading && !error && (
          <>
            {/* ── TOP ROW: member toggles + stat pills ─────────────────────────── */}
            <div style={{
              background: C.card, border: `1px solid ${C.cardBorder}`,
              borderRadius: 8, padding: "12px 16px", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              {/* Left: label + member toggle buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
                <span style={{
                  fontSize: 10, color: C.textMuted, fontWeight: 700,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  borderRight: `1px solid ${C.cardBorder}`, paddingRight: 12, whiteSpace: "nowrap",
                }}>
                  表示切替
                </span>
                {members.map(member => {
                  const visible = visibleMembers.has(member.id);
                  const [c0] = member.avatarColor;
                  return (
                    <button
                      key={String(member.id)}
                      onClick={() => toggleMember(member.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 7,
                        background: visible ? `${c0}15` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${visible ? c0 + "50" : C.cardBorder}`,
                        borderRadius: 8, padding: "5px 11px", cursor: "pointer",
                        transition: "all 0.15s", color: visible ? C.textPrimary : C.textMuted,
                        fontSize: 12, fontWeight: visible ? 600 : 400,
                      }}
                    >
                      <MemberAvatar member={member} size={20} />
                      <span>{member.name}</span>
                      <span style={{ color: visible ? c0 : C.textDim, marginLeft: 1 }}>
                        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      </span>
                    </button>
                  );
                })}
                <div style={{ fontSize: 10, color: C.textDim, display: "flex", alignItems: "center", gap: 3 }}>
                  <Info size={10} style={{ color: C.warning }} />
                  <span style={{ color: C.warning }}>●</span> 未提出
                </div>
              </div>

              {/* Right: stat pills */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                <StatPill label="平均SPI" value={avgSPIStr} accent={!isNaN(avgSPINum) && avgSPINum >= 1 ? C.accent : C.danger} />
                <StatPill label="平均CPI" value={avgCPIStr} accent={!isNaN(avgCPINum) && avgCPINum >= 1 ? C.accent : C.warning} />
                <StatPill label="総工数" value={`${totalH}h`} accent="#60A5FA" />
                <StatPill label="遅延" value={`${delayedTotal}件`} accent={delayedTotal > 0 ? C.danger : C.accent} />
              </div>
            </div>

            {/* ── legend ───────────────────────────────────────────────────────── */}
            <div style={{
              display: "flex", alignItems: "center", gap: 16,
              marginBottom: 14, fontSize: 11, color: C.textMuted, flexWrap: "wrap",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 18, height: 5, background: C.barPlanned, borderRadius: 99, display: "inline-block" }} />
                計画期間
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 18, height: 5, background: C.barForecast, borderRadius: 99, display: "inline-block" }} />
                予測期間（遅延）
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <TrendingUp size={11} style={{ color: C.accent }} />
                予測行: 進捗速度から算出
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: C.textDim }}>
                <Clock size={11} />
                各セル: 工数(h) / 進捗率(%)
              </span>
              {members.some(m => m.tasks.some(t => t.forecastEndIso)) && (
                <span style={{
                  marginLeft: "auto", fontSize: 10, color: C.textDim,
                  display: "flex", alignItems: "center", gap: 3,
                }}>
                  <span style={{ color: C.futureBorder }}>■</span>薄い列 = 予測期間（実績なし）
                </span>
              )}
            </div>

            {/* ── 横スクロールコンテナ (カレンダー・メンバーEVMチャート) ── */}
            <div className="gantt-scroll-container" style={{ 
              overflowX: "auto", 
              width: "100%", 
              flex: 1, 
              overflowY: "auto",
              paddingBottom: 16 
            }}>
              <div style={{ minWidth: "max-content", paddingRight: 4 }}>
                {/* ── calendar header (最上部・共通) ───────────────────────────── */}
                <div style={{
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8,
                  display: "flex", alignItems: "stretch", marginBottom: 12, overflow: "hidden",
                  position: "sticky", top: 0, zIndex: 20
                }}>
                  {/* 左側：ヘッダーラベル - sticky列固定 */}
                  <div style={{
                    width: TASK_COL_W, flexShrink: 0, padding: "12px 14px",
                    borderRight: `1px solid ${C.cardBorder}`,
                    display: "flex", alignItems: "center",
                    position: "sticky", left: 0, zIndex: 30, background: C.card,
                  }}>
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 700, letterSpacing: "0.05em" }}>メンバー / カレンダー</span>
              </div>
              {/* 右側：カレンダー日付セル */}
              <div style={{ display: "flex", alignItems: "center", padding: "10px 8px" }}>
                <div style={{ display: "flex", gap: CELL_GAP, paddingLeft: 32 }}>
                  {displayDates.map((date, ci) => {
                    const isToday = ci === todayIdx;
                    const isFuture = date > baseDateIso;
                    const label = date.slice(5).replace("-", "/"); // "06/01"
                    const dayName = isToday ? "TODAY" : (isFuture ? "予測" : "実績");
                    return (
                      <div key={ci} style={{
                        width: DATE_COL_W, flexShrink: 0,
                        background: isToday ? C.todayBg : isFuture ? C.futureBg : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isToday ? C.todayBorder : isFuture ? C.futureBorder : C.inputBorder}`,
                        borderRadius: 5, padding: "4px 2px", textAlign: "center",
                        opacity: isFuture ? 0.7 : 1,
                      }}>
                        <div style={{ fontSize: 10, color: isToday ? C.accent : C.textPrimary, fontWeight: 700 }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 8, color: isToday ? C.accent : C.textMuted }}>
                          {dayName}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── member sections ──────────────────────────────────────────────── */}
            {members.filter(m => visibleMembers.has(m.id)).map(member => (
              <MemberSection
                key={String(member.id)}
                member={member}
                displayDates={displayDates}
                todayIdx={todayIdx}
              />
            ))}
              </div>
            </div>

            {visibleMembers.size === 0 && (
              <div style={{
                background: C.card, border: `1px solid ${C.cardBorder}`,
                borderRadius: 8, padding: "48px 24px", textAlign: "center",
                color: C.textDim, fontSize: 14,
              }}>
                <EyeOff size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <div>「表示切替」からメンバーを選択してください。</div>
              </div>
            )}

            {members.length === 0 && (
              <div style={{
                background: C.card, border: `1px solid ${C.cardBorder}`,
                borderRadius: 8, padding: "48px 24px", textAlign: "center",
                color: C.textDim, fontSize: 14,
              }}>
                <div>表示できるメンバーデータがありません。</div>
                <div style={{ fontSize: 12, marginTop: 8 }}>Redmineから同期を実行してください。</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
