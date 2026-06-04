document.addEventListener('DOMContentLoaded', () => {
    loadEVMData();
    setupNavigation();
    setupSyncControls();

    // 再読み込みボタンのイベントリスナー (ダッシュボードのリフレッシュ)
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
        btnSync.addEventListener('click', () => {
            const icon = btnSync.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            
            reloadDataScript(() => {
                loadEVMData(() => {
                    setTimeout(() => {
                        if (icon) icon.classList.remove('fa-spin');
                    }, 500);
                });
            });
        });
    }
});

let evmChartInstance = null;

// 動的に evm_data.js を再読込する関数 (キャッシュ回避)
function reloadDataScript(callback) {
    const oldScript = document.querySelector('script[src^="evm_data.js"]');
    if (oldScript) {
        oldScript.remove();
    }
    
    const newScript = document.createElement('script');
    newScript.src = 'evm_data.js?t=' + new Date().getTime();
    newScript.onload = () => {
        console.log("EVM data script hot-reloaded.");
        if (callback) callback();
    };
    newScript.onerror = (e) => {
        console.error("Failed to hot-reload EVM data script:", e);
        if (callback) callback();
    };
    document.head.appendChild(newScript);
}

function loadEVMData(callback = null) {
    try {
        if (typeof window.EVM_DATA === 'undefined') {
            throw new Error('EVMデータがロードされていません。');
        }
        updateDashboard(window.EVM_DATA);
        if (callback) callback();
    } catch (error) {
        console.error('Error loading EVM data:', error);
        alert('EVMデータのロード中にエラーが発生しました。evm_data.js が同じフォルダに存在し、正しく読み込まれているか確認してください。');
        if (callback) callback();
    }
}

function updateDashboard(data) {
    const summary = data.project_summary;
    const timeSeries = data.time_series;
    const memberStats = data.member_stats;

    // 1. 最終データ更新時間の設定（今日の日付とします）
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = `最終同期日: 2026-06-04 (本日時点の日報データを反映済)`;
    }

    // 2. KPIカードの更新
    // 進捗率
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
        setIndexStatus(summary.spi, spiStatusEl, cardSpi, 'スケジュール');
    }

    // CPI
    const cpiEl = document.getElementById('kpi-cpi');
    const cpiStatusEl = document.getElementById('status-cpi');
    const cardCpi = document.getElementById('card-cpi');
    if (cpiEl) cpiEl.textContent = summary.cpi.toFixed(2);
    if (cpiStatusEl && cardCpi) {
        setIndexStatus(summary.cpi, cpiStatusEl, cardCpi, 'コスト');
    }

    // AC / BAC
    const acEl = document.getElementById('kpi-ac');
    const bacEl = document.getElementById('kpi-bac');
    const svCvEl = document.getElementById('status-sv-cv');
    if (acEl) acEl.textContent = `${summary.ac.toFixed(1)}h`;
    if (bacEl) bacEl.textContent = `${summary.total_budget.toFixed(1)}h`;
    if (svCvEl) {
        const svSign = summary.sv >= 0 ? '+' : '';
        const cvSign = summary.cv >= 0 ? '+' : '';
        svCvEl.textContent = `SV: ${svSign}${summary.sv.toFixed(1)}h | CV: ${cvSign}${summary.cv.toFixed(1)}h`;
        if (summary.cv < 0) {
            svCvEl.className = 'kpi-status status-danger';
        } else {
            svCvEl.className = 'kpi-status status-good';
        }
    }

    // 3. メンバー一覧テーブルの描画
    const tbody = document.getElementById('members-list-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        
        memberStats.forEach(member => {
            const tr = document.createElement('tr');
            
            // 指標のステータスバッジの選定
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

            const svText = (member.sv >= 0 ? '+' : '') + member.sv.toFixed(1);
            const cvText = (member.cv >= 0 ? '+' : '') + member.cv.toFixed(1);

            // メンバー名ひっくり返りのトリミング（苗字と名前の並び調整）
            let displayName = member.name;
            if (displayName.includes(' ')) {
                const parts = displayName.split(' ');
                if (parts.length === 2 && (parts[0] === '悟史' || parts[0] === '一郎' || parts[0] === '花子' || parts[0] === '敏行')) {
                    displayName = parts[1] + ' ' + parts[0];
                }
            }

            tr.innerHTML = `
                <td><strong>${displayName}</strong></td>
                <td>${member.pv.toFixed(1)}h</td>
                <td>${member.ev.toFixed(1)}h</td>
                <td>${member.ac.toFixed(1)}h</td>
                <td class="${member.sv < 0 ? 'status-danger' : 'status-good'}">${svText}h</td>
                <td class="${member.cv < 0 ? 'status-danger' : 'status-good'}">${cvText}h</td>
                <td><span class="${member.spi < 0.9 ? 'status-danger' : (member.spi < 1.0 ? 'status-warning' : 'status-good')}">${member.spi.toFixed(2)}</span></td>
                <td><span class="${member.cpi < 0.9 ? 'status-danger' : (member.cpi < 1.0 ? 'status-warning' : 'status-good')}">${member.cpi.toFixed(2)}</span></td>
                <td><span class="badge-status ${badgeClass}">${badgeText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 4. EVM 管理曲線の描画
    renderEVMChart(timeSeries);

    // 5. メンバー別日別稼働実績および日報履歴の描画
    renderWorkLogsMatrix(data.member_work_logs, data.member_stats);
    renderIssueProgressAccordion(data.member_issue_progress, data.member_work_logs);
}

function setIndexStatus(value, statusEl, cardEl, labelPrefix) {
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

function renderEVMChart(timeSeries) {
    const dates = timeSeries.map(d => d.date);
    const pvData = timeSeries.map(d => d.pv);
    const evData = timeSeries.map(d => d.ev);
    const acData = timeSeries.map(d => d.ac);

    const ctx = document.getElementById('evmChart').getContext('2d');

    // すでにグラフインスタンスが存在する場合は破棄する
    if (evmChartInstance) {
        evmChartInstance.destroy();
    }

    // Chart.jsのカスタマイズデザイン
    evmChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'PV (計画)',
                    data: pvData,
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
                    data: evData,
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
                    data: acData,
                    borderColor: '#FF453A',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointRadius: 2,
                    pointHoverRadius: 6,
                    tension: 0.2,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // カスタムレジェンドを使用するため非表示
                },
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
                            return ` ${context.dataset.label}: ${context.raw} h`;
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
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'transparent'
                    },
                    ticks: {
                        color: '#8B949E',
                        font: {
                            family: 'Inter',
                            size: 11
                        },
                        maxTicksLimit: 12
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'transparent'
                    },
                    ticks: {
                        color: '#8B949E',
                        font: {
                            family: 'Inter',
                            size: 11
                        },
                        callback: function(value) {
                            return value + ' h';
                        }
                    }
                }
            }
        }
    });
}

// ナビゲーションの切り替え制御
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
            if (mainTitle) mainTitle.textContent = "メンバー稼働実績 ＆ 日報履歴";
        });
    }
}

// 同期コントロールのイベントハンドリング
function setupSyncControls() {
    const btnRunSync = document.getElementById('btn-run-sync');
    const syncDateInput = document.getElementById('sync-date');
    const consoleOutput = document.getElementById('console-output');
    const btnClearLog = document.getElementById('btn-clear-log');

    if (btnRunSync && syncDateInput && consoleOutput) {
        btnRunSync.addEventListener('click', () => {
            const targetDate = syncDateInput.value;
            
            // UIをローディング表示にする
            btnRunSync.disabled = true;
            const originalText = btnRunSync.innerHTML;
            btnRunSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同期実行中...';
            
            appendLog(`[INFO] ${targetDate ? targetDate + ' の' : '未処理の'}データ同期リクエストを送信しました...`);

            // POST /api/sync
            fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
                    
                    // ダッシュボードデータをリフレッシュ
                    appendLog(`[INFO] EVMデータを画面に再ロードしています...`);
                    reloadDataScript(() => {
                        loadEVMData(() => {
                            appendLog(`[SUCCESS] 画面のEVMチャートと数値を最新化しました。`);
                        });
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
                // UIを戻す
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
        // 初期文字列を削除
        if (consoleOutput.textContent.startsWith('同期処理を実行すると')) {
            consoleOutput.textContent = '';
        }
        
        const timestamp = new Date().toLocaleTimeString();
        consoleOutput.textContent += `[${timestamp}] ${message}\n`;
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
}

// メンバー別日別稼働実績マトリクス表の描画
function renderWorkLogsMatrix(logs, memberStats) {
    const table = document.getElementById('matrix-work-table');
    const thead = table ? table.querySelector('thead') : null;
    const tbody = document.getElementById('matrix-work-tbody');
    if (!thead || !tbody) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td class="text-center" colspan="100%">稼働実績データがありません。</td></tr>';
        return;
    }

    const dates = logs.map(l => l.date);
    const formattedDates = dates.map(d => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
    });

    // ヘッダー行
    const trHead = document.createElement('tr');
    trHead.innerHTML = '<th>メンバー名</th>';
    formattedDates.forEach(fd => {
        trHead.innerHTML += `<th>${fd}</th>`;
    });
    thead.appendChild(trHead);

    // メンバー一覧を取得
    const members = memberStats.map(m => m.name);

    // メンバーごとに1行生成
    members.forEach(member => {
        let displayName = member;
        if (displayName.includes(' ')) {
            const parts = displayName.split(' ');
            if (parts.length === 2 && (parts[0] === '悟史' || parts[0] === '一郎' || parts[0] === '花子' || parts[0] === '敏行')) {
                displayName = parts[1] + ' ' + parts[0];
            }
        }

        const trRow = document.createElement('tr');
        let rowHtml = `<td><strong>${displayName}</strong></td>`;

        logs.forEach(log => {
            const hours = log.hours[member] || 0.0;
            if (hours > 0) {
                rowHtml += `<td class="matrix-cell-active">${hours.toFixed(1)}h</td>`;
            } else {
                rowHtml += `<td class="matrix-cell-empty">-</td>`;
            }
        });

        trRow.innerHTML = rowHtml;
        tbody.appendChild(trRow);
    });
}

// 担当者別・チケット別進捗推移アコーディオンの描画
function renderIssueProgressAccordion(progressData, workLogs) {
    const container = document.getElementById('accordion-progress-container');
    if (!container) return;

    container.innerHTML = '';

    if (!progressData || progressData.length === 0) {
        container.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 30px 0;">進捗推移データがありません。</p>';
        return;
    }

    // 日付リストを取得（workLogsのdateから持ってくる）
    const dates = workLogs.map(l => l.date);
    const formattedDates = dates.map(d => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
    });

    progressData.forEach(memberData => {
        const memberName = memberData.member_name;
        let displayName = memberName;
        // 姓名の並びを綺麗にする
        if (displayName.includes(' ')) {
            const parts = displayName.split(' ');
            if (parts.length === 2 && (parts[0] === '悟史' || parts[0] === '一郎' || parts[0] === '花子' || parts[0] === '敏行')) {
                displayName = parts[1] + ' ' + parts[0];
            }
        }

        const issues = memberData.issues || [];
        const ticketCount = issues.length;

        // アコーディオンの要素を生成
        const itemDiv = document.createElement('div');
        itemDiv.className = 'accordion-item';

        // アコーディオンヘッダーのHTML
        const headerHtml = `
            <div class="accordion-header">
                <div class="accordion-header-left">
                    <i class="fa-solid fa-circle-user accordion-author-icon"></i>
                    <span class="accordion-member-name">${displayName}</span>
                    <span class="accordion-ticket-count">担当チケット: ${ticketCount}件</span>
                </div>
                <div class="accordion-header-right">
                    <span class="accordion-status-text">クリックで詳細を表示</span>
                    <i class="fa-solid fa-chevron-down accordion-toggle-icon"></i>
                </div>
            </div>
        `;

        // テーブルヘッダーのHTML
        let tableHeaderCols = `
            <th class="col-ticket-id">チケットID</th>
            <th class="col-subject">チケット名</th>
        `;
        formattedDates.forEach(fd => {
            tableHeaderCols += `<th>${fd}</th>`;
        });

        // 各チケット（行）のHTML生成
        let tableRowsHtml = '';
        issues.forEach(issue => {
            let rowCols = `
                <td class="cell-ticket-id">#${issue.issue_id}</td>
                <td class="cell-subject" title="${issue.subject}">${issue.subject}</td>
            `;

            dates.forEach(date => {
                const progress = issue.progress_by_date[date];
                if (progress !== undefined && progress !== null) {
                    let cellClass = 'progress-cell-zero';
                    if (progress === 100) {
                        cellClass = 'progress-cell-complete';
                    } else if (progress > 0) {
                        cellClass = 'progress-cell-active';
                    }
                    rowCols += `<td class="${cellClass}">${progress}%</td>`;
                } else {
                    rowCols += `<td class="progress-cell-empty">-</td>`;
                }
            });

            tableRowsHtml += `<tr>${rowCols}</tr>`;
        });

        // アコーディオンコンテンツ（マトリクス表）のHTML
        const contentHtml = `
            <div class="accordion-content">
                <table class="progress-matrix-table">
                    <thead>
                        <tr>${tableHeaderCols}</tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml || '<tr><td colspan="100%" class="text-center" style="padding: 20px;">担当チケットがありません。</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;

        itemDiv.innerHTML = headerHtml + contentHtml;
        container.appendChild(itemDiv);

        // 開閉トグルのイベントリスナー設定
        const header = itemDiv.querySelector('.accordion-header');
        const content = itemDiv.querySelector('.accordion-content');
        const statusText = itemDiv.querySelector('.accordion-status-text');

        header.addEventListener('click', () => {
            const isActive = itemDiv.classList.contains('active');
            
            // クラスの切り替え
            itemDiv.classList.toggle('active');
            
            if (isActive) {
                statusText.textContent = 'クリックで詳細を表示';
            } else {
                statusText.textContent = 'クリックで詳細を非表示';
            }
        });
    });
}

