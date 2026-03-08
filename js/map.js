/**
 * Map Module — Leaflet + multiple tile layers + measure + center markers
 */

export const MapModule = {
    map: null,
    geoJSONLayer: null,
    centersLayer: null,
    legendControl: null,
    currentMode: 'default',
    onDistrictClick: null,
    _activePartyCode: null,
    selectedDistrictCode: null,
    _comparePanel: null,
    _comparePanel: null,
    _miniMap: null,
    _hideTimer: null,
    _panelLocked: false,
    _pinnedDistricts: [],

    // ── Tile Layers ──────────────────────────────────────────
    TILES: {
        'Street Map': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors', maxZoom: 19, crossOrigin: true
        }),
        'Carto Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '© CartoDB', maxZoom: 19, crossOrigin: true
        }),
        'Carto Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '© CartoDB', maxZoom: 19, crossOrigin: true
        }),
        'ESRI Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri', maxZoom: 19, crossOrigin: true
        }),
        'Topo Map': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenTopoMap', maxZoom: 17, crossOrigin: true
        }),
        'No Base': L.tileLayer('', { attribution: '' })
    },

    // ── Init ─────────────────────────────────────────────────
    init(containerId, geoJSON, onDistrictClick) {
        this.onDistrictClick = onDistrictClick;

        this.map = L.map(containerId, {
            zoomControl: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            dragging: true,
            preferCanvas: true
        });

        this.labelsLayer = L.layerGroup().addTo(this.map);
        this.partyLabelsLayer = L.layerGroup().addTo(this.map);

        // Re-render labels on every zoom/pan so pixel sizes stay accurate
        this.map.on('zoomend moveend', () => this.updateLabels());

        // Create the shared hover info panel
        this._hoverPanel = document.createElement('div');
        this._hoverPanel.className = 'map-hover-panel';
        this._hoverPanel.style.display = 'none';
        document.getElementById(containerId).appendChild(this._hoverPanel);

        // Interaction fix: Don't hide if mouse is in the panel
        this._hoverPanel.onmouseenter = () => { 
            if (this._hideTimer) clearTimeout(this._hideTimer);
            this._panelLocked = true; 
        };
        this._hoverPanel.onmouseleave = () => { 
            this._panelLocked = false; 
            this._hideHoverPanel(); 
        };

        // Create the Pinned Comparison Panel
        this._comparePanel = document.createElement('div');
        this._comparePanel.className = 'comparison-panel';
        document.getElementById(containerId).appendChild(this._comparePanel);

        // Theme Sync
        window.addEventListener('themeChanged', e => {
            const theme = e.detail;
            if (theme === 'dark') {
                this.TILES['Carto Dark'].addTo(this.map);
                this.map.removeLayer(this.TILES['Carto Light']);
            } else {
                this.TILES['Carto Light'].addTo(this.map);
                this.map.removeLayer(this.TILES['Carto Dark']);
            }
        });

        // Default base tile (Check theme first)
        const activeTheme = document.documentElement.getAttribute('data-theme') || 'light';
        this.TILES[activeTheme === 'dark' ? 'Carto Dark' : 'Carto Light'].addTo(this.map);

        // Layer Control
        this._layerControl = L.control.layers(this.TILES, {}, { position: 'topright', collapsed: true }).addTo(this.map);

        // Scale bar
        L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(this.map);

        // Measure tool
        if (window.L && L.control.measure) {
            L.control.measure({
                position: 'topright',
                primaryLengthUnit: 'kilometers',
                secondaryLengthUnit: 'meters',
                primaryAreaUnit: 'sqkilometers',
                activeColor: '#2563eb',
                completedColor: '#059669'
            }).addTo(this.map);
        }

        // Draw districts
        this.renderDistricts(geoJSON);
        this.buildCentersLayer(geoJSON);
        this.addMiniMap(geoJSON);

        // Add Toggle Controls to Map
        this.addToggleControl();
        this.addModeControl();

        if (this.geoJSONLayer && this.geoJSONLayer.getBounds().isValid()) {
            this.map.fitBounds(this.geoJSONLayer.getBounds(), { padding: [20, 20] });
        }

        // Labels need the map to have a center+zoom, so call after fitBounds
        this.updateLabels();

        return this.map;
    },

    addModeControl() {
        const ModeControl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-control leaflet-control-custom-mode');
                container.innerHTML = `
                    <select id="choropleth-mode" class="map-mode-select modern-select">
                        <option value="default" selected>Default View</option>
                        <option value="registered">Registered Voters</option>
                        <option value="id_collected">ID Cards Collected</option>
                        <option value="turnout">Voter Turnout</option>
                        <option value="votes">Valid Votes</option>
                        <option value="invalid">Invalid Votes</option>
                        <option value="winner">Winning Party</option>
                    </select>
                `;
                
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                const sel = container.querySelector('select');
                sel.onchange = (e) => {
                    const mode = e.target.value;
                    this.setMode(mode);
                    const event = new CustomEvent('modeChanged', { detail: mode });
                    window.dispatchEvent(event);
                };
                
                return container;
            }
        });
        new ModeControl().addTo(this.map);
    },

    addToggleControl() {
        const ToggleControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-toggle');
                container.innerHTML = `
                    <button id="map-toggle-centers" title="Toggle Centers">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                    </button>
                `;
                container.onclick = (e) => {
                    L.DomEvent.stopPropagation(e);
                    const isOn = this.centersLayer && this.map.hasLayer(this.centersLayer);
                    this.toggleCentersLayer(!isOn);
                    const btn = document.getElementById('map-toggle-centers');
                    if (isOn) {
                        btn.classList.remove('active');
                    } else {
                        btn.classList.add('active');
                    }
                };
                return container;
            }
        });
        new ToggleControl().addTo(this.map);
    },

    renderDistricts(geoJSON) {
        if (this.geoJSONLayer) this.geoJSONLayer.remove();

        this.geoJSONLayer = L.geoJSON(geoJSON, {
            style: f => this.styleFeature(f),
            onEachFeature: (f, layer) => this.bindFeatureEvents(f, layer)
        }).addTo(this.map);

        this.computeDynamicRanges();

        // Note: updateLabels is NOT called here because during init the map
        // has no center/zoom yet. It is called after fitBounds in init(),
        // and on every zoomend/moveend afterwards.
        this.updateLegend();
    },

    computeDynamicRanges() {
        if (!this.geoJSONLayer) return;
        this.modeRanges = { turnout: [], registered: [], votes: [], invalid: [], id_collected: [] };
        let maxVals = { turnout: 0, registered: 0, votes: 0, invalid: 0, id_collected: 0 };

        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (!d) return;
            if ((d.turnout_perc || 0) > maxVals.turnout) maxVals.turnout = d.turnout_perc;
            if ((d.registered_people || 0) > maxVals.registered) maxVals.registered = d.registered_people;
            if ((d.id_collected_perc || 0) > maxVals.id_collected) maxVals.id_collected = d.id_collected_perc;
            if ((d.valid_votes || 0) > maxVals.votes) maxVals.votes = d.valid_votes;
            if ((d.invalid_perc || 0) > maxVals.invalid) maxVals.invalid = d.invalid_perc;
        });

        // 5 ranges: [0%, 20%, 40%, 60%, 80%] of max
        const getStops = (max) => {
            if (max === 0) return [0, 1, 2, 3, 4];
            return [0, max * 0.2, max * 0.4, max * 0.6, max * 0.8].map(v => Math.floor(v));
        };

        this.modeRanges.turnout = getStops(maxVals.turnout);
        this.modeRanges.registered = getStops(maxVals.registered);
        this.modeRanges.id_collected = getStops(maxVals.id_collected);
        this.modeRanges.votes = getStops(maxVals.votes);
        this.modeRanges.invalid = getStops(maxVals.invalid);
    },

    addMiniMap(geoJSON) {
        if (this._miniMap) return;
        const self = this;
        const MiniMapControl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-control-minimap');
                container.style.width = '120px';
                container.style.height = '120px';
                
                setTimeout(() => {
                    const mm = L.map(container, {
                        attributionControl: false, zoomControl: false, dragging: false,
                        touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false
                    });
                    self._miniMap = mm;
                    
                    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png').addTo(mm);
                    L.geoJSON(geoJSON, {
                        style: { color: '#94a3b8', weight: 0.5, fillOpacity: 0.1, fillColor: '#cbd5e1' }
                    }).addTo(mm);

                    const bounds = L.geoJSON(geoJSON).getBounds();
                    mm.fitBounds(bounds);

                    const viewRect = L.rectangle(self.map.getBounds(), { color: "#ef4444", weight: 1.5, fillOpacity: 0, interactive: false }).addTo(mm);
                    self.map.on('move', () => viewRect.setBounds(self.map.getBounds()));
                }, 200);
                return container;
            }
        });
        new MiniMapControl().addTo(this.map);
    },



    // ── Hover Panel ────────────────────────────────────────────
    _showHoverPanel(d, mouseEvent) {
        if (!this._hoverPanel) return;

        let rankHtml = '';
        if (d.ranks && this.currentMode && d.ranks[this.currentMode] && this.currentMode !== 'default') {
            const modeLabels = {
                'registered': 'Registered Voters',
                'id_collected': 'ID Cards Collected',
                'turnout': 'Voter Turnout',
                'votes': 'Valid Votes',
                'invalid': 'Invalid Votes'
            };
            const label = modeLabels[this.currentMode] || this.currentMode;
            rankHtml = `
                <div class="hp-divider"></div>
                <div class="hp-rank-row">
                    <span class="hp-rank-label">${label} Rank</span>
                    <strong class="hp-rank-value">#${d.ranks[this.currentMode]} <small>National</small></strong>
                </div>`;
        }

        const winnerHtml = d.winner ? `
            <div class="hp-divider"></div>
            <div class="hp-winner-row">
                <div class="hp-winner-label">Winning Party</div>
                <div class="hp-winner-content">
                    <div class="hp-party-swatch" style="background:${d.winner.party_color || '#6b7280'}"></div>
                    <span class="hp-party-name">${d.winner.party_name}</span>
                    <span class="hp-party-seats">${d.winner.seats_won} seats</span>
                </div>
            </div>` : '';

        const formatNum = (num) => (num || 0).toLocaleString();
        const idc = d.id_cards_collected || 0;
        const reg = d.registered_people || 1;
        const idcP = ((idc / reg) * 100).toFixed(1);

        const turnout = (d.valid_votes || 0) + (d.invalid_votes || 0);
        const tnP = (d.turnout_perc || 0).toFixed(1);

        const vv = d.valid_votes || 0;
        const iv = d.invalid_votes || 0;
        const tv = vv + iv;
        const vvP = tv > 0 ? ((vv / tv) * 100).toFixed(1) : '0';
        const ivP = tv > 0 ? ((iv / tv) * 100).toFixed(1) : '0';

        this._hoverPanel.innerHTML = `
            <div class="hp-header">
                <div class="hp-row-top">
                    <span class="hp-name">${d.district_name || '—'}</span>
                    <span class="hp-state-info">${(d.state?.state_name) || ''}</span>
                    <span class="hp-seats-badge">Seats: ${d.total_seats || 0}</span>
                    <span class="hp-cat-badge">Cat: ${d.district_category || '—'}</span>
                </div>
            </div>
            <div class="hp-body">
                <div class="hp-row-full">
                    <span class="hp-label">Registered People</span>
                    <strong>${formatNum(reg)}</strong>
                </div>
                
                <div class="hp-divider"></div>

                <div class="hp-grid">
                    <div class="hp-col">
                        <div class="hp-label">ID Collected</div>
                        <strong>${formatNum(idc)}</strong>
                    </div>
                    <div class="hp-col">
                        <div class="hp-label">Voter Turnout</div>
                        <strong>${formatNum(turnout)}</strong>
                    </div>
                </div>
                <div class="hp-grid mt-1">
                    <div class="hp-col">
                        <div class="hp-label">% Collected</div>
                        <strong>${idcP}%</strong>
                    </div>
                    <div class="hp-col">
                        <div class="hp-label">% Turnout</div>
                        <strong>${tnP}%</strong>
                    </div>
                </div>

                <div class="hp-divider"></div>

                <div class="hp-grid">
                    <div class="hp-col">
                        <div class="hp-label">Valid Votes</div>
                        <strong>${formatNum(vv)}</strong>
                    </div>
                    <div class="hp-col">
                        <div class="hp-label">Invalid Votes</div>
                        <strong>${formatNum(iv)}</strong>
                    </div>
                </div>
                <div class="hp-grid mt-1">
                    <div class="hp-col">
                        <div class="hp-label">% Valid</div>
                        <strong>${vvP}%</strong>
                    </div>
                    <div class="hp-col">
                        <div class="hp-label">% Invalid</div>
                        <strong>${ivP}%</strong>
                    </div>
                </div>
                
                ${rankHtml}
                ${winnerHtml}
                <button class="hp-compare-btn" id="hp-compare-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
                    Compare District
                </button>
            </div>`;

        const btn = this._hoverPanel.querySelector('#hp-compare-btn');
        if (btn) {
            L.DomEvent.on(btn, 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                this._pinDistrict(d);
            });
        }

        this._hoverPanel.style.display = 'block';
        this._moveHoverPanel(mouseEvent);
    },

    _pinDistrict(d) {
        if (!this._comparePanel) return;
        const code = d.dist_code || d.district_code;
        if (this._pinnedDistricts.some(p => (p.dist_code || p.district_code) === code)) return;
        
        this._pinnedDistricts.push(d);
        this._renderPinnedDistricts();
    },

    _renderPinnedDistricts() {
        if (!this._comparePanel) return;
        if (this._pinnedDistricts.length === 0) {
            this._comparePanel.style.display = 'none';
            return;
        }

        this._comparePanel.style.display = 'flex';
        this._comparePanel.innerHTML = `
            <div class="cp-card-header">
                <span class="cp-card-title">District Comparison Arena</span>
                <span class="cp-card-close" id="cp-global-close">×</span>
            </div>
            <div class="cp-body">
                <table class="cp-table">
                    <thead id="cp-thead"></thead>
                    <tbody id="cp-tbody"></tbody>
                </table>
            </div>
        `;

        this._comparePanel.querySelector('#cp-global-close').onclick = () => {
            this._pinnedDistricts = [];
            this._renderPinnedDistricts();
        };

        const thead = this._comparePanel.querySelector('#cp-thead');
        const tbody = this._comparePanel.querySelector('#cp-tbody');

        // Build Header Row
        let headHtml = `<tr><th class="cp-label-col">DATA FIELDS</th>`;
        this._pinnedDistricts.forEach((d, idx) => {
            headHtml += `
                <th>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span>${d.district_name}</span>
                        <span class="cp-dist-remove" data-idx="${idx}" style="cursor:pointer; color:var(--c-danger); font-size:16px;">×</span>
                    </div>
                </th>`;
        });
        headHtml += `</tr>`;
        thead.innerHTML = headHtml;

        // Build Data Rows
        const metrics = [
            { label: 'Category', key: 'district_category', format: v => v || '—' },
            { label: 'Reg. People', key: 'registered_people', format: v => (v || 0).toLocaleString() },
            { label: 'Total Votes', calc: d => (d.valid_votes || 0) + (d.invalid_votes || 0), format: v => v.toLocaleString() },
            { label: 'ID Coll. %', calc: d => (d.id_cards_collected / (d.registered_people || 1) * 100), format: v => v.toFixed(1) + '%' },
            { label: 'Turnout %', key: 'turnout_perc', format: v => (v || 0).toFixed(1) + '%' },
            { label: 'Valid %', calc: d => (d.valid_votes / ((d.valid_votes + d.invalid_votes) || 1) * 100), format: v => v.toFixed(1) + '%' },
            { label: 'Invalid %', calc: d => (d.invalid_votes / ((d.valid_votes + d.invalid_votes) || 1) * 100), format: v => v.toFixed(1) + '%' }
        ];

        metrics.forEach(m => {
            let rowHtml = `<tr><td class="cp-label-col">${m.label}</td>`;
            this._pinnedDistricts.forEach(d => {
                const val = m.calc ? m.calc(d) : d[m.key];
                rowHtml += `<td class="cp-val-col">${m.format(val)}</td>`;
            });
            rowHtml += `</tr>`;
            tbody.innerHTML += rowHtml;
        });

        // Winner Row
        let winnerHtml = `<tr><td class="cp-label-col" style="vertical-align:top; padding-top:12px;">Winner</td>`;
        this._pinnedDistricts.forEach(d => {
            const w = d.winner;
            winnerHtml += `<td class="cp-val-col cp-winner-cell" style="vertical-align:top;">
                ${w ? `
                    <div style="display:flex; flex-direction:column; gap:4px; text-align:left;">
                        <div style="display:flex; align-items:flex-start; gap:6px;">
                            <div style="width:8px; height:8px; border-radius:50%; background:${w.party_color || '#6b7280'}; flex-shrink:0; margin-top:3px;"></div>
                            <span style="font-weight:800; color:var(--c-text); font-size:10px; white-space:normal; line-height:1.2; max-width:140px;">${w.party_name || '—'}</span>
                        </div>
                        <div style="font-weight:700; color:var(--c-warn); font-size:9.5px; margin-left:14px; opacity:0.9;">${w.seats_won || 0} SEATS WON</div>
                    </div>
                ` : '—'}
            </td>`;
        });
        winnerHtml += `</tr>`;
        tbody.innerHTML += winnerHtml;

        // Attach individual remove handlers
        this._comparePanel.querySelectorAll('.cp-dist-remove').forEach(el => {
            el.onclick = (e) => {
                const idx = parseInt(el.getAttribute('data-idx'));
                this._pinnedDistricts.splice(idx, 1);
                this._renderPinnedDistricts();
            };
        });
    },

    _moveHoverPanel(e) {
        if (!this._hoverPanel || this._hoverPanel.style.display === 'none' || this._panelLocked) return;
        const mapEl = this._hoverPanel.parentElement;
        const rect = mapEl.getBoundingClientRect();

        // Cursor position relative to the map container
        const px = e.originalEvent.clientX - rect.left;
        const py = e.originalEvent.clientY - rect.top;

        // Panel dimensions
        const pw = this._hoverPanel.offsetWidth || 300;
        const ph = this._hoverPanel.offsetHeight || 300;
        const gap = 0; // ZERO gap to ensure seamless transition to the panel

        // X Positioning (Left vs Right)
        let left = px + gap;
        if (left + pw > rect.width) {
            // No room on the right, try left
            left = px - pw - gap;
        }
        // Final safety clamp for X
        left = Math.max(4, Math.min(left, rect.width - pw - 4));

        // Y Positioning (Top vs Bottom)
        let top = py + gap;
        if (top + ph > rect.height) {
            // No room below, try above
            top = py - ph - gap;
        }
        // Final safety clamp for Y
        top = Math.max(4, Math.min(top, rect.height - ph - 4));

        this._hoverPanel.style.left = left + 'px';
        this._hoverPanel.style.top = top + 'px';
    },

    _hideHoverPanel() {
        if (this._panelLocked) return;
        if (this._hideTimer) clearTimeout(this._hideTimer);
        
        // Give user 300ms to move mouse from polygon to the panel
        this._hideTimer = setTimeout(() => {
            if (!this._panelLocked && this._hoverPanel) {
                this._hoverPanel.style.display = 'none';
            }
        }, 300);
    },

    // ── Polygon Labels (divIcon sized to polygon pixels — zero overflow possible)
    updateLabels() {
        // Guard: Leaflet sets _loaded=true only after the map has a center+zoom.
        // latLngToContainerPoint will throw if called before that.
        if (!this.map || !this.map._loaded) return;
        this.labelsLayer.clearLayers();
        if (!this.geoJSONLayer) return;

        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (!d || !layer.getBounds) return;

            // Measure how many pixels this polygon occupies on screen right now
            const bounds = layer.getBounds();
            const sw = this.map.latLngToContainerPoint(bounds.getSouthWest());
            const ne = this.map.latLngToContainerPoint(bounds.getNorthEast());
            const w = Math.abs(ne.x - sw.x);
            const h = Math.abs(ne.y - sw.y);

            // Drop threshold so even tiny districts (Boondheere) get a label
            if (w < 4 || h < 4) return;

            // Party data for the active highlighted party (if any)
            const pr = this._activePartyCode
                ? d.party_results?.find(r => r.party_code === this._activePartyCode)
                : null;

            // Scale font to available width smoothly, allowing very small text for tiny districts
            const fs = w >= 110 ? 12 : w >= 70 ? 11 : w >= 45 ? 9.5 : w >= 30 ? 8.5 : w >= 15 ? 7 : 5;
            const fsS = Math.max(fs - 1.5, 5);   // slightly smaller for seats/votes line

            // Name: truncate or abbreviate when polygon is narrow
            const name = d.district_name || '';
            const dispName = w < 25 ? name.substring(0, 2) + '.' : w < 40 ? name.split(' ')[0].substring(0, 4) + '.' : w < 60 ? name.split(' ')[0] : name;

            // Build inner HTML — lines are added only if there’s vertical room
            let inner = `<div class="pl-name" style="font-size:${fs}px">${dispName}</div>`;

            // Always show the current active metric beneath the name
            if (h >= 12 && this.currentMode !== 'winner') {
                let statText = '';
                const formatNum = (num) => Math.round(num).toLocaleString();

                if (this.currentMode !== 'default') {
                    switch (this.currentMode) {
                        case 'registered':
                            statText = `${formatNum(d.registered_people || 0)} reg.`;
                            break;
                        case 'id_collected': {
                            const idc = d.id_cards_collected || 0;
                            const icp = d.id_collected_perc || 0;
                            statText = `${formatNum(idc)} (${icp.toFixed(1)}%)`;
                            break;
                        }
                        case 'turnout':
                            const tVal = (d.valid_votes || 0) + (d.invalid_votes || 0);
                            statText = `${formatNum(tVal)} (${(d.turnout_perc || 0).toFixed(1)}%)`;
                            break;
                        case 'votes': {
                            const vv = d.valid_votes || 0;
                            const tv = vv + (d.invalid_votes || 0);
                            statText = `${formatNum(vv)} (${tv > 0 ? (vv / tv * 100).toFixed(1) : '0'}%)`;
                            break;
                        }
                        case 'invalid': {
                            const iv = d.invalid_votes || 0;
                            const ivp = d.invalid_perc || 0;
                            statText = `${formatNum(iv)} (${ivp.toFixed(1)}%)`;
                            break;
                        }
                    }
                    inner += `<div class="pl-seats" style="font-size:${fsS}px">${statText}</div>`;
                }
            }

            // Party highlight text still adds extra data below IF highlighted + space available
            if (pr && h >= 22) {
                const seats = pr.seats_won || 0;
                const total = d.total_seats || 1;
                const pct = total > 0 ? Math.round((seats / total) * 100) : 0;
                inner += `<div class="pl-seats" style="font-size:${fsS}px" style="color:#111827">${seats} seat${seats !== 1 ? 's' : ''} (${pct}%)</div>`;
                if (h >= 32) {
                    const votes = (pr.votes_received || 0).toLocaleString();
                    inner += `<div class="pl-votes" style="font-size:${Math.max(fsS - 1, 5)}px">${votes} votes</div>`;
                }
            }

            const center = bounds.getCenter();
            const marker = L.marker(center, {
                icon: L.divIcon({
                    className: 'poly-label',
                    html: `<div class="pl-inner">${inner}</div>`,
                    // icon sized to the polygon’s pixel footprint — text cannot overflow
                    iconSize: [w, h],
                    iconAnchor: [w / 2, h / 2]
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: -1000
            });
            this.labelsLayer.addLayer(marker);
        });
    },

    styleFeature(feature) {
        const d = feature.properties.data || {};
        const color = this.getColor(d);
        const isSelected = this.selectedDistrictCode && (d.district_code === this.selectedDistrictCode || d.dist_code === this.selectedDistrictCode);
        const activeTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const borderColor = isSelected ? '#fbbf24' : (activeTheme === 'dark' ? '#CBD5F5' : '#6B7280');
        
        return {
            fillColor: color,
            fillOpacity: this.currentMode === 'default' ? 0.2 : 0.72,
            color: borderColor,
            weight: isSelected ? 3 : 1,
            dashArray: null
        };
    },

    getColor(d) {
        if (this.currentMode === 'default') {
            const cat = String(d.district_category || '').toUpperCase();
            if (cat === 'A') return '#1d4ed8'; // Blue-700
            if (cat === 'B') return '#10b981'; // Emerald-500
            if (cat === 'C') return '#f59e0b'; // Amber-500
            return '#64748b'; // Slate-500
        }
        if (!this.modeRanges) return '#cbd5e1';
        switch (this.currentMode) {
            case 'turnout':
                return this.scale(d.turnout_perc, this.modeRanges.turnout || [0, 30, 50, 65, 80], ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a']);
            case 'registered':
                return this.scale(d.registered_people, this.modeRanges.registered || [0, 20000, 50000, 100000, 250000], ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534']);
            case 'id_collected':
                return this.scale(d.id_collected_perc, this.modeRanges.id_collected || [0, 20, 40, 60, 80], ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a']);
            case 'votes':
                return this.scale(d.valid_votes, this.modeRanges.votes || [0, 5000, 25000, 75000, 200000], ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534']);
            case 'invalid':
                return this.scale(d.invalid_perc, this.modeRanges.invalid || [0, 2, 5, 10, 20], ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444']);
            case 'winner':
                return d.winner ? (d.winner.party_color || '#9ca3af') : '#e5e7eb';
            default:
                return '#cbd5e1';
        }
    },

    scale(val, stops, colors) {
        if (val == null || isNaN(val)) return colors[0];
        for (let i = stops.length - 1; i >= 0; i--) {
            if (val >= stops[i]) return colors[i];
        }
        return colors[0];
    },

    bindFeatureEvents(feature, layer) {
        const d = feature.properties.data;
        layer.on({
            mouseover: e => {
                e.target.setStyle({ weight: 3, color: '#fbbf24', fillOpacity: 0.6 });
                if (d) this._showHoverPanel(d, e);
            },
            mousemove: e => {
                this._moveHoverPanel(e);
            },
            mouseout: e => {
                this.geoJSONLayer.resetStyle(e.target);
                this._hideHoverPanel();
            },
            click: e => {
                this.map.fitBounds(e.target.getBounds(), { padding: [20, 20], maxZoom: 16 });
                if (this.onDistrictClick && d) this.onDistrictClick(d);
            }
        });
    },

    // ── Centers Layer ─────────────────────────────────────────
    buildCentersLayer(geoJSON) {
        const markers = window.L.markerClusterGroup ? L.markerClusterGroup({
            maxClusterRadius: 40,
            showCoverageOnHover: false
        }) : L.layerGroup();

        geoJSON.features.forEach(feature => {
            const d = feature.properties.data;
            if (!d || !d.centers) return;

            d.centers.forEach(c => {
                const lat = parseFloat(c.latitude);
                const lng = parseFloat(c.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                const isReg = c.is_registration_center === 'TRUE' || c.is_registration_center === true;
                const isPoll = c.is_polling_center === 'TRUE' || c.is_polling_center === true;
                const color = isReg && isPoll ? '#2563eb' : isReg ? '#059669' : '#d97706';
                const type = isReg && isPoll ? 'Registration & Polling' : isReg ? 'Registration' : 'Polling';

                const marker = L.circleMarker([lat, lng], {
                    radius: 5,
                    fillColor: color,
                    fillOpacity: 0.9,
                    color: '#fff',
                    weight: 1.5
                });

                marker.bindPopup(`
                    <div class="center-popup">
                        <div class="cp-name">${c.center_name || 'Center'}</div>
                        <div class="cp-row"><span>Type</span><strong>${type}</strong></div>
                        <div class="cp-row"><span>Stations</span><strong>${c.polling_stations_count || 0}</strong></div>
                        <div class="cp-row"><span>District</span><strong>${d.district_name}</strong></div>
                    </div>`, { maxWidth: 200 });

                markers.addLayer(marker);
            });
        });

        this.centersLayer = markers;
    },

    toggleCentersLayer(show) {
        if (show) this.centersLayer.addTo(this.map);
        else this.centersLayer.remove();
    },

    showDistrictCenters(districtCode) {
        if (!this.map) return;
        if (this.activeCentersLayer) {
            this.activeCentersLayer.remove();
            this.activeCentersLayer = null;
        }
        if (!districtCode) return;

        const markers = [];
        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (d && (d.dist_code === districtCode || d.district_code === districtCode) && d.centers) {
                d.centers.forEach(c => {
                    const lat = parseFloat(c.latitude);
                    const lng = parseFloat(c.longitude);
                    if (isNaN(lat) || isNaN(lng)) return;

                    const isReg = c.is_registration_center === 'TRUE' || c.is_registration_center === true;
                    const isPoll = c.is_polling_center === 'TRUE' || c.is_polling_center === true;
                    const color = isReg && isPoll ? '#2563eb' : isReg ? '#059669' : '#d97706';
                    const type = isReg && isPoll ? 'Registration & Polling' : isReg ? 'Registration' : 'Polling';

                    const marker = L.circleMarker([lat, lng], {
                        radius: 6, fillColor: color, fillOpacity: 0.9, color: '#fff', weight: 1.5
                    });
                    marker.bindPopup(`<div class="center-popup">
                        <div class="cp-name">${c.center_name || 'Center'}</div>
                        <div class="cp-row"><span>Type</span><strong>${type}</strong></div>
                        <div class="cp-row"><span>Stations</span><strong>${c.polling_stations_count || 0}</strong></div>
                    </div>`, { maxWidth: 200 });
                    markers.push(marker);
                });
            }
        });

        if (markers.length > 0) {
            this.activeCentersLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
            markers.forEach(m => this.activeCentersLayer.addLayer(m));
            this.activeCentersLayer.addTo(this.map);
        }
    },

    showDistrictFocus(districtCode) {
        this.selectedDistrictCode = districtCode;
        if (!this.geoJSONLayer) return;

        let targetLayer = null;
        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (d && (d.dist_code === districtCode || d.district_code === districtCode)) {
                targetLayer = layer;
            }
        });

        // Reset styles for all, then target will get its yellow border via styleFeature
        this.geoJSONLayer.setStyle(f => this.styleFeature(f));

        if (targetLayer) {
            this.map.fitBounds(targetLayer.getBounds(), { padding: [20, 20], maxZoom: 16 });
        }
    },

    // ── Mode / Filter ─────────────────────────────────────────
    setMode(mode) {
        this.currentMode = mode;
        if (this.geoJSONLayer) {
            this.geoJSONLayer.setStyle(f => this.styleFeature(f));
            this.updateLegend();
            this.updateLabels();
        }
        
        // Sync Dropdown UI visuals
        const sel = document.getElementById('choropleth-mode');
        if (sel) sel.value = mode;
    },

    filterByState(stateCode, geoJSON) {
        this.selectedDistrictCode = null; // Clear focus on state change
        const filtered = stateCode === 'all' ? geoJSON : {
            ...geoJSON,
            features: geoJSON.features.filter(f => f.properties.data?.state_code === stateCode)
        };
        this.renderDistricts(filtered);
        if (this.geoJSONLayer.getBounds().isValid()) {
            this.map.fitBounds(this.geoJSONLayer.getBounds(), { padding: [10, 10] });
        }
    },

    highlightParty(partyCode) {
        if (!this.geoJSONLayer) return;
        this._activePartyCode = partyCode;

        // No longer changing colors here, staying in default view
        // Refresh labels so party seats/votes appear inside polygons
        this.updateLabels();
    },

    resetStyles() {
        this._activePartyCode = null;
        if (this.geoJSONLayer) {
            this.geoJSONLayer.setStyle(f => this.styleFeature(f));
        }
        if (this.partyLabelsLayer) {
            this.partyLabelsLayer.clearLayers();
        }
        // Redraw labels without party data
        this.updateLabels();
    },

    // ── Legend ───────────────────────────────────────────────
    updateLegend() {
        if (this.legendControl) this.legendControl.remove();

        if (this.currentMode === 'default') return;

        const self = this;
        this.legendControl = L.control({ position: 'bottomright' });
        this.legendControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');
            const configs = {
                turnout: { label: 'Voter Turnout', stops: self.modeRanges?.turnout || [0, 20, 40, 60, 80], colors: ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a'], suffix: '%' },
                registered: { label: 'Registered Voters', stops: self.modeRanges?.registered || [0, 20, 40, 60, 80], colors: ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534'], suffix: '' },
                id_collected: { label: 'ID Cards Collected', stops: self.modeRanges?.id_collected || [0, 20, 40, 60, 80], colors: ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a'], suffix: '%' },
                votes: { label: 'Valid Votes', stops: self.modeRanges?.votes || [0, 20, 40, 60, 80], colors: ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534'], suffix: '' },
                invalid: { label: 'Invalid Votes', stops: self.modeRanges?.invalid || [0, 2, 5, 10, 20], colors: ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444'], suffix: '%' },
                winner: { label: 'Winner', stops: [], colors: [] }
            };
            const cfg = configs[self.currentMode] || configs.turnout;
            div.innerHTML = `<strong>${cfg.label}</strong>`;

            // Calculate Histogram Data
            if (self.currentMode !== 'winner' && self.geoJSONLayer) {
                const counts = new Array(cfg.stops.length).fill(0);
                self.geoJSONLayer.eachLayer(layer => {
                    const data = layer.feature?.properties?.data || {};
                    let val = 0;
                    switch(self.currentMode) {
                        case 'turnout': val = data.turnout_perc; break;
                        case 'id_collected': val = data.id_collected_perc; break;
                        case 'registered': val = data.registered_people; break;
                        case 'votes': val = data.valid_votes; break;
                        case 'invalid': val = data.invalid_perc; break;
                    }
                    for (let i = cfg.stops.length - 1; i >= 0; i--) {
                        if (val >= cfg.stops[i]) { counts[i]++; break; }
                    }
                });
                const maxCount = Math.max(...counts) || 1;
                let histoHtml = '<div class="legend-histo">';
                counts.forEach((c, i) => {
                    const hP = (c / maxCount) * 100;
                    histoHtml += `<div class="histo-bar" style="height:${hP}%; background:${cfg.colors[i]}" data-count="${c} districts"></div>`;
                });
                histoHtml += '</div>';
                div.innerHTML += histoHtml;
            }

            if (self.currentMode === 'winner') {
                const winners = new Map();
                if (self.geoJSONLayer) {
                    self.geoJSONLayer.eachLayer(layer => {
                        const w = layer.feature?.properties?.data?.winner;
                        if (w && w.party_name) {
                            winners.set(w.party_name, w.party_color || '#9ca3af');
                        }
                    });
                }
                if (winners.size === 0) {
                    div.innerHTML += `<br><span style="color:#666">No Winner Data</span>`;
                } else {
                    winners.forEach((color, name) => {
                        div.innerHTML += `<br><i style="background:${color}"></i>${name}`;
                    });
                }
                return div;
            }

            cfg.stops.forEach((v, i) => {
                div.innerHTML += `<br><i style="background:${cfg.colors[i]}"></i>${v.toLocaleString()}${cfg.suffix}+`;
            });
            return div;
        };
        this.legendControl.addTo(this.map);
    },

    // ── Snapshot Export ──────────────────────────────────────
    exportMap() {
        if (!window.html2canvas) return;

        const mapEl = document.getElementById('map');
        const oldTransform = mapEl.style.transform;

        // Temporarily reset any transforms that might ruin off-screen tiles (just in case)
        window.html2canvas(mapEl, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#e5e7eb'
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `election_map_${new Date().getTime()}.png`;
            link.href = canvas.toDataURL();
            link.click();
        }).catch(err => console.error("Snapshot failed: ", err));
    }
};
