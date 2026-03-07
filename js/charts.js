import { CONFIG } from './config.js?v=3';

const DARK = '#1a202c';
const GRID = 'rgba(0,0,0,.06)';

export const ChartsModule = {
    charts: {},

    init() {
        Chart.defaults.font.family = 'Inter, sans-serif';
        Chart.defaults.font.size = 11;
        Chart.defaults.color = DARK;

        this.charts.seatsSum = this._bar('seatsWonChart');
        this.charts.votesSum = this._bar('partyVotesChart');
        this.charts.genderRep = this._multiBar('genderRepChart');
        this.charts.efficiency = this._multiBar('efficiencyChart');
    },

    update(summary, parties) {
        if (!summary) return;
        
        const totalSeats = summary.totalSeats || 1;
        const totalVotes = summary.turnoutVotes || summary.totalVotes || 1;

        const arrFull = Object.keys(parties || {})
            .map(pc => ({
                code: pc,
                name: parties[pc]?.party_name || pc,
                color: parties[pc]?.party_color || '#2563eb',
                votes: summary.partyVotes?.[pc] || 0,
                seats: summary.partySeats?.[pc] || 0,
                vPct: (summary.partyVotes?.[pc] || 0) / totalVotes * 100,
                sPct: (summary.partySeats?.[pc] || 0) / totalSeats * 100
            }))
            .sort((a, b) => b.seats - a.seats);

        const arr = arrFull.slice(0, 6);

        this._setBar(this.charts.seatsSum, arr.map(x => x.name), arr.map(x => x.seats), arr.map(x => x.color), arr.map(x => x.sPct));
        this._setBar(this.charts.votesSum, arr.map(x => x.name), arr.map(x => x.votes), arr.map(x => x.color), arr.map(x => x.vPct));

        // 4: Gender Representation - Now horizontal and grouped
        const g = summary.genderStats || {};
        const totalCand = (g.male || 0) + (g.female || 0) || 1;
        const totalWin = (g.maleWinners || 0) + (g.femaleWinners || 0) || 1;

        this.charts.genderRep.data.labels = ['Male', 'Female'];
        this.charts.genderRep.data.datasets = [
            { 
                label: 'Candidates', 
                data: [g.male || 0, g.female || 0], 
                backgroundColor: '#94a3b8', 
                pcts: [(g.male || 0)/totalCand*100, (g.female || 0)/totalCand*100] 
            },
            { 
                label: 'Winners', 
                data: [g.maleWinners || 0, g.femaleWinners || 0], 
                backgroundColor: '#10b981',
                pcts: [(g.maleWinners||0)/totalWin*100, (g.femaleWinners||0)/totalWin*100] 
            }
        ];
        this.charts.genderRep.update('none');

        // 5: Efficiency (Votes % vs Seats %) - Better comparison
        this.charts.efficiency.data.labels = arr.map(x => x.name);
        this.charts.efficiency.data.datasets = [
            { label: 'Vote Share %', data: arr.map(x => x.vPct), backgroundColor: '#3b82f6' },
            { label: 'Seat Share %', data: arr.map(x => x.sPct), backgroundColor: '#f59e0b' }
        ];
        this.charts.efficiency.update('none');
    },

    _setBar(chart, labels, data, colors, pcts) {
        chart.data.labels = labels;
        chart.data.datasets = [{
            data,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 8,
            categoryPercentage: 0.7,
            barPercentage: 0.7,
            pcts: pcts // Custom metadata for plugin
        }];
        chart.update('none');
    },

    _setDonut(chart, labels, data, colors) {
        chart.data.labels = labels;
        chart.data.datasets = [{ data, backgroundColor: colors, borderWidth: 0 }];
        chart.update('none');
    },

    _bar(id) {
        return new Chart(document.getElementById(id), {
            type: 'bar',
            data: { labels: [], datasets: [] },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: {
                    padding: { left: 0, right: 90, top: 35, bottom: 10 }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.9)',
                        padding: 10,
                        cornerRadius: 8
                    }
                },
                scales: {
                    x: { beginAtZero: true, grid: { display: false }, ticks: { display: false } },
                    y: { grid: { display: false }, ticks: { display: false } }
                }
            },
            plugins: [{
                id: 'customLabels',
                afterDraw: (chart) => {
                    const { ctx, data } = chart;
                    if (!data.datasets.length) return;

                    ctx.save();
                    data.labels.forEach((label, i) => {
                        const meta = chart.getDatasetMeta(0);
                        const element = meta.data[i];
                        if (!element) return;

                        const val = data.datasets[0].data[i];
                        const pct = data.datasets[0].pcts ? data.datasets[0].pcts[i] : null;
                        const rect = element.getProps(['x', 'y', 'base', 'width', 'height'], true);
                        
                        // Party Name (Higher offset for safety)
                        ctx.font = '700 11px Inter';
                        ctx.fillStyle = '#1e293b';
                        ctx.textAlign = 'left';
                        ctx.fillText(label, 0, rect.y - 18);

                        // Value + Pct
                        ctx.font = '600 10px Inter';
                        ctx.fillStyle = '#64748b';
                        ctx.textAlign = 'left';
                        let txt = val.toLocaleString();
                        if (pct !== null) txt += ` (${pct.toFixed(1)}%)`;
                        ctx.fillText(txt, rect.x + 10, rect.y + 4);
                    });
                    ctx.restore();
                }
            }]
        });
    },

    _multiBar(id) {
        return new Chart(document.getElementById(id), {
            type: 'bar',
            data: { labels: [], datasets: [] },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: {
                    padding: { left: 0, right: 90, top: 40, bottom: 10 }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { boxWidth: 10, padding: 15, font: { size: 10, weight: '700' } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.9)',
                        padding: 10,
                        cornerRadius: 8
                    }
                },
                scales: {
                    x: { beginAtZero: true, grid: { display: false }, ticks: { display: false } },
                    y: { grid: { display: false }, ticks: { display: false } }
                }
            },
            plugins: [{
                id: 'multiLabels',
                afterDraw: (chart) => {
                    const { ctx, data } = chart;
                    ctx.save();
                    data.labels.forEach((label, i) => {
                        const meta = chart.getDatasetMeta(0);
                        const element = meta.data[i];
                        if (!element) return;
                        const rect = element.getProps(['y'], true);
                        
                        // Group Title
                        ctx.font = '700 11px Inter';
                        ctx.fillStyle = '#1e293b';
                        ctx.textAlign = 'left';
                        ctx.fillText(label, 0, rect.y - 32);

                        // Values for each bar in group
                        data.datasets.forEach((dataset, di) => {
                            const dMeta = chart.getDatasetMeta(di);
                            const dEl = dMeta.data[i];
                            if (!dEl) return;
                            const dRect = dEl.getProps(['x', 'y'], true);
                            const val = dataset.data[i];
                            const pct = dataset.pcts ? dataset.pcts[i] : (id === 'efficiencyChart' ? val : null);

                            ctx.font = '600 10px Inter';
                            ctx.fillStyle = '#64748b';
                            let txt = id === 'efficiencyChart' ? `${pct.toFixed(1)}%` : val.toLocaleString();
                            if (id !== 'efficiencyChart' && pct !== null) txt += ` (${pct.toFixed(1)}%)`;
                            ctx.fillText(txt, dRect.x + 10, dRect.y + 4);
                        });
                    });
                    ctx.restore();
                }
            }]
        });
    }
};
