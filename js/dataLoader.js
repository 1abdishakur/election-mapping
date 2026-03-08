import { CONFIG } from './config.js?v=3';

/**
 * DataLoader — uses sheet names (not GIDs) for reliable Google Sheets access.
 * URL format: /gviz/tq?tqx=out:csv&sheet=SHEETNAME
 * Works with any sheet where the spreadsheet is shared as "Anyone with the link can view".
 */
export const DataLoader = {

    buildUrl(sheetName) {
        const timestamp = new Date().getTime();
        return `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&t=$${timestamp}`;
    },

    async fetchSheet(name, sheetName) {
        const url = this.buildUrl(sheetName);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            // Google returns an error page if the sheet doesn't exist or isn't shared
            if (text.includes('google-visualization-errors') || text.includes('<!DOCTYPE')) {
                console.warn(`[DataLoader] "${name}" returned an error page — check sheet name and sharing.`);
                return [];
            }
            const rows = this.parseCSV(text);
            console.log(`[DataLoader] ${name} (${sheetName}): ${rows.length} rows`);
            if (rows.length > 0) console.log(`[DataLoader] ${name} columns:`, Object.keys(rows[0]).join(', '));
            return rows;
        } catch (err) {
            console.warn(`[DataLoader] Failed "${name}": ${err.message}`);
            return [];
        }
    },

    parseCSV(raw) {
        const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const tokens = this._tokenize(lines);
        if (tokens.length < 2) return [];
        const headers = tokens[0].map(h => h.trim().replace(/^"|"$/g, '').trim());
        return tokens.slice(1)
            .filter(row => row.some(v => v.trim() !== ''))
            .map(row => {
                const obj = {};
                headers.forEach((h, i) => {
                    obj[h] = (row[i] || '').trim().replace(/^"|"$/g, '').trim();
                });
                return obj;
            });
    },

    _tokenize(text) {
        const rows = [];
        let row = [''];
        let inQ = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') {
                if (inQ && text[i + 1] === '"') { row[row.length - 1] += '"'; i++; }
                else inQ = !inQ;
            } else if (ch === ',' && !inQ) {
                row.push('');
            } else if (ch === '\n' && !inQ) {
                rows.push(row);
                row = [''];
            } else {
                row[row.length - 1] += ch;
            }
        }
        if (row.some(v => v)) rows.push(row);
        return rows;
    },

    async loadAllTables() {
        const entries = Object.entries(CONFIG.SHEETS);
        const results = await Promise.all(
            entries.map(([name, sheetName]) => this.fetchSheet(name, sheetName))
        );
        const tables = {};
        entries.forEach(([name], i) => { tables[name] = results[i]; });
        return tables;
    },

    async fetchGeoJSON() {
        try {
            const res = await fetch(CONFIG.GEOJSON_PATH);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn('[DataLoader] GeoJSON failed:', err.message);
            return { type: 'FeatureCollection', features: [] };
        }
    }
};
