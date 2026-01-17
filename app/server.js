import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import { createServer } from 'http';
import { Server } from 'socket.io';

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
      'Billable vs Non-Billable': []
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
          const existingEntry = billableAnalytics['Billable vs Non-Billable'].find(e => e.date === date);
          if (existingEntry) {
            existingEntry.billableCount += billableCount;
            existingEntry.nonBillableCount += nonBillableCount;
            existingEntry.rowCount += data.length;
          } else {
            billableAnalytics['Billable vs Non-Billable'].push({
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
    
    billableAnalytics['Billable vs Non-Billable'].sort((a, b) => a.date.localeCompare(b.date));
    
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
