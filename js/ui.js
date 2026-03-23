/**
 * UI Controller — DOM bindings, KPI updates, party list, search
 */
export const UIController = {

    init(callbacks) {
        const { onStateChange, onDistrictChange, onModeChange, onSearch, onToggleCenters, onReset, onShowAllParties } = callbacks;

        document.getElementById('state-filter').addEventListener('change', e => onStateChange(e.target.value));
        document.getElementById('district-filter').addEventListener('change', e => onDistrictChange(e.target.value));
        window.addEventListener('modeChanged', e => onModeChange(e.detail));
        document.getElementById('district-search').addEventListener('input', e => onSearch(e.target.value));

        document.getElementById('reset-btn').addEventListener('click', onReset);
        document.getElementById('show-all-parties').addEventListener('click', onShowAllParties);

        // Details panel has been removed per user specs

        this.sb = document.getElementById('party-sidebar');
        this.cb = document.getElementById('charts-sidebar');
        this.grid = document.querySelector('.body-grid');

        this.updateGrid = () => {
            const sW = this.sb.classList.contains('collapsed') ? '44px' : 'var(--sidebar-w)';
            const cW = this.cb.classList.contains('collapsed') ? '44px' : 'var(--charts-w)';
            if (this.grid) this.grid.style.gridTemplateColumns = `${sW} 1fr ${cW}`;
            window.dispatchEvent(new Event('resize')); // Recalculate maps/charts
        };

        document.getElementById('toggle-sidebar').addEventListener('click', () => {
            this.sb.classList.toggle('collapsed');
            this.updateGrid();
        });

        document.getElementById('toggle-charts').addEventListener('click', () => {
            this.cb.classList.toggle('collapsed');
            this.updateGrid();
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.search-wrap')) {
                document.getElementById('search-results').classList.remove('open');
            }
        });

        // Sidebar Resizers
        const activeRoot = document.documentElement;
        let isResizingLeft = false;
        let isResizingRight = false;
        const sb = this.sb;
        const cb = this.cb;
        const updateGrid = this.updateGrid;

        const resizerLeft = document.getElementById('resizer-left');
        const resizerRight = document.getElementById('resizer-right');

        if (resizerLeft) {
            resizerLeft.addEventListener('mousedown', (e) => {
                isResizingLeft = true;
                resizerLeft.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
        }

        if (resizerRight) {
            resizerRight.addEventListener('mousedown', (e) => {
                isResizingRight = true;
                resizerRight.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (isResizingLeft) {
                if (!sb || sb.classList.contains('collapsed')) return;
                const newWidth = Math.max(200, Math.min(e.clientX, window.innerWidth / 2));
                activeRoot.style.setProperty('--sidebar-w', `${newWidth}px`);
                updateGrid();
            } else if (isResizingRight) {
                if (!cb || cb.classList.contains('collapsed')) return;
                const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth / 2));
                activeRoot.style.setProperty('--charts-w', `${newWidth}px`);
                updateGrid();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizingLeft || isResizingRight) {
                isResizingLeft = false;
                isResizingRight = false;
                if (resizerLeft) resizerLeft.classList.remove('dragging');
                if (resizerRight) resizerRight.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.dispatchEvent(new Event('resize')); // Recalculate maps & charts
            }
        });

        // 📱 MOBILE INTERACTION HANDLERS — Removed for Desktop-Only spec
        this.initTheme();
        this.initFullscreen();
    },


    initFullscreen() {
        const btn = document.getElementById('fullscreen-btn');
        if (!btn) return;

        function toggleFullScreen() {
            const isFullscreen = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            
            if (!isFullscreen) {
                const elem = document.documentElement;
                if (elem.requestFullscreen) {
                    elem.requestFullscreen().catch(err => {
                        console.warn('Fullscreen err:', err);
                        // Fallback to body if documentElement fails
                        document.body.requestFullscreen().catch(e => console.warn(e));
                    });
                } else if (elem.mozRequestFullScreen) { /* Firefox */
                    elem.mozRequestFullScreen();
                } else if (elem.webkitRequestFullscreen) { /* Safari */
                    elem.webkitRequestFullscreen();
                } else if (elem.msRequestFullscreen) { /* IE11 */
                    elem.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.mozCancelFullScreen) { /* Firefox */
                    document.mozCancelFullScreen();
                } else if (document.webkitExitFullscreen) { /* Safari */
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { /* IE11 */
                    document.msExitFullscreen();
                }
            }
        }

        btn.addEventListener('click', () => {
            toggleFullScreen();
        });
        
        // Listen for browser fullscreen changes (Esc key or button)
        ['fullscreenchange', 'mozfullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(evt => {
            document.addEventListener(evt, () => {
                updateIcon();
                // Critical: Force Leaflet and Charts to recalculate their height/width
                window.dispatchEvent(new Event('resize'));
            });
        });
        
        const updateIcon = () => {
            const isFullscreen = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (isFullscreen) {
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                </svg>`;
            } else {
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                </svg>`;
            }
            // Trigger a resize event to ensure Leaflet map and Chart.js adapt to the new full window
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        };

        ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => 
            document.addEventListener(evt, updateIcon)
        );
    },

    initTheme() {
        const btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;
        const sunIcon = btn.querySelector('.sun-icon');
        const moonIcon = btn.querySelector('.moon-icon');

        const setTheme = (theme, persist = true) => {
            document.documentElement.setAttribute('data-theme', theme);
            if (persist) localStorage.setItem('dashboard-theme', theme);

            if (theme === 'dark') {
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
            } else {
                sunIcon.style.display = 'block';
                moonIcon.style.display = 'none';
            }
            // Dispatch to other modules
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: theme }));
        };

        const saved = localStorage.getItem('dashboard-theme') || 'light';
        setTheme(saved, false);

        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            setTheme(current === 'dark' ? 'light' : 'dark');
        });
    },

    populateStateFilter(states) {
        const sel = document.getElementById('state-filter');
        states.forEach(s => {
            const o = document.createElement('option');
            o.value = s.state_code;
            o.textContent = s.state_name;
            sel.appendChild(o);
        });
    },

    populateDistrictFilter(districts) {
        const sel = document.getElementById('district-filter');
        while (sel.options.length > 1) sel.remove(1);
        districts.forEach(d => {
            const o = document.createElement('option');
            o.value = d.district_code || d.dist_code;
            o.textContent = d.district_name;
            sel.appendChild(o);
        });
    },

    updateKPIs(data, isSpecific = false) {
        const fmt = n => (typeof n === 'number' && !isNaN(n)) ? n.toLocaleString() : '—';
        const fmtPct = n => (typeof n === 'number' && !isNaN(n)) ? n.toFixed(1) + '%' : '—';

        // 1. Navbar Badges
        this._set('badge-states-count', fmt(data.totalStates));
        this._set('badge-districts-count', fmt(data.totalDistricts));

        // 2. KPI Cards

        // KPI 1: Candidates
        const statCand = document.getElementById('stat-candidates-gender');
        if (statCand) {
            statCand.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">
                    <div>M: ${fmtPct(data.candidates.malePct)}</div>
                    <div>F: ${fmtPct(data.candidates.femalePct)}</div>
                </div>
            `;
            this._animateNumber(statCand.querySelector('.kpi-main-val'), data.candidates.total);
        }

        // KPI 2: Parties Contested
        const statParties = document.getElementById('stat-parties-contested');
        if (statParties) {
            const vps = (data.totalSeats > 0) ? (data.totalVotes / data.totalSeats) : 0;
            const vpsText = (isSpecific && vps > 0) ? `${fmt(Math.round(vps))} / Seat` : '—';

            statParties.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">${vpsText}</div>
            `;
            this._animateNumber(statParties.querySelector('.kpi-main-val'), data.contestedPartiesCount);
        }

        // KPI 3: Registered Voters
        const statReg = document.getElementById('stat-registered');
        if (statReg) {
            statReg.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">—</div>
            `;
            this._animateNumber(statReg.querySelector('.kpi-main-val'), data.totalRegistered);
        }

        // KPI 4: ID Cards Collected
        const statId = document.getElementById('stat-id-cards');
        if (statId) {
            statId.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">${fmtPct(data.idCollectedPct)}</div>
            `;
            this._animateNumber(statId.querySelector('.kpi-main-val'), data.totalIdCards);
        }

        // KPI 5: Voter Turnout
        const statTurnout = document.getElementById('stat-turnout');
        if (statTurnout) {
            statTurnout.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">${fmtPct(data.turnoutPct)}</div>
            `;
            this._animateNumber(statTurnout.querySelector('.kpi-main-val'), data.turnoutVotes);
        }

        // KPI 6: Valid Votes
        const statValid = document.getElementById('stat-votes-valid');
        if (statValid) {
            statValid.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub">${fmtPct(data.validPct)}</div>
            `;
            this._animateNumber(statValid.querySelector('.kpi-main-val'), data.totalVotes);
        }

        // KPI 7: Invalid Votes
        const statInvalid = document.getElementById('stat-votes-invalid');
        if (statInvalid) {
            statInvalid.innerHTML = `
                <div class="kpi-main-val">—</div>
                <div class="kpi-sub" style="color:var(--c-danger); font-weight:700;">${fmtPct(data.invalidPct)}</div>
            `;
            this._animateNumber(statInvalid.querySelector('.kpi-main-val'), data.totalInvalid);
        }

        // Infrastructure: now displayed as navbar badges
        this._set('badge-centers-count', fmt(data.pollingCentersCount));
        this._set('badge-stations-count', fmt(data.totalPollingStations));
    },

    _animateNumber(el, endVal, duration = 800) {
        if (!el || isNaN(endVal) || endVal === null) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // easeOutQuad
            const easeProgress = progress * (2 - progress);
            const current = Math.floor(easeProgress * endVal);
            el.textContent = current.toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                el.textContent = endVal.toLocaleString();
            }
        };
        window.requestAnimationFrame(step);
    },

    _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    },

    renderPartyList(partySummaries, onPartyClick, isDistrictLevel = false) {
        const list = document.getElementById('party-list');
        list.innerHTML = '';

        if (!partySummaries.length) {
            list.innerHTML = '<div class="loading-msg">No party data available.</div>';
            return;
        }

        partySummaries.forEach(p => {
            const el = document.createElement('div');
            el.className = 'party-card';
            el.dataset.code = p.party_code;

            const logoSrc = p.party_logo_url || '';
            const seats = p.seats_won || 0;
            const votes = p.votes_received || 0;
            const totalSeatsAvailable = partySummaries.reduce((sum, item) => sum + (item.seats_won || 0), 0);
            const seatShare = totalSeatsAvailable > 0 ? (seats / totalSeatsAvailable) * 100 : 0;

            let badgeHtml = '';
            if (isDistrictLevel) {
                const isContested = String(p.is_contested).trim().toUpperCase() === 'TRUE';
                if (!isContested) {
                    badgeHtml = `<span class="badge-uncontested">Not Contested</span>`;
                }
            }

            el.innerHTML = `
                <div class="pc-accent" style="background:${p.party_color || '#9ca3af'}"></div>
                <div class="pc-compact-col-wrap">
                    <img class="pc-logo-side" src="${logoSrc}" alt="${p.party_name}"
                         onerror="this.style.background='#f3f4f6'; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%23ccc%22 d=%22M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 12.27c-2.53-.49-4.64-2.13-5.59-4.34C7.05 14.15 9.4 13.5 12 13.5s4.95.65 5.59 1.43c-.95 2.21-3.06 3.85-5.59 4.34z%22/%3E%3C/svg%3E'">
                    <div class="pc-details-stack">
                        <div class="pc-name-tiny">${p.party_name}</div>
                        <div class="pc-unit-row2">
                            <div class="pc-stats-tiny">
                                <span><strong>${votes.toLocaleString()}</strong> Votes</span>
                                <span class="pc-seats-prominent"><strong>${seats.toLocaleString()}</strong> Seats</span>
                            </div>
                            <div class="pc-bar-tiny">
                                <div class="pc-fill-tiny" style="width:${seatShare}%; background:${p.party_color || '#9ca3af'}"></div>
                            </div>
                        </div>
                    </div>
                </div>`;

            el.addEventListener('click', () => {
                document.querySelectorAll('.party-card').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
                onPartyClick(p.party_code);
            });

            list.appendChild(el);
        });
    },

    clearPartySelection() {
        document.querySelectorAll('.party-card').forEach(x => x.classList.remove('selected'));
    },

    setContext(text, modeLabel = '') {
        this._set('panel-context', text);
        this._set('map-context', modeLabel ? `${modeLabel} — ${text}` : text);
        this._set('ms-title', text); // Connect mini panel title
    },

    updateMiniPanel(summary) {
        const fmt = n => (typeof n === 'number' && !isNaN(n)) ? n.toLocaleString() : '—';
        const fmtPct = n => (typeof n === 'number' && !isNaN(n)) ? n.toFixed(1) + '%' : '—';

        this._set('ms-districts', fmt(summary.totalDistricts));
        this._set('ms-registered', fmt(summary.totalRegistered));
        this._set('ms-turnout', fmtPct(summary.turnoutPct));
        this._set('ms-seats', fmt(summary.totalSeats));
    },

    renderSearchResults(results, onSelect) {
        const box = document.getElementById('search-results');
        box.innerHTML = '';
        if (!results.length) { box.classList.remove('open'); return; }

        results.slice(0, 8).forEach(d => {
            const el = document.createElement('div');
            el.className = 'search-item';
            el.innerHTML = `
                <div class="s-name">${d.district_name}</div>
                <div class="s-meta">${(d.state?.state_name) || ''} · ${d.district_category || ''}</div>`;
            el.onclick = () => {
                onSelect(d);
                box.classList.remove('open');
                document.getElementById('district-search').value = d.district_name;
            };
            box.appendChild(el);
        });
        box.classList.add('open');
    },

    hideLoading() {
        const loader = document.getElementById('loading-overlay');
        if (loader) {
            loader.classList.add('hidden');
        }
    },

    updateDistrictDetailPanel(d) {
        const listContainer = document.getElementById('dd-candidates-list');
        const candidatesBlock = listContainer ? listContainer.closest('.chart-block') : null;

        if (!d) {
            if (candidatesBlock) candidatesBlock.style.display = 'none';
            return;
        }

        // Elected Candidates List
        if (listContainer) {
            const winners = (d.winners || []).sort((a, b) => a.seat_number - b.seat_number);
            if (winners.length > 0) {
                if (candidatesBlock) candidatesBlock.style.display = '';
                let html = `<table class="dd-candidates-table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Candidate Name</th>
                            <th>Party</th>
                        </tr>
                    </thead>
                    <tbody>`;
                winners.forEach(w => {
                    html += `<tr>
                        <td>${w.seat_number || '—'}</td>
                        <td class="cand-name">${w.elected_candidates || '—'}</td>
                        <td>
                            <div class="cand-party">
                                <span class="party-dot" style="background:${w.party_color || '#ccc'}"></span>
                                ${w.party_name || '—'}
                            </div>
                        </td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                listContainer.innerHTML = html;
            } else {
                if (candidatesBlock) candidatesBlock.style.display = 'none';
                listContainer.innerHTML = '<div class="dd-empty-msg">No candidate data available for this selection.</div>';
            }
        }
    },

    updateMajorityTracker(summary, parties) {
        const container = document.getElementById('majority-tracker');
        if (!container) return;

        const totalSeats = summary.totalSeats || 0;
        const majority = Math.floor(totalSeats / 2) + 1;
        
        // Sorting parties by seats won
        const partySeatsArr = Object.keys(parties).map(code => ({
            code,
            name: parties[code]?.party_name || code,
            color: parties[code]?.party_color || '#ccc',
            seats: summary.partySeats?.[code] || 0
        })).sort((a, b) => b.seats - a.seats);

        const winner = partySeatsArr[0];
        const hasMajority = winner && winner.seats >= majority;
        const seatsToMajority = majority - (winner ? winner.seats : 0);

        let segmentsHtml = '';
        partySeatsArr.forEach(p => {
            if (p.seats <= 0) return;
            const width = (p.seats / totalSeats) * 100;
            segmentsHtml += `<div class="majority-segment" style="width:${width}%; background:${p.color}" title="${p.name}: ${p.seats} seats"></div>`;
        });

        const statusLabel = hasMajority 
            ? `<span style="color:var(--c-accent)">${winner.name} has secured majority control</span>` 
            : `<span>Coalition Needed: <strong>${seatsToMajority} more seats</strong> to reach <strong>${majority}</strong></span>`;

        container.innerHTML = `
            <div class="majority-info">
                <span>Seat Majority Tracker</span>
                <span>Target: ${majority}</span>
            </div>
            <div class="majority-bar">
                <div class="majority-marker" style="left: 50%;" title="Majority Line (${majority})"></div>
                ${segmentsHtml}
            </div>
            <div class="majority-status">
                <i style="background:${hasMajority ? 'var(--c-accent)' : 'var(--c-warn)'}"></i>
                ${statusLabel}
            </div>
        `;
    }
};
