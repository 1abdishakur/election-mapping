import { DataLoader } from './dataLoader.js?v=170';
import { DataJoiner } from './dataJoiner.js?v=170';
import { MapModule } from './map.js?v=221';
import { ChartsModule } from './charts.js?v=171';
import { UIController } from './ui.js?v=172';

/** Central Application State */
const AppState = {
    selectedState: 'all',
    selectedDistrict: 'all',
    selectedParty: null,
    choroplethMode: 'default'
};

class ElectionDashboard {
    constructor() {
        this.masterData = [];
        this.geoJSON = null;
        this.globalSummary = null;
        this.parties = {};
        this.allTables = {}; // Store raw data for consistent global counts
    }

    async init() {


        const [rawTables, geoJSON] = await Promise.all([
            DataLoader.loadAllTables(),
            DataLoader.fetchGeoJSON()
        ]);

        // Debug: log what we got
        Object.entries(rawTables).forEach(([k, v]) => {

        });

        const normalizedTables = DataJoiner.normalize(rawTables);
        this.allTables = normalizedTables;
        const result = DataJoiner.processData(normalizedTables);
        this.masterData = result.districtMaster;
        this.globalSummary = result.summary;
        this.parties = result.parties;
        this.geoJSON = DataJoiner.attachToGeoJSON(geoJSON, this.masterData);

        // Build from unique parties in party_results — no separate party table needed
        const rawParties = Object.values(this.parties)
            .map(p => ({
                ...p,
                seats_won: this.globalSummary.partySeats[p.party_code] || 0,
                votes_received: this.globalSummary.partyVotes[p.party_code] || 0
            }))
            .sort((a, b) => b.seats_won - a.seats_won);



        // Wire UI
        UIController.init({
            onStateChange: code => this.onStateChange(code),
            onDistrictChange: code => this.onDistrictChange(code),
            onModeChange: mode => this.onModeChange(mode),
            onSearch: q => this.onSearch(q),
            onToggleCenters: show => MapModule.toggleCentersLayer(show),
            onReset: () => this.onReset(),
            onShowAllParties: () => this.onShowAllParties()
        });

        UIController.populateStateFilter(rawTables.states || []);
        UIController.populateDistrictFilter(this.masterData);
        UIController.updateKPIs(this.globalSummary);
        UIController.updateMiniPanel(this.globalSummary);
        UIController.renderPartyList(rawParties, code => this.onPartyClick(code));
        UIController.updateMajorityTracker(this.globalSummary, this.parties);
        UIController.setContext('National Overview', 'Voter Turnout');

        const exportBtn = document.getElementById('export-map-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => MapModule.exportMap());

        // Map
        MapModule.init('map', this.geoJSON, d => this.onMapDistrictClick(d));

        // Charts
        ChartsModule.init();
        ChartsModule.update(this.globalSummary, this.parties, this.masterData);

        setTimeout(() => {
            const sel = document.getElementById('choropleth-mode');
            const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
            UIController.setContext('National Overview', modeLabel);

            UIController.hideLoading();

            this.startLiveSync();
        }, 300);
    }

    // ── Live Data Sync ────────────────────────────────────────
    startLiveSync() {

        setInterval(async () => {
            await this.refreshData();
        }, 60000);
    }

    async refreshData() {
        // Minimal background fetch
        try {
            // Track how many states had data BEFORE refresh
            const prevDataStates = new Set();
            (this.geoJSON?.features || []).forEach(f => {
                if (f.properties.data != null) {
                    const st = f.properties.State || f.properties.state || '';
                    if (st) prevDataStates.add(st.trim());
                }
            });

            const rawTables = await DataLoader.loadAllTables();
            const normalizedTables = DataJoiner.normalize(rawTables);
            this.allTables = normalizedTables;
            
            const result = DataJoiner.processData(normalizedTables);
            this.masterData = result.districtMaster;
            this.globalSummary = result.summary;
            this.parties = result.parties;
            
            // Attach fresh data to existing GeoJSON structure
            this.geoJSON = DataJoiner.attachToGeoJSON(this.geoJSON, this.masterData);

            // Notify map to update its visuals and properties without re-adding borders
            MapModule.updateData();

            // Check if NEW states appeared with data
            const newDataStates = new Set();
            (this.geoJSON?.features || []).forEach(f => {
                if (f.properties.data != null) {
                    const st = f.properties.State || f.properties.state || '';
                    if (st) newDataStates.add(st.trim());
                }
            });

            if (newDataStates.size > prevDataStates.size) {
                // New states appeared — zoom to cover all data-having areas
                const dataBounds = MapModule._getDataBounds(this.geoJSON);
                if (dataBounds) {
                    MapModule.map.fitBounds(dataBounds, { padding: [30, 30] });
                    console.log(`[App] New states detected (${prevDataStates.size} → ${newDataStates.size}), re-zooming to data bounds`);
                }
            }

            // Notify dashboard to reapply its state
            this.reapplyState();
        } catch (err) {
            console.warn("[App] Live Sync failed this cycle:", err);
        }
    }

    reapplyState() {
        if (AppState.selectedDistrict !== 'all') {
            // Re-activate the focused district with fresh data
            const d = this.masterData.find(x => (x.district_code || x.dist_code) === AppState.selectedDistrict);
            if (d) {
                const summary = DataJoiner.districtToSummary(d);
                UIController.updateKPIs(summary, true);
                UIController.updateMiniPanel(summary);
                ChartsModule.update(summary, this.parties, [d], true);
                this.updatePartyList(summary, true);
                UIController.updateMajorityTracker(summary, this.parties);
            }
        } else {
            // Apply global or state calculations
            const filtered = this.filterDistricts();
            const summary = DataJoiner.computeGlobalTotals(filtered, this.parties, this.allTables);
            UIController.updateKPIs(summary);
            UIController.updateMiniPanel(summary);
            ChartsModule.update(summary, this.parties, filtered);
            this.updatePartyList(summary);
            UIController.updateMajorityTracker(summary, this.parties);
        }
    }

    // ── Handlers ──────────────────────────────────────────────

    onStateChange(code) {
        AppState.selectedState = code;
        AppState.selectedDistrict = 'all';
        AppState.selectedParty = null;
        UIController.clearPartySelection();

        const filtered = this.filterDistricts();
        UIController.populateDistrictFilter(filtered);
        MapModule.filterByState(code, this.geoJSON);
        MapModule.resetStyles();

        const summary = DataJoiner.computeGlobalTotals(filtered, this.parties, this.allTables);
        UIController.updateKPIs(summary);
        UIController.updateMiniPanel(summary);
        ChartsModule.update(summary, this.parties, filtered);

        this.updatePartyList(summary);
        UIController.updateMajorityTracker(summary, this.parties);

        const label = code === 'all' ? 'National Overview' : `${code} — State View`;
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(label, modeLabel);
        
        // Show State/National aggregate data in the bottom panel
        UIController.updateDistrictDetailPanel(summary);
    }

    onDistrictChange(code) {
        AppState.selectedDistrict = code;
        AppState.selectedParty = null;
        UIController.clearPartySelection();

        if (code === 'all') {
            const filtered = this.filterDistricts();
            const summary = DataJoiner.computeGlobalTotals(filtered, this.parties, this.allTables);
            MapModule.filterByState(AppState.selectedState, this.geoJSON);
            MapModule.resetStyles();
            UIController.updateKPIs(summary);
            UIController.updateMiniPanel(summary);
            ChartsModule.update(summary, this.parties);
            this.updatePartyList(summary);
            UIController.updateMajorityTracker(summary, this.parties);
            
            const sel = document.getElementById('choropleth-mode');
            const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
            UIController.setContext('State Overview', modeLabel);
            
            // Re-show state summary in the bottom panel when reverting from district to state view
            UIController.updateDistrictDetailPanel(summary);
            return;
        }

        const d = this.masterData.find(x => (x.district_code || x.dist_code) === code);
        if (d) this.activateDistrict(d);
    }

    onModeChange(mode) {
        AppState.choroplethMode = mode;
        MapModule.setMode(mode);
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';

        let contextText;
        if (AppState.selectedDistrict !== 'all') {
            const d = this.masterData.find(x => (x.district_code || x.dist_code) === AppState.selectedDistrict);
            contextText = d ? d.district_name : 'District View';
        } else if (AppState.selectedState !== 'all') {
            contextText = `${AppState.selectedState} — State View`;
        } else {
            contextText = 'National Overview';
        }
        UIController.setContext(contextText, modeLabel);
    }

    onSearch(q) {
        if (!q || q.length < 2) { UIController.renderSearchResults([], null); return; }
        const hits = this.masterData.filter(d =>
            d.district_name?.toLowerCase().includes(q.toLowerCase())
        );
        UIController.renderSearchResults(hits, d => this.activateDistrict(d));
    }

    onMapDistrictClick(district) {
        AppState.selectedDistrict = district.district_code || district.dist_code;
        AppState.selectedParty = null;
        UIController.clearPartySelection();
        this.activateDistrict(district);
    }

    onPartyClick(partyCode) {
        AppState.selectedParty = partyCode;

        // UNZOOM: If a specific district was zoomed, reset view to the broader context (State or National)
        if (AppState.selectedDistrict !== 'all') {
            AppState.selectedDistrict = 'all';
            const distFilter = document.getElementById('district-filter');
            if (distFilter) distFilter.value = 'all';

            MapModule.selectedDistrictCode = null;
            if (MapModule.geoJSONLayer?.getBounds().isValid()) {
                MapModule.map.fitBounds(MapModule.geoJSONLayer.getBounds(), { padding: [25, 25] });
            }
            MapModule.showDistrictCenters(null);
        }

        MapModule.highlightParty(partyCode);

        const filtered = this.filterDistricts();
        const partySummary = this.buildPartySummary(filtered, partyCode);

        // Update all metrics based on the broader context (not just the previous district)
        UIController.updateKPIs(partySummary);
        UIController.updateMiniPanel(partySummary);
        ChartsModule.update(partySummary, this.parties);

        // Update the party list to reflect state/national performance for the labels below items
        this.updatePartyList(partySummary, false);

        const name = this.parties[partyCode]?.party_name || partyCode;
        MapModule.setMode('default');
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(`${name}`, modeLabel);

        // Re-highlight the selected item since we just re-rendered the list
        setTimeout(() => {
            const items = document.querySelectorAll('.party-card');
            items.forEach(it => {
                if (it.dataset.code === partyCode) it.classList.add('selected');
            });
        }, 10);
    }

    onShowAllParties() {
        this.onReset();
    }

    onReset() {
        AppState.selectedState = 'all';
        AppState.selectedDistrict = 'all';
        AppState.selectedParty = null;
        UIController.clearPartySelection();

        document.getElementById('state-filter').value = 'all';
        document.getElementById('district-filter').value = 'all';
        document.getElementById('district-search').value = '';

        UIController.populateDistrictFilter(this.masterData);
        MapModule.filterByState('all', this.geoJSON);
        MapModule.selectedDistrictCode = null;
        MapModule.resetStyles();
        MapModule.clearPinnedDistricts(); // Clear comparison on Reset
        MapModule.setMode('default');

        if (MapModule.geoJSONLayer && MapModule.geoJSONLayer.getBounds().isValid()) {
            MapModule.map.flyToBounds(MapModule.geoJSONLayer.getBounds(), { padding: [20, 20], duration: 1.2 });
        }
        MapModule.showDistrictCenters(null);

        UIController.updateKPIs(this.globalSummary);
        UIController.updateMiniPanel(this.globalSummary);
        ChartsModule.update(this.globalSummary, this.parties, this.masterData);
        this.updatePartyList(this.globalSummary, false);
        UIController.updateMajorityTracker(this.globalSummary, this.parties);

        MapModule.setMode('default');
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext('National Overview', modeLabel);
        UIController.updateDistrictDetailPanel(null);
    }

    // ── Helpers ───────────────────────────────────────────────

    activateDistrict(district) {
        const summary = DataJoiner.districtToSummary(district);
        UIController.updateKPIs(summary, true);
        UIController.updateMiniPanel(summary);
        ChartsModule.update(summary, this.parties, [district], true);

        this.updatePartyList(summary, true);
        MapModule.showDistrictCenters(district.dist_code || district.district_code);
        MapModule.showDistrictFocus(district.dist_code || district.district_code);

        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(district.district_name, modeLabel);
        UIController.updateDistrictDetailPanel(district);
    }

    updatePartyList(summary, isDistrictLevel = false) {
        const sortedParties = Object.values(this.parties).map(p => ({
            ...p,
            seats_won: summary.partySeats[p.party_code] || 0,
            votes_received: summary.partyVotes[p.party_code] || 0,
            is_contested: summary.partyDetails?.[p.party_code]?.is_contested,
            candidates_submitted: summary.partyDetails?.[p.party_code]?.candidates_submitted || 0,
            male_candidates: summary.partyDetails?.[p.party_code]?.male_candidates || 0,
            female_candidates: summary.partyDetails?.[p.party_code]?.female_candidates || 0,
            male_seats_won: summary.partyDetails?.[p.party_code]?.male_seats_won || 0,
            female_seats_won: summary.partyDetails?.[p.party_code]?.female_seats_won || 0
        })).sort((a, b) => b.seats_won - a.seats_won);

        UIController.renderPartyList(sortedParties, code => this.onPartyClick(code), isDistrictLevel);
    }

    filterDistricts() {
        if (AppState.selectedState === 'all') return this.masterData;
        return this.masterData.filter(d => d.state_code === AppState.selectedState);
    }

    buildPartySummary(districts, partyCode) {
        let votes = 0, seats = 0, maleSeats = 0, femaleSeats = 0;
        let totalCandidates = 0, maleCandidates = 0, femaleCandidates = 0;
        let totalRegistered = 0, totalIdCards = 0, totalVotes = 0, totalInvalid = 0;
        let totalPollingStations = 0, pollingCentersCount = 0;

        const contestedStates = new Set();
        const contestedDistricts = new Set();
        const partyVotes = {};
        const partySeats = {};
        const partyDetails = {};

        districts.forEach(d => {
            const pr = d.party_results?.find(r => r.party_code === partyCode);
            if (!pr) return; // party didn't contest this district

            // This party contested this district
            if (d.state_code) contestedStates.add(d.state_code);
            contestedDistricts.add(d.district_code || d.dist_code);

            votes += pr.votes_received || 0;
            seats += pr.seats_won || 0;
            maleSeats += pr.male_seats_won || 0;
            femaleSeats += pr.female_seats_won || 0;
            totalCandidates += pr.cadidates_submited || 0;
            maleCandidates += pr.male_cadidates || 0;
            femaleCandidates += pr.female_cadidates || 0;

            // Aggregate district-level totals for context
            totalRegistered += d.registered_people || 0;
            totalIdCards += d.id_cards_collected || 0;
            totalVotes += d.valid_votes || 0;
            totalInvalid += d.invalid_votes || 0;
            totalPollingStations += d.centers?.reduce((sum, c) => sum + (parseInt(c.polling_stations_count) || 0), 0) || 0;
            pollingCentersCount += d.centers?.length || 0;

            // Build per-party breakdown (only this party for focused view)
            partyVotes[partyCode] = (partyVotes[partyCode] || 0) + (pr.votes_received || 0);
            partySeats[partyCode] = (partySeats[partyCode] || 0) + (pr.seats_won || 0);
        });

        partyDetails[partyCode] = {
            male_seats_won: maleSeats,
            female_seats_won: femaleSeats,
            candidates_submitted: totalCandidates,
            male_candidates: maleCandidates,
            female_candidates: femaleCandidates
        };

        const p = this.parties[partyCode] || {};
        const turnoutVotes = totalVotes + totalInvalid;
        const idCollectedPct = totalRegistered > 0 ? (totalIdCards / totalRegistered) * 100 : 0;
        const turnoutPct = totalIdCards > 0 ? (turnoutVotes / totalIdCards) * 100 : 0;

        return {
            totalStates: contestedStates.size,
            totalDistricts: contestedDistricts.size,
            candidates: {
                total: totalCandidates,
                female: femaleCandidates,
                femalePct: totalCandidates > 0 ? (femaleCandidates / totalCandidates) * 100 : 0,
                male: maleCandidates,
                malePct: totalCandidates > 0 ? (maleCandidates / totalCandidates) * 100 : 0
            },
            contestedPartiesCount: 1,
            totalRegistered,
            totalIdCards,
            idCollectedPct,
            turnoutVotes,
            turnoutPct,
            totalVotes,
            validPct: turnoutVotes > 0 ? (totalVotes / turnoutVotes) * 100 : 0,
            totalInvalid,
            invalidPct: turnoutVotes > 0 ? (totalInvalid / turnoutVotes) * 100 : 0,
            pollingCentersCount,
            totalPollingStations,
            totalSeats: seats,
            overallWinner: { ...p, seats_won: seats, votes_received: votes },
            partyVotes,
            partySeats,
            partyDetails,
            genderStats: {
                male: maleCandidates,
                female: femaleCandidates,
                maleWinners: maleSeats,
                femaleWinners: femaleSeats
            },
            opStats: { centers: pollingCentersCount, stations: totalPollingStations },
            overallTurnout: turnoutPct
        };
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new ElectionDashboard().init().catch(e => console.error('[App] Fatal:', e));
});
