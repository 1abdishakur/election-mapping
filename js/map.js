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
    _activePartyCode: null,   // tracks the currently highlighted party

    // ── Tile Layers ──────────────────────────────────────────
    TILES: {
        'Street Map': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors', maxZoom: 19, crossOrigin: true
        }),
        'Carto Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© CartoDB', maxZoom: 19, crossOrigin: true
        }),
        'Carto Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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

        // Default base tile
        this.TILES['Carto Light'].addTo(this.map);

        // Layer Control
        L.control.layers(this.TILES, {}, { position: 'topright', collapsed: true }).addTo(this.map);

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
            if ((d.invalid_votes || 0) > maxVals.invalid) maxVals.invalid = d.invalid_votes;
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
            </div>`;

        this._hoverPanel.style.display = 'block';
        this._moveHoverPanel(mouseEvent);
    },

    _moveHoverPanel(e) {
        if (!this._hoverPanel || this._hoverPanel.style.display === 'none') return;
        const mapEl = this._hoverPanel.parentElement;
        const rect = mapEl.getBoundingClientRect();

        // Cursor position relative to the map container
        const px = e.originalEvent.clientX - rect.left;
        const py = e.originalEvent.clientY - rect.top;

        // Panel dimensions
        const pw = this._hoverPanel.offsetWidth || 240;
        const ph = this._hoverPanel.offsetHeight || 300;
        const gap = 14;

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
        if (this._hoverPanel) this._hoverPanel.style.display = 'none';
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
                            const tv = (d.valid_votes || 0) + iv;
                            statText = `${formatNum(iv)} (${tv > 0 ? (iv / tv * 100).toFixed(1) : '0'}%)`;
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
        return {
            fillColor: color,
            fillOpacity: this.currentMode === 'default' ? 0.2 : 0.72,
            color: '#666666',
            weight: 1,
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
                return this.scale(d.invalid_votes, this.modeRanges.invalid || [0, 1000, 3000, 7000, 15000], ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444']);
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
                e.target.setStyle({ weight: 3, color: '#000000', fillOpacity: 0.6 });
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
                this.map.fitBounds(e.target.getBounds(), { padding: [40, 40], maxZoom: 12 });
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
        const filtered = stateCode === 'all' ? geoJSON : {
            ...geoJSON,
            features: geoJSON.features.filter(f => f.properties.data?.state_code === stateCode)
        };
        this.renderDistricts(filtered);
        if (this.geoJSONLayer.getBounds().isValid()) {
            this.map.fitBounds(this.geoJSONLayer.getBounds(), { padding: [20, 20] });
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
                invalid: { label: 'Invalid Votes', stops: self.modeRanges?.invalid || [0, 20, 40, 60, 80], colors: ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444'], suffix: '' },
                winner: { label: 'Winner', stops: [], colors: [] }
            };
            const cfg = configs[self.currentMode] || configs.turnout;
            div.innerHTML = `<strong>${cfg.label}</strong>`;

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
