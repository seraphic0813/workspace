import { transformApiToMembers } from '../evmAdapter';

// Minimal smoke tests. Install a test runner (jest/ts-node) to run these.
function assert(cond: boolean, msg?: string) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

const sampleApi = {
  member_work_logs: [
    { date: '2026-06-01', hours: { '鈴木 一郎': 6 } },
    { date: '2026-06-02', hours: { '鈴木 一郎': null } }
  ],
  member_issue_progress: [
    {
      member_id: 8,
      member_name: '鈴木 一郎',
      issues: [
        {
          issue_id: 104,
          subject: 'アルバム一覧画面',
          progress_by_date: { '2026-06-01': 10, '2026-06-02': null },
          planned_start_date: '2026-06-01',
          planned_end_date: '2026-06-03',
          forecast_end_date: '2026-06-04'
        }
      ]
    }
  ]
};

const displayDates = ['2026-06-01', '2026-06-02', '2026-06-03'];

function run() {
  const members = transformApiToMembers(sampleApi as any, displayDates, '2026-06-03');
  assert(members.length === 1, 'should produce one member');
  const m = members[0];
  assert(m.tasks.length === 1, 'member should have one task');
  const t = m.tasks[0];
  // logs length equals display columns
  assert(t.logs.length === displayDates.length, 'logs length mismatch');
  // first day has hours and progress
  assert(t.logs[0].hours === 6, 'hours should be 6 on first day');
  assert(t.logs[0].progress === 10, 'progress should be 10 on first day');
  // planned indices computed
  assert(typeof t.plannedStart === 'number', 'plannedStart should be number');
  console.log('evmAdapter basic smoke tests passed');
}

if (require.main === module) run();
