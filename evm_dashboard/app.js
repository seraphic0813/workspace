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

    // 1. 最終更新バッジ ＋ ヘッダーメタ情報 ＋ サイドバー基準日
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = `最終更新: ${summary.last_synced || '未同期'}`;
    }
    const metaPlannedEl = document.getElementById('meta-planned-end');
    if (metaPlannedEl) metaPlannedEl.textContent = formatDateJP(summary.planned_end_date);
    const metaTeamEl = document.getElementById('meta-team-count');
    if (metaTeamEl) metaTeamEl.textContent = `${memberStats.length}名`;
    const metaBudgetEl = document.getElementById('meta-budget');
    if (metaBudgetEl) metaBudgetEl.textContent = `${summary.total_budget}${unit}`;
    const sidebarBaseDateEl = document.getElementById('sidebar-base-date');
    if (sidebarBaseDateEl) sidebarBaseDateEl.textContent = formatDateJP(summary.base_date);

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

    // AC（実績コスト・人日）＋ SV/CV
    const acEl = document.getElementById('kpi-ac');
    const svCvEl = document.getElementById('status-sv-cv');
    if (acEl) acEl.textContent = `${summary.ac}${unit}`;
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
    // ETCカードに悲観EAC（最悪ケース）を注記: EAC_worst = AC + (BAC - EV) / (CPI × SPI)
    const etcWorstEl = document.getElementById('etc-worst-note');
    if (etcWorstEl) {
        const denom = (summary.cpi || 0) * (summary.spi || 0);
        if (denom > 0) {
            const eacWorst = summary.ac + (summary.bac - summary.ev) / denom;
            etcWorstEl.textContent = `最悪ケース: ${eacWorst.toFixed(2)}${unit}`;
        } else {
            etcWorstEl.textContent = '最悪ケース: -';
        }
    }

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

    // 4. メンバー一覧テーブル（行番号・アバター・フッター集計）
    const tbody = document.getElementById('members-list-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        let countGood = 0, countWarn = 0, countDanger = 0;
        let sumSpi = 0, sumCpi = 0, nValid = 0;
        memberStats.forEach((member, idx) => {
            const tr = document.createElement('tr');

            let badgeClass = 'good';
            let badgeText = '正常';
            const score = Math.min(member.spi, member.cpi);
            if (score < 0.9) {
                badgeClass = 'danger';
                badgeText = '遅延・超過';
                countDanger++;
            } else if (score < 1.0) {
                badgeClass = 'warning';
                badgeText = '調整推奨';
                countWarn++;
            } else {
                countGood++;
            }

            // チーム平均は PV>0 のメンバーのみで集計（PV=0 の異常値混入を防ぐ）
            if (member.pv > 0) {
                sumSpi += member.spi;
                sumCpi += member.cpi;
                nValid++;
            }

            const svText = (member.sv >= 0 ? '+' : '') + member.sv;
            const cvText = (member.cv >= 0 ? '+' : '') + member.cv;
            const initial = ((member.name || '?').trim().charAt(0)) || '?';

            tr.innerHTML = `
                <td class="col-rank">${idx + 1}</td>
                <td><span class="member-name-cell"><span class="member-avatar">${initial}</span><strong>${member.name}</strong></span></td>
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

        // フッター集計（正常/注意/警告 件数 ＋ チーム平均 SPI/CPI）
        const summaryEl = document.getElementById('members-summary');
        const countsEl = document.getElementById('summary-counts');
        const indicesEl = document.getElementById('team-indices');
        if (summaryEl && countsEl && indicesEl) {
            if (memberStats.length > 0) {
                countsEl.innerHTML =
                    `<span class="summary-count"><span class="summary-dot good"></span>正常 ${countGood}名</span>` +
                    `<span class="summary-count"><span class="summary-dot warning"></span>注意 ${countWarn}名</span>` +
                    `<span class="summary-count"><span class="summary-dot danger"></span>警告 ${countDanger}名</span>`;
                const teamSpi = nValid > 0 ? (sumSpi / nValid).toFixed(2) : '-';
                const teamCpi = nValid > 0 ? (sumCpi / nValid).toFixed(2) : '-';
                indicesEl.innerHTML =
                    `<span>チーム SPI: <strong>${teamSpi}</strong></span>` +
                    `<span>チーム CPI: <strong>${teamCpi}</strong></span>`;
                summaryEl.style.display = 'table-footer-group';
            } else {
                summaryEl.style.display = 'none';
            }
        }
    }

    // 5. EVMグラフ描画（予測線付き）
    renderEVMChart(timeSeries, forecastSeries, unit, summary);

    // 6. インサイト描画（統合判定・個人ばらつき・容量超過・予測信頼性）
    renderInsights(summary, data.capacity_warnings || [], unit);
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

    // 「今日」（＝表示基準日）の縦線マーカー。Chart.jsのインラインプラグインで描画（CDN追加不要）
    const baseDateIdx = allDates.indexOf(summary.base_date);
    const todayLinePlugin = {
        id: 'todayLine',
        afterDraw(chart) {
            if (baseDateIdx < 0) return;
            const xPos = chart.scales.x.getPixelForValue(baseDateIdx);
            const area = chart.chartArea;
            const c = chart.ctx;
            c.save();
            c.beginPath();
            c.setLineDash([4, 4]);
            c.lineWidth = 1.5;
            c.strokeStyle = 'rgba(240, 246, 252, 0.35)';
            c.moveTo(xPos, area.top);
            c.lineTo(xPos, area.bottom);
            c.stroke();
            c.setLineDash([]);
            c.fillStyle = 'rgba(240, 246, 252, 0.75)';
            c.font = '600 11px Inter';
            c.textAlign = 'center';
            c.fillText('今日', xPos, area.top + 12);
            c.restore();
        }
    };

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

    // 予測線（EAC予測 = 完了時コスト予測曲線）を1本だけ追加
    if (forecastSeries.length > 0) {
        datasets.push({
            label: 'EAC予測',
            data: acForecast,
            borderColor: 'rgba(255, 69, 58, 0.5)',
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
        },
        plugins: [todayLinePlugin]
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
            // iframeに表示基準日を反映してリロード
            syncMemberDashboardFrame();
        });
    }

    // ヘッダーの「データを取り込む」→ 連携ステータス（同期）画面へ遷移
    const btnFetchData = document.getElementById('btn-fetch-data');
    if (btnFetchData && btnSyncInfo) {
        btnFetchData.addEventListener('click', () => btnSyncInfo.click());
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
// インサイト描画
//   - スケジュール×コストの統合判定（一文サマリ）   [P2-6]
//   - 全体KPIに個人ばらつきを併記（オールグリーンの罠回避） [P2-5]
//   - 計画キャパシティ超過の警告                     [P2-4]
//   - 完了予測の信頼性（参考値）表示                 [P2-7]
// ========================================================

function renderInsights(summary, capacityWarnings, unit) {
    unit = unit || '人日';
    capacityWarnings = capacityWarnings || [];

    // --- 統合判定の一文サマリ + 個人ばらつき/容量タグ ---
    const banner = document.getElementById('insight-banner');
    const summaryEl = document.getElementById('insight-summary');
    const tagsEl = document.getElementById('insight-tags');
    if (banner && summaryEl && tagsEl) {
        const text = summary.status_summary || '';
        summaryEl.textContent = text;
        tagsEl.innerHTML = '';

        if (summary.member_alert) {
            banner.classList.add('insight-alert');
            const tag = document.createElement('span');
            tag.className = 'insight-tag danger';
            tag.innerHTML = `<i class="fa-solid fa-user-xmark"></i> 個人にばらつき: 最小SPI ${summary.member_spi_min} (${summary.member_spi_min_name})`;
            tagsEl.appendChild(tag);
        } else {
            banner.classList.remove('insight-alert');
        }

        if (typeof summary.member_sv_worst === 'number' && summary.member_sv_worst < 0) {
            const tag = document.createElement('span');
            tag.className = 'insight-tag warning';
            tag.innerHTML = `<i class="fa-solid fa-arrow-trend-down"></i> 最大遅延: ${summary.member_sv_worst}${unit} (${summary.member_sv_worst_name})`;
            tagsEl.appendChild(tag);
        }

        if (capacityWarnings.length > 0) {
            const tag = document.createElement('span');
            tag.className = 'insight-tag danger';
            tag.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 計画過負荷 ${capacityWarnings.length}件`;
            tagsEl.appendChild(tag);
        }

        banner.style.display = (text || tagsEl.children.length > 0) ? 'flex' : 'none';
    }

    // --- 全体SPIカードを個人ばらつき時に注意色へ（オールグリーンの罠回避）---
    const cardSpi = document.getElementById('card-spi');
    const spiStatusEl = document.getElementById('status-spi');
    if (cardSpi && spiStatusEl && summary.member_alert) {
        if (!cardSpi.classList.contains('card-danger')) {
            cardSpi.classList.remove('card-good');
            cardSpi.classList.add('card-warning');
        }
        if (spiStatusEl.textContent.indexOf('個人') === -1) {
            spiStatusEl.textContent += '（個人にばらつき）';
        }
    }

    // --- 完了予測の信頼性（参考値）---
    const noteEl = document.getElementById('forecast-end-note');
    if (noteEl) {
        if (summary.forecast_reliable === false && summary.forecast_note) {
            noteEl.textContent = '⚠ 参考値';
            noteEl.title = summary.forecast_note;
            noteEl.style.opacity = '1';
            noteEl.className = 'kpi-status status-warning';
        } else {
            noteEl.textContent = '-';
            noteEl.style.opacity = '0';
            noteEl.className = 'kpi-status';
        }
    }

    // --- 計画キャパシティ超過テーブル ---
    const capPanel = document.getElementById('capacity-panel');
    const capTbody = document.getElementById('capacity-tbody');
    if (capPanel && capTbody) {
        capTbody.innerHTML = '';
        if (capacityWarnings.length > 0) {
            capacityWarnings.forEach(w => {
                const tr = document.createElement('tr');
                const issuesText = (w.issues || [])
                    .map(it => `#${it.issue_id} ${it.subject} (${it.hours}h)`)
                    .join('<br>');
                tr.innerHTML = `
                    <td><strong>${w.member_name}</strong></td>
                    <td>${formatDateJP(w.date)}</td>
                    <td class="status-danger">${w.planned_hours}h</td>
                    <td>${w.capacity}h</td>
                    <td class="status-danger">+${w.over_hours}h</td>
                    <td class="capacity-issues-cell">${issuesText}</td>
                `;
                capTbody.appendChild(tr);
            });
            capPanel.style.display = 'block';
        } else {
            capPanel.style.display = 'none';
        }
    }
}

// ========================================================
// 表示基準日 DatePicker
// ========================================================

function setupDisplayDatePicker() {
    const displayDateInput = document.getElementById('display-date');
    if (displayDateInput) {
        displayDateInput.addEventListener('change', () => {
            fetchAndRenderEVM();
            // 稼働実績ページが表示中の場合はiframeにも反映
            syncMemberDashboardFrame();
        });
    }
}

// ========================================================
// iframe (member-dashboard) との基準日同期
// ========================================================

function syncMemberDashboardFrame() {
    const frame = document.getElementById('member-dashboard-frame');
    const displayDateInput = document.getElementById('display-date');
    if (!frame) return;

    const dateVal = displayDateInput ? displayDateInput.value : '';
    const newSrc = '/member-dashboard/' + (dateVal ? '?date=' + encodeURIComponent(dateVal) : '');

    // srcが変わる場合のみ更新（再ロード防止）
    try {
        const currentSrc = new URL(frame.src, window.location.origin).pathname +
                           new URL(frame.src, window.location.origin).search;
        const targetSrc = '/member-dashboard/' + (dateVal ? '?date=' + encodeURIComponent(dateVal) : '');
        if (currentSrc !== targetSrc) {
            frame.src = targetSrc;
        } else {
            // 同じsrcでもpostMessageでデータ更新を要求
            try {
                frame.contentWindow.postMessage({ type: 'date-change', date: dateVal }, window.location.origin);
            } catch (e) { /* cross-origin safe */ }
        }
    } catch (e) {
        frame.src = newSrc;
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
