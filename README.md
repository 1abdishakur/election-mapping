# Election Monitoring Dashboard

A premium, static web-based dashboard for visualizing and analyzing election data. Built with Leaflet.js, Chart.js, and Google Sheets.

## 🚀 Features

- **Interactive Map**: District-level visualization with multiple choropleth modes (Turnout, Votes, Seats, Winner, Category).
- **Relational Data**: Client-side joining of multiple Google Sheets tables (States, Districts, Party Results, Operations, Staff).
- **Dynamic Charts**: Real-time performance tracking for parties and operational monitoring using Chart.js.
- **District Analytics**: Deep-dive into specific district metrics, including party breakdowns and operational status.
- **Search & Filters**: Search by district name or filter by state.
- **Centers Visualization**: Toggleable layer for registration and polling centers.

## 📁 Project Structure

```text
election-mapping/
├── index.html              # Main application entry point
├── css/
│   └── style.css           # Modern design system & styles
├── js/
│   ├── config.js           # Spreadsheet IDs and GID configurations
│   ├── dataLoader.js       # Google Sheets fetching & CSV parsing
│   ├── dataJoiner.js       # Relational logic & data normalization
│   ├── map.js              # Leaflet map logic & choropleths
│   ├── charts.js           # Chart.js visualizations
│   ├── ui.js               # DOM interactions & UI state
│   └── main.js             # Application orchestrator
├── data/
│   └── districts.geojson   # District boundary data
└── assets/
    └── logos/              # Party and application logos
```

## 🛠️ Configuration

To connect your own Google Sheet:

1.  Open your Google Sheet.
2.  Go to `File > Share > Publish to web`.
3.  Ensure "Entire Document" and "CSV" are selected (or just ensure the sheet is "Anyone with the link can view").
4.  Open `js/config.js` and update:
    - `SPREADSHEET_ID`: Found in your Google Sheet URL.
    - `GIDS`: Map each tab name to its `gid` value (found in the URL when you click a tab in the sheet).

## 🚦 How to Run

Since the project uses ES6 Modules, you must run it through a web server (it will not work by opening the file directly due to CORS/Modules security).

### Option 1: VS Code Live Server
1. Open the folder in VS Code.
2. Click "Go Live" in the bottom right corner.

### Option 2: Python (Simple)
```bash
python -m http.server 8000
```

### Option 3: Node.js
```bash
npx serve .
```

## 🗺️ GeoJSON Note
The `data/districts.geojson` file currently contains placeholder boundaries. Replace this file with your actual district GeoJSON. Ensure each feature has a `district_code` property that matches the `district_code` in your Google Sheet.
