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

        document.addEventListener('click', e => {
            if (!e.target.closest('.search-wrap')) {
                document.getElementById('search-results').classList.remove('open');
            }
        });

        // Panel Compress/Expand Toggles
        const sb = document.getElementById('party-sidebar');
        const cb = document.getElementById('charts-sidebar');
        const grid = document.querySelector('.body-grid');

        const updateGrid = () => {
            const sW = sb.classList.contains('collapsed') ? '44px' : 'var(--sidebar-w)';
            const cW = cb.classList.contains('collapsed') ? '44px' : 'var(--charts-w)';
            grid.style.gridTemplateColumns = `${sW} 1fr ${cW}`;
        };

        document.getElementById('toggle-sidebar').addEventListener('click', () => {
            sb.classList.toggle('collapsed');
            updateGrid();
        });

        document.getElementById('toggle-charts').addEventListener('click', () => {
            cb.classList.toggle('collapsed');
            updateGrid();
        });

        // 📱 MOBILE INTERACTION HANDLERS
        const nv = document.getElementById('navbar-content');
        const mMenu = document.getElementById('mobile-menu-toggle');
        const mParties = document.getElementById('mobile-toggle-parties');
        const mCharts = document.getElementById('mobile-toggle-charts');

        mMenu.addEventListener('click', e => {
            e.stopPropagation();
            nv.classList.toggle('open');
            sb.classList.remove('open');
            cb.classList.remove('open');
        });

        mParties.addEventListener('click', e => {
            e.stopPropagation();
            sb.classList.toggle('open');
            cb.classList.remove('open');
            nv.classList.remove('open');
        });

        mCharts.addEventListener('click', e => {
            e.stopPropagation();
            cb.classList.toggle('open');
            sb.classList.remove('open');
            nv.classList.remove('open');
        });

        // Close all on background click
        document.addEventListener('click', e => {
            if (!e.target.closest('.navbar') &&
                !e.target.closest('.sidebar') &&
                !e.target.closest('.charts-panel') &&
                !e.target.closest('.mobile-fab-container')) {
                nv.classList.remove('open');
                sb.classList.remove('open');
                cb.classList.remove('open');
            }
        });

        this.initTheme();
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
                <div class="kpi-main-val">0</div>
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
                <div class="kpi-main-val">0</div>
                <div class="kpi-sub">${vpsText}</div>
            `;
            this._animateNumber(statParties.querySelector('.kpi-main-val'), data.contestedPartiesCount);
        }

        // KPI 3: Registered Voters
        const statReg = document.getElementById('stat-registered');
        if (statReg) {
            statReg.innerHTML = `
                <div class="kpi-main-val">0</div>
                <div class="kpi-sub">—</div>
            `;
            this._animateNumber(statReg.querySelector('.kpi-main-val'), data.totalRegistered);
        }

        // KPI 4: ID Cards Collected
        const statId = document.getElementById('stat-id-cards');
        if (statId) {
            statId.innerHTML = `
                <div class="kpi-main-val">0</div>
                <div class="kpi-sub">${fmtPct(data.idCollectedPct)}</div>
            `;
            this._animateNumber(statId.querySelector('.kpi-main-val'), data.totalIdCards);
        }

        // KPI 5: Voter Turnout
        const statTurnout = document.getElementById('stat-turnout');
        if (statTurnout) {
            statTurnout.innerHTML = `
                <div class="kpi-main-val">0</div>
                <div class="kpi-sub">${fmtPct(data.turnoutPct)}</div>
            `;
            this._animateNumber(statTurnout.querySelector('.kpi-main-val'), data.turnoutVotes);
        }

        // KPI 6: Valid Votes
        const statValid = document.getElementById('stat-votes-valid');
        if (statValid) {
            statValid.innerHTML = `
                <div class="kpi-main-val">0</div>
                <div class="kpi-sub">${fmtPct(data.validPct)}</div>
            `;
            this._animateNumber(statValid.querySelector('.kpi-main-val'), data.totalVotes);
        }

        // KPI 7: Invalid Votes
        const statInvalid = document.getElementById('stat-votes-invalid');
        if (statInvalid) {
            statInvalid.innerHTML = `
                <div class="kpi-main-val">0</div>
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
            el.className = 'party-item';
            el.dataset.code = p.party_code;

            const logoSrc = p.party_logo_url || '';
            let extraHtml = '';
            if (isDistrictLevel) {
                const isContested = String(p.is_contested).trim().toUpperCase() === 'TRUE';
                if (!isContested) {
                    extraHtml = `
                    <div class="party-cand-info">
                        <span class="badge-uncontested">Not Contested</span>
                    </div>`;
                }
            }

            el.innerHTML = `
                <div class="party-swatch" style="background:${p.party_color || '#9ca3af'}"></div>
                <img class="party-logo" src="${logoSrc}" alt="${p.party_name}"
                     onerror="this.style.background='#e5e7eb'; this.src=''">
                <div class="party-text">
                    <div class="party-name">${p.party_name}</div>
                    <div class="party-stat">${(p.seats_won || 0).toLocaleString()} seats won &middot; ${(p.votes_received || 0).toLocaleString()} votes</div>
                    <div class="party-gender-seats">M: ${p.male_seats_won || 0} &middot; F: ${p.female_seats_won || 0}</div>
                    ${extraHtml}
                </div>`;

            el.addEventListener('click', () => {
                document.querySelectorAll('.party-item').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
                onPartyClick(p.party_code);
            });

            list.appendChild(el);
        });
    },

    clearPartySelection() {
        document.querySelectorAll('.party-item').forEach(x => x.classList.remove('selected'));
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
    }
};
