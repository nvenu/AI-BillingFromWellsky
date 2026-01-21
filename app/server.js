import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Store logs for clients
let downloadLogs = [];

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve data files for download
app.use('/downloads', express.static(DATA_DIR));

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected');
  // Send existing logs to new client
  socket.emit('logs', downloadLogs);
});

// Billable task types
const BILLABLE_TASKS = [
  'billable HHA Visit', 'Occupational Therapy Rates', 'COTA Visit',
  'OASIS-E Discharge (OT)', 'OASIS-E1 Death (OT)', 'OASIS-E1 Discharge (OT)',
  'OASIS-E1 Follow-up (OT)', 'OASIS-E1 Recertification (OT)', 'OASIS-E1 Resumption of Care (OT)',
  'OASIS-E1 Start of Care (OT)', 'OASIS-E1 Transfer (OT)', 'OT - Telehealth',
  'OT Discharge', 'OT Discharge Eval w/ Discharge Summary', 'OT Evaluation',
  'OT Re-Evaluation', 'OT Re-Evaluation w/Supervisory Visit', 'OT Visit',
  'OT Visit w/ Supervisory Visit', 'OASIS-E Discharge (PT)', 'OASIS-E1 Death (PT)',
  'OASIS-E1 Discharge (PT)', 'OASIS-E1 Follow-up (PT)', 'OASIS-E1 Recertification (PT)',
  'OASIS-E1 Resumption of Care (PT)', 'OASIS-E1 Start of Care (PT)', 'OASIS-E1 Transfer (PT)',
  'PT - Telehealth', 'PT Discharge', 'PT Discharge w/Discharge Summary', 'PT Evaluation',
  'PT Maintenance', 'PT Re-Evaluation', 'PT Re-evaluation w/Supervisory Visit', 'PT Visit',
  'PT Visit w/Supervisory Visit', 'PTA Maintenance', 'PTA Visit', 'LPN/LVN - Skilled Nursing Visit',
  'OASIS-E Discharge', 'OASIS-E Discharge (Non-Billable)', 'OASIS-E1 Death',
  'OASIS-E1 Discharge', 'OASIS-E1 Discharge (Non-Billable)', 'OASIS-E1 Follow-up',
  'OASIS-E1 Recertification', 'OASIS-E1 Resumption of Care', 'OASIS-E1 Start of Care',
  'OASIS-E1 Transfer', 'PT w/ INR', 'RN - Skilled Nursing Visit', 'Skilled Nurse Visit',
  'Skilled Nurse Visit (Non-Billable)', 'SN Wound Care', 'SN Assessment E1', 'SN B12 INJ',
  'SN D/C', 'SN Evaluation', 'SN Foley Change', 'SN Injection', 'SN Injection AM',
  'SN Injection PM', 'SN Labs', 'SN WC Photo', 'SN Wound Care AM', 'SN Wound Care PM',
  'SNV - Psych Nurse', 'SNV - Telehealth', 'SNV D/C Planning', 'SNV w/ Aide Supervision',
  'SNV W/ Discharge Summary', 'SNV w/ LPN Supervision', 'SNV w/LVN Supervision',
  'MSW - Telehealth', 'MSW Discharge', 'MSW Evaluation', 'MSW Visit',
  'OASIS-E Discharge (Non-Billable) - ST', 'OASIS-E Discharge (ST)', 'OASIS-E1 Death (ST)',
  'OASIS-E1 Discharge (ST)', 'OASIS-E1 Follow-up (ST)', 'OASIS-E1 Recertification (ST)',
  'OASIS-E1 Resumption of Care (ST)', 'OASIS-E1 Start of Care (ST)', 'OASIS-E1 Transfer (ST)',
  'ST - Telehealth', 'ST Discharge', 'ST Evaluation', 'ST Re-Evaluation', 'ST Visit',
  'Update', 'CMS-485'
];

function isBillableTask(taskType) {
  if (!taskType) return false;
  return BILLABLE_TASKS.some(billable => 
    taskType.toLowerCase().trim() === billable.toLowerCase().trim()
  );
}

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// API: Get all reports
app.get('/api/reports', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const excelFiles = files.filter(f => f.endsWith('.xlsx'));
    
    const reports = [];
    for (const file of excelFiles) {
      const filepath = path.join(DATA_DIR, file);
      const stats = await fs.stat(filepath);
      const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2})\.xlsx/);
      
      if (match) {
        reports.push({
          filename: file,
          reportName: match[1].replace(/_/g, ' '),
          date: match[2],
          size: stats.size,
          created: stats.mtime
        });
      }
    }
    
    res.json(reports.sort((a, b) => b.date.localeCompare(a.date)));
  } catch (error) {
    res.json([]);
  }
});

// API: Get analytics data
app.get('/api/analytics', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const excelFiles = files.filter(f => f.endsWith('.xlsx'));
    
    const analytics = {};
    const billableAnalytics = {
      'All Locations - Combined': []
    };
    
    for (const file of excelFiles) {
      const filepath = path.join(DATA_DIR, file);
      const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2})\.xlsx/);
      
      if (match) {
        const reportName = match[1].replace(/_/g, ' ');
        const date = match[2];
        
        try {
          const workbook = XLSX.readFile(filepath);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(sheet);
          
          if (!analytics[reportName]) {
            analytics[reportName] = [];
          }
          
          // Count billable vs non-billable
          let billableCount = 0;
          let nonBillableCount = 0;
          
          data.forEach(row => {
            // Check common column names for task type
            const taskType = row['Task Type'] || row['Task'] || row['Type'] || 
                           row['Visit Type'] || row['Service Type'] || '';
            
            if (isBillableTask(taskType)) {
              billableCount++;
            } else {
              nonBillableCount++;
            }
          });
          
          analytics[reportName].push({
            date,
            rowCount: data.length,
            billableCount,
            nonBillableCount,
            columns: Object.keys(data[0] || {})
          });
          
          // Add to billable analytics
          const existingEntry = billableAnalytics['All Locations - Combined'].find(e => e.date === date);
          if (existingEntry) {
            existingEntry.billableCount += billableCount;
            existingEntry.nonBillableCount += nonBillableCount;
            existingEntry.rowCount += data.length;
          } else {
            billableAnalytics['All Locations - Combined'].push({
              date,
              rowCount: data.length,
              billableCount,
              nonBillableCount
            });
          }
        } catch (e) {
          console.error(`Error parsing ${file}:`, e.message);
        }
      }
    }
    
    // Sort by date
    Object.keys(analytics).forEach(name => {
      analytics[name].sort((a, b) => a.date.localeCompare(b.date));
    });
    
    billableAnalytics['All Locations - Combined'].sort((a, b) => a.date.localeCompare(b.date));
    
    // Merge billable analytics with regular analytics
    const combinedAnalytics = { ...billableAnalytics, ...analytics };
    
    res.json(combinedAnalytics);
  } catch (error) {
    res.json({});
  }
});

// API: Trigger download (placeholder - runs automation)
app.post('/api/download', async (req, res) => {
  try {
    downloadLogs = []; // Clear previous logs
    
    const KinnserReportDownloader = (await import('./automation/reportDownloader_simple.js')).default;
    const downloader = new KinnserReportDownloader(io);
    const results = await downloader.run();
    
    // Notify clients to refresh data
    io.emit('download-complete', { success: true, results });
    
    res.json({ success: true, results });
  } catch (error) {
    const errorMsg = error.message;
    io.emit('log', { type: 'error', message: `Error: ${errorMsg}` });
    io.emit('download-complete', { success: false, error: errorMsg });
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// API: Trigger deviation report download
app.post('/api/deviation/download', async (req, res) => {
  try {
    downloadLogs = []; // Clear previous logs
    
    const DeviationReportDownloader = (await import('./automation/deviationDownloader.js')).default;
    const downloader = new DeviationReportDownloader(io);
    const results = await downloader.run();
    
    // Store results in a JSON file
    const deviationDataPath = path.join(DATA_DIR, 'deviation_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(deviationDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results - replace existing records for same date and location
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.location === newRecord.location && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        // Update existing record
        existingData[existingIndex] = newRecord;
      } else {
        // Add new record
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(deviationDataPath, JSON.stringify(existingData, null, 2));
    
    // Notify clients to refresh data
    io.emit('deviation-complete', { success: true, results });
    
    res.json({ success: true, results });
  } catch (error) {
    const errorMsg = error.message;
    io.emit('log', { type: 'error', message: `Error: ${errorMsg}` });
    io.emit('deviation-complete', { success: false, error: errorMsg });
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// API: Get deviation analytics
app.get('/api/deviation/analytics', async (req, res) => {
  try {
    const deviationDataPath = path.join(DATA_DIR, 'deviation_data.json');
    const fileContent = await fs.readFile(deviationDataPath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    // Group by location
    const analytics = {};
    data.forEach(record => {
      if (!analytics[record.location]) {
        analytics[record.location] = [];
      }
      analytics[record.location].push({
        date: record.date,
        count: record.count
      });
    });
    
    // Sort by date
    Object.keys(analytics).forEach(location => {
      analytics[location].sort((a, b) => a.date.localeCompare(b.date));
    });
    
    res.json(analytics);
  } catch (error) {
    res.json({});
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve deviation report page
app.get('/deviation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'deviation.html'));
});

// Serve EOE report page
app.get('/eoe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'eoe.html'));
});

// API: Trigger EOE report download
app.post('/api/eoe/download', async (req, res) => {
  try {
    downloadLogs = []; // Clear previous logs
    
    const EOEReportDownloader = (await import('./automation/eoeDownloader.js')).default;
    const downloader = new EOEReportDownloader(io);
    const results = await downloader.run();
    
    // Store results in a JSON file
    const eoeDataPath = path.join(DATA_DIR, 'eoe_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(eoeDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results - replace existing records for same date and location
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.location === newRecord.location && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        // Update existing record
        existingData[existingIndex] = newRecord;
      } else {
        // Add new record
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(eoeDataPath, JSON.stringify(existingData, null, 2));
    
    // Notify clients to refresh data
    io.emit('eoe-complete', { success: true, results });
    
    res.json({ success: true, results });
  } catch (error) {
    const errorMsg = error.message;
    io.emit('log', { type: 'error', message: `Error: ${errorMsg}` });
    io.emit('eoe-complete', { success: false, error: errorMsg });
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// API: Get EOE analytics
app.get('/api/eoe/analytics', async (req, res) => {
  try {
    const eoeDataPath = path.join(DATA_DIR, 'eoe_data.json');
    const fileContent = await fs.readFile(eoeDataPath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    // Group by location
    const analytics = {};
    data.forEach(record => {
      if (!analytics[record.location]) {
        analytics[record.location] = [];
      }
      analytics[record.location].push({
        date: record.date,
        count: record.count
      });
    });
    
    // Sort by date
    Object.keys(analytics).forEach(location => {
      analytics[location].sort((a, b) => a.date.localeCompare(b.date));
    });
    
    res.json(analytics);
  } catch (error) {
    res.json({});
  }
});

// Schedule automatic downloads
const schedule = process.env.REPORT_SCHEDULE || '0 8 * * *';
console.log(`📅 Scheduled automatic downloads: ${schedule} (Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

cron.schedule(schedule, async () => {
  console.log('⏰ Running scheduled download...');
  try {
    const KinnserReportDownloader = (await import('./automation/reportDownloader_simple.js')).default;
    const downloader = new KinnserReportDownloader(io);
    const results = await downloader.run();
    io.emit('download-complete', { success: true, results });
    console.log('✅ Scheduled download completed successfully');
  } catch (error) {
    console.error('❌ Scheduled download failed:', error.message);
    io.emit('log', { type: 'error', message: `Scheduled download failed: ${error.message}` });
    io.emit('download-complete', { success: false, error: error.message });
  }
});

// Schedule automatic deviation reports
const deviationSchedule = process.env.DEVIATION_SCHEDULE || '30 8 * * *';
console.log(`📊 Scheduled deviation reports: ${deviationSchedule} (Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

cron.schedule(deviationSchedule, async () => {
  console.log('⏰ Running scheduled deviation report...');
  try {
    const DeviationReportDownloader = (await import('./automation/deviationDownloader.js')).default;
    const downloader = new DeviationReportDownloader(io);
    const results = await downloader.run();
    
    // Store results
    const deviationDataPath = path.join(DATA_DIR, 'deviation_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(deviationDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results - replace existing records for same date and location
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.location === newRecord.location && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        // Update existing record
        existingData[existingIndex] = newRecord;
      } else {
        // Add new record
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(deviationDataPath, JSON.stringify(existingData, null, 2));
    
    io.emit('deviation-complete', { success: true, results });
    console.log('✅ Scheduled deviation report completed successfully');
  } catch (error) {
    console.error('❌ Scheduled deviation report failed:', error.message);
    io.emit('log', { type: 'error', message: `Scheduled deviation report failed: ${error.message}` });
    io.emit('deviation-complete', { success: false, error: error.message });
  }
});

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Kinnser Report Dashboard running at http://localhost:${PORT}\n`);
});

// Helper to emit logs
export function emitLog(type, message) {
  const log = { type, message, timestamp: new Date().toISOString() };
  downloadLogs.push(log);
  io.emit('log', log);
}

// Schedule automatic EOE reports
const eoeSchedule = process.env.EOE_SCHEDULE || '30 8 * * *';
console.log(`📋 Scheduled EOE reports: ${eoeSchedule} (Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

cron.schedule(eoeSchedule, async () => {
  console.log('⏰ Running scheduled EOE report...');
  try {
    const EOEReportDownloader = (await import('./automation/eoeDownloader.js')).default;
    const downloader = new EOEReportDownloader(io);
    const results = await downloader.run();
    
    // Store results
    const eoeDataPath = path.join(DATA_DIR, 'eoe_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(eoeDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results - replace existing records for same date and location
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.location === newRecord.location && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        // Update existing record
        existingData[existingIndex] = newRecord;
      } else {
        // Add new record
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(eoeDataPath, JSON.stringify(existingData, null, 2));
    
    io.emit('eoe-complete', { success: true, results });
    console.log('✅ Scheduled EOE report completed successfully');
  } catch (error) {
    console.error('❌ Scheduled EOE report failed:', error.message);
    io.emit('log', { type: 'error', message: `Scheduled EOE report failed: ${error.message}` });
    io.emit('eoe-complete', { success: false, error: error.message });
  }
});
