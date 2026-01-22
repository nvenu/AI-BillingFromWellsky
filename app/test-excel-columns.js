import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// Get first EOE file
const files = fs.readdirSync(DATA_DIR);
const eoeFile = files.find(f => f.startsWith('EOE_Not_Ready_') && f.endsWith('.xlsx'));

if (!eoeFile) {
  console.log('No EOE files found');
  process.exit(1);
}

console.log(`Reading file: ${eoeFile}\n`);

const filepath = path.join(DATA_DIR, eoeFile);
const workbook = XLSX.readFile(filepath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];

// Skip first row (title), read from row 2 onwards
const allRows = XLSX.utils.sheet_to_json(sheet, { range: 1 });

console.log(`Total rows (including header): ${allRows.length}\n`);

if (allRows.length === 0) {
  console.log('No data found');
  process.exit(0);
}

// First row after skip is the header row
const headerRow = allRows[0];
const records = allRows.slice(1); // Actual data rows

console.log('Header row:');
console.log(JSON.stringify(headerRow, null, 2));

console.log(`\nData records: ${records.length}\n`);

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
});

console.log('Column mapping:');
console.log(JSON.stringify(colMap, null, 2));

console.log('\nFirst data record:');
console.log(JSON.stringify(records[0], null, 2));

console.log('\nAnalyzing first record:');
const record = records[0];
console.log(`Orders: "${record[colMap.orders]}" - Has checkmark: ${record[colMap.orders] === '✔'}`);
console.log(`F2F: "${record[colMap.f2f]}" - Has checkmark: ${record[colMap.f2f] === '✔'}`);
console.log(`RAP Status: "${record[colMap.rapStatus]}" - Has value: ${record[colMap.rapStatus] && record[colMap.rapStatus].toString().trim() !== ''}`);
console.log(`PCR Tracking: "${record[colMap.pcrTracking]}" - Has checkmark: ${record[colMap.pcrTracking] === '✔'}`);
console.log(`Service Date: "${record[colMap.serviceDate]}" - Has checkmark: ${record[colMap.serviceDate] === '✔'}`);
console.log(`Medicare: "${record[colMap.medicare]}" - Has checkmark: ${record[colMap.medicare] === '✔'}`);
console.log(`Days Pending: "${record[colMap.daysPending]}" - Parsed: ${parseInt(record[colMap.daysPending]) || 0}`);


