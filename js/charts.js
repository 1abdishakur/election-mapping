export const ChartsModule = {
    charts: {},

    init() {
        Chart.defaults.font.family = 'Inter, sans-serif';
        Chart.defaults.font.size = 11;

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        this.updateTheme(currentTheme);

        // 1: Vote Share (Doughnut)
        this.charts.voteShare = this._doughnut('voteShareChart', 'Votes');
        // 2: Seat Share (Doughnut)
        this.charts.seatShare = this._doughnut('seatShareChart', 'Seats');
        // 3: Gender Split (Horizontal Bar)
        this.charts.gender = this._bar('genderChart');

        // 4: Competitiveness — custom DOM renderer (no Chart.js)
        this._competeExpanded = false;
        this._competeAllData = [];
        this._initCompeteExpand();
        // 5: Council Layout (Parliament Dots) — no Chart.js needed
        // Container is a plain div, rendered via _renderParliament()

        window.addEventListener('themeChanged', e => this.updateTheme(e.detail));
    },

    updateTheme(theme) {
        const isDark = theme === 'dark';
        this.textColor = isDark ? '#F9FAFB' : '#1F2937';
        this.mutedColor = isDark ? '#9CA3AF' : '#6B7280';
        this.gridColor = isDark ? '#334155' : '#E5E7EB';

        Chart.defaults.color = this.textColor;

        Object.entries(this.charts).forEach(([key, chart]) => {
            if (!chart || typeof chart.update !== 'function') return;
            if (chart.options.scales) {
                Object.values(chart.options.scales).forEach(scale => {
                    if (scale.grid) scale.grid.color = this.gridColor;
                    if (scale.ticks) scale.ticks.color = this.textColor;
                });
            }
            chart.update('none');
        });
    },

    update(summary, parties, districtMaster = [], isDistrictLevel = false) {
        if (!summary) return;

        const partyList = Object.keys(parties || {}).map(pc => ({
            code: pc,
            name: parties[pc]?.party_name || pc,
            color: parties[pc]?.party_color || '#2563eb',
            votes: summary.partyVotes?.[pc] || 0,
            seats: summary.partySeats?.[pc] || 0
        })).sort((a, b) => b.seats - a.seats);

        const topParties = partyList.filter(p => p.votes > 0 || p.seats > 0);

        this._setDoughnut(this.charts.voteShare, topParties.map(p => p.name), topParties.map(p => p.votes), topParties.map(p => p.color));
        this._setDoughnut(this.charts.seatShare, topParties.map(p => p.name), topParties.map(p => p.seats), topParties.map(p => p.color));

        // 3: Gender Split
        if (this.charts.gender && summary.genderStats) {
            const male = summary.genderStats.maleWinners || 0;
            const female = summary.genderStats.femaleWinners || 0;
            this.charts.gender.data.labels = ['Male', 'Female', '']; // Add padding labels if needed, or just let Chart.js handle it
            this.charts.gender.data.datasets[0].data = [male, female];
            this.charts.gender.data.datasets[0].backgroundColor = ['#3b82f6', '#ec4899'];
            this.charts.gender.options.scales.x.max = Math.max(male, female) * 1.5;
            this.charts.gender.update();
        }



        // 4: Competitiveness (Top 10 Tightest Races, colored by state)
        let compRaces = [];
        if (districtMaster && districtMaster.length) {
            compRaces = districtMaster.map(d => {
                const results = [...(d.party_results || [])].sort((a, b) => b.votes_received - a.votes_received);
                const winner = results[0];
                const runnerUp = results[1];
                const total = d.valid_votes || 1;
                const marginVal = winner && runnerUp ? (winner.votes_received - runnerUp.votes_received) : (winner ? winner.votes_received : 0);
                const marginPct = (marginVal / total) * 100;
                const stateName = (d.state?.state_name || '').trim();
                return { name: d.district_name, margin: marginVal, pct: marginPct, state: stateName };
            })
                .sort((a, b) => a.pct - b.pct);
        }
        this._competeAllData = compRaces;
        this._renderCompetitiveness();

        // 5: Council Layout (Parliament Dots) — only at district level
        const councilBlock = document.getElementById('councilLayoutChart')?.closest('.chart-block');
        if (isDistrictLevel) {
            if (councilBlock) councilBlock.style.display = '';
            this._renderParliament('councilLayoutChart', topParties.slice(0, 10));
        } else {
            if (councilBlock) councilBlock.style.display = 'none';
        }
    },

    _setDoughnut(chart, labels, data, colors) {
        chart.data.labels = labels;
        chart.data.datasets = [{
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 4
        }];
        chart.update('none');
    },

    // ── District Competitiveness (Custom DOM) ─────────────────
    _initCompeteExpand() {
        const btn = document.getElementById('compete-expand-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            this._competeExpanded = !this._competeExpanded;
            btn.textContent = this._competeExpanded ? '▲' : '▼';
            btn.title = this._competeExpanded ? 'Show top 10' : 'Show all';
            // Adjust container height
            const block = document.getElementById('competitiveness-block');
            if (block) {
                block.style.height = this._competeExpanded ? 'auto' : '';
                block.style.flex = this._competeExpanded ? '0 0 auto' : '';
            }
            this._renderCompetitiveness();
        });
    },

    _renderCompetitiveness() {
        const container = document.getElementById('competitivenessChart');
        if (!container) return;

        const data = this._competeExpanded ? this._competeAllData : this._competeAllData.slice(0, 10);
        if (!data.length) {
            container.innerHTML = '<div style="text-align:center;color:var(--c-text-3);font-size:11px;padding:20px;">No data</div>';
            return;
        }

        const maxPct = Math.max(...data.map(r => r.pct), 1);

        // Get state colors from MapModule
        const stateColors = (typeof MapModule !== 'undefined' && MapModule._stateColorMap) ? MapModule._stateColorMap : {};

        let html = '';
        data.forEach((r, i) => {
            const barW = Math.max(2, (r.pct / maxPct) * 100);
            const color = stateColors[r.state] || '#F59E0B';
            html += `<div class="compete-row">`;
            html += `<div class="compete-label" title="${r.name}">${r.name}</div>`;
            html += `<div class="compete-bar-wrap">`;
            html += `<div class="compete-bar" style="width:${barW}%;background:${color}" title="${r.state}"></div>`;
            html += `<span class="compete-val">${r.pct.toFixed(1)}%</span>`;
            html += `</div>`;
            html += `</div>`;
        });

        // Show count info
        if (!this._competeExpanded && this._competeAllData.length > 10) {
            html += `<div class="compete-more">Showing 10 of ${this._competeAllData.length} districts</div>`;
        }

        container.innerHTML = html;
    },

    _doughnut(id, valueLabel = 'Val') {
        return new Chart(document.getElementById(id), {
            type: 'doughnut',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (item) => {
                                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = (item.raw / total) * 100;
                                return `${item.label}: ${item.raw.toLocaleString()} (${pct.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            },
            plugins: [{
                id: 'doughnutLabels',
                afterDraw: (chart) => {
                    const { ctx, data } = chart;
                    if (!data.datasets?.[0]?.data?.length) return;
                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                    if (total === 0) return;

                    ctx.save();
                    const meta = chart.getDatasetMeta(0);
                    meta.data.forEach((element, i) => {
                        const val = data.datasets[0].data[i];
                        const pct = (val / total) * 100;
                        if (pct < 3) return; // Hide labels for very small slices

                        const position = element.tooltipPosition();
                        ctx.font = 'bold 10px Inter';
                        ctx.textAlign = 'center';

                        // Show raw value and percentage in brackets
                        const text = `${val.toLocaleString()} (${pct.toFixed(0)}%)`;

                        // Add white stroke for contrast against any dark slice colors
                        ctx.lineJoin = 'round';
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                        ctx.strokeText(text, position.x, position.y);

                        // Dark text fill
                        ctx.fillStyle = '#1F2937';
                        ctx.fillText(text, position.x, position.y);
                    });
                    ctx.restore();
                }
            }]
        });
    },



    /**
     * Render a parliament-style dot layout into a container div.
     * Seats are arranged in concentric semi-circle arcs.
     */
    _renderParliament(containerId, parties) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const totalSeats = parties.reduce((s, p) => s + p.seats, 0);
        if (totalSeats === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--c-text-3);font-size:11px;padding:20px;">No seat data</div>';
            return;
        }

        // Build flat array of seat colors
        const seats = [];
        parties.forEach(p => {
            for (let i = 0; i < p.seats; i++) seats.push({ color: p.color, party: p.name });
        });

        // Calculate rows for a semi-circle layout
        // Each row holds progressively more seats (outer rows are wider)
        const rows = [];
        let placed = 0;
        let rowIdx = 0;
        // Start with a small inner row, grow outward
        while (placed < totalSeats) {
            const capacity = Math.max(3, Math.floor(5 + rowIdx * 2.5));
            const rowSeats = Math.min(capacity, totalSeats - placed);
            rows.push(rowSeats);
            placed += rowSeats;
            rowIdx++;
        }
        // Reverse so largest row is at the bottom (like a real parliament)
        rows.reverse();

        // Build HTML
        let seatIdx = 0;
        let html = '<div class="parliament-rows">';
        rows.forEach(count => {
            html += '<div class="parliament-row">';
            for (let i = 0; i < count && seatIdx < seats.length; i++) {
                const s = seats[seatIdx++];
                html += `<span class="parliament-dot" style="background:${s.color}" title="${s.party}"></span>`;
            }
            html += '</div>';
        });
        html += '</div>';

        // Legend
        html += '<div class="parliament-legend">';
        parties.forEach(p => {
            if (p.seats <= 0) return;
            html += `<div class="parliament-legend-item">`;
            html += `<span class="parliament-legend-dot" style="background:${p.color}"></span>`;
            html += `<span class="parliament-legend-label">${p.name} (${p.seats})</span>`;
            html += `</div>`;
        });
        html += '</div>';

        container.innerHTML = html;
    },

    _bar(id) {
        return new Chart(document.getElementById(id), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [],
                    borderRadius: 4,
                    barThickness: 18
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 450 },
                layout: { padding: { right: 70, left: 10, top: 10, bottom: 10 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        display: false,
                        grid: { display: false }
                    },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            font: { weight: '800', size: 10 }
                        }
                    }
                }
            },
            plugins: [{
                id: 'barLabels',
                afterDraw: (chart) => {
                    const { ctx, data } = chart;
                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                    ctx.save();
                    data.datasets[0].data.forEach((val, i) => {
                        const meta = chart.getDatasetMeta(0);
                        const bar = meta.data[i];
                        if (!bar || val === 0) return;

                        const pct = total > 0 ? ((val / total) * 100).toFixed(0) : 0;
                        ctx.fillStyle = this.textColor;
                        ctx.font = '800 11px Inter';
                        ctx.textAlign = 'left';
                        const text = `${val.toLocaleString()} (${pct}%)`;
                        ctx.fillText(text, bar.x + 8, bar.y + 4);
                    });
                    ctx.restore();
                }
            }]
        });
    }
};
