document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSyncControls();
    setupDisplayDatePicker();
    setupEvmGuideModal();

    // 初期表示時: サーバーAPIからEVMデータを取得して描画
    fetchAndRenderEVM();

    // 再読み込みボタン
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
        btnSync.addEventListener('click', () => {
            fetchAndRenderEVM();
        });
    }
});

let evmChartInstance = null;

// ========================================================
// データ取得・描画
// ========================================================

function fetchAndRenderEVM(callback = null) {
    const displayDateInput = document.getElementById('display-date');
    const targetDate = displayDateInput ? displayDateInput.value : '';

    let url = '/api/evm-data?t=' + Date.now();
    if (targetDate) {
        url += '&date=' + encodeURIComponent(targetDate);
    }

    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('EVM data API error: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            // 表示基準日の初期値を、実際に計算された基準日（base_date）で自動同期する
            if (displayDateInput && !displayDateInput.value && data.project_summary && data.project_summary.base_date) {
                displayDateInput.value = data.project_summary.base_date;
            }
            updateDashboard(data);
            if (callback) callback();
        })
        .catch(err => {
            console.error('EVM data fetch failed:', err);
            // フォールバック: evm_data.js がロード済みなら使う
            if (typeof window.EVM_DATA !== 'undefined') {
                console.warn('Falling back to cached evm_data.js');
                updateDashboard(window.EVM_DATA);
            }
            if (callback) callback();
        });
}

// ========================================================
// ダッシュボード描画
// ========================================================

function updateDashboard(data) {
    const summary = data.project_summary;
    const timeSeries = data.time_series;
    const forecastSeries = data.forecast_series || [];
    const memberStats = data.member_stats;
    const unit = summary.unit || '人日';

    // 1. 最終同期日
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        const lastSynced = summary.last_synced || '未同期';
        lastUpdateEl.textContent = `最終同期日: ${lastSynced}`;
    }

    // 2. KPIカード - Core Metrics
    const progressEl = document.getElementById('kpi-progress');
    const progressBarEl = document.getElementById('kpi-progress-bar');
    if (progressEl) progressEl.textContent = `${summary.progress}%`;
    if (progressBarEl) progressBarEl.style.width = `${summary.progress}%`;

    // SPI
    const spiEl = document.getElementById('kpi-spi');
    const spiStatusEl = document.getElementById('status-spi');
    const cardSpi = document.getElementById('card-spi');
    if (spiEl) spiEl.textContent = summary.spi.toFixed(2);
    if (spiStatusEl && cardSpi) {
        setIndexStatus(summary.spi, spiStatusEl, cardSpi);
    }

    // CPI
    const cpiEl = document.getElementById('kpi-cpi');
    const cpiStatusEl = document.getElementById('status-cpi');
    const cardCpi = document.getElementById('card-cpi');
    if (cpiEl) cpiEl.textContent = summary.cpi.toFixed(2);
    if (cpiStatusEl && cardCpi) {
        setIndexStatus(summary.cpi, cpiStatusEl, cardCpi);
    }

    // AC / BAC（人日単位）
    const acEl = document.getElementById('kpi-ac');
    const bacEl = document.getElementById('kpi-bac');
    const svCvEl = document.getElementById('status-sv-cv');
    if (acEl) acEl.textContent = `${summary.ac}${unit}`;
    if (bacEl) bacEl.textContent = `${summary.total_budget}${unit}`;
    if (svCvEl) {
        const svSign = summary.sv >= 0 ? '+' : '';
        const cvSign = summary.cv >= 0 ? '+' : '';
        svCvEl.textContent = `SV: ${svSign}${summary.sv}${unit} | CV: ${cvSign}${summary.cv}${unit}`;
        if (summary.cv < 0) {
            svCvEl.className = 'kpi-status status-danger';
        } else {
            svCvEl.className = 'kpi-status status-good';
        }
    }

    // 3. 主要KPI - BAC (Top)
    const bacTopEl = document.getElementById('kpi-bac-top');
    if (bacTopEl) bacTopEl.textContent = `${summary.bac}${unit}`;

    // 4. 予測・見込み分析 (ETC/EAC/VAC/完了日)
    const etcEl = document.getElementById('forecast-etc');
    if (etcEl) etcEl.textContent = `${summary.etc}${unit}`;

    const eacEl = document.getElementById('forecast-eac');
    if (eacEl) eacEl.textContent = `${summary.eac}${unit}`;

    const vacEl = document.getElementById('forecast-vac');
    const cardVac = document.getElementById('card-vac');
    if (vacEl) {
        const vacSign = summary.vac >= 0 ? '+' : '';
        vacEl.textContent = `${vacSign}${summary.vac}${unit}`;
        vacEl.className = summary.vac >= 0 ? 'kpi-value status-good' : 'kpi-value status-danger';
    }
    if (cardVac) {
        cardVac.classList.remove('card-vac-good', 'card-vac-danger');
        cardVac.classList.add(summary.vac >= 0 ? 'card-vac-good' : 'card-vac-danger');
    }

    const plannedEndEl = document.getElementById('forecast-planned-end');
    if (plannedEndEl) plannedEndEl.textContent = formatDateJP(summary.planned_end_date);

    const forecastEndEl = document.getElementById('forecast-forecast-end');
    const cardForecastEnd = document.getElementById('card-forecast-end');
    if (forecastEndEl) forecastEndEl.textContent = formatDateJP(summary.forecast_end_date);
    if (cardForecastEnd) {
        cardForecastEnd.classList.remove('card-forecast-late', 'card-forecast-ok');
        if (summary.forecast_end_date > summary.planned_end_date) {
            cardForecastEnd.classList.add('card-forecast-late');
        } else {
            cardForecastEnd.classList.add('card-forecast-ok');
        }
    }

    // 4. メンバー一覧テーブル
    const tbody = document.getElementById('members-list-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        memberStats.forEach(member => {
            const tr = document.createElement('tr');

            let badgeClass = 'good';
            let badgeText = '良好';
            const score = Math.min(member.spi, member.cpi);
            if (score < 0.9) {
                badgeClass = 'danger';
                badgeText = '遅延・過剰';
            } else if (score < 1.0) {
                badgeClass = 'warning';
                badgeText = '調整推奨';
            }

            const svText = (member.sv >= 0 ? '+' : '') + member.sv;
            const cvText = (member.cv >= 0 ? '+' : '') + member.cv;

            tr.innerHTML = `
                <td><strong>${member.name}</strong></td>
                <td>${member.pv}${unit}</td>
                <td>${member.ev}${unit}</td>
                <td>${member.ac}${unit}</td>
                <td class="${member.sv < 0 ? 'status-danger' : 'status-good'}">${svText}${unit}</td>
                <td class="${member.cv < 0 ? 'status-danger' : 'status-good'}">${cvText}${unit}</td>
                <td><span class="${member.spi < 0.9 ? 'status-danger' : (member.spi < 1.0 ? 'status-warning' : 'status-good')}">${member.spi.toFixed(2)}</span></td>
                <td><span class="${member.cpi < 0.9 ? 'status-danger' : (member.cpi < 1.0 ? 'status-warning' : 'status-good')}">${member.cpi.toFixed(2)}</span></td>
                <td><span class="badge-status ${badgeClass}">${badgeText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 5. EVMグラフ描画（予測線付き）
    renderEVMChart(timeSeries, forecastSeries, unit, summary);

    // 6. 統合ツリーテーブル描画
    renderTreeTable(data.member_work_logs, data.member_issue_progress, data.member_stats);
}

function formatDateJP(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }
    return dateStr;
}

function setIndexStatus(value, statusEl, cardEl) {
    cardEl.classList.remove('card-good', 'card-warning', 'card-danger');
    statusEl.classList.remove('status-good', 'status-warning', 'status-danger');

    if (value >= 1.0) {
        statusEl.textContent = '🟢 計画通り/良好';
        statusEl.classList.add('status-good');
        cardEl.classList.add('card-good');
    } else if (value >= 0.9) {
        statusEl.textContent = '🟡 わずかに遅れ・超過';
        statusEl.classList.add('status-warning');
        cardEl.classList.add('card-warning');
    } else {
        statusEl.textContent = '🔴 危険（遅延・コスト超過）';
        statusEl.classList.add('status-danger');
        cardEl.classList.add('card-danger');
    }
}

// ========================================================
// EVMチャート描画（予測線付き）
// ========================================================

function renderEVMChart(timeSeries, forecastSeries, unit, summary) {
    // 実測データ
    const dates = timeSeries.map(d => d.date);
    const pvData = timeSeries.map(d => d.pv);
    const evData = timeSeries.map(d => d.ev);
    const acData = timeSeries.map(d => d.ac);

    // 予測データ: 基準日の値から始まるため、接続点（基準日）を先頭に追加
    const baseDate = summary.base_date;
    const baseTsEntry = timeSeries.find(t => t.date === baseDate);

    // 全日付リスト（実測 + 予測で重複なし）
    const forecastDates = forecastSeries.map(d => d.date);
    const allDates = [...dates];
    forecastDates.forEach(d => {
        if (!allDates.includes(d)) allDates.push(d);
    });
    allDates.sort();

    // 各データセットをallDatesにマッピング
    const pvFull = allDates.map(d => {
        const ts = timeSeries.find(t => t.date === d);
        if (ts) return ts.pv;
        const fc = forecastSeries.find(f => f.date === d);
        if (fc) return fc.pv;
        return null;
    });

    const evFull = allDates.map(d => {
        const ts = timeSeries.find(t => t.date === d);
        if (ts) return ts.ev;
        return null;
    });

    const acFull = allDates.map(d => {
        const ts = timeSeries.find(t => t.date === d);
        if (ts) return ts.ac;
        return null;
    });

    // 予測EV/AC: 基準日の接続点 + 予測データ
    const evForecast = allDates.map(d => {
        if (d === baseDate && baseTsEntry) return baseTsEntry.ev;
        const fc = forecastSeries.find(f => f.date === d);
        return fc ? fc.ev : null;
    });

    const acForecast = allDates.map(d => {
        if (d === baseDate && baseTsEntry) return baseTsEntry.ac;
        const fc = forecastSeries.find(f => f.date === d);
        return fc ? fc.ac : null;
    });

    const formattedDates = allDates.map(d => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
    });

    const ctx = document.getElementById('evmChart').getContext('2d');

    if (evmChartInstance) {
        evmChartInstance.destroy();
    }

    const datasets = [
        {
            label: 'PV (計画)',
            data: pvFull,
            borderColor: '#388BFD',
            backgroundColor: 'rgba(56, 139, 253, 0.05)',
            borderWidth: 3,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.2
        },
        {
            label: 'EV (出来高)',
            data: evFull,
            borderColor: '#00F5A0',
            backgroundColor: 'transparent',
            borderWidth: 3,
            pointRadius: 2,
            pointHoverRadius: 6,
            tension: 0.2,
            spanGaps: false
        },
        {
            label: 'AC (実績)',
            data: acFull,
            borderColor: '#FF453A',
            backgroundColor: 'transparent',
            borderWidth: 3,
            pointRadius: 2,
            pointHoverRadius: 6,
            tension: 0.2,
            spanGaps: false
        }
    ];

    // 予測線がある場合のみ追加
    if (forecastSeries.length > 0) {
        datasets.push({
            label: 'EV予測',
            data: evForecast,
            borderColor: 'rgba(0, 245, 160, 0.45)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [8, 5],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.2,
            spanGaps: false
        });
        datasets.push({
            label: 'AC予測',
            data: acForecast,
            borderColor: 'rgba(255, 69, 58, 0.45)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [8, 5],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.2,
            spanGaps: false
        });
    }

    evmChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#161B22',
                    titleColor: '#F0F6FC',
                    bodyColor: '#C9D1D9',
                    borderColor: 'rgba(56, 139, 253, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            if (context.raw === null) return null;
                            return ` ${context.dataset.label}: ${context.raw} ${unit}`;
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)', borderColor: 'transparent' },
                    ticks: { color: '#8B949E', font: { family: 'Inter', size: 11 }, maxTicksLimit: 14 }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)', borderColor: 'transparent' },
                    ticks: {
                        color: '#8B949E',
                        font: { family: 'Inter', size: 11 },
                        callback: function(value) { return value + ' ' + unit; }
                    }
                }
            }
        }
    });
}

// ========================================================
// ナビゲーション
// ========================================================

function setupNavigation() {
    const btnSummary = document.getElementById('btn-summary');
    const btnSyncInfo = document.getElementById('btn-sync-info');
    const btnWorkLogs = document.getElementById('btn-work-logs');

    const viewDashboard = document.getElementById('view-dashboard');
    const viewSync = document.getElementById('view-sync');
    const viewWorkLogs = document.getElementById('view-work-logs');

    const mainTitle = document.getElementById('main-title');

    if (btnSummary && btnSyncInfo && btnWorkLogs && viewDashboard && viewSync && viewWorkLogs) {
        btnSummary.addEventListener('click', (e) => {
            e.preventDefault();
            btnSummary.classList.add('active');
            btnSyncInfo.classList.remove('active');
            btnWorkLogs.classList.remove('active');
            viewDashboard.classList.add('active');
            viewSync.classList.remove('active');
            viewWorkLogs.classList.remove('active');
            if (mainTitle) mainTitle.textContent = "EVM プロジェクト進捗分析";
        });

        btnSyncInfo.addEventListener('click', (e) => {
            e.preventDefault();
            btnSyncInfo.classList.add('active');
            btnSummary.classList.remove('active');
            btnWorkLogs.classList.remove('active');
            viewSync.classList.add('active');
            viewDashboard.classList.remove('active');
            viewWorkLogs.classList.remove('active');
            if (mainTitle) mainTitle.textContent = "Redmine ニュース連携ステータス";
        });

        btnWorkLogs.addEventListener('click', (e) => {
            e.preventDefault();
            btnWorkLogs.classList.add('active');
            btnSummary.classList.remove('active');
            btnSyncInfo.classList.remove('active');
            viewWorkLogs.classList.add('active');
            viewDashboard.classList.remove('active');
            viewSync.classList.remove('active');
            if (mainTitle) mainTitle.textContent = "メンバー稼働実績 ＆ チケット進捗推移";
        });
    }
}

// ========================================================
// 同期コントロール
// ========================================================

function setupSyncControls() {
    const btnRunSync = document.getElementById('btn-run-sync');
    const syncDateInput = document.getElementById('sync-date');
    const consoleOutput = document.getElementById('console-output');
    const btnClearLog = document.getElementById('btn-clear-log');

    if (btnRunSync && syncDateInput && consoleOutput) {
        btnRunSync.addEventListener('click', () => {
            const targetDate = syncDateInput.value;

            btnRunSync.disabled = true;
            const originalText = btnRunSync.innerHTML;
            btnRunSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同期実行中...';

            appendLog(`[INFO] ${targetDate ? targetDate + ' の' : '未処理の'}データ同期リクエストを送信しました...`);

            fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: targetDate || null })
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw err; });
                }
                return response.json();
            })
            .then(res => {
                if (res.status === 'success') {
                    appendLog(`[SUCCESS] ${res.message}`);
                    if (res.output) {
                        appendLog(`\n--- システム出力 ---\n${res.output}`);
                    }
                    // 同期対象日を表示基準日にも自動セット
                    const displayDateInput = document.getElementById('display-date');
                    if (displayDateInput && targetDate) {
                        displayDateInput.value = targetDate;
                    }

                    appendLog(`[INFO] EVMデータを画面に再ロードしています...`);
                    fetchAndRenderEVM(() => {
                        appendLog(`[SUCCESS] 画面のEVMチャートと数値を最新化しました。`);
                    });
                } else {
                    appendLog(`[ERROR] 同期エラー: ${res.message}`);
                }
            })
            .catch(err => {
                const errMsg = err.message || err.error || "不明なエラー";
                appendLog(`[ERROR] 同期処理中にエラーが発生しました: ${errMsg}`);
            })
            .finally(() => {
                btnRunSync.disabled = false;
                btnRunSync.innerHTML = originalText;
            });
        });
    }

    if (btnClearLog && consoleOutput) {
        btnClearLog.addEventListener('click', () => {
            consoleOutput.textContent = 'ログがクリアされました。';
        });
    }
}

function appendLog(message) {
    const consoleOutput = document.getElementById('console-output');
    if (consoleOutput) {
        if (consoleOutput.textContent.startsWith('同期処理を実行すると')) {
            consoleOutput.textContent = '';
        }
        const timestamp = new Date().toLocaleTimeString();
        consoleOutput.textContent += `[${timestamp}] ${message}\n`;
        // 親のコンテナ（.console-body）を確実に最下部へスクロール（DOM更新後に実行）
        requestAnimationFrame(() => {
            const parent = consoleOutput.parentElement;
            if (parent) {
                parent.scrollTop = parent.scrollHeight;
            }
        });
    }
}

// ========================================================
// 統合ツリーテーブル（メンバー稼働 + チケット進捗）
// ========================================================

function renderTreeTable(workLogs, issueProgress, memberStats) {
    const table = document.getElementById('tree-work-table');
    const thead = table ? table.querySelector('thead') : null;
    const tbody = document.getElementById('tree-work-tbody');
    if (!thead || !tbody) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!workLogs || workLogs.length === 0) {
        tbody.innerHTML = '<tr><td class="text-center" colspan="100%">稼働実績データがありません。</td></tr>';
        return;
    }

    const dates = workLogs.map(l => l.date);
    const formattedDates = dates.map(d => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
    });

    // ヘッダー
    const trHead = document.createElement('tr');
    trHead.innerHTML = '<th>メンバー / チケット</th>';
    formattedDates.forEach(fd => {
        trHead.innerHTML += `<th>${fd}</th>`;
    });
    thead.appendChild(trHead);

    // メンバー名はサーバーで正規化済み
    const members = memberStats.map(m => m.name);
    const memberIds = memberStats.map(m => m.id);

    members.forEach((member, mIdx) => {
        const memberId = memberIds[mIdx];
        const rowId = `member-${memberId}`;

        // === メンバー行（稼働実績 h） ===
        const trMember = document.createElement('tr');
        trMember.className = 'tree-row-member';
        trMember.dataset.memberId = memberId;

        let memberHtml = `<td><span class="tree-toggle"><i class="fa-solid fa-caret-right tree-toggle-icon"></i> ${member}</span></td>`;

        workLogs.forEach(log => {
            const val = log.hours[member];
            if (val !== undefined && val !== null) {
                if (val > 0) {
                    memberHtml += `<td class="tree-cell-active">${val}h</td>`;
                } else {
                    memberHtml += `<td class="tree-cell-zero">0h</td>`;
                }
            } else {
                memberHtml += `<td class="tree-cell-empty">-</td>`;
            }
        });

        trMember.innerHTML = memberHtml;
        tbody.appendChild(trMember);

        // === チケット行（進捗率 %）===
        const memberProgress = issueProgress ? issueProgress.find(mp => mp.member_id === memberId) : null;
        const issues = memberProgress ? (memberProgress.issues || []) : [];

        issues.forEach(issue => {
            const trIssue = document.createElement('tr');
            trIssue.className = `tree-row-issue tree-child-${memberId}`;

            let issueHtml = `<td><span class="issue-id-cell">#${issue.issue_id}</span> ${issue.subject}</td>`;

            dates.forEach(date => {
                const progress = issue.progress_by_date[date];
                if (progress !== undefined && progress !== null) {
                    let cellClass = 'progress-cell-zero';
                    if (progress === 100) {
                        cellClass = 'progress-cell-complete';
                    } else if (progress > 0) {
                        cellClass = 'progress-cell-active';
                    }
                    issueHtml += `<td class="${cellClass}">${progress}%</td>`;
                } else {
                    issueHtml += `<td class="progress-cell-empty">-</td>`;
                }
            });

            trIssue.innerHTML = issueHtml;
            tbody.appendChild(trIssue);
        });

        // メンバー行のクリックで子チケット行を展開/折りたたみ
        trMember.addEventListener('click', () => {
            const isExpanded = trMember.classList.contains('expanded');
            trMember.classList.toggle('expanded');
            const childRows = tbody.querySelectorAll(`.tree-child-${memberId}`);
            childRows.forEach(row => {
                if (isExpanded) {
                    row.classList.remove('visible');
                } else {
                    row.classList.add('visible');
                }
            });
        });
    });
}

// ========================================================
// 表示基準日 DatePicker
// ========================================================

function setupDisplayDatePicker() {
    const displayDateInput = document.getElementById('display-date');
    if (displayDateInput) {
        displayDateInput.addEventListener('change', () => {
            fetchAndRenderEVM();
        });
    }
}

// ========================================================
// EVM指標の読み方 - 折りたたみトグル
// ========================================================

function setupEvmGuideModal() {
    const trigger = document.getElementById('btn-guide-trigger');
    const modal = document.getElementById('evm-guide-modal');
    const closeBtn = document.getElementById('modal-close');

    if (trigger && modal && closeBtn) {
        // モーダルを開く
        trigger.addEventListener('click', () => {
            modal.classList.add('open');
        });

        // 閉じるボタンで閉じる
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('open');
        });

        // 領域外クリックで閉じる
        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('open');
            }
        });
    }
}
