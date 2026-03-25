/**
 * Election Dashboard Configuration
 * Party data is derived from party_results.
 */

export const CONFIG = {
    SPREADSHEET_ID: '1ojFi4l9nv7Pq3d-PxQN1HKPXuT3u3piePYLew0mYL4w',

    SHEETS: {
        states: 'states',
        districts: 'districts',
        party: 'party',
        party_results: 'party_results',
        centers: 'centers',
        elected_candidates: 'elected_candidates'
    },

    GEOJSON_PATH: 'data/districts.geojson',

    COLORS: {
        charts: [
            '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed',
            '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0f766e',
            '#1d4ed8', '#c026d3', '#334155', '#b45309', '#be123c',
            '#166534', '#1e40af', '#6d28d9', '#9f1239', '#0c4a6e'
        ]
    }
};
