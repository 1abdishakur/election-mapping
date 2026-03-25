/**
 * Map Module — Leaflet + multiple tile layers + measure + center markers
 */
import { DataJoiner } from './dataJoiner.js';

export const MapModule = {
    choroplethMode: 'default',
    map: null,
    geoJSONLayer: null,
    labelsLayer: null,
    centersLayer: null,
    heatLayer: null,
    coverageLayer: null,
    searchControl: null,
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
    showCenters: false,

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
            const geomType = f.geometry?.type;
            if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') return;
            if (!byState[st]) byState[st] = [];
            // Create a clean copy — strip data properties that could cause issues with turf
            const clean = turf.feature(f.geometry, { stateName: st });
            byState[st].push(clean);
        });

        const stateFeatures = [];
        for (const [stateName, features] of Object.entries(byState)) {
            try {
                let merged = null;
                if (features.length === 1) {
                    merged = features[0];
                } else {
                    const buffered = features.map(f => turf.buffer(f, 0.001, { units: 'kilometers' }));
                    merged = turf.union(turf.featureCollection(buffered));
                    if (merged) {
                        merged = turf.buffer(merged, -0.0001, { units: 'kilometers' });
                    }
                }
                
                if (merged) {
                    merged.properties = { stateName };
                    stateFeatures.push(merged);
                }
            } catch (e) {
                console.warn(`[Map] Dissolve failed for ${stateName}, trying raw fallback`);
                try {
                    const coords = [];
                    features.forEach(f => {
                        if (f.geometry.type === 'Polygon') {
                            coords.push(f.geometry.coordinates);
                        } else if (f.geometry.type === 'MultiPolygon') {
                            coords.push(...f.geometry.coordinates);
                        }
                    });
                    if (coords.length > 0) {
                        stateFeatures.push({
                            type: 'Feature',
                            properties: { stateName },
                            geometry: { type: 'MultiPolygon', coordinates: coords }
                        });
                    }
                } catch (e2) { 
                    /* skip total failure */ 
                }
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
                    weight: 6,
                    dashArray: '2, 8',
                    interactive: false,
                    lineJoin: 'round',
                    lineCap: 'round'
                };
            },
            interactive: false
        }).addTo(this.map);

        // Bring to front so it sits above district fills
        this._stateBordersLayer.bringToFront();


        // ── Render Large Muted State Labels ──
        if (!this._stateLabelsLayer) {
            this._stateLabelsLayer = L.layerGroup().addTo(this.map);
        } else {
            this._stateLabelsLayer.clearLayers();
        }

        stateFeatures.forEach(f => {
            let latlng;
            try {
                // Try centerOfMass first for accurate polygon center
                const com = turf.centerOfMass(f);
                // Turf returns [longitude, latitude]
                latlng = [com.geometry.coordinates[1], com.geometry.coordinates[0]];
            } catch (e) {
                const bounds = L.geoJSON(f).getBounds();
                latlng = bounds.getCenter();
            }

            const stateMarker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'state-label',
                    html: `<div class="state-label-inner">${f.properties.stateName}</div>`,
                    iconSize: [300, 40],
                    iconAnchor: [150, 20]
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: -10 
            });
            this._stateLabelsLayer.addLayer(stateMarker);
        });

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

        // Hide when mouse leaves the MAP area entirely
        const mapContainer = document.getElementById(containerId);
        if (mapContainer) {
            mapContainer.onmouseleave = () => {
                if (!this._panelLocked) this._hideHoverPanel();
            };
        }

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



        this.renderDistricts(geoJSON);
        this.buildAdvancedMapControls();
        this._initSearchControl();
        this.addMiniMap(geoJSON);

        // Add Toggle Controls to Map
        this.addToggleControl();
        this.addModeControl();

        // Final Sync: Ensure map state matches our visibility flags
        this._applyActiveCenters();

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
        const self = this;
        const ModeControl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-control mode-dropdown');
                container.innerHTML = `
                    <button class="mode-dropdown-trigger" id="mode-dropdown-trigger">
                        <span id="current-mode-label">Default View</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-left:8px; opacity:0.6;"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <div class="mode-dropdown-menu" id="mode-dropdown-menu" style="display:none;">
                        <div class="mode-opt selected" data-value="default">Default View</div>
                        <div class="mode-opt" data-value="registered">Registered Voters</div>
                        <div class="mode-opt" data-value="id_collected">ID Cards Collected</div>
                        <div class="mode-opt" data-value="turnout">Voter Turnout</div>
                        <div class="mode-opt" data-value="votes">Valid Votes</div>
                        <div class="mode-opt" data-value="invalid">Invalid Votes</div>
                        <div class="mode-opt" data-value="winner">Winning Party</div>
                        <div class="mode-opt" data-value="margin">Margin of Victory</div>
                    </div>
                `;
                
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                const btn = container.querySelector('#mode-dropdown-trigger');
                const menu = container.querySelector('#mode-dropdown-menu');
                const label = container.querySelector('#current-mode-label');

                btn.onclick = () => {
                    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                };

                container.querySelectorAll('.mode-opt').forEach(opt => {
                    opt.onclick = () => {
                        const val = opt.getAttribute('data-value');
                        label.textContent = opt.textContent;
                        
                        container.querySelectorAll('.mode-opt').forEach(m => m.classList.remove('selected'));
                        opt.classList.add('selected');
                        
                        self.setMode(val);
                        window.dispatchEvent(new CustomEvent('modeChanged', { detail: val }));
                        menu.style.display = 'none';
                    };
                });

                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target)) menu.style.display = 'none';
                });

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
                    <button id="map-toggle-centers" title="Toggle Centers" class="${this.showCenters ? 'active' : ''}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                    </button>
                `;
                container.onclick = (e) => {
                    L.DomEvent.stopPropagation(e);
                    this.toggleCentersLayer(!this.showCenters);
                };
                return container;
            }
        });
        new ToggleControl().addTo(this.map);
    },

    renderDistricts(geoJSON) {
        this._lastGeoJSON = geoJSON;
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

        // Update centers for this filtered set
        this.buildCentersLayer(geoJSON);

        this.computeDynamicRanges();
        this.updateLegend();
        
        // Initial label render
        setTimeout(() => this.updateLabels(), 100);
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
        
        // 5. If the hover panel is locked open, refresh its content from updated data
        if (this._panelLocked && this.selectedDistrictCode) {
            this.geoJSONLayer.eachLayer(layer => {
                const d = layer.feature?.properties?.data;
                const match = d && (d.dist_code === this.selectedDistrictCode || d.district_code === this.selectedDistrictCode);
                if (match) {
                    // Re-render the hover panel with fresh data
                    const fakeEvent = { originalEvent: { clientX: 0, clientY: 0 } };
                    const panelRect = this._hoverPanel?.getBoundingClientRect();
                    if (panelRect) {
                        fakeEvent.originalEvent.clientX = panelRect.left + panelRect.width / 2;
                        fakeEvent.originalEvent.clientY = panelRect.top + panelRect.height / 2;
                    }
                    this._showHoverPanel(d, fakeEvent);
                }
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
            options: { position: 'bottomright' },
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

                    // Sync mini-map tile with theme
                    window.addEventListener('themeChanged', e => {
                        const theme = e.detail;
                        mm.eachLayer(l => { if (l instanceof L.TileLayer) mm.removeLayer(l); });
                        L.tileLayer(theme === 'dark' 
                            ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png' 
                            : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
                        ).addTo(mm);
                    });
                }, 200);
                return container;
            }
        });
        new MiniMapControl().addTo(this.map);
    },



    // ── Hover Panel ────────────────────────────────────────────
    _showHoverPanel(d, mouseEvent) {
        if (!this._hoverPanel) return;
        if (this._hideTimer) clearTimeout(this._hideTimer);
        this._hoverPanel.style.display = 'block';
        
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
        const gap = 20; // 20px gap to ensure cursor doesn't "get stuck" under the panel during hover transitions

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
        
        // Give user 200ms to move mouse from polygon to the panel
        this._hideTimer = setTimeout(() => {
            if (!this._panelLocked && this._hoverPanel) {
                this._hoverPanel.style.display = 'none';
            }
        }, 200);
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
                        case 'turnout': {
                            const tVal = (d.valid_votes || 0) + (d.invalid_votes || 0);
                            statText = `${formatNum(tVal)} (${(d.turnout_perc || 0).toFixed(1)}%)`;
                            break;
                        }
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
                inner += `<div class="pl-seats" style="font-size:${fsS}px;color:#111827">${seats} seat${seats !== 1 ? 's' : ''} (${pct}%)</div>`;
                
                if (h >= 32) {
                    const votes = (pr.votes_received || 0).toLocaleString();
                    const m = pr.male_seats_won || 0;
                    const f = pr.female_seats_won || 0;
                    
                    let extra = `<div class="pl-votes" style="font-size:${Math.max(fsS - 1, 5)}px">${votes} votes</div>`;
                    if (seats > 0) {
                        extra += `<div class="pl-gender" style="font-size:${Math.max(fsS - 1, 5)}px; color:#4B5563; font-weight:700;">(${m}m  ${f}f)</div>`;
                    }
                    inner += extra;
                }
            }

            let center;
            try {
                const com = turf.centerOfMass(layer.feature);
                center = [com.geometry.coordinates[1], com.geometry.coordinates[0]];
            } catch (e) {
                center = bounds.getCenter();
            }

            const marker = L.marker(center, {
                icon: L.divIcon({
                    className: 'poly-label',
                    html: `<div class="pl-inner">${inner}</div>`,
                    // icon sized to a portion of the polygon’s pixel footprint to reduce overlap
                    iconSize: [w * 0.9, h * 0.9],
                    iconAnchor: [(w * 0.9) / 2, (h * 0.9) / 2]
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: -500
            });
            this.labelsLayer.addLayer(marker);
        });
        
        // Labels are now attached to markers as tooltips, no separate management needed

        // Also update state labels sizing/visibility on zoom
        if (this._stateLabelsLayer) {
            const zoom = this.map.getZoom();
            this._stateLabelsLayer.eachLayer(layer => {
                const el = layer.getElement();
                if (el) {
                    const inner = el.querySelector('.state-label-inner');
                    if (inner) {
                        // Very subtle zoom scaling
                        const scale = 1 + (zoom - 6) * 0.1;
                        inner.style.transform = `scale(${Math.max(0.6, Math.min(scale, 1.8))})`;
                    }
                }
            });
        }
    },

    styleFeature(feature) {
        const hasData = feature.properties.data != null;
        const d = feature.properties.data || {};
        
        // Match district border color to its state's dotted border color
        const st = (feature.properties.State || feature.properties.state || '').trim();
        const stateColor = this._stateColorMap[st] || 'rgba(255, 255, 255, 0.45)';

        // ── No-data districts: faint ghost ──
        if (!hasData) {
            return {
                fillColor: '#94a3b8',
                fillOpacity: 0.04,
                color: stateColor,
                weight: 0.8,
                dashArray: '4 4'
            };
        }

        const color = this.getColor(d);
        // Use robust code matching from DataJoiner
        const isSelected = this.selectedDistrictCode && (
            DataJoiner.compareCodes(d.district_code, this.selectedDistrictCode) || 
            DataJoiner.compareCodes(d.dist_code, this.selectedDistrictCode)
        );

        // District borders: now use the same vivid color as the state's outer dotted line
        // Selection is made much "stronger" as requested (weight 6, opacity 1)
        return {
            fillColor: color,
            fillOpacity: this.currentMode === 'default' ? (isSelected ? 0.35 : 0.2) : 0.72,
            color: isSelected ? '#fbbf24' : stateColor,
            weight: isSelected ? 6 : 1.2,
            opacity: isSelected ? 1 : 0.8,
            dashArray: null
        };
    },

    getColor(d) {
        if (!d) return '#94a3b8';

        if (this.currentMode === 'default') {
            const cat = String(d.district_category || '').toUpperCase();
            if (cat === 'A') return '#1d4ed8'; // Blue-700
            if (cat === 'B') return '#10b981'; // Emerald-500
            if (cat === 'C') return '#f59e0b'; // Amber-500
            return '#64748b'; // Slate-500
        }

        if (this.currentMode === 'winner') {
            return d.winner?.party_color || '#94a3b8';
        }

        if (this.currentMode === 'margin') {
            const results = [...(d.party_results || [])].sort((a, b) => b.votes_received - a.votes_received);
            const winner = results[0];
            const runnerUp = results[1];
            const total = (d.valid_votes || 1);
            const margin = winner && runnerUp ? ((winner.votes_received - runnerUp.votes_received) / total * 100) : (winner ? (winner.votes_received / total * 100) : 0);
            
            if (margin < 5) return '#dbeafe';
            if (margin < 15) return '#60a5fa';
            if (margin < 30) return '#2563eb';
            return '#1e40af';
        }

        const stats = {
            turnout: d.turnout_perc,
            id_collected: d.id_collected_perc,
            registered: d.registered_people,
            votes: d.valid_votes,
            invalid: d.invalid_perc
        };

        const val = stats[this.currentMode] || 0;
        const stops = this.modeRanges[this.currentMode] || [0, 20, 40, 60, 80];
        
        // Use standard 5-step color scale for others
        const colors = this.currentMode === 'invalid' 
            ? ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444']
            : ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a'];

        for (let i = stops.length - 1; i >= 0; i--) {
            if (val >= stops[i]) return colors[i];
        }
        return colors[0];
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
            },
            click: e => {
                this.map.flyToBounds(e.target.getBounds(), { padding: [40, 40], duration: 1, maxZoom: 16 });
                if (this.onDistrictClick && d) this.onDistrictClick(d);
            }
        });
    },

    // ── Centers Layer & Advanced Features ─────────────────────
    _getCenterStyle() {
        return { fillColor: '#0ea5e9', color: '#0369a1', weight: 1.5 }; // Unified Professional Blue
    },

    buildCentersLayer(geoJSON) {
        // Clear previous instances properly
        if (this.centersLayer) this.map.removeLayer(this.centersLayer);
        if (this.activeCentersLayer) this.map.removeLayer(this.activeCentersLayer);
        if (this.coverageLayer) this.map.removeLayer(this.coverageLayer);
        if (this.heatLayer) this.map.removeLayer(this.heatLayer);

        // 1. Initialize Marker Clustering for Centers (Professional Grouping)
        this.centersLayer = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            removeOutsideVisibleBounds: true,
            disableClusteringAtZoom: 16,
            maxClusterRadius: 35,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();
                return L.divIcon({
                    html: `<div class="center-cluster-icon"><span>${count}</span></div>`,
                    className: 'marker-cluster-custom',
                    iconSize: [32, 32]
                });
            }
        });

        this.coverageLayer = L.layerGroup();
        const heatPoints = [];

        // If centers should be shown, add them to map
        if (this.showCenters) this.centersLayer.addTo(this.map);

        geoJSON.features.forEach(feature => {
            const d = feature.properties.data;
            if (!d || !d.centers) return;

            let cnt = 0;
            d.centers.forEach(c => {
                const lat = parseFloat(c.latitude);
                const lng = parseFloat(c.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                const style = this._getCenterStyle();
                const radius = 8;
                const labelText = c.center_name || 'Center';
                const marker = L.circleMarker([lat, lng], {
                    radius: radius,
                    fillColor: style.fillColor,
                    fillOpacity: 0.95,
                    color: style.color,
                    weight: style.weight
                });

                // Attach label as permanent tooltip to the point
                marker.bindTooltip(labelText, {
                    permanent: true,
                    direction: 'top',
                    className: 'center-label-attached',
                    offset: [0, -radius - 2],
                    opacity: 1
                });

                const stations = parseInt(c.polling_stations_count) || 1;

                cnt++;

 

                // Feature 6: Coverage Visualization (1km radius)
                const coverage = L.circle([lat, lng], {
                    radius: 1000,
                    color: '#6366f1',
                    weight: 1,
                    fillOpacity: 0.05,
                    interactive: false
                });

                this.centersLayer.addLayer(marker);
                this.coverageLayer.addLayer(coverage);

                // Feature 7: Heatmap Points
                heatPoints.push([lat, lng, 0.5]);
            });
        });

        // Initialize Heatmap
        this.heatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 14 });
    },

    buildAdvancedMapControls() {
        if (!this.map) return;
        
        const controls = L.control({ position: 'topright' });
        controls.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-layer-controls glass-panel');
            div.innerHTML = `
                <div class="lc-title" style="font-size: 10px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">Map Layers</div>
                <label style="font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="chk-centers" ${this.showCenters ? 'checked' : ''}> Show Centers
                </label>
                <label style="font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="chk-coverage"> Coverage Range
                </label>
                <div id="coverage-radius-wrap" style="display:none; flex-direction:column; gap:3px; margin:2px 0 6px 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:9px; color:var(--c-text-3);">Radius: <span id="radius-val">1.0</span> km</div>
                        <input type="number" id="radius-input" value="1000" min="100" max="10000" style="width:42px; font-size:8px; height:18px; padding:0 2px; background:rgba(255,255,255,0.05); border:1px solid var(--c-border); color:white; border-radius:2px;">
                    </div>
                    <input type="range" id="radius-slider" min="200" max="5000" step="100" value="1000" style="width:100%; cursor:pointer; height:12px;">
                </div>
                
                <label style="font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="chk-heatmap"> Density Heatmap
                </label>
                <div id="heatmap-options-wrap" style="display:none; flex-direction:column; gap:6px; margin:2px 0 6px 20px;">
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <div style="font-size:9px; color:var(--c-text-3);">Radius: <span id="heat-radius-val">25</span>px</div>
                        <input type="range" id="heat-radius-slider" min="5" max="60" step="1" value="25" style="width:100%; cursor:pointer; height:12px;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:1px;">
                        <div style="font-size:9px; color:var(--c-text-3);">Intensity: <span id="heat-blur-val">15</span>px (Blur)</div>
                        <input type="range" id="heat-blur-slider" min="5" max="50" step="1" value="15" style="width:100%; cursor:pointer; height:12px;">
                    </div>
                </div>
            `;
            
            L.DomEvent.disableClickPropagation(div);
            return div;
        };
        controls.addTo(this.map);

        // Bind events
        setTimeout(() => {
            document.getElementById('chk-centers')?.addEventListener('change', e => {
                this.toggleCentersLayer(e.target.checked);
            });
            
            const coverageWrap = document.getElementById('coverage-radius-wrap');
            const radiusVal = document.getElementById('radius-val');
            const radiusSlider = document.getElementById('radius-slider');
            const radiusInput = document.getElementById('radius-input');
            
            document.getElementById('chk-coverage')?.addEventListener('change', e => {
                const show = e.target.checked;
                if (show) {
                    this.coverageLayer.addTo(this.map);
                    if (coverageWrap) coverageWrap.style.display = 'flex';
                } else {
                    this.coverageLayer.remove();
                    if (coverageWrap) coverageWrap.style.display = 'none';
                }
            });

            const updateRadius = (newR) => {
                const r = parseInt(newR) || 0;
                if (radiusSlider) radiusSlider.value = r;
                if (radiusInput) radiusInput.value = r;
                if (radiusVal) radiusVal.innerText = (r / 1000).toFixed(1);
                
                // Update all circles in the coverage layer
                if (this.coverageLayer) {
                    this.coverageLayer.eachLayer(layer => {
                        if (layer.setRadius) layer.setRadius(r);
                    });
                }
            };

            radiusSlider?.addEventListener('input', e => updateRadius(e.target.value));
            radiusInput?.addEventListener('input', e => updateRadius(e.target.value));

            // Feature: Heatmap Controls
            const heatWrap = document.getElementById('heatmap-options-wrap');
            const heatRadiusSlider = document.getElementById('heat-radius-slider');
            const heatRadiusVal = document.getElementById('heat-radius-val');
            const heatBlurSlider = document.getElementById('heat-blur-slider');
            const heatBlurVal = document.getElementById('heat-blur-val');

            document.getElementById('chk-heatmap')?.addEventListener('change', e => {
                const show = e.target.checked;
                if (show) {
                    this.heatLayer.addTo(this.map);
                    if (heatWrap) heatWrap.style.display = 'flex';
                } else {
                    this.heatLayer.remove();
                    if (heatWrap) heatWrap.style.display = 'none';
                }
            });

            const updateHeatmap = () => {
                const r = parseInt(heatRadiusSlider.value);
                const b = parseInt(heatBlurSlider.value);
                if (heatRadiusVal) heatRadiusVal.innerText = r;
                if (heatBlurVal) heatBlurVal.innerText = b;
                
                if (this.heatLayer) {
                    this.heatLayer.setOptions({ radius: r, blur: b });
                }
            };

            heatRadiusSlider?.addEventListener('input', updateHeatmap);
            heatBlurSlider?.addEventListener('input', updateHeatmap);
        }, 500);
    },

    _initSearchControl() {
        if (!this.map || !this.centersLayer) return;

        this.searchControl = new L.Control.Search({
            layer: this.centersLayer,
            initial: false,
            propertyName: 'title', // We set this on CircleMarker options
            marker: false,
            zoom: 16,
            moveToLocation: (latlng) => {
                this.map.setView(latlng, 16);
            }
        });

        this.searchControl.on('search:locationfound', (e) => {
            if (e.layer.openPopup) e.layer.openPopup();
        });

        this.map.addControl(this.searchControl);
    },

    toggleCentersLayer(show) {
        this.showCenters = show;
        
        // Sync Sidebar Button
        const btn = document.getElementById('map-toggle-centers');
        if (btn) btn.classList.toggle('active', show);

        // Sync Layers Panel Checkbox
        const chk = document.getElementById('chk-centers');
        if (chk) chk.checked = show;

        // Re-apply whatever is the current active district / global state
        this._applyActiveCenters();

        this.updateLegend(); // Refresh legend
    },

    // Central helper — decides what center markers to show based on
    // current showCenters flag AND the stored selectedDistrictCode.
    _applyActiveCenters() {
        if (!this.map) return;

        // 1. Aggressive Deep Cleanup: Find and kill all election-center related layers
        // We use a custom flag _isElectionLayer to ensure we catch everything even if refs change
        this.map.eachLayer(layer => {
            if (layer._isElectionLayer || layer instanceof L.MarkerClusterGroup) {
                this.map.removeLayer(layer);
            }
        });

        // Clear references
        if (this.centersLayer) this.centersLayer = null;
        if (this.activeCentersLayer) this.activeCentersLayer = null;

        // 2. If toggle is OFF, stop here
        if (!this.showCenters) return;

        // 3. Otherwise, rebuild and show what's appropriate for the current focus
        // We always rebuild here to ensure the data matches the new context perfectly
        if (this.selectedDistrictCode) {
            this._renderDistrictCenters(this.selectedDistrictCode);
        } else {
            // Re-render Global/State centers if no specific district focus
            this.buildCentersLayer(this._lastGeoJSON || null);
            if (this.centersLayer) {
                this.centersLayer._isElectionLayer = true;
                this.map.addLayer(this.centersLayer);
            }
        }
    },

    // Public entry — called by activateDistrict() and onReset()
    showDistrictCenters(districtCode) {
        // Unify with existing selectedDistrictCode property to avoid state drift
        this.selectedDistrictCode = districtCode || null;
        this._applyActiveCenters();
    },

    // Internal — builds and adds markers for a single district
    _renderDistrictCenters(districtCode) {
        if (!this.map || !this.geoJSONLayer) return;

        const markers = [];
        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (d && (d.dist_code === districtCode || d.district_code === districtCode) && d.centers) {
                d.centers.forEach(c => {
                    const lat = parseFloat(c.latitude);
                    const lng = parseFloat(c.longitude);
                    if (isNaN(lat) || isNaN(lng)) return;

                    const style = this._getCenterStyle();
                    const labelText = c.center_name || 'Center';

                    const marker = L.circleMarker([lat, lng], {
                        radius: 8, fillColor: style.fillColor, fillOpacity: 0.95,
                        color: style.color, weight: style.weight
                    });

                    marker.bindTooltip(labelText, {
                        permanent: true,
                        direction: 'top',
                        className: 'center-label-attached',
                        offset: [0, -10],
                        opacity: 1
                    });
                    markers.push(marker);
                });
            }
        });

        if (markers.length > 0) {
            this.activeCentersLayer = L.markerClusterGroup({
                disableClusteringAtZoom: 17,
                maxClusterRadius: 30,
                iconCreateFunction: (cluster) => {
                    const count = cluster.getChildCount();
                    return L.divIcon({
                        html: `<div class="center-cluster-icon"><span>${count}</span></div>`,
                        className: 'marker-cluster-custom',
                        iconSize: [32, 32]
                    });
                }
            });

            this.activeCentersLayer._isElectionLayer = true;
            markers.forEach(m => this.activeCentersLayer.addLayer(m));
            this.activeCentersLayer.addTo(this.map);
        }
    },

    showDistrictFocus(districtCode) {
        this.selectedDistrictCode = districtCode;
        // Clear any pending hide timer so the hover panel isn't dismissed
        if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
        if (!this.geoJSONLayer) return;

        let targetLayer = null;
        this.geoJSONLayer.eachLayer(layer => {
            const d = layer.feature?.properties?.data;
            if (d && (DataJoiner.compareCodes(d.dist_code, districtCode) || DataJoiner.compareCodes(d.district_code, districtCode))) {
                targetLayer = layer;
            }
        });

        // Reset styles for all, then target will get its yellow border via styleFeature
        this.geoJSONLayer.setStyle(f => this.styleFeature(f));

        if (targetLayer) {
            targetLayer.bringToFront();
            this.map.flyToBounds(targetLayer.getBounds(), { padding: [40, 40], duration: 1, maxZoom: 16 });
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
            features: geoJSON.features.filter(f => {
                // Match by State property name (works for both data and no-data districts)
                const st = (f.properties.State || f.properties.state || '').trim();
                // Also try matching by state_code on data if present
                const dataStateCode = f.properties.data?.state_code;
                return st === stateCode || dataStateCode === stateCode;
            })
        };
        this.renderDistricts(filtered);
        if (this.geoJSONLayer && this.geoJSONLayer.getBounds().isValid()) {
            this.map.flyToBounds(this.geoJSONLayer.getBounds(), { padding: [20, 20], duration: 1.2 });
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
        // Redraw labels without party data
        this.updateLabels();
    },

    // ── Legend ───────────────────────────────────────────────
    updateLegend() {
        if (this.legendControl) this.legendControl.remove();

        const self = this;
        this.legendControl = L.control({ position: 'bottomleft' });
        this.legendControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');

            // 1. Default View: Centers legend (ONLY IF TOGGLED ON)
            if (self.currentMode === 'default') {
                if (self.showCenters) {
                    let totalCenters = 0, totalStations = 0;
                    if (self.geoJSONLayer) {
                        self.geoJSONLayer.eachLayer(layer => {
                            const data = layer.feature?.properties?.data;
                            if (!data || !data.centers) return;
                            if (self.selectedState && self.selectedState !== 'all') {
                                const st = (layer.feature.properties.State || layer.feature.properties.state || '').trim();
                                if (st !== self.selectedState) return;
                            }
                            if (self.selectedDistrictCode) {
                                const dCode = data.dist_code || data.district_code;
                                if (dCode !== self.selectedDistrictCode) return;
                            }
                            data.centers.forEach(c => {
                                totalCenters++;
                                totalStations += parseInt(c.polling_stations_count) || 0;
                            });
                        });
                    }

                    div.innerHTML = `
                        <div class="legend-section centers-legend">
                            <div class="legend-header">Election Centers</div>
                            <div class="legend-items">
                                <div class="legend-item"><div class="legend-dot" style="background:#0ea5e9;"></div><span>Active Centers</span></div>
                            </div>
                        </div>
                        <div class="legend-stats" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.06)">
                            <div class="stat-row"><span class="stat-label">Total Centers:</span><span class="stat-value">${totalCenters}</span></div>
                            <div class="stat-row"><span class="stat-label">Total Stations:</span><span class="stat-value">${totalStations}</span></div>
                        </div>`;
                }
                return div;
            }

            // 2. Choropleth Legend (non-default modes)
            const configs = {
                turnout: { label: 'Voter Turnout', stops: self.modeRanges?.turnout || [0, 20, 40, 60, 80], colors: ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a'], suffix: '%' },
                registered: { label: 'Registered Voters', stops: self.modeRanges?.registered || [0, 20, 40, 60, 80], colors: ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534'], suffix: '' },
                id_collected: { label: 'ID Cards Collected', stops: self.modeRanges?.id_collected || [0, 20, 40, 60, 80], colors: ['#ef4444', '#f97316', '#facc15', '#4ade80', '#16a34a'], suffix: '%' },
                votes: { label: 'Valid Votes', stops: self.modeRanges?.votes || [0, 20, 40, 60, 80], colors: ['#fef08a', '#d9f99d', '#86efac', '#22c55e', '#166534'], suffix: '' },
                invalid: { label: 'Invalid Votes', stops: self.modeRanges?.invalid || [0, 2, 5, 10, 20], colors: ['#16a34a', '#4ade80', '#facc15', '#f97316', '#ef4444'], suffix: '%' },
                winner: { label: 'Winner', stops: [], colors: [] },
                margin: { label: 'Margin of Victory', stops: [0, 5, 15, 30], colors: ['#dbeafe', '#60a5fa', '#2563eb', '#1e40af'], suffix: '%', labels: ['Very Close (0-5%)', 'Competitive (5-15%)', 'Strong (15-30%)', 'Landslide (30%+)'] }
            };
            const cfg = configs[self.currentMode] || configs.turnout;
            div.innerHTML = `<strong>${cfg.label}</strong>`;

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
                        if (w && w.party_name) winners.set(w.party_name, w.party_color || '#9ca3af');
                    });
                }
                if (winners.size === 0) div.innerHTML += `<br><span style="color:#666">No Winner Data</span>`;
                else winners.forEach((color, name) => { div.innerHTML += `<br><i style="background:${color}"></i>${name}`; });
            } else {
                cfg.stops.forEach((v, i) => {
                    div.innerHTML += `<br><i style="background:${cfg.colors[i]}"></i>${v.toLocaleString()}${cfg.suffix}+`;
                });
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
        if (closeBtn) closeBtn.onclick = closeModal;
        if (cancelBtn) cancelBtn.onclick = closeModal;

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

        if (confirmBtn) confirmBtn.onclick = async () => {
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
