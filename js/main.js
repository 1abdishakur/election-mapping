import { DataLoader } from './dataLoader.js?v=117';
import { DataJoiner } from './dataJoiner.js?v=117';
import { MapModule } from './map.js?v=117';
import { ChartsModule } from './charts.js?v=117';
import { UIController } from './ui.js?v=117';

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
        console.log('[App] Initializing…');

        const [rawTables, geoJSON] = await Promise.all([
            DataLoader.loadAllTables(),
            DataLoader.fetchGeoJSON()
        ]);

        // Debug: log what we got
        Object.entries(rawTables).forEach(([k, v]) => {
            console.log(`[Data] ${k}: ${v.length} rows`);
        });

        this.allTables = rawTables;
        const result = DataJoiner.processData(rawTables);
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

        console.log(`[App] Parties from results: ${rawParties.length}, Districts: ${this.masterData.length}`);

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
        UIController.setContext('National Overview', 'Voter Turnout');

        const exportBtn = document.getElementById('export-map-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => MapModule.exportMap());

        // Map
        MapModule.init('map', this.geoJSON, d => this.onMapDistrictClick(d));

        // Charts
        ChartsModule.init();
        ChartsModule.update(this.globalSummary, this.parties);

        setTimeout(() => {
            const sel = document.getElementById('choropleth-mode');
            const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
            UIController.setContext('National Overview', modeLabel);

            UIController.hideLoading();
            console.log('[App] Ready');
        }, 300);
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
        ChartsModule.update(summary, this.parties);

        this.updatePartyList(summary);

        const label = code === 'all' ? 'National Overview' : `${code} — State View`;
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(label, modeLabel);
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
            const sel = document.getElementById('choropleth-mode');
            const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
            UIController.setContext('State Overview', modeLabel);
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
        let contextText = AppState.selectedDistrict !== 'all' ? document.getElementById('panel-context').textContent.split(' — ')[1] || document.getElementById('panel-context').textContent :
            AppState.selectedState !== 'all' ? `${AppState.selectedState} — State View` : 'National Overview';
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
        MapModule.highlightParty(partyCode);

        const filtered = this.filterDistricts();
        const partySummary = this.buildPartySummary(filtered, partyCode);
        UIController.updateKPIs(partySummary);
        UIController.updateMiniPanel(partySummary);
        ChartsModule.update(partySummary, this.parties);

        const name = this.parties[partyCode]?.party_name || partyCode;
        MapModule.setMode('default');
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(`${name}`, modeLabel);
    }

    onShowAllParties() {
        AppState.selectedParty = null;
        UIController.clearPartySelection();
        MapModule.resetStyles();

        const filtered = this.filterDistricts();
        const summary = DataJoiner.computeGlobalTotals(filtered, this.parties, this.allTables);
        UIController.updateKPIs(summary);
        UIController.updateMiniPanel(summary);
        ChartsModule.update(summary, this.parties);

        // Use global summary if nothing selected, else use filtered summary
        this.updatePartyList(summary);

        MapModule.setMode('default');
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext('All Parties', modeLabel);
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
        MapModule.setMode('default');

        if (MapModule.geoJSONLayer?.getBounds().isValid()) {
            MapModule.map.fitBounds(MapModule.geoJSONLayer.getBounds());
        }
        MapModule.showDistrictCenters(null);

        UIController.updateKPIs(this.globalSummary);
        UIController.updateMiniPanel(this.globalSummary);
        ChartsModule.update(this.globalSummary, this.parties);
        this.updatePartyList(this.globalSummary, false);

        MapModule.setMode('default');
        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext('National Overview', modeLabel);
    }

    // ── Helpers ───────────────────────────────────────────────

    activateDistrict(district) {
        const summary = DataJoiner.districtToSummary(district);
        UIController.updateKPIs(summary, true);
        UIController.updateMiniPanel(summary);
        ChartsModule.update(summary, this.parties);

        this.updatePartyList(summary, true);
        MapModule.showDistrictCenters(district.dist_code || district.district_code);
        MapModule.showDistrictFocus(district.dist_code || district.district_code);

        const sel = document.getElementById('choropleth-mode');
        const modeLabel = sel ? sel.options[sel.selectedIndex].text : 'Default View';
        UIController.setContext(district.district_name, modeLabel);
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
            totalPollingStations += (d.operations?.polling_stations_used || 0);
            pollingCentersCount += d.centers?.filter(c =>
                String(c.is_polling_center).trim().toUpperCase() === 'TRUE'
            ).length || 0;

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
            staffStats: { reg: 0, id: 0, day: 0 },
            overallTurnout: turnoutPct
        };
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new ElectionDashboard().init().catch(e => console.error('[App] Fatal:', e));
});
