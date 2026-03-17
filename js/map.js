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
    _miniMap: null,
    _hideTimer: null,
    _panelLocked: false,
    _pinnedDistricts: [],
    _stateColorMap: {},
    _stateBordersLayer: null,

    // 12 vivid, maximally-distinct state border colors
    _STATE_PALETTE: [
        '#e63946', '#f77f00', '#fcbf49', '#2dc653', '#4cc9f0',
        '#7b2d8b', '#f72585', '#3a86ff', '#06d6a0', '#ffd166',
        '#ef476f', '#118ab2'
    ],

    _buildStateColorMap(geoJSON) {
        this._stateColorMap = {};
        let idx = 0;
        (geoJSON.features || []).forEach(f => {
            const stateName = (f.properties.State || f.properties.state || '').trim();
            if (stateName && !this._stateColorMap[stateName]) {
                this._stateColorMap[stateName] = this._STATE_PALETTE[idx % this._STATE_PALETTE.length];
                idx++;
            }
        });
        console.log('[Map] State border colors:', this._stateColorMap);
    },

    // ── Build dissolved state outlines using Turf.js ──
    _buildStateBorders(geoJSON) {
        if (this._stateBordersLayer) {
            this._stateBordersLayer.remove();
            this._stateBordersLayer = null;
        }
        if (!window.turf) {
            console.warn('[Map] Turf.js not loaded, skipping state borders');
            return;
        }

        // Group features by state name
        const byState = {};
        (geoJSON.features || []).forEach(f => {
            const st = (f.properties.State || f.properties.state || '').trim();
            if (!st) return;
            if (!byState[st]) byState[st] = [];
            byState[st].push(f);
        });

        const stateFeatures = [];
        for (const [stateName, features] of Object.entries(byState)) {
            try {
                // Merge all district polygons of this state into one outline
                let merged = features[0];
                for (let i = 1; i < features.length; i++) {
                    try {
                        merged = turf.union(
                            turf.featureCollection([merged, features[i]])
                        );
                    } catch (e) {
                        // If union fails for a pair, skip it
                    }
                }
                if (merged) {
                    merged.properties = { stateName };
                    stateFeatures.push(merged);
                }
            } catch (e) {
                console.warn(`[Map] Could not dissolve state: ${stateName}`, e);
            }
        }

        if (stateFeatures.length === 0) return;

        const stateGeoJSON = { type: 'FeatureCollection', features: stateFeatures };
        this._stateBordersLayer = L.geoJSON(stateGeoJSON, {
            style: f => {
                const color = this._stateColorMap[f.properties.stateName] || '#6B7280';
                return {
                    fillColor: 'transparent',
                    fillOpacity: 0,
                    color: color,
                    weight: 3,
                    dashArray: null,
                    interactive: false
                };
            },
            interactive: false
        }).addTo(this.map);

        // Bring to front so it sits above district fills
        this._stateBordersLayer.bringToFront();
        console.log(`[Map] Built ${stateFeatures.length} state outlines`);
    },

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
            preferCanvas: true,
            attributionControl: false
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

        // ── Zoom to ONLY districts that have election data on launch ──
        const dataBounds = this._getDataBounds(geoJSON);
        if (dataBounds) {
            this.map.fitBounds(dataBounds, { padding: [30, 30] });
        } else if (this.geoJSONLayer && this.geoJSONLayer.getBounds().isValid()) {
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

        // Build the state→color map from ALL GeoJSON features
        this._buildStateColorMap(geoJSON);

        // Render ALL districts — thin neutral borders, no-data = ghost
        this.geoJSONLayer = L.geoJSON(geoJSON, {
            style: f => this.styleFeature(f),
            onEachFeature: (f, layer) => this.bindFeatureEvents(f, layer)
        }).addTo(this.map);

        // Build dissolved state outlines on top
        this._buildStateBorders(geoJSON);

        this.computeDynamicRanges();
        this.updateLegend();
    },

    // Returns LatLngBounds covering ONLY features that have real data
    _getDataBounds(geoJSON) {
        const dataFeatures = (geoJSON?.features || []).filter(f => f.properties.data != null);
        if (dataFeatures.length === 0) return null;
        const dataJSON = { type: 'FeatureCollection', features: dataFeatures };
        const bounds = L.geoJSON(dataJSON).getBounds();
        return bounds.isValid() ? bounds : null;
    },

    updateData() {
        if (!this.geoJSONLayer) return;
        
        // 1. Re-calculate color bin sizes and ranges
        this.computeDynamicRanges();
        
        // 2. Safely re-apply styles to all polygons
        this.geoJSONLayer.setStyle(f => this.styleFeature(f));
        
        // 3. Update legend counts and thresholds
        this.updateLegend();
        
        // 4. Update the polygon text labels seamlessly
        this.updateLabels();
        
        // 5. Update Hover/Active Info card if currently open and locked
        if (this._panelLocked && this.selectedDistrictCode) {
            this.geoJSONLayer.eachLayer(layer => {
                const props = layer.feature?.properties?.data;
                const match = props && (props.dist_code === this.selectedDistrictCode || props.district_code === this.selectedDistrictCode);
                if (match) this.showDistrictFocus(this.selectedDistrictCode);
            });
        }
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

    clearPinnedDistricts() {
        this._pinnedDistricts = [];
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
                    <div style="display:flex; align-items:center; gap:6px; white-space:nowrap;">
                        <span style="font-size:10.5px;">${d.district_name}</span>
                        <span class="cp-dist-remove" data-idx="${idx}" style="cursor:pointer; color:var(--c-danger); font-size:16px; line-height:1;">×</span>
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
                            <span style="font-weight:800; color:var(--c-text); font-size:9.5px; white-space:normal; line-height:1.2; max-width:110px;">${w.party_name || '—'}</span>
                        </div>
                        <div style="font-weight:700; color:var(--c-warn); font-size:9px; margin-left:14px; opacity:0.9;">${w.seats_won || 0} SEATS WON</div>
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

            // Show district name from geojson 'name' field
            const name = layer.feature?.properties?.name || d.district_name || '';
            const dispName = name;

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
        const hasData = feature.properties.data != null;
        const d = feature.properties.data || {};

        // ── No-data districts: faint ghost ──
        if (!hasData) {
            return {
                fillColor: '#94a3b8',
                fillOpacity: 0.04,
                color: 'rgba(148,163,184,0.3)',
                weight: 0.5,
                dashArray: '4 4'
            };
        }

        const color = this.getColor(d);
        const isSelected = this.selectedDistrictCode && (d.district_code === this.selectedDistrictCode || d.dist_code === this.selectedDistrictCode);

        // District borders: thin neutral lines — state outlines are drawn by the separate layer
        return {
            fillColor: color,
            fillOpacity: this.currentMode === 'default' ? 0.2 : 0.72,
            color: isSelected ? '#fbbf24' : 'rgba(107,114,128,0.4)',
            weight: isSelected ? 3 : 0.6,
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
        // Skip events for no-data ghost districts
        if (!d) return;
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
    _getCenterStyle(isReg, isPoll) {
        if (isReg && !isPoll) return { fillColor: '#1a1a1a', color: '#ffffff', weight: 1.5 };  // Black = Registration
        if (isPoll && !isReg) return { fillColor: '#FFD700', color: '#1a1a1a', weight: 1.5 };  // Yellow = Polling
        return { fillColor: '#1a1a1a', color: '#FFD700', weight: 3 };                           // Black + Yellow border = Both
    },

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
                const style = this._getCenterStyle(isReg, isPoll);
                const type = isReg && isPoll ? 'Registration & Polling' : isReg ? 'Registration' : 'Polling';

                const marker = L.circleMarker([lat, lng], {
                    radius: 6,
                    fillColor: style.fillColor,
                    fillOpacity: 0.95,
                    color: style.color,
                    weight: style.weight
                });

                marker.on('click', () => {
                    const theme = document.documentElement.getAttribute('data-theme') || 'light';
                    const popupContent = `
                        <div class="center-tooltip center-tooltip-${theme}">
                            <div class="ct-header">
                                <div class="ct-title">${c.center_name || 'Unknown Center'}</div>
                                <div class="ct-tags">
                                    ${isReg ? '<span class="ct-tag ct-tag-reg">Registration</span>' : ''}
                                    ${isPoll ? '<span class="ct-tag ct-tag-poll">Polling</span>' : ''}
                                </div>
                            </div>
                            <div class="ct-info">
                                <div class="ct-row"><span>Polling Stations:</span> <b>${c.polling_stations_count || '0'}</b></div>
                                <div class="ct-row"><span>District:</span> <b>${d.district_name || '—'}</b></div>
                                <div class="ct-row ct-coords"><span>Lat:</span> ${parseFloat(c.latitude).toFixed(6)} <span>Lng:</span> ${parseFloat(c.longitude).toFixed(6)}</div>
                            </div>
                        </div>
                    `;
                    marker.bindPopup(popupContent, { closeButton: true, minWidth: 220, maxWidth: 320, className: 'center-tooltip-popup' }).openPopup();
                });
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
                    const style = this._getCenterStyle(isReg, isPoll);
                    const type = isReg && isPoll ? 'Registration & Polling' : isReg ? 'Registration' : 'Polling';

                    const marker = L.circleMarker([lat, lng], {
                        radius: 8, fillColor: style.fillColor, fillOpacity: 0.95,
                        color: style.color, weight: style.weight
                    });
                    marker.on('click', () => this._openCenterModal(c, d, type, isReg, isPoll));
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

    _openCenterModal(c, d, type, isReg, isPoll) {
        const existing = document.getElementById('center-detail-modal');
        if (existing) existing.remove();

        const isBoth = isReg && isPoll;
        const isRegOnly = isReg && !isPoll;

        const modal = document.createElement('div');
        modal.id = 'center-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);';

        modal.innerHTML = `
            <style>@keyframes cmUp{from{opacity:0;transform:translateY(20px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}</style>
            <div style="background:var(--c-surface,#1e293b);border:1px solid var(--c-border,#334155);border-radius:20px;max-width:420px;width:94%;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,0.55);animation:cmUp 0.28s cubic-bezier(0.34,1.56,0.64,1);">
                <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:22px;border-bottom:1px solid rgba(255,255,255,0.07);position:relative;">
                    <button onclick="document.getElementById('center-detail-modal').remove()" style="position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;border:none;background:rgba(255,255,255,0.08);color:#94a3b8;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.18)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">&times;</button>
                    <div style="display:flex;align-items:center;gap:14px;">
                        <div style="width:46px;height:46px;border-radius:50%;flex-shrink:0;background:${isRegOnly ? '#222' : '#FFD700'};border:${isBoth ? '3px solid #FFD700;background:#111' : '2px solid rgba(255,255,255,0.2)'};box-shadow:0 4px 16px rgba(0,0,0,0.4);"></div>
                        <div>
                            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#475569;margin-bottom:4px;">Voting Center</div>
                            <div style="font-size:16px;font-weight:700;color:#f1f5f9;line-height:1.25;">${c.center_name || 'Unknown Center'}</div>
                        </div>
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        ${isReg ? '<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#cbd5e1;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:600;">&#11200; Registration</span>' : ''}
                        ${isPoll ? '<span style="background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);color:#fbbf24;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:600;">&#11044; Polling</span>' : ''}
                    </div>
                </div>
                <div style="padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:12px;padding:14px;">
                        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Polling Stations</div>
                        <div style="font-size:26px;font-weight:800;color:#38bdf8;">${c.polling_stations_count || '0'}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px;">
                        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">District</div>
                        <div style="font-size:14px;font-weight:700;color:#e2e8f0;">${d.district_name || '—'}</div>
                    </div>
                </div>
                <div style="padding:14px 20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:9px;color:#475569;margin-bottom:5px;text-transform:uppercase;">Latitude</div>
                        <div style="font-size:12px;font-weight:600;color:#94a3b8;font-family:monospace;">${parseFloat(c.latitude).toFixed(6)}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:9px;color:#475569;margin-bottom:5px;text-transform:uppercase;">Longitude</div>
                        <div style="font-size:12px;font-weight:600;color:#94a3b8;font-family:monospace;">${parseFloat(c.longitude).toFixed(6)}</div>
                    </div>
                </div>
            </div>`;  

        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
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

        // In default mode, do not show the state border-color key
        if (this.currentMode === 'default') {
            return;
        }

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

            // ── Centers & Stations summary ─────────────────────
            if (self.geoJSONLayer) {
                let totalCenters = 0, totalStations = 0, regOnly = 0, pollOnly = 0, both = 0;
                self.geoJSONLayer.eachLayer(layer => {
                    const data = layer.feature?.properties?.data;
                    if (!data || !data.centers) return;
                    data.centers.forEach(c => {
                        const isReg = c.is_registration_center === 'TRUE' || c.is_registration_center === true;
                        const isPoll = c.is_polling_center === 'TRUE' || c.is_polling_center === true;
                        totalCenters++;
                        totalStations += parseInt(c.polling_stations_count) || 0;
                        if (isReg && isPoll) both++;
                        else if (isReg) regOnly++;
                        else if (isPoll) pollOnly++;
                    });
                });
                if (totalCenters > 0) {
                    div.innerHTML += `
                        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.12);">
                            <strong style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Centers</strong>
                            <br><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1a1a1a;border:1.5px solid #fff;margin-right:5px;vertical-align:middle;"></span>Registration: ${regOnly}
                            <br><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FFD700;border:1.5px solid #1a1a1a;margin-right:5px;vertical-align:middle;"></span>Polling: ${pollOnly}
                            <br><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1a1a1a;border:2.5px solid #FFD700;margin-right:5px;vertical-align:middle;"></span>Both: ${both}
                            <br><span style="color:#94a3b8;font-size:11px;">Total: ${totalCenters} centers · ${totalStations} stations</span>
                        </div>`;
                }
            }

            return div;
        };
        this.legendControl.addTo(this.map);
    },

    // ── Snapshot Export ──────────────────────────────────────
    // ── Advanced PDF Export ──────────────────────────────────
    exportMap() {
        this.openExportModal();
    },

    openExportModal() {
        const modal = document.getElementById('export-modal');
        if (!modal) return;
        modal.style.display = 'flex';

        // Wire modal internal events if not already done
        if (!this._exportInit) {
            this._initExportModalEvents();
            this._exportInit = true;
        }
    },

    _initExportModalEvents() {
        const modal = document.getElementById('export-modal');
        const closeBtn = document.getElementById('close-export-modal');
        const cancelBtn = document.getElementById('cancel-export');
        const confirmBtn = document.getElementById('confirm-export');

        const closeModal = () => modal.style.display = 'none';
        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;

        // Size & Orientation Selection
        const sizeBtns = modal.querySelectorAll('.size-btn');
        sizeBtns.forEach(btn => {
            btn.onclick = () => {
                sizeBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            };
        });

        const orientBtns = modal.querySelectorAll('.orient-btn');
        orientBtns.forEach(btn => {
            btn.onclick = () => {
                orientBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            };
        });

        confirmBtn.onclick = async () => {
            const size = modal.querySelector('.size-btn.selected')?.dataset.size || 'a4';
            const orientation = modal.querySelector('.orient-btn.selected')?.dataset.orient || 'portrait';
            const showLegend = document.getElementById('export-show-legend').checked;
            const showTitle = document.getElementById('export-show-title').checked;

            confirmBtn.disabled = true;
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = 'Capture & Render…'; // Inform user what's happening

            try {
                console.log(`[Export] Generating ${size} ${orientation} PDF…`);
                await this.generateModernPDF({ size, orientation, showLegend, showTitle });
                closeModal();
            } catch (err) {
                console.error("[Export] FAILED:", err);
                alert(`PDF Export Error: ${err.message || "Unknown Failure"}`);
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalText;
            }
        };
    },

    async generateModernPDF(options) {
        const { size, orientation, showLegend, showTitle } = options;
        
        // Ensure libraries exist
        if (!window.html2canvas) throw new Error("html2canvas library missing.");
        if (!window.jspdf) throw new Error("jsPDF library missing.");

        // 1. Determine Context Bounds for Smart Zoom
        let bounds = null;
        if (this.selectedDistrictCode && this.geoJSONLayer) {
            this.geoJSONLayer.eachLayer(layer => {
                const props = layer.feature?.properties?.data;
                const match = props && (props.dist_code === this.selectedDistrictCode || props.district_code === this.selectedDistrictCode);
                if (match) bounds = layer.getBounds();
            });
        }

        if (!bounds && this.geoJSONLayer) {
            bounds = this.geoJSONLayer.getBounds();
        }

        // Apply smart zoom if bounds found
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [10, 10], animate: false });
        }

        // Wait for tiles & settlement
        await new Promise(r => setTimeout(r, 1200));

        const mapContainer = document.querySelector('.map-container');
        if (!mapContainer) throw new Error("Map container not found.");

        // Capture Map (Safer ignore logic)
        const canvas = await window.html2canvas(mapContainer, {
            useCORS: true,
            allowTaint: false,
            scale: size === 'a0' || size === 'a1' ? 1.5 : 2, // Scale down for huge prints to save memory
            backgroundColor: document.documentElement.dataset.theme === 'dark' ? '#0f172a' : '#f1f5f9',
            ignoreElements: (el) => {
                if (!el.classList) return false;
                return el.classList.contains('leaflet-control-zoom') 
                    || el.classList.contains('leaflet-control-attribution')
                    || el.classList.contains('leaflet-control-layers')
                    || el.classList.contains('leaflet-control-measure');
            }
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'mm',
            format: size
        });

        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const isDark = document.documentElement.dataset.theme === 'dark';

        // Draw Background if dark
        if (isDark) {
            pdf.setFillColor(15, 23, 42); // Navy/Dark background
            pdf.rect(0, 0, pw, ph, 'F');
        }

        // Draw Frame
        pdf.setDrawColor(isDark ? 51 : 229, isDark ? 65 : 231, isDark ? 85 : 235);
        pdf.setLineWidth(0.4);
        pdf.rect(margin - 5, margin - 5, pw - (margin * 2) + 10, ph - (margin * 2) + 10);

        let currentY = margin;

        // Title
        if (showTitle) {
            const contextText = document.getElementById('map-context')?.textContent || 'National Election Overview';
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(size === 'a0' ? 32 : size === 'a1' ? 28 : 22);
            pdf.setTextColor(isDark ? 249 : 31, isDark ? 250 : 41, isDark ? 251 : 55);
            pdf.text(contextText.toUpperCase(), margin, currentY);
            currentY += (size === 'a0' ? 18 : 12);
            
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(156, 163, 175);
            pdf.text(`REPORTING DATE: ${new Date().toLocaleString().toUpperCase()}`, margin, currentY);
            currentY += 12;
        }

        // Map Image (Centering & Scaling)
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const mapW = pw - (margin * 2);
        const mapH = (canvas.height * mapW) / canvas.width;
        
        // Check available space
        const availH = ph - currentY - margin - (showLegend ? 35 : 0);
        let finalH = mapH;
        let finalW = mapW;
        if (mapH > availH) {
            finalH = availH;
            finalW = (canvas.width * finalH) / canvas.height;
        }
        
        const centerX = (pw - finalW) / 2;
        pdf.addImage(imgData, 'JPEG', centerX, currentY, finalW, finalH);
        currentY += finalH + 10;

        // Legend Rendering
        if (showLegend && this.legendControl) {
            const legendEl = document.querySelector('.info.legend');
            if (legendEl) {
                try {
                    const legCanvas = await window.html2canvas(legendEl, { 
                        scale: 1.5,
                        backgroundColor: isDark ? '#1e293b' : '#ffffff' 
                    });
                    const legW = size === 'a0' ? 80 : 50; 
                    const legH = (legCanvas.height * legW) / legCanvas.width;
                    pdf.addImage(legCanvas.toDataURL('image/png'), 'PNG', pw - legW - margin, ph - legH - margin - 8, legW, legH);
                } catch (ce) { console.warn("Legend render skipped", ce); }
            }
        }

        // Branding
        pdf.setFontSize(9);
        pdf.setTextColor(156, 163, 175);
        const brandingText = "NATIONAL INDEPENDENT ELECTORAL COMMISSION | NIEC TECHNICAL OPERATIONS SYSTEM";
        pdf.text(brandingText, margin, ph - margin + 4);

        // Final Save Trigger
        pdf.save(`NIEC_REPORT_${size.toUpperCase()}_#${new Date().getTime()}.pdf`);
    }
};
