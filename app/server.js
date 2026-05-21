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
    
    // Clean up data older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    existingData = existingData.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate >= sevenDaysAgo;
    });
    
    console.log(`🗑️  Cleaned up deviation data: keeping records from ${sevenDaysAgo.toISOString().split('T')[0]} onwards`);
    
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

// Serve Unbilled report page
app.get('/unbilled', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'unbilled.html'));
});

// Serve DX report page
app.get('/dx', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dx.html'));
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

// API: Trigger DX report download
app.post('/api/dx/download', async (req, res) => {
  try {
    downloadLogs = []; // Clear previous logs
    
    const DXReportDownloader = (await import('./automation/dxDownloader.js')).default;
    const downloader = new DXReportDownloader(io);
    const results = await downloader.run();
    
    // Store results in a JSON file
    const dxDataPath = path.join(DATA_DIR, 'dx_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(dxDataPath, 'utf-8');
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
        existingData[existingIndex] = newRecord;
      } else {
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(dxDataPath, JSON.stringify(existingData, null, 2));
    
    // Notify clients to refresh data
    io.emit('dx-complete', { success: true, results });
    
    res.json({ success: true, results });
  } catch (error) {
    const errorMsg = error.message;
    io.emit('log', { type: 'error', message: `Error: ${errorMsg}` });
    io.emit('dx-complete', { success: false, error: errorMsg });
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// API: Get DX analytics
app.get('/api/dx/analytics', async (req, res) => {
  try {
    const dxDataPath = path.join(DATA_DIR, 'dx_data.json');
    const fileContent = await fs.readFile(dxDataPath, 'utf-8');
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

// API: Get detailed DX analytics from Excel files
app.get('/api/dx/detailed-analytics', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const dxFiles = files.filter(f => f.startsWith('DX_Not_Ready_') && f.endsWith('.xlsx'));
    
    const allOffices = [
      'Nightingale - Taunton',
      'Aspire - Dublin',
      'Aspire - San Diego',
      'Aspire - Scottsdale',
      'Aspire - Yuba City',
      'Nightingale - Las Vegas',
      'Nightingale - Minnetonka',
      'Nightingale - Pompano Beach',
      'Nightingale - Willowbrook'
    ];
    
    const detailedData = {
      byOffice: {},
      byDate: {},
      agingBuckets: {},
      rapRiskBuckets: {},
      referralSources: {},
      insurances: {},
      missingDxRecords: []
    };
    
    // Initialize all offices
    allOffices.forEach(office => {
      detailedData.byOffice[office] = {
        total: 0,
        missingDx: 0,
        percentMissingDx: 0,
        agingBuckets: {
          '0-2 days': 0,
          '3-7 days': 0,
          '8-14 days': 0,
          '15+ days': 0
        },
        rapRiskBuckets: {
          'Critical (0-3d)': 0,
          'High (4-7d)': 0,
          'Medium (8-14d)': 0,
          'Low (15+d)': 0
        },
        byDate: {}
      };
    });
    
    for (const file of dxFiles) {
      const filepath = path.join(DATA_DIR, file);
      const match = file.match(/DX_Not_Ready_(.+)_(\d{4}-\d{2}-\d{2})\.xlsx/);
      
      if (match) {
        const location = match[1].replace(/_/g, ' ');
        const date = match[2];
        
        try {
          const workbook = XLSX.readFile(filepath);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const allRows = XLSX.utils.sheet_to_json(sheet, { range: 1 });
          
          if (allRows.length === 0) continue;
          
          const headerRow = allRows[0];
          let records = allRows.slice(1);
          
          // Map column names - handle the actual Excel structure
          const colMap = {};
          Object.keys(headerRow).forEach(key => {
            const value = String(headerRow[key] || '').trim();
            if (value === 'Diagnosis' || value === 'Primary Diagnosis') colMap.diagnosis = key;
            else if (value === 'Days Until RAP Cancellation' || value === 'Days Left to File') colMap.rapDays = key;
            else if (value === 'Aging') colMap.aging = key;
            else if (value === 'Referral Source') colMap.referralSource = key;
            else if (value === 'Intake User') colMap.intakeUser = key;
            else if (value === 'Patient Name') colMap.patientName = key;
            else if (value === 'MRN') colMap.mrn = key;
            else if (value === 'Created Date' || value === 'Create Date' || value === 'Episode Start Date') colMap.createdDate = key;
            else if (value === 'Branch') colMap.branch = key;
            else if (value === 'Insurance') colMap.insurance = key;
            else if (value === 'Billing Period') colMap.billingPeriod = key;
          });
          
          // Debug: log column mapping
          console.log(`[DX] File: ${file}, Columns mapped:`, colMap);
          
          // Deduplicate records based on Patient Name + MRN
          const seen = new Set();
          const originalCount = records.length;
          records = records.filter(record => {
            const patientName = record[colMap.patientName] || '';
            const mrn = record[colMap.mrn] || '';
            const key = `${patientName}|${mrn}`;
            if (seen.has(key)) {
              return false; // Duplicate, skip
            }
            seen.add(key);
            return true;
          });
          const duplicatesRemoved = originalCount - records.length;
          if (duplicatesRemoved > 0) {
            console.log(`[DX] ${file}: Removed ${duplicatesRemoved} duplicate records`);
          }
          
          detailedData.byOffice[location].total += records.length;
          
          if (!detailedData.byDate[date]) {
            detailedData.byDate[date] = {};
            allOffices.forEach(office => {
              detailedData.byDate[date][office] = 0;
            });
          }
          
          records.forEach(record => {
            const diagnosis = record[colMap.diagnosis] || '';
            const isMissingDx = !diagnosis || diagnosis.toString().trim() === '';
            
            if (isMissingDx) {
              detailedData.byOffice[location].missingDx++;
              detailedData.byDate[date][location]++;
              
              // Aging buckets
              const aging = parseInt(record[colMap.aging]) || 0;
              if (aging <= 2) {
                detailedData.byOffice[location].agingBuckets['0-2 days']++;
                detailedData.agingBuckets['0-2 days'] = (detailedData.agingBuckets['0-2 days'] || 0) + 1;
              } else if (aging <= 7) {
                detailedData.byOffice[location].agingBuckets['3-7 days']++;
                detailedData.agingBuckets['3-7 days'] = (detailedData.agingBuckets['3-7 days'] || 0) + 1;
              } else if (aging <= 14) {
                detailedData.byOffice[location].agingBuckets['8-14 days']++;
                detailedData.agingBuckets['8-14 days'] = (detailedData.agingBuckets['8-14 days'] || 0) + 1;
              } else {
                detailedData.byOffice[location].agingBuckets['15+ days']++;
                detailedData.agingBuckets['15+ days'] = (detailedData.agingBuckets['15+ days'] || 0) + 1;
              }
              
              // RAP Risk buckets
              const rapDays = parseInt(record[colMap.rapDays]) || 0;
              if (rapDays <= 3) {
                detailedData.byOffice[location].rapRiskBuckets['Critical (0-3d)']++;
                detailedData.rapRiskBuckets['Critical (0-3d)'] = (detailedData.rapRiskBuckets['Critical (0-3d)'] || 0) + 1;
              } else if (rapDays <= 7) {
                detailedData.byOffice[location].rapRiskBuckets['High (4-7d)']++;
                detailedData.rapRiskBuckets['High (4-7d)'] = (detailedData.rapRiskBuckets['High (4-7d)'] || 0) + 1;
              } else if (rapDays <= 14) {
                detailedData.byOffice[location].rapRiskBuckets['Medium (8-14d)']++;
                detailedData.rapRiskBuckets['Medium (8-14d)'] = (detailedData.rapRiskBuckets['Medium (8-14d)'] || 0) + 1;
              } else {
                detailedData.byOffice[location].rapRiskBuckets['Low (15+d)']++;
                detailedData.rapRiskBuckets['Low (15+d)'] = (detailedData.rapRiskBuckets['Low (15+d)'] || 0) + 1;
              }
              
              // Referral sources
              const referralSource = record[colMap.referralSource] || 'Unknown';
              detailedData.referralSources[referralSource] = (detailedData.referralSources[referralSource] || 0) + 1;
              
              // Intake users
              const intakeUser = record[colMap.intakeUser] || 'Unknown';
              if (!detailedData.intakeUsers) detailedData.intakeUsers = {};
              detailedData.intakeUsers[intakeUser] = (detailedData.intakeUsers[intakeUser] || 0) + 1;
              
              // Insurance tracking
              const insurance = record[colMap.insurance] || '';
              if (insurance) {
                detailedData.insurances[insurance] = (detailedData.insurances[insurance] || 0) + 1;
              }
              
              // Store detail record with actual available columns
              detailedData.missingDxRecords.push({
                office: location,
                date: date,
                patientName: record[colMap.patientName] || '',
                mrn: record[colMap.mrn] || '',
                insurance: record[colMap.insurance] || '',
                episodeStart: record[colMap.createdDate] || '',
                billingPeriod: record[colMap.billingPeriod] || '',
                daysLeftToFile: record[colMap.rapDays] || '',
                referralSource: referralSource,
                intakeUser: intakeUser
              });
            }
          });
          
          // Calculate percentage
          if (detailedData.byOffice[location].total > 0) {
            detailedData.byOffice[location].percentMissingDx = 
              Math.round((detailedData.byOffice[location].missingDx / detailedData.byOffice[location].total) * 100);
          }
          
        } catch (e) {
          console.error(`Error parsing ${file}:`, e.message);
        }
      }
    }
    
    res.json(detailedData);
  } catch (error) {
    console.error('Error in DX detailed analytics:', error);
    res.json({
      byOffice: {},
      byDate: {},
      agingBuckets: {},
      rapRiskBuckets: {},
      referralSources: {},
      missingDxRecords: []
    });
  }
});

// API: Trigger Unbilled report download
app.post('/api/unbilled/download', async (req, res) => {
  try {
    downloadLogs = []; // Clear previous logs
    
    const UnbilledReportDownloader = (await import('./automation/unbilledDownloader.js')).default;
    const downloader = new UnbilledReportDownloader(io);
    const results = await downloader.run();
    
    // Store results in a JSON file
    const unbilledDataPath = path.join(DATA_DIR, 'unbilled_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(unbilledDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results - replace existing records for same date and office
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.office === newRecord.office && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        existingData[existingIndex] = newRecord;
      } else {
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(unbilledDataPath, JSON.stringify(existingData, null, 2));
    
    // Notify clients to refresh data
    io.emit('unbilled-complete', { success: true, results });
    
    res.json({ success: true, results });
  } catch (error) {
    const errorMsg = error.message;
    io.emit('log', { type: 'error', message: `Error: ${errorMsg}` });
    io.emit('unbilled-complete', { success: false, error: errorMsg });
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// API: Get Unbilled report analytics from JSON file
app.get('/api/unbilled/analytics', async (req, res) => {
  try {
    const unbilledDataPath = path.join(DATA_DIR, 'unbilled_data.json');
    const fileContent = await fs.readFile(unbilledDataPath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    const allOffices = [
      'Nightingale - Taunton',
      'Aspire - Dublin',
      'Aspire - San Diego',
      'Aspire - Scottsdale',
      'Aspire - Yuba City',
      'Nightingale - Las Vegas',
      'Nightingale - Minnetonka',
      'Nightingale - Pompano Beach',
      'Nightingale - Willowbrook'
    ];
    
    // Calculate aggregated statistics
    const analytics = {
      byOffice: {},
      byDate: {},
      byPayerType: {},
      agingSummary: {},
      totalUnbilled: 0,
      totalCharges: 0,
      totalVisits: 0
    };
    
    // Initialize all offices
    allOffices.forEach(office => {
      analytics.byOffice[office] = {
        totalUnbilled: 0,
        totalCharges: 0,
        totalVisits: 0,
        byDate: {}
      };
    });
    
    data.forEach(record => {
      const office = record.office;
      const date = record.date;
      const unbilled = parseFloat(record.totalUnbilled) || 0;
      const charges = parseFloat(record.totalCharges) || 0;
      const visits = parseInt(record.totalVisits) || 0;
      
      // By office
      if (analytics.byOffice[office]) {
        analytics.byOffice[office].totalUnbilled += unbilled;
        analytics.byOffice[office].totalCharges += charges;
        analytics.byOffice[office].totalVisits += visits;
        analytics.byOffice[office].byDate[date] = {
          totalUnbilled: unbilled,
          totalCharges: charges,
          totalVisits: visits
        };
      }
      
      // By date (all offices combined)
      if (!analytics.byDate[date]) {
        analytics.byDate[date] = {
          totalUnbilled: 0,
          totalCharges: 0,
          totalVisits: 0,
          byOffice: {}
        };
      }
      analytics.byDate[date].totalUnbilled += unbilled;
      analytics.byDate[date].totalCharges += charges;
      analytics.byDate[date].totalVisits += visits;
      analytics.byDate[date].byOffice[office] = {
        totalUnbilled: unbilled,
        totalCharges: charges,
        totalVisits: visits
      };
      
      // Aggregate payer types
      Object.entries(record.byPayerType || {}).forEach(([payer, amount]) => {
        analytics.byPayerType[payer] = (analytics.byPayerType[payer] || 0) + parseFloat(amount);
      });
      
      // Aggregate aging summary
      Object.entries(record.agingSummary || {}).forEach(([bucket, amount]) => {
        analytics.agingSummary[bucket] = (analytics.agingSummary[bucket] || 0) + parseFloat(amount);
      });
    });
    
    // Calculate latest totals (most recent date, all offices)
    const dates = Object.keys(analytics.byDate).sort();
    if (dates.length > 0) {
      const latestDate = dates[dates.length - 1];
      analytics.totalUnbilled = analytics.byDate[latestDate].totalUnbilled;
      analytics.totalCharges = analytics.byDate[latestDate].totalCharges;
      analytics.totalVisits = analytics.byDate[latestDate].totalVisits;
    }
    
    res.json(analytics);
  } catch (error) {
    console.error('Error in unbilled analytics:', error);
    res.json({
      byOffice: {},
      byDate: {},
      byPayerType: {},
      agingSummary: {},
      totalUnbilled: 0,
      totalCharges: 0,
      totalVisits: 0
    });
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

// API: Get detailed EOE analytics from Excel files
app.get('/api/eoe/detailed-analytics', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const eoeFiles = files.filter(f => f.startsWith('EOE_Not_Ready_') && f.endsWith('.xlsx'));
    
    const allOffices = [
      'Nightingale - Taunton',
      'Aspire - Dublin',
      'Aspire - San Diego',
      'Aspire - Scottsdale',
      'Aspire - Yuba City',
      'Nightingale - Las Vegas',
      'Nightingale - Minnetonka',
      'Nightingale - Pompano Beach',
      'Nightingale - Willowbrook'
    ];
    
    const detailedData = {
      byOffice: {},
      byDate: {},
      rootCauses: {},
      riskBuckets: {},
      byInsurance: {}  // Add insurance tracking
    };
    
    // Initialize all offices with zero data
    allOffices.forEach(office => {
      detailedData.byOffice[office] = {
        total: 0,
        rootCauses: {
          'Missing Orders': 0,
          'Missing F2F': 0,
          'RAP Issues': 0,
          'PCR Tracking Missing': 0,
          'Service Date Mismatch': 0,
          'Medicare Missing': 0
        },
        riskBuckets: {
          'Critical': 0,
          'High': 0,
          'Medium': 0,
          'Low': 0
        },
        byDate: {}
      };
    });
    
    for (const file of eoeFiles) {
      const filepath = path.join(DATA_DIR, file);
      const match = file.match(/EOE_Not_Ready_(.+)_(\d{4}-\d{2}-\d{2})\.xlsx/);
      
      if (match) {
        const location = match[1].replace(/_/g, ' ');
        const date = match[2];
        
        try {
          const workbook = XLSX.readFile(filepath);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          
          // Skip first row (title), read from row 2 onwards
          const allRows = XLSX.utils.sheet_to_json(sheet, { range: 1 });
          
          if (allRows.length === 0) continue;
          
          // First row after skip is the header row
          const headerRow = allRows[0];
          const records = allRows.slice(1); // Actual data rows
          
          // Map the column names
          const colMap = {};
          Object.keys(headerRow).forEach(key => {
            const value = headerRow[key];
            if (value === 'Orders') colMap.orders = key;
            else if (value === 'F2F') colMap.f2f = key;
            else if (value === 'RAP Status') colMap.rapStatus = key;
            else if (value === 'PCR Tracking #') colMap.pcrTracking = key;
            else if (value === 'Same Service Date Match') colMap.serviceDate = key;
            else if (value === 'Medicare #') colMap.medicare = key;
            else if (value === 'Days Until RAP Cancellation') colMap.daysPending = key;
            else if (value === 'Insurance') colMap.insurance = key;  // Add insurance column
          });
          
          if (!detailedData.byOffice[location]) {
            detailedData.byOffice[location] = {
              total: 0,
              rootCauses: {
                'Missing Orders': 0,
                'Missing F2F': 0,
                'RAP Issues': 0,
                'PCR Tracking Missing': 0,
                'Service Date Mismatch': 0,
                'Medicare Missing': 0
              },
              riskBuckets: {
                'Critical': 0,
                'High': 0,
                'Medium': 0,
                'Low': 0
              },
              byDate: {}
            };
          }
          
          if (!detailedData.byOffice[location].byDate[date]) {
            detailedData.byOffice[location].byDate[date] = 0;
          }
          
          detailedData.byOffice[location].total += records.length;
          detailedData.byOffice[location].byDate[date] += records.length;
          
          if (!detailedData.byDate[date]) {
            detailedData.byDate[date] = {};
            allOffices.forEach(office => {
              detailedData.byDate[date][office] = 0;
            });
          }
          detailedData.byDate[date][location] = (detailedData.byDate[date][location] || 0) + records.length;
          
          // Process each record for root causes and risk buckets
          records.forEach((record, idx) => {
            // Track insurance
            const insurance = record[colMap.insurance] || 'Private';
            if (!detailedData.byInsurance[insurance]) {
              detailedData.byInsurance[insurance] = 0;
            }
            detailedData.byInsurance[insurance]++;
            
            // Check what's missing (empty or no checkmark)
            // If the cell is empty or doesn't have a checkmark, it's missing
            const hasOrders = record[colMap.orders] && (record[colMap.orders] === '✔' || record[colMap.orders] === 'X');
            const hasF2F = record[colMap.f2f] && (record[colMap.f2f] === '✔' || record[colMap.f2f] === 'X');
            const hasRAPStatus = record[colMap.rapStatus] && record[colMap.rapStatus].toString().trim() !== '';
            const hasPCRTracking = record[colMap.pcrTracking] && (record[colMap.pcrTracking] === '✔' || record[colMap.pcrTracking] === 'X');
            const hasServiceDateMatch = record[colMap.serviceDate] && (record[colMap.serviceDate] === '✔' || record[colMap.serviceDate] === 'X');
            const hasMedicare = record[colMap.medicare] && (record[colMap.medicare] === '✔' || record[colMap.medicare] === 'X');
            
            // Debug first record
            if (idx === 0) {
              console.log(`[DEBUG] ${location} - First record analysis:`);
              console.log(`  Orders: "${record[colMap.orders]}" -> has: ${hasOrders}`);
              console.log(`  F2F: "${record[colMap.f2f]}" -> has: ${hasF2F}`);
              console.log(`  RAP Status: "${record[colMap.rapStatus]}" -> has: ${hasRAPStatus}`);
              console.log(`  PCR Tracking: "${record[colMap.pcrTracking]}" -> has: ${hasPCRTracking}`);
              console.log(`  Service Date: "${record[colMap.serviceDate]}" -> has: ${hasServiceDateMatch}`);
              console.log(`  Medicare: "${record[colMap.medicare]}" -> has: ${hasMedicare}`);
            }
            
            // Determine root cause based on what's missing
            if (!hasOrders) {
              detailedData.byOffice[location].rootCauses['Missing Orders']++;
              detailedData.rootCauses['Missing Orders'] = (detailedData.rootCauses['Missing Orders'] || 0) + 1;
            }
            if (!hasF2F) {
              detailedData.byOffice[location].rootCauses['Missing F2F']++;
              detailedData.rootCauses['Missing F2F'] = (detailedData.rootCauses['Missing F2F'] || 0) + 1;
            }
            if (!hasRAPStatus) {
              detailedData.byOffice[location].rootCauses['RAP Issues']++;
              detailedData.rootCauses['RAP Issues'] = (detailedData.rootCauses['RAP Issues'] || 0) + 1;
            }
            if (!hasPCRTracking) {
              detailedData.byOffice[location].rootCauses['PCR Tracking Missing']++;
              detailedData.rootCauses['PCR Tracking Missing'] = (detailedData.rootCauses['PCR Tracking Missing'] || 0) + 1;
            }
            if (!hasServiceDateMatch) {
              detailedData.byOffice[location].rootCauses['Service Date Mismatch']++;
              detailedData.rootCauses['Service Date Mismatch'] = (detailedData.rootCauses['Service Date Mismatch'] || 0) + 1;
            }
            if (!hasMedicare) {
              detailedData.byOffice[location].rootCauses['Medicare Missing']++;
              detailedData.rootCauses['Medicare Missing'] = (detailedData.rootCauses['Medicare Missing'] || 0) + 1;
            }
            
            // Determine risk bucket based on days pending
            const daysPendingStr = record[colMap.daysPending] || '';
            const daysPending = parseInt(daysPendingStr) || 0;
            
            if (daysPending <= 3) {
              detailedData.byOffice[location].riskBuckets['Critical']++;
              detailedData.riskBuckets['Critical'] = (detailedData.riskBuckets['Critical'] || 0) + 1;
            } else if (daysPending <= 7) {
              detailedData.byOffice[location].riskBuckets['High']++;
              detailedData.riskBuckets['High'] = (detailedData.riskBuckets['High'] || 0) + 1;
            } else if (daysPending <= 14) {
              detailedData.byOffice[location].riskBuckets['Medium']++;
              detailedData.riskBuckets['Medium'] = (detailedData.riskBuckets['Medium'] || 0) + 1;
            } else {
              detailedData.byOffice[location].riskBuckets['Low']++;
              detailedData.riskBuckets['Low'] = (detailedData.riskBuckets['Low'] || 0) + 1;
            }
          });
        } catch (e) {
          console.error(`Error parsing ${file}:`, e.message);
        }
      }
    }
    
    res.json(detailedData);
  } catch (error) {
    console.error('Error in detailed analytics:', error);
    res.json({
      byOffice: {},
      byDate: {},
      rootCauses: {},
      riskBuckets: {},
      byInsurance: {}
    });
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
    
    // Clean up data older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    existingData = existingData.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate >= sevenDaysAgo;
    });
    
    console.log(`🗑️  Cleaned up deviation data: keeping records from ${sevenDaysAgo.toISOString().split('T')[0]} onwards`);
    
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

// Cleanup old data files (older than 15 days) - runs daily at midnight UTC
cron.schedule('0 0 * * *', async () => {
  console.log('🗑️  Running daily cleanup of old data files (>15 days)...');
  
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  
  try {
    const files = await fs.readdir(DATA_DIR);
    let deletedCount = 0;
    
    for (const file of files) {
      // Skip non-data files
      if (file === '.gitkeep' || file === '.DS_Store') continue;
      
      const filepath = path.join(DATA_DIR, file);
      const stats = await fs.stat(filepath);
      
      // Skip directories
      if (stats.isDirectory()) continue;
      
      // Check if file has a date in its name
      const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
      
      if (dateMatch) {
        const fileDate = new Date(dateMatch[1]);
        if (fileDate < fifteenDaysAgo) {
          await fs.unlink(filepath);
          console.log(`   🗑️  Deleted: ${file}`);
          deletedCount++;
        }
      } else if (file.endsWith('.png')) {
        // Delete screenshots older than 15 days based on file modification time
        if (stats.mtime < fifteenDaysAgo) {
          await fs.unlink(filepath);
          console.log(`   🗑️  Deleted screenshot: ${file}`);
          deletedCount++;
        }
      }
    }
    
    // Also clean up JSON data files (keep only last 15 days of records)
    const jsonFiles = ['deviation_data.json', 'eoe_data.json', 'dx_data.json', 'unbilled_data.json'];
    
    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(DATA_DIR, jsonFile);
      try {
        const content = await fs.readFile(jsonPath, 'utf-8');
        const data = JSON.parse(content);
        
        if (Array.isArray(data)) {
          const filtered = data.filter(record => {
            const recordDate = new Date(record.date);
            return recordDate >= fifteenDaysAgo;
          });
          
          if (filtered.length < data.length) {
            await fs.writeFile(jsonPath, JSON.stringify(filtered, null, 2));
            console.log(`   🗑️  ${jsonFile}: removed ${data.length - filtered.length} old records`);
            deletedCount += (data.length - filtered.length);
          }
        }
      } catch (e) {
        // File doesn't exist or isn't valid JSON, skip
      }
    }
    
    console.log(`✅ Cleanup complete: removed ${deletedCount} old items`);
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
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

// Schedule automatic DX reports
const dxSchedule = process.env.DX_SCHEDULE || '0 9 * * *';
console.log(`🩺 Scheduled DX reports: ${dxSchedule} (Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

cron.schedule(dxSchedule, async () => {
  console.log('⏰ Running scheduled DX report...');
  try {
    const DXReportDownloader = (await import('./automation/dxDownloader.js')).default;
    const downloader = new DXReportDownloader(io);
    const results = await downloader.run();
    
    // Store results
    const dxDataPath = path.join(DATA_DIR, 'dx_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(dxDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.location === newRecord.location && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        existingData[existingIndex] = newRecord;
      } else {
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(dxDataPath, JSON.stringify(existingData, null, 2));
    
    io.emit('dx-complete', { success: true, results });
    console.log('✅ Scheduled DX report completed successfully');
  } catch (error) {
    console.error('❌ Scheduled DX report failed:', error.message);
    io.emit('log', { type: 'error', message: `Scheduled DX report failed: ${error.message}` });
    io.emit('dx-complete', { success: false, error: error.message });
  }
});

// Schedule automatic Unbilled reports - 3:30 PM IST = 10:00 AM UTC
const unbilledSchedule = process.env.UNBILLED_SCHEDULE || '0 10 * * *';
console.log(`💰 Scheduled Unbilled reports: ${unbilledSchedule} (Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

cron.schedule(unbilledSchedule, async () => {
  console.log('⏰ Running scheduled Unbilled report...');
  try {
    const UnbilledReportDownloader = (await import('./automation/unbilledDownloader.js')).default;
    const downloader = new UnbilledReportDownloader(io);
    const results = await downloader.run();
    
    // Store results
    const unbilledDataPath = path.join(DATA_DIR, 'unbilled_data.json');
    let existingData = [];
    try {
      const fileContent = await fs.readFile(unbilledDataPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (e) {
      // File doesn't exist yet
    }
    
    // Update or add new results
    results.forEach(newRecord => {
      const existingIndex = existingData.findIndex(
        record => record.office === newRecord.office && record.date === newRecord.date
      );
      
      if (existingIndex !== -1) {
        existingData[existingIndex] = newRecord;
      } else {
        existingData.push(newRecord);
      }
    });
    
    await fs.writeFile(unbilledDataPath, JSON.stringify(existingData, null, 2));
    
    io.emit('unbilled-complete', { success: true, results });
    console.log('✅ Scheduled Unbilled report completed successfully');
  } catch (error) {
    console.error('❌ Scheduled Unbilled report failed:', error.message);
    io.emit('log', { type: 'error', message: `Scheduled Unbilled report failed: ${error.message}` });
    io.emit('unbilled-complete', { success: false, error: error.message });
  }
});

