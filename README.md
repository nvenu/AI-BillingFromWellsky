# Kinnser Past Due Report Dashboard

Automated dashboard for tracking and visualizing Kinnser Past Due Visits reports across multiple locations.

## Features

- 🤖 Automated report downloading from Kinnser.net
- 📊 Interactive horizontal bar charts with billable vs non-billable breakdown
- 🎨 Beautiful blue/orange gradient visualizations
- 📅 Date range filtering
- 🔄 Real-time activity logging
- 👥 Multi-location support (9 locations)

## Setup

1. **Install dependencies:**
   ```bash
   cd app
   npm install
   ```

2. **Configure credentials:**
   - Copy `app/.env.example` to `app/.env`
   - Add your Kinnser credentials:
     ```
     KINNSER_USERNAME=your_username
     KINNSER_PASSWORD=your_password
     ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open dashboard:**
   - Navigate to http://localhost:3000

## Usage

- Click **"Download Now"** to fetch reports from all locations
- Use filters to view specific date ranges or report types
- Charts automatically update with billable (blue) and non-billable (orange) counts

## Locations

The system tracks reports for:
- Nightingale - Taunton
- Aspire - Dublin
- Aspire - San Diego
- Aspire - Scottsdale
- Aspire - Yuba City
- Nightingale - Las Vegas
- Nightingale - Minnetonka
- Nightingale - Pompano Beach
- Nightingale - Willowbrook

## Technology Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JavaScript, Chart.js
- **Automation:** Playwright
- **Data:** XLSX parsing, SQLite storage

## Project Structure

```
app/
├── server.js                    # Express server
├── automation/
│   └── reportDownloader_simple.js  # Automation script
├── public/
│   └── index.html              # Dashboard UI
├── data/                       # Downloaded reports
└── package.json
```

## License

Private - Internal Use Only
