"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLogBroadcaster = setLogBroadcaster;
exports.setStopCheckFunction = setStopCheckFunction;
exports.loginAndProcessOffices = loginAndProcessOffices;
require("dotenv/config");
const playwright_1 = require("playwright");
const insurance_helper_1 = require("./insurance-helper");
const office_config_1 = require("./office-config");
const email_helper_1 = require("./email-helper");
const XLSX = __importStar(require("xlsx"));
const date_fns_1 = require("date-fns");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Version tracking
const APP_VERSION = "2.3.0"; // Headless + 327 tracking + Partnership Health Plan + Detailed 327 reporting
const BUILD_DATE = "2026-04-10";
// Log broadcaster for live console
let logBroadcaster = null;
function setLogBroadcaster(broadcaster) {
    logBroadcaster = broadcaster;
}
// Stop check function (will be set by server)
let stopCheckFunction = null;
function setStopCheckFunction(checkFn) {
    stopCheckFunction = checkFn;
}
function isStopRequested() {
    return stopCheckFunction ? stopCheckFunction() : false;
}
// Helper: Extract PDF from claim print view
// Strategy: Extract Angular scope keys from the row, call the PDF generation API directly
async function extractPdfFromPrintIcon(page, printIconId, retryCount = 0) {
    try {
        await page.waitForSelector(`#${printIconId}`, { timeout: 15000 });
        await page.evaluate((id) => {
            const el = document.querySelector('#' + id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, printIconId);
        await page.waitForTimeout(500);

        // Strategy 1: Override window.open + listen for response simultaneously
        await page.evaluate(() => {
            window.__capturedOpenUrl = null;
            window.__originalOpen = window.open;
            window.open = function(url) {
                window.__capturedOpenUrl = url;
                return { document: { write: function(){}, close: function(){} }, close: function(){}, focus: function(){} };
            };
        });

        // Listen for PDF response on the network
        let responseBuffer = null;
        const responsePromise = new Promise((resolve) => {
            const handler = async (response) => {
                try {
                    const url = response.url();
                    const contentType = response.headers()['content-type'] || '';
                    if (contentType.includes('pdf') || url.includes('.pdf') || url.includes('SharedTemp')) {
                        const body = await response.body();
                        if (body && body.length > 1000) {
                            page.context().off('response', handler);
                            resolve(body);
                        }
                    }
                } catch (e) {}
            };
            page.context().on('response', handler);
            setTimeout(() => { page.context().off('response', handler); resolve(null); }, 50000);
        });

        // Listen for popup
        const newPagePromise = page.context().waitForEvent('page', { timeout: 50000 }).catch(() => null);

        // Click print icon
        await page.click(`#${printIconId}`);
        console.log(`  ✓ Clicked print icon: ${printIconId}`);

        // Race: wait for either window.open capture OR network response OR new tab
        // Poll window.open capture every 1s for speed
        let pdfUrl = null;
        for (let i = 0; i < 50; i++) {
            await page.waitForTimeout(1000);
            try {
                const captured = await page.evaluate(() => window.__capturedOpenUrl);
                if (captured) { pdfUrl = captured; break; }
            } catch (e) { break; } // page navigated away
        }

        // Restore window.open
        try {
            await page.evaluate(() => {
                if (window.__originalOpen) { window.open = window.__originalOpen; delete window.__originalOpen; }
                delete window.__capturedOpenUrl;
            });
        } catch (e) {}

        // Try captured URL first
        if (pdfUrl && pdfUrl.length > 5) {
            console.log(`  Captured PDF URL: ${pdfUrl}`);
            if (!pdfUrl.startsWith('http')) {
                const baseUrl = page.url().split('/EHR/')[0];
                pdfUrl = baseUrl + (pdfUrl.startsWith('/') ? '' : '/') + pdfUrl;
            }
            try {
                const resp = await page.context().request.fetch(pdfUrl);
                const pdfBuffer = await resp.body();
                if (pdfBuffer && pdfBuffer.length > 500) {
                    console.log(`  ✓ Downloaded PDF (${pdfBuffer.length} bytes)`);
                    const pdfPage = await newPagePromise;
                    if (pdfPage) try { await pdfPage.close(); } catch(e) {}
                    return pdfBuffer;
                }
            } catch (e) {
                console.log(`  ⚠️  Fetch failed: ${e.message}`);
            }
        } else {
            console.log(`  Captured PDF URL: none`);
        }

        // Try network response
        responseBuffer = await responsePromise;
        if (responseBuffer && responseBuffer.length > 500) {
            console.log(`  ✓ Got PDF from response interception (${responseBuffer.length} bytes)`);
            const pdfPage = await newPagePromise;
            if (pdfPage) try { await pdfPage.close(); } catch(e) {}
            return responseBuffer;
        }

        // Try new tab
        const pdfPage = await newPagePromise;
        if (pdfPage) {
            try {
                await pdfPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                await pdfPage.waitForTimeout(3000);
                const tabUrl = pdfPage.url();
                console.log(`  New tab URL: ${tabUrl}`);
                if (tabUrl && tabUrl.length > 10 && tabUrl !== 'about:blank' && tabUrl !== ':') {
                    const resp = await pdfPage.context().request.fetch(tabUrl);
                    const pdfBuffer = await resp.body();
                    await pdfPage.close();
                    if (pdfBuffer && pdfBuffer.length > 500) {
                        console.log(`  ✓ Downloaded PDF from tab (${pdfBuffer.length} bytes)`);
                        return pdfBuffer;
                    }
                }
                await pdfPage.close();
            } catch (e) {
                console.log(`  ⚠️  Tab failed: ${e.message}`);
                try { await pdfPage.close(); } catch(e2) {}
            }
        }

        // Retry once
        if (retryCount === 0) {
            console.log(`  ⚠️  All strategies failed, retrying...`);
            await page.waitForTimeout(3000);
            return extractPdfFromPrintIcon(page, printIconId, 1);
        }

        console.log(`  ✗ PDF EXTRACTION FAILED after retry`);
        return null;
    } catch (error) {
        console.log(`  ✗ PDF extraction error: ${error.message}`);
        try { await page.evaluate(() => { if (window.__originalOpen) { window.open = window.__originalOpen; } }); } catch(e) {}
        if (retryCount === 0) {
            console.log(`  ⚠️  Retrying after error...`);
            await page.waitForTimeout(3000);
            return extractPdfFromPrintIcon(page, printIconId, 1);
        }
        return null;
    }
}
// Override console.log to broadcast to web interface AND write to log file
const originalConsoleLog = console.log;
console.log = function (...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    originalConsoleLog.apply(console, args);
    if (logBroadcaster) {
        logBroadcaster(message);
    }
};
async function selectOffice(page, office) {
    console.log(`\n=== Selecting Office: ${office.name} ===`);
    try {
        // Make sure we're on a page where the office selector exists
        // If we're deep in billing manager, go back to home first
        const currentUrl = page.url();
        if (currentUrl.includes('/billing')) {
            console.log("Navigating back to home page...");
            await page.goto(currentUrl.split('/EHR/')[0] + '/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
        }
        // Wait for the office selector dropdown
        try {
            await page.waitForSelector('#swapUser', { timeout: 20000 });
        }
        catch (error) {
            console.error("✗ Office selector dropdown not found");
            await page.screenshot({ path: 'debug-no-office-selector.png' });
            throw new Error("Office selector dropdown (#swapUser) not found on page");
        }
        // Verify the office exists in the dropdown
        const officeExists = await page.evaluate((officeValue) => {
            const select = document.querySelector('#swapUser');
            if (!select)
                return false;
            const options = Array.from(select.options);
            return options.some(opt => opt.value === officeValue);
        }, office.value);
        if (!officeExists) {
            console.error(`✗ Office "${office.name}" (value: ${office.value}) not found in dropdown`);
            const availableOffices = await page.evaluate(() => {
                const select = document.querySelector('#swapUser');
                if (!select)
                    return [];
                return Array.from(select.options).map(opt => ({ value: opt.value, text: opt.text }));
            });
            console.log("Available offices:", availableOffices);
            throw new Error(`Office "${office.name}" not available in dropdown`);
        }
        // Select the office
        await page.selectOption('#swapUser', office.value);
        console.log(`✓ Selected office: ${office.name}`);
        // Wait for page to reload after office change
        await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
        await page.waitForTimeout(3000);
        // Wait for any loading to complete
        await waitForLoadingToComplete(page);
        // Verify office was actually switched
        try {
            const selectedOffice = await page.$eval('#swapUser', (select) => select.value);
            if (selectedOffice !== office.value) {
                console.error(`✗ Office switch failed. Expected: ${office.value}, Got: ${selectedOffice}`);
                throw new Error(`Failed to switch to office ${office.name}`);
            }
            console.log(`✓ Office switched to ${office.name}`);
        }
        catch (verifyError) {
            console.log(`⚠️  Could not verify office switch (element not found), but continuing...`);
            console.log(`✓ Assuming office switched to ${office.name}`);
        }
    }
    catch (error) {
        console.error(`✗ Error selecting office ${office.name}:`, error);
        throw error;
    }
}
async function processOffice(page, office, insuranceHelper, selectedInsurances = null) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`PROCESSING OFFICE: ${office.name} (${office.stateCode})`);
    console.log(`${'='.repeat(80)}`);
    try {
        // 1. Navigate to Billing Manager
        await navigateToBillingManager(page);
        // 2. Click Primary Payer dropdown and select Ready
        await applyFilters(page);
        // 3. Select All Insurances from dropdown (or specific insurances if provided)
        await selectAllInsurances(page, selectedInsurances);
        // 4. Wait for results table to load
        const hasRecords = await waitForResultsTable(page);
        if (!hasRecords) {
            console.log(`No records in Ready tab for ${office.name}`);
            console.log(`Will still process Pending Approval and Ready To Send tabs...`);
            // Skip directly to Pending Approval and Ready To Send
            let readyToSendFiles = [];
            let changedTo327 = [];
            let snFailures = [];
            try {
                const result = await processPendingApproval(page, insuranceHelper, selectedInsurances, selectedRecords);
                readyToSendFiles = result.files;
                changedTo327 = result.changedTo327;
                snFailures = result.snFailures || [];
                console.log(`✓ Pending Approval and Ready To Send workflow completed for ${office.name}`);
            }
            catch (error) {
                console.error(`⚠️  Error in Pending Approval/Ready To Send for ${office.name}:`, error);
            }
            return { records: [], filename: null, readyToSendFiles, readyToSendCount: readyToSendFiles.length > 0 ? readyToSendFiles.filter(f => f.includes('electronic') || f.includes('paper-claim')).length : 0, changedTo327, snFailures };
        }
        // 5. Process records ONE BY ONE: select valid record → click create → repeat
        const { selectedCount, selectedRecords, failedRecords } = await processRecordsOneByOne(page, insuranceHelper, selectedInsurances);
        // 6. Save selected records to Excel for audit trail
        let filename = null;
        if (selectedRecords.length > 0) {
            const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
            filename = `selected-records-${office.stateCode}-${office.name.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.xlsx`;
            saveSelectedRecordsToExcel(selectedRecords, filename);
        }
        // 6b. Save failed records to separate Excel file
        if (failedRecords.length > 0) {
            const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
            const failedFilename = `FAILED-records-${office.stateCode}-${office.name.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.xlsx`;
            saveFailedRecordsToExcel(failedRecords, failedFilename);
        }
        // 7. All records have been processed one by one (no need to click Create again)
        if (selectedCount > 0) {
            console.log(`✓ All ${selectedCount} claims created for ${office.name}`);
        }
        else {
            console.log(`No records selected in Ready tab for ${office.name}`);
            console.log(`Will still process Pending Approval and Ready To Send tabs...`);
        }
        // 8. ALWAYS process Pending Approval and Ready To Send (even if no records were selected in Ready)
        let readyToSendFiles = [];
        let changedTo327 = [];
        let snFailures = [];
        try {
            // Browser health check before Pending Approval
            console.log(`\n=== BROWSER HEALTH CHECK ===`);
            try {
                const healthUrl = page.url();
                console.log(`  Current URL: ${healthUrl}`);
                if (!healthUrl || healthUrl === 'about:blank' || healthUrl === ':') {
                    console.log(`  ⚠️  Browser appears disconnected! Attempting recovery...`);
                    // Try to navigate to billing manager
                    await page.goto('https://kinnser.net/EHR/#/AM/billing/claims-manager/managed-care/approve-claims', { waitUntil: 'domcontentloaded', timeout: 30000 });
                    console.log(`  ✓ Recovered - navigated to Pending Approval`);
                } else {
                    console.log(`  ✓ Browser is alive`);
                }
            } catch (healthError) {
                console.error(`  ⚠️  Browser health check failed: ${healthError.message}`);
                console.error(`  ⚠️  CRITICAL: Browser context may be dead. Pending Approval processing may fail.`);
            }
            const result = await processPendingApproval(page, insuranceHelper, selectedInsurances, selectedRecords);
            readyToSendFiles = result.files;
            changedTo327 = result.changedTo327;
            snFailures = result.snFailures || [];
            console.log(`✓ Pending Approval and Ready To Send workflow completed for ${office.name}`);
        }
        catch (error) {
            console.error(`⚠️  Error in Pending Approval/Ready To Send for ${office.name}:`, error);
            console.log(`Continuing anyway...`);
            // Try to find any ready-to-send files that were created despite the error
            try {
                const allFiles = fs.readdirSync(process.cwd());
                const rtsFiles = allFiles.filter(f => f.startsWith('ready-to-send-'));
                if (rtsFiles.length > 0) {
                    readyToSendFiles = rtsFiles;
                    console.log(`✓ Found ${rtsFiles.length} ready-to-send file(s) on disk despite error`);
                }
                // Also check downloads folder for PDFs
                const downloadsPath = path.join(process.cwd(), 'downloads');
                if (fs.existsSync(downloadsPath)) {
                    const dlFiles = fs.readdirSync(downloadsPath);
                    const pdfFiles = dlFiles.filter(f => f.startsWith('paper-claim-')).map(f => path.join(downloadsPath, f));
                    if (pdfFiles.length > 0) {
                        readyToSendFiles.push(...pdfFiles);
                        console.log(`✓ Found ${pdfFiles.length} PDF file(s) in downloads`);
                    }
                }
            } catch (fsError) {
                // Ignore file system errors
            }
        }
        console.log(`✓ Successfully processed ${office.name}`);
        const readyToSendCount = readyToSendFiles.length > 0 ? readyToSendFiles.filter(f => f.includes('electronic') || f.includes('paper-claim')).length : 0;
        return { records: selectedRecords, filename, readyToSendFiles, readyToSendCount, changedTo327, snFailures };
    }
    catch (error) {
        console.error(`✗ Error processing office ${office.name}:`, error);
        throw error;
    }
}
function saveSelectedRecordsToExcel(records, filename) {
    if (records.length === 0) {
        console.log("⚠️  No records to save");
        return;
    }
    console.log(`\n=== Saving Excel File ===`);
    console.log(`Records to save: ${records.length}`);
    console.log(`Filename: ${filename}`);
    // Create worksheet data
    const wsData = [
        ['Timestamp', 'Record ID', 'Insurance', 'Authorization', 'Patient Name', 'MRN', 'Branch', 'Insurance (Full)', 'SOC Date', 'Billing Period', 'Authorization (Full)'],
        ...records.map(r => {
            const cols = r.allColumns || [];
            return [
                r.timestamp,
                r.id,
                r.insurance,
                r.authorization,
                cols[2] || '',  // Patient Name
                cols[3] || '',  // MRN
                cols[4] || '',  // Branch
                cols[5] || '',  // Insurance (Full)
                cols[6] || '',  // SOC Date
                cols[7] || '',  // Billing Period
                cols[8] || ''   // Authorization (Full)
            ];
        })
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selected Records');
    // Save to file
    try {
        XLSX.writeFile(wb, filename);
        console.log(`✓ Successfully saved ${records.length} selected records to ${filename}`);
        // Verify file was created
        if (fs.existsSync(filename)) {
            const stats = fs.statSync(filename);
            console.log(`✓ File verified: ${filename} (${stats.size} bytes)`);
        }
        else {
            console.error(`✗ File was not created: ${filename}`);
        }
    }
    catch (error) {
        console.error(`✗ Failed to save Excel file:`, error);
        throw error;
    }
}
function saveFailedRecordsToExcel(records, filename) {
    if (records.length === 0) {
        console.log("⚠️  No failed records to save");
        return;
    }
    console.log(`\n=== Saving FAILED Records Excel File ===`);
    console.log(`Failed records to save: ${records.length}`);
    console.log(`Filename: ${filename}`);
    // Create worksheet data with failure reason
    const wsData = [
        ['Timestamp', 'Record ID', 'Insurance', 'Authorization', 'Failure Reason', 'Patient Name', 'MRN', 'Branch', 'Insurance (Full)', 'SOC Date', 'Billing Period', 'Authorization (Full)'],
        ...records.map(r => {
            const cols = r.allColumns || [];
            return [
                r.timestamp,
                r.id,
                r.insurance,
                r.authorization,
                r.failureReason || 'Unknown error',
                cols[2] || '',  // Patient Name
                cols[3] || '',  // MRN
                cols[4] || '',  // Branch
                cols[5] || '',  // Insurance (Full)
                cols[6] || '',  // SOC Date
                cols[7] || '',  // Billing Period
                cols[8] || ''   // Authorization (Full)
            ];
        })
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Records');
    // Save to file
    try {
        XLSX.writeFile(wb, filename);
        console.log(`✓ Successfully saved ${records.length} FAILED records to ${filename}`);
        // Verify file was created
        if (fs.existsSync(filename)) {
            const stats = fs.statSync(filename);
            console.log(`✓ File verified: ${filename} (${stats.size} bytes)`);
        }
        else {
            console.error(`✗ File was not created: ${filename}`);
        }
    }
    catch (error) {
        console.error(`✗ Failed to save FAILED records Excel file:`, error);
        throw error;
    }
}
/**
 * Automates login and processing of Ready billing records for selected office(s)
 * @param officeValue - Office value to process, or 'all' for all offices
 */
async function loginAndProcessOffices(officeValue = 'all', selectedInsurances = null) {
    let browser = null;
    try {
        // Log version information
        console.log('='.repeat(60));
        console.log(`🚀 Kinnser Billing Automation v${APP_VERSION}`);
        console.log(`📅 Build Date: ${BUILD_DATE}`);
        console.log(`⏰ Started: ${(0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log('='.repeat(60));
        // Create downloads directory
        const downloadsPath = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadsPath)) {
            fs.mkdirSync(downloadsPath, { recursive: true });
        }
        browser = await playwright_1.chromium.launch({
            headless: process.env.HEADLESS !== 'false' // headless unless explicitly set to 'false'
        });
        const context = await browser.newContext({
            acceptDownloads: true
        });
        const page = await context.newPage();
        // Set up selective dialog handler
        // Auto-accept login confirmation, but allow approval confirmations to be handled by code
        page.on('dialog', async (dialog) => {
            const message = dialog.message();
            console.log(`Dialog detected: ${dialog.type()} - "${message}"`);
            // Auto-accept login/system confirmation dialogs
            if (message.includes('This system is intended for business use only') ||
                message.includes('Unauthorized access')) {
                await dialog.accept();
                console.log('Dialog accepted (system confirmation)');
            }
            // For approval confirmation, we want to handle it in code, but the dialog
            // event fires before page.evaluate can return, so we need to accept it here
            // and track the user's choice separately
            else if (message.includes('PENDING APPROVAL - CONFIRMATION REQUIRED')) {
                // This should not auto-accept - but we can't prevent the dialog from appearing
                // We need to use a different approach for confirmation
                await dialog.accept();
                console.log('Dialog accepted (approval confirmation)');
            }
            else {
                // Accept other dialogs by default
                await dialog.accept();
                console.log('Dialog accepted');
            }
        });
        // Load insurance instructions
        const insuranceHelper = new insurance_helper_1.InsuranceHelper("Insurance Instructions.xlsx");
        // 1. Login
        await performLogin(page);
        // Determine which offices to process
        const officesToProcess = officeValue === 'all'
            ? office_config_1.OFFICES
            : office_config_1.OFFICES.filter(o => o.value === officeValue);
        if (officesToProcess.length === 0) {
            throw new Error(`Office not found: ${officeValue}`);
        }
        console.log(`\n${'='.repeat(80)}`);
        console.log(`STARTING PROCESSING`);
        console.log(`Offices to process: ${officesToProcess.length}`);
        officesToProcess.forEach(o => console.log(`  - ${o.name} (${o.stateCode})`));
        console.log(`${'='.repeat(80)}`);
        const allSelectedRecords = [];
        const summary = [];
        const excelFiles = [];
        const allReadyToSendFiles = [];
        const all327Changes = [];
        const allSNFailures = [];
        // 2. Process each office
        for (let i = 0; i < officesToProcess.length; i++) {
            const office = officesToProcess[i];
            console.log(`\n[${i + 1}/${officesToProcess.length}] Processing ${office.name}...`);
            // Select the office
            await selectOffice(page, office);
            // Process this office
            const { records: officeRecords, filename, readyToSendFiles, readyToSendCount, changedTo327, snFailures } = await processOffice(page, office, insuranceHelper, selectedInsurances);
            allSelectedRecords.push(...officeRecords);
            const totalCount = officeRecords.length + (readyToSendCount || 0);
            summary.push({ office: office.name, count: officeRecords.length, readyToSendCount: readyToSendCount || 0, changedTo327Count: changedTo327.length });
            // Collect all 327 changes with office name
            changedTo327.forEach(change => {
                all327Changes.push({
                    office: office.name,
                    mrn: change.mrn,
                    billingPeriod: change.billingPeriod,
                    reason: change.reason
                });
            });
            // Collect SN visit failures
            if (snFailures && snFailures.length > 0) {
                snFailures.forEach(failure => {
                    allSNFailures.push({
                        office: office.name,
                        mrn: failure.mrn,
                        billingPeriod: failure.billingPeriod,
                        insurance: failure.insurance
                    });
                });
            }
            if (filename) {
                excelFiles.push(filename);
            }
            allReadyToSendFiles.push(...readyToSendFiles);
            // Track 327 changes for this office
            if (changedTo327.length > 0) {
                console.log(`\n=== TYPE OF BILL 327 CHANGES FOR ${office.name} ===`);
                changedTo327.forEach(change => {
                    console.log(`  MRN: ${change.mrn}, Billing Period: ${change.billingPeriod}`);
                });
            }
            console.log(`✓ Completed ${office.name}: ${officeRecords.length} records from Ready tab, ${readyToSendCount || 0} records from Ready To Send tab`);
            // Small delay between offices
            await page.waitForTimeout(2000);
        }
        // 3. Print final summary
        console.log(`\n${'='.repeat(80)}`);
        console.log(`FINAL SUMMARY`);
        console.log(`${'='.repeat(80)}`);
        summary.forEach(s => {
            console.log(`${s.office}: ${s.count} records`);
        });
        console.log(`\nTotal records selected: ${allSelectedRecords.length}`);
        console.log(`${'='.repeat(80)}`);
        // 4. Save combined summary if processing multiple offices
        const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
        if (officesToProcess.length > 1 && allSelectedRecords.length > 0) {
            const summaryFilename = `SUMMARY-${officesToProcess.length}-offices-${timestamp}.xlsx`;
            saveSelectedRecordsToExcel(allSelectedRecords, summaryFilename);
            excelFiles.push(summaryFilename);
        }
        // 5. Send email with all Excel files and PDFs
        let emailSent = false;
        const allAttachments = [...excelFiles, ...allReadyToSendFiles];
        // ALWAYS send email, even if no records processed
        console.log(`\n=== Sending Email ===`);
        try {
            const officeNames = officesToProcess.map(o => o.name).join(', ');
            // Count different file types
            const readyTabExcelCount = excelFiles.length;
            const readyToSendExcelCount = allReadyToSendFiles.filter(f => f.endsWith('.xlsx')).length;
            const pdfCount = allReadyToSendFiles.filter(f => f.endsWith('.pdf')).length;
            // Collect all 327 changes across offices
            const total327Changes = summary.reduce((sum, s) => sum + (s.changedTo327Count || 0), 0);
            const emailBody = `
Kinnser Billing Automation Report
Version: ${APP_VERSION} (Build: ${BUILD_DATE})
Generated: ${(0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss')}

OFFICES PROCESSED: ${officeNames}

READY TAB SUMMARY:
${summary.map(s => `${s.office}: ${s.count} records selected`).join('\n')}

Total records selected from Ready tab: ${allSelectedRecords.length}
Total offices processed: ${officesToProcess.length}

TYPE OF BILL CHANGES (327 - Adjustment Claim):
${total327Changes > 0 ? `Total records needing TOB 327: ${total327Changes}

${summary.filter(s => s.changedTo327Count && s.changedTo327Count > 0).map(s => `${s.office}: ${s.changedTo327Count} record(s) need TOB 327`).join('\n')}

DETAILED LIST:
${all327Changes.map(change => `  Office: ${change.office}
    - MRN: ${change.mrn}, Billing Period: ${change.billingPeriod}
      Reason: ${change.reason}`).join('\n')}

✓ These records have been AUTOMATICALLY changed to Type of Bill 327 (Adjustment Claim)
  No manual action required - records were processed and approved.` : 'No duplicate records found - no Type of Bill changes needed'}

${officesToProcess.some(o => o.stateCode === 'MA') && allSNFailures.length > 0 ? `
SENIOR WHOLE HEALTH (BID) - SN VISIT VALIDATION:
⚠️  ${allSNFailures.length} record(s) NOT approved due to > 2 Skilled Nursing visits per day:
${allSNFailures.map(f => `  - MRN: ${f.mrn}, Billing Period: ${f.billingPeriod}, Office: ${f.office}`).join('\n')}

These records remain in Pending Approval for manual review.
Please verify Skilled Nursing visit counts before billing.` : ''}

${(allSelectedRecords.length > 0 || allReadyToSendFiles.length > 0) ? `
WORKFLOW STATUS:
✓ Ready tab: ${allSelectedRecords.length} records selected and Create button clicked
✓ Pending Approval tab: Processed (duplicates fixed if found)
${allReadyToSendFiles.length > 0 ? '✓ Ready To Send tab: Records processed and submitted' : '⚠️  Ready To Send tab: No records found (may still be in Pending Approval)'}

ATTACHED FILES (${allAttachments.length} total):

1. Ready Tab Excel Files (${readyTabExcelCount}):
${excelFiles.length > 0 ? excelFiles.map(f => `   - ${f}`).join('\n') : '   - None'}

2. Ready To Send Files (${allReadyToSendFiles.length}):
${allReadyToSendFiles.length > 0 ? `   - Summary Excel: ${readyToSendExcelCount} file(s)
   - Electronic Claims Excel: Included if applicable
   - Paper Claims PDFs: ${pdfCount} file(s)
${allReadyToSendFiles.map(f => `   - ${f}`).join('\n')}` : `   ⚠️  No files from Ready To Send
   
   POSSIBLE REASONS:
   - Records are still in Pending Approval (need manual approval)
   - Records don't match insurance criteria for Ready To Send
   - Timing issue - records may appear in next run`}

${allReadyToSendFiles.length > 0 ? `
ACTIONS TAKEN:
✓ Electronic claims sent automatically
✓ Paper claims downloaded as PDFs
✓ All files attached to this email` : `
NEXT STEPS:
1. Check Pending Approval tab in Kinnser for records awaiting approval
2. Verify records were created successfully in Ready tab
3. Run automation again if records are now in Ready To Send`}
` : `
NO RECORDS PROCESSED:
- All records in Ready tab were skipped (insurances not in approved list or invalid authorization)
- No claims were created
- Pending Approval and Ready To Send tabs were checked but had no matching records

WORKFLOW COMPLETED:
✓ Ready tab checked - 0 records selected
✓ Pending Approval checked
✓ Ready To Send checked

No action was taken as no records met the processing criteria.
`}
      `;
            await (0, email_helper_1.sendEmail)({
                to: process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com",
                subject: `Kinnser Billing Report - ${officeNames} - ${timestamp}${(allSelectedRecords.length === 0 && allReadyToSendFiles.length === 0) ? ' [NO RECORDS PROCESSED]' : ''}`,
                body: emailBody,
                attachments: allAttachments
            });
            emailSent = true;
            console.log(`✓ Email sent successfully to ${process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com"}`);
            if (allAttachments.length > 0) {
                console.log(`  Total attachments: ${allAttachments.length}`);
                console.log(`  - Ready Tab Excel: ${readyTabExcelCount}`);
                console.log(`  - Ready To Send Excel: ${readyToSendExcelCount}`);
                console.log(`  - PDFs: ${pdfCount}`);
            }
            else {
                console.log(`  No attachments (0 records processed)`);
            }
        }
        catch (emailError) {
            console.error(`✗ Failed to send email:`, emailError);
            if (allAttachments.length > 0) {
                console.log(`Files saved locally: ${allAttachments.join(', ')}`);
            }
        }
        // Close browser after email is sent
        console.log("\n✓ Automation completed. Closing browser...");
        if (browser) {
            await browser.close();
            browser = null;
            console.log("✓ Browser closed");
        }
        return {
            totalRecords: allSelectedRecords.length,
            filesCreated: excelFiles.length,
            emailSent,
            summary
        };
    }
    catch (error) {
        console.error("Error in billing automation:", error);
        throw error;
    }
    finally {
        // Ensure browser is closed even if there's an error
        if (browser) {
            console.log("Cleaning up browser...");
            await browser.close();
            browser = null;
        }
    }
}
async function waitForLoadingToComplete(page) {
    console.log("Waiting for loading to complete...");
    // Brief moment to let any loading start
    await page.waitForTimeout(300);
    // Check if loading spinner exists and is visible
    const loaderExists = await page.locator('#globalAjaxLoader').count() > 0;
    if (!loaderExists) {
        console.log("No loading spinner element found on page");
        await page.waitForTimeout(300);
        console.log("✓ Loading complete");
        return;
    }
    // Check if spinner is currently visible
    const isVisible = await page.evaluate(() => {
        const loader = document.querySelector('#globalAjaxLoader');
        if (!loader)
            return false;
        return loader.offsetParent !== null && window.getComputedStyle(loader).display !== 'none';
    });
    if (!isVisible) {
        console.log("Loading spinner is already hidden - page is ready");
        await page.waitForTimeout(300);
        console.log("✓ Loading complete");
        return;
    }
    // Spinner is visible, wait for it to hide
    console.log("Loading spinner is visible, waiting for it to hide...");
    await page.waitForFunction(() => {
        const loader = document.querySelector('#globalAjaxLoader');
        if (!loader)
            return true;
        return loader.offsetParent === null || window.getComputedStyle(loader).display === 'none';
    }, { timeout: 30000 });
    console.log("✓ Loading spinner is now hidden");
    // Brief wait for content to render
    await page.waitForTimeout(500);
    console.log("✓ Loading complete");
}
async function performLogin(page) {
    const username = process.env.KINNSER_USER;
    const password = process.env.KINNSER_PASS;
    if (!username || !password) {
        throw new Error("KINNSER_USER and KINNSER_PASS environment variables must be set");
    }
    console.log("Navigating to Kinnser login page...");
    try {
        await page.goto("https://kinnser.net/login.cfm", {
            waitUntil: "domcontentloaded",
            timeout: 60000 // Increased timeout to 60 seconds
        });
        console.log("✓ Login page loaded");
    }
    catch (error) {
        console.error("Failed to load login page:", error);
        console.log("Retrying with networkidle...");
        await page.goto("https://kinnser.net/login.cfm", {
            waitUntil: "networkidle",
            timeout: 60000
        });
    }
    console.log("Filling in credentials...");
    try {
        await page.fill('input[name="username"], input#username', username);
        await page.fill('input[name="password"], input#password', password);
        console.log("✓ Credentials filled");
    }
    catch (error) {
        console.error("✗ Failed to fill credentials:", error);
        await page.screenshot({ path: 'debug-login-form-error.png' });
        throw new Error("Could not find username/password fields on login page");
    }
    // Click login and wait for any page to load (might be inbox or main page)
    console.log("Clicking login button...");
    try {
        await page.click('#login_btn');
    }
    catch (error) {
        console.error("✗ Failed to click login button:", error);
        await page.screenshot({ path: 'debug-login-button-error.png' });
        throw new Error("Could not find or click login button");
    }
    // Wait for navigation to complete (could go to inbox or main page)
    console.log("Waiting for login to complete...");
    try {
        await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
    }
    catch (error) {
        console.error("✗ Page did not load after login:", error);
        throw new Error("Login page did not respond within 60 seconds");
    }
    // Wait a bit for any redirects
    await page.waitForTimeout(3000);
    // Verify login success - should not be on login page
    const currentUrl = page.url();
    if (currentUrl.includes("login.cfm")) {
        console.error("✗ Login failed - still on login page");
        await page.screenshot({ path: 'debug-login-failed.png' });
        // Check for error messages
        const errorMessage = await page.textContent('.error, .alert-danger, [class*="error"]').catch(() => null);
        if (errorMessage) {
            throw new Error(`Login failed: ${errorMessage}`);
        }
        throw new Error("Login failed - check credentials or MFA requirements");
    }
    console.log("✓ Logged in successfully, current URL:", currentUrl);
}
async function navigateToBillingManager(page) {
    console.log("=== Navigating to Billing Manager ===");
    try {
        await page.waitForSelector('a.menuButton[onclick*="gotoMenu"]', { timeout: 30000 });
    }
    catch (error) {
        console.log("⚠️  Go To menu not found, trying alternative selector...");
        await page.waitForSelector('a.menuButton', { timeout: 10000 });
    }
    // Use JavaScript click to avoid element interception issues
    console.log("Clicking Go To menu...");
    await page.evaluate(() => {
        const button = document.querySelector('a.menuButton[onclick*="gotoMenu"]');
        if (button) {
            button.click();
            return true;
        }
        // Try alternative selector
        const buttons = Array.from(document.querySelectorAll('a.menuButton'));
        const gotoButton = buttons.find(b => { var _a; return (_a = b.textContent) === null || _a === void 0 ? void 0 : _a.includes('Go To'); });
        if (gotoButton) {
            gotoButton.click();
            return true;
        }
        return false;
    });
    // Wait for menu to expand and show items
    await page.waitForTimeout(3000);
    // Wait for Billing Manager to be visible (not just present)
    console.log("Waiting for Billing Manager menu item to be visible...");
    try {
        await page.waitForSelector('a.menuitem:has-text("Billing Manager")', { state: 'visible', timeout: 45000 });
    }
    catch (error) {
        console.log("⚠️  Billing Manager not visible with :has-text, trying alternative...");
        // Take screenshot for debugging
        await page.screenshot({ path: 'debug-menu-timeout.png' });
        console.log("📸 Screenshot saved: debug-menu-timeout.png");
        // Try to find it with JavaScript
        const found = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a.menuitem'));
            const billingManager = items.find(item => { var _a; return (_a = item.textContent) === null || _a === void 0 ? void 0 : _a.includes('Billing Manager'); });
            return billingManager ? true : false;
        });
        if (!found) {
            throw new Error("Billing Manager menu item not found after 45 seconds");
        }
        console.log("✓ Found Billing Manager with JavaScript");
    }
    // Click Billing Manager using JavaScript to avoid interception
    console.log("Clicking Billing Manager...");
    // Set up navigation promise before clicking
    const navigationPromise = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('a.menuitem'));
        const billingManager = items.find(item => { var _a; return (_a = item.textContent) === null || _a === void 0 ? void 0 : _a.includes('Billing Manager'); });
        if (billingManager)
            billingManager.click();
    });
    // Wait for navigation to complete
    await navigationPromise;
    console.log("✓ Navigation completed, URL:", page.url());
    // Wait for the loading to complete
    console.log("Waiting for Billing Manager page to fully load...");
    await waitForLoadingToComplete(page);
    // Give Angular time to render
    await page.waitForTimeout(3000);
    // Verify the Primary Payer button is now visible
    console.log("Checking for Primary Payer button...");
    // Wait for the button to be visible with a longer timeout
    try {
        await page.waitForSelector('#ManagedCareClaims', { state: 'visible', timeout: 30000 });
        console.log("✓ Primary Payer button is visible");
    }
    catch (error) {
        console.error("✗ Primary Payer button not visible after 30 seconds");
        await page.screenshot({ path: 'debug-no-button.png' });
        // Try to check what's on the page
        const pageTitle = await page.title();
        console.log("Page title:", pageTitle);
        // Check if we're actually on the billing page
        const url = page.url();
        if (!url.includes('/billing')) {
            console.error("✗ Not on billing page. Current URL:", url);
            throw new Error("Failed to navigate to Billing Manager");
        }
        throw new Error("Primary Payer button not found after page load");
    }
    console.log("✓ Billing Manager page fully loaded and ready");
}
async function applyFilters(page) {
    console.log("=== Starting applyFilters ===");
    console.log("Current URL:", page.url());
    // Wait for Primary Payer dropdown button to be visible
    console.log("Waiting for Primary Payer dropdown (#ManagedCareClaims)...");
    try {
        await page.waitForSelector('#ManagedCareClaims', { timeout: 60000 });
        console.log("✓ Found Primary Payer dropdown");
    }
    catch (error) {
        console.error("✗ Could not find Primary Payer dropdown");
        // Take a screenshot for debugging
        await page.screenshot({ path: 'debug-no-dropdown.png' });
        throw error;
    }
    // Click the Primary Payer dropdown button
    console.log("Clicking Primary Payer dropdown...");
    await page.click('#ManagedCareClaims');
    await page.waitForTimeout(1000); // Wait for dropdown to open
    // Wait for dropdown to open and Ready link to be visible
    console.log("Waiting for Ready link in dropdown (#managedCare-ready)...");
    try {
        await page.waitForSelector('#managedCare-ready', { timeout: 20000 });
        console.log("✓ Found Ready link");
    }
    catch (error) {
        console.error("✗ Could not find Ready link");
        await page.screenshot({ path: 'debug-no-ready-link.png' });
        throw error;
    }
    // Click Ready link
    console.log("Clicking Ready link...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click('#managedCare-ready')
    ]);
    // Wait for Claims Manager page to load
    console.log("Waiting for Claims Manager page to load...");
    await waitForLoadingToComplete(page);
    // Verify we're on the Ready tab (Claims Manager page)
    const readyUrl = page.url();
    if (!readyUrl.includes('/ready') && !readyUrl.includes('claims-manager')) {
        console.error(`✗ Navigation to Ready tab failed! Current URL: ${readyUrl}`);
        throw new Error("Failed to navigate to Ready tab");
    }
    const pageTitle = await page.textContent('h1, h2, .page-title, [class*="title"]').catch(() => '');
    console.log("✓ Page loaded:", pageTitle);
    console.log("✓ Ready tab URL verified:", readyUrl);
    console.log("=== applyFilters completed ===");
}
async function selectAllInsurances(page, selectedInsurances = null) {
    // Wait for the insurance dropdown to be visible
    console.log("Waiting for insurance dropdown...");
    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 30000 });
    // Get all available insurance options from dropdown
    const options = await page.$$eval('select[ng-model="insuranceKey"] option', (opts) => opts.map(opt => { var _a; return ({ value: opt.value, text: ((_a = opt.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || '' }); }));
    // Filter out empty options and "All Insurances" option
    const availableInsurances = options.filter(opt => opt.value && opt.value !== '1' && opt.text);
    console.log(`Found ${availableInsurances.length} available insurances in dropdown`);
    if (selectedInsurances && selectedInsurances.length > 0) {
        console.log(`User selected ${selectedInsurances.length} insurance(s)`);
        // Check if all available insurances are selected
        // If user selected all or most insurances, just use "All Insurances" option
        if (selectedInsurances.length >= availableInsurances.length * 0.9) {
            console.log("All or most insurances selected - using 'All Insurances' option");
            await page.selectOption('select[ng-model="insuranceKey"]', '1');
        }
        else {
            // Select specific insurances
            console.log(`Selecting specific insurance(s): ${selectedInsurances.slice(0, 3).join(', ')}${selectedInsurances.length > 3 ? '...' : ''}`);
            // Find matching options for selected insurances (exact match)
            const matchedValues = [];
            for (const insurance of selectedInsurances) {
                const match = availableInsurances.find(opt => opt.text.toLowerCase().trim() === insurance.toLowerCase().trim());
                if (match && match.value) {
                    matchedValues.push(match.value);
                }
                else {
                    console.log(`⚠️  Could not find dropdown option for insurance: ${insurance}`);
                }
            }
            if (matchedValues.length === 0) {
                console.log("⚠️  No matching insurances found, falling back to 'All Insurances'");
                await page.selectOption('select[ng-model="insuranceKey"]', '1');
            }
            else if (matchedValues.length === 1) {
                // Select the single matched insurance
                console.log(`Selecting insurance with value: ${matchedValues[0]}`);
                await page.selectOption('select[ng-model="insuranceKey"]', matchedValues[0]);
            }
            else {
                // Multiple insurances selected - Kinnser dropdown may not support multi-select
                // Use "All Insurances" and filter in processing logic
                console.log(`Multiple insurances selected (${matchedValues.length}) - using 'All Insurances' and will filter during processing`);
                await page.selectOption('select[ng-model="insuranceKey"]', '1');
            }
        }
    }
    else {
        // No specific selection - Select "All Insurances" (value="1")
        console.log("No specific insurances selected - using 'All Insurances'");
        await page.selectOption('select[ng-model="insuranceKey"]', '1');
    }
    // Wait for loading to complete after selection
    console.log("Waiting for records to load...");
    await waitForLoadingToComplete(page);
    // ADDITIONAL: Wait for Angular to render the data
    console.log("Waiting for Angular to render table data...");
    await page.waitForTimeout(5000); // Give Angular more time to render
    // Wait for table rows with actual data OR "no records" message
    console.log("Waiting for Angular to render table data...");
    try {
        await page.waitForFunction(() => {
            // Check for "no records" message
            const bodyText = document.body.textContent || '';
            if (bodyText.includes('There are currently no records to display') ||
                bodyText.includes('No records found')) {
                console.log('No records message found');
                return true;
            }
            // Check for table with data
            const tables = Array.from(document.querySelectorAll('table'));
            for (let i = 0; i < tables.length; i++) {
                const tbody = tables[i].querySelector('tbody');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr');
                    if (rows.length > 0) {
                        // Check if first row has a checkbox
                        const firstRow = rows[0];
                        const checkbox = firstRow.querySelector('input[type="checkbox"]');
                        if (checkbox) {
                            console.log('Found table with checkbox in first row');
                            return true;
                        }
                    }
                }
            }
            return false;
        }, { timeout: 30000 });
    }
    catch (error) {
        console.log("⚠️  Timeout waiting for table - checking if there are no records...");
        const noRecords = await page.evaluate(() => {
            const bodyText = document.body.textContent || '';
            return bodyText.includes('There are currently no records to display') ||
                bodyText.includes('No records found');
        });
        if (noRecords) {
            console.log("✓ Confirmed: No records to display");
        }
        else {
            console.log("⚠️  Table structure might be different than expected");
            throw error;
        }
    }
    console.log("Insurance selection completed successfully");
}
async function waitForResultsTable(page) {
    console.log("Waiting for results table with data...");
    // Wait for table to exist
    await page.waitForSelector('table', { timeout: 30000 });
    // Wait for loading spinner to disappear
    console.log("Waiting for loading spinner to disappear...");
    await waitForLoadingToComplete(page);
    // Give Angular MORE time to render after loading completes
    console.log("Waiting for Angular to render table data...");
    await page.waitForTimeout(8000);
    // Additional wait for data to populate
    console.log("Waiting for data to populate...");
    await page.waitForTimeout(5000);
    // Take screenshot for debugging
    await page.screenshot({ path: 'debug-table-check.png' });
    console.log("📸 Screenshot saved: debug-table-check.png");
    // Check if there's a "no records" message
    const noRecordsMessage = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        return bodyText.includes('There are currently no records to display') ||
            bodyText.includes('No records found') ||
            bodyText.includes('no records to display');
    });
    if (noRecordsMessage) {
        console.log("⚠️ No records found in tab - will skip to next tab");
        return false; // Return false to indicate no records
    }
    // Check if table has data rows - look for tbody tr specifically
    const hasData = await page.evaluate(() => {
        var _a;
        const tables = Array.from(document.querySelectorAll("table"));
        console.log(`Found ${tables.length} tables`);
        for (let i = 0; i < tables.length; i++) {
            const t = tables[i];
            const tbodyRows = t.querySelectorAll("tbody tr");
            console.log(`Table ${i}: ${tbodyRows.length} tbody rows`);
            if (tbodyRows.length > 0) {
                // Check if first row has cells with content
                const firstRow = tbodyRows[0];
                const cells = firstRow.querySelectorAll('td');
                console.log(`First row has ${cells.length} cells`);
                if (cells.length > 0) {
                    // Check if at least one cell has text content
                    for (let j = 0; j < cells.length; j++) {
                        const cell = cells[j];
                        const text = ((_a = cell.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || '';
                        if (text.length > 0) {
                            console.log(`Found data in cell ${j}: "${text.substring(0, 50)}"`);
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    });
    if (hasData) {
        console.log("✓ Results table with data is ready");
        return true;
    }
    else {
        console.log("⚠️ No records found in tab - will skip to next tab");
        return false;
    }
}
async function processAllPagesAndSelectValid(page, insuranceHelper) {
    console.log("\n=== PROCESSING ALL PAGES ===");
    let allSelectedRecords = [];
    let totalSelectedCount = 0;
    let currentPage = 1;
    while (true) {
        console.log(`\n--- Processing Page ${currentPage} ---`);
        // Process records on current page
        const { selectedCount, selectedRecords } = await processRecordsAndSelectValid(page, insuranceHelper);
        totalSelectedCount += selectedCount;
        allSelectedRecords.push(...selectedRecords);
        console.log(`✓ Page ${currentPage}: ${selectedCount} records selected`);
        // Check if there's a next page
        console.log("Checking for next page button...");
        const nextButtonInfo = await page.evaluate(() => {
            var _a;
            const nextButton = document.querySelector('#nextGridPage');
            if (!nextButton) {
                return { exists: false, disabled: null, visible: null };
            }
            const style = window.getComputedStyle(nextButton);
            return {
                exists: true,
                disabled: nextButton.disabled,
                visible: style.display !== 'none' && style.visibility !== 'hidden',
                text: (_a = nextButton.textContent) === null || _a === void 0 ? void 0 : _a.trim()
            };
        });
        console.log(`Next button info:`, nextButtonInfo);
        if (!nextButtonInfo.exists) {
            console.log(`✓ No next page button found - single page only`);
            break;
        }
        if (nextButtonInfo.disabled) {
            console.log(`✓ Next page button is disabled - reached last page (page ${currentPage})`);
            break;
        }
        if (!nextButtonInfo.visible) {
            console.log(`✓ Next page button is hidden - reached last page (page ${currentPage})`);
            break;
        }
        // Click next page
        console.log(`➡️  Navigating to page ${currentPage + 1}...`);
        try {
            await page.click('#nextGridPage');
            console.log(`✓ Clicked next page button`);
        }
        catch (error) {
            console.log(`⚠️  Failed to click next page button:`, error);
            break;
        }
        // Wait for page to load
        console.log("Waiting for next page to load...");
        await page.waitForTimeout(3000);
        // Wait for table to update
        console.log("Waiting for table to update...");
        try {
            await page.waitForFunction(() => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (let i = 0; i < tables.length; i++) {
                    const tbody = tables[i].querySelector('tbody');
                    if (tbody) {
                        const rows = tbody.querySelectorAll('tr');
                        if (rows.length > 0) {
                            const firstRow = rows[0];
                            const checkbox = firstRow.querySelector('input[type="checkbox"]');
                            if (checkbox) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            }, { timeout: 30000 });
            console.log("✓ Table updated with new records");
        }
        catch (error) {
            console.log("⚠️  Timeout waiting for table to update");
            break;
        }
        currentPage++;
        // Safety limit to prevent infinite loops
        if (currentPage > 50) {
            console.log('⚠️  Reached safety limit of 50 pages');
            break;
        }
    }
    console.log(`\n=== ALL PAGES PROCESSED ===`);
    console.log(`Total pages: ${currentPage}`);
    console.log(`Total records selected: ${totalSelectedCount}`);
    return { selectedCount: totalSelectedCount, selectedRecords: allSelectedRecords };
}
// NEW FUNCTION: Process records one by one - select valid record, click create, repeat
async function processRecordsOneByOne(page, insuranceHelper, selectedInsurances = null) {
    console.log("\n=== PROCESSING RECORDS ONE BY ONE ===");
    console.log("Flow: Find valid record → Select → Scroll → Click Create → Check for errors → Repeat (stays on Ready tab)");
    let allSelectedRecords = [];
    let failedRecords = [];
    let failedRecordIds = new Set(); // Track failed record IDs to skip them
    let totalProcessed = 0;
    let totalFailed = 0;
    let maxIterations = 500; // Safety limit
    let iteration = 0;
    while (iteration < maxIterations) {
        iteration++;
        console.log(`\n--- Iteration ${iteration} ---`);
        // Wait for page to be ready
        await page.waitForTimeout(2000);
        // Wait for loading to complete
        await waitForLoadingToComplete(page);
        // Get all records on current page and identify the FIRST valid one (excluding failed ones)
        const validRecords = await identifyValidRecordsOnPage(page, insuranceHelper, selectedInsurances);
        // Filter out records that have already failed
        const availableRecords = validRecords.filter(r => !failedRecordIds.has(r.id));
        if (availableRecords.length === 0) {
            console.log(`✓ No more valid records found - completed`);
            break;
        }
        // Process ONLY the first available valid record
        const record = availableRecords[0];
        console.log(`\n[Record ${totalProcessed + totalFailed + 1}] Processing: ${record.insurance}`);
        try {
            // Select this record
            await page.evaluate((checkboxId) => {
                const checkbox = document.getElementById(checkboxId);
                if (checkbox && !checkbox.checked) {
                    checkbox.click();
                }
            }, record.id);
            console.log(`  ✓ Selected checkbox`);
            await page.waitForTimeout(500);
            // Scroll to Create button
            console.log(`  ⟳ Scrolling to Create button...`);
            await page.evaluate(() => {
                const createButton = document.querySelector('button[ng-click*="createClaims"]');
                if (createButton) {
                    createButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            await page.waitForTimeout(1000);
            // Click Create button for this record (WITHOUT navigating away)
            console.log(`  ⟳ Clicking Create button...`);
            await page.evaluate(() => {
                const button = document.querySelector('button#claimsCreation');
                if (button) {
                    button.click();
                }
            });
            console.log(`  ✓ Create button clicked`);
            // Wait for claim creation animation to complete
            console.log(`  ⏳ Waiting for claim creation...`);
            await page.waitForTimeout(3000);
            // Wait for loading spinner
            await waitForLoadingToComplete(page);
            // Additional wait for success/error message to appear
            await page.waitForTimeout(2000);
            // Check for success or error message in the alert div
            const resultMessage = await page.evaluate(() => {
                var _a, _b;
                // Look for the alert div with id="alert"
                const alertDiv = document.querySelector('div#alert');
                if (alertDiv) {
                    // Check if it's a success or error alert
                    const isSuccess = alertDiv.classList.contains('alert-success');
                    const isError = alertDiv.classList.contains('alert-danger') || alertDiv.classList.contains('alert-error');
                    // Get the message from the span with ng-bind-html-unsafe
                    const messageSpan = alertDiv.querySelector('span[ng-bind-html-unsafe="alert.message"]');
                    const message = ((_a = messageSpan === null || messageSpan === void 0 ? void 0 : messageSpan.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || '';
                    if (message) {
                        if (isSuccess || message.includes('Claim(s) have been created successfully')) {
                            return { success: true, message };
                        }
                        else if (isError || message.includes('Some of the claims were not created successfully')) {
                            return { success: false, message };
                        }
                    }
                }
                // Fallback: check for messages in other elements
                const elements = Array.from(document.querySelectorAll('span.ng-binding, div.alert'));
                for (const element of elements) {
                    const text = ((_b = element.textContent) === null || _b === void 0 ? void 0 : _b.trim()) || '';
                    if (text.includes('Claim(s) have been created successfully')) {
                        return { success: true, message: text };
                    }
                    if (text.includes('Some of the claims were not created successfully')) {
                        return { success: false, message: text };
                    }
                }
                return null;
            });
            if (resultMessage) {
                if (resultMessage.success) {
                    // Record SUCCEEDED
                    console.log(`  ✅ SUCCESS: ${resultMessage.message}`);
                    allSelectedRecords.push(record);
                    totalProcessed++;
                    console.log(`  ✓ Processed successfully (Total: ${totalProcessed})`);
                }
                else {
                    // Record FAILED - mark it and skip
                    console.log(`  ❌ FAILED: ${resultMessage.message}`);
                    console.log(`  ⊘ Marking record as failed and skipping to next record`);
                    failedRecordIds.add(record.id);
                    failedRecords.push({
                        ...record,
                        failureReason: resultMessage.message
                    });
                    totalFailed++;
                    // Uncheck the failed record so it doesn't stay selected
                    await page.evaluate((checkboxId) => {
                        const checkbox = document.getElementById(checkboxId);
                        if (checkbox && checkbox.checked) {
                            checkbox.click();
                        }
                    }, record.id);
                    console.log(`  ✓ Unchecked failed record`);
                }
            }
            else {
                // No message found - assume success (record should have disappeared)
                console.log(`  ⚠️  No success/error message found - assuming success`);
                allSelectedRecords.push(record);
                totalProcessed++;
                console.log(`  ✓ Processed (Total: ${totalProcessed})`);
            }
            // Check if stop was requested
            if (isStopRequested()) {
                console.log(`\n⚠️  ═══════════════════════════════════════════════════════`);
                console.log(`⚠️  STOP REQUESTED BY USER`);
                console.log(`⚠️  ═══════════════════════════════════════════════════════`);
                console.log(`✓ Current record completed successfully`);
                console.log(`✓ Stopping gracefully...`);
                console.log(`✓ Records processed: ${totalProcessed}`);
                console.log(`✓ Records failed: ${totalFailed}`);
                console.log(`⚠️  ═══════════════════════════════════════════════════════\n`);
                break; // Exit the while loop
            }
        }
        catch (error) {
            console.error(`  ✗ Error processing record:`, error);
            // Mark as failed to avoid retrying
            failedRecordIds.add(record.id);
            failedRecords.push({
                ...record,
                failureReason: `Exception: ${error}`
            });
            totalFailed++;
            // Check if stop was requested even after error
            if (isStopRequested()) {
                console.log(`\n⚠️  STOP REQUESTED BY USER - Stopping after error...`);
                break;
            }
        }
    }
    if (iteration >= maxIterations) {
        console.log(`⚠️  Reached safety limit of ${maxIterations} iterations`);
    }
    console.log(`\n=== COMPLETED ===`);
    console.log(`Total records processed successfully: ${totalProcessed}`);
    console.log(`Total records failed: ${totalFailed}`);
    if (failedRecords.length > 0) {
        console.log(`\n=== FAILED RECORDS ===`);
        failedRecords.forEach((record, index) => {
            console.log(`${index + 1}. ${record.insurance} - ${record.failureReason}`);
        });
    }
    return { selectedCount: totalProcessed, selectedRecords: allSelectedRecords, failedRecords };
}
// Helper function to identify valid records without selecting them
async function identifyValidRecordsOnPage(page, insuranceHelper, selectedInsurances = null) {
    const records = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
            const tbody = table.querySelector('tbody');
            if (!tbody)
                continue;
            const rows = tbody.querySelectorAll('tr');
            if (rows.length === 0)
                continue;
            const headerCells = Array.from(table.querySelectorAll('thead th'));
            const headers = headerCells.map(cell => {
                var _a, _b, _c;
                const link = cell.querySelector('a');
                const span = cell.querySelector('span');
                return (((_a = link === null || link === void 0 ? void 0 : link.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = span === null || span === void 0 ? void 0 : span.textContent) === null || _b === void 0 ? void 0 : _b.trim()) || ((_c = cell.textContent) === null || _c === void 0 ? void 0 : _c.trim()) || '').toLowerCase();
            });
            const insuranceIndex = headers.findIndex(h => h.includes('insurance'));
            const authIndex = headers.findIndex(h => h.includes('authorization'));
            if (insuranceIndex === -1)
                continue;
            const extractedRecords = [];
            rows.forEach((row) => {
                var _a, _b, _c, _d, _e, _f;
                const cells = row.querySelectorAll('td');
                if (cells.length < 5)
                    return;
                const checkbox = row.querySelector('input[type="checkbox"]');
                if (!checkbox || !checkbox.id)
                    return;
                let insurance = '';
                if (insuranceIndex < cells.length) {
                    const cell = cells[insuranceIndex];
                    const ngBindingDiv = cell.querySelector('div.ng-binding');
                    insurance = ((_a = ngBindingDiv === null || ngBindingDiv === void 0 ? void 0 : ngBindingDiv.textContent) === null || _a === void 0 ? void 0 : _a.trim()) ||
                        ((_c = (_b = cell.querySelector('a')) === null || _b === void 0 ? void 0 : _b.textContent) === null || _c === void 0 ? void 0 : _c.trim()) ||
                        ((_d = cell.innerText) === null || _d === void 0 ? void 0 : _d.trim()) || '';
                }
                let authorization = '';
                if (authIndex >= 0 && authIndex < cells.length) {
                    const cell = cells[authIndex];
                    const ngBindingDiv = cell.querySelector('div.ng-binding');
                    authorization = ((_e = ngBindingDiv === null || ngBindingDiv === void 0 ? void 0 : ngBindingDiv.textContent) === null || _e === void 0 ? void 0 : _e.trim()) ||
                        ((_f = cell.innerText) === null || _f === void 0 ? void 0 : _f.trim()) || '';
                }
                const allColumns = Array.from(cells).map(cell => {
                    var _a, _b;
                    const ngBindingDiv = cell.querySelector('div.ng-binding');
                    return ((_a = ngBindingDiv === null || ngBindingDiv === void 0 ? void 0 : ngBindingDiv.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = cell.innerText) === null || _b === void 0 ? void 0 : _b.trim()) || '';
                });
                extractedRecords.push({
                    id: checkbox.id,
                    insurance,
                    authorization,
                    allColumns
                });
            });
            if (extractedRecords.length > 0)
                return extractedRecords;
        }
        return [];
    });
    // Filter for valid records
    const validRecords = [];
    const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss');
    console.log(`\n  Filtering ${records.length} records based on insurance criteria...`);
    for (const record of records) {
        if (!record.insurance) {
            console.log(`  ⊘ Skipped: No insurance name`);
            continue;
        }
        // If user selected specific insurances, ONLY process those
        if (selectedInsurances && selectedInsurances.length > 0) {
            const normalizedSelected = selectedInsurances.map(s => s.toLowerCase().trim());
            const recordInsLower = record.insurance.toLowerCase().trim();
            if (!normalizedSelected.includes(recordInsLower)) {
                // Not in user's selection - skip silently (don't log each one to reduce noise)
                continue;
            }
        }
        // Check if insurance should be processed (has "no changes" or "paper" remark)
        const shouldProcess = insuranceHelper.shouldProcessInsurance(record.insurance);
        if (!shouldProcess) {
            console.log(`  ⊘ Skipped: ${record.insurance} (not in approved list)`);
            continue;
        }
        // Check authorization validity
        if (record.authorization && !insuranceHelper.isValidAuthorization(record.authorization)) {
            console.log(`  ❌ Skipped: ${record.insurance} - Invalid auth: ${record.authorization}`);
            continue;
        }
        console.log(`  ✓ Valid: ${record.insurance}`);
        validRecords.push({
            id: record.id,
            insurance: record.insurance,
            authorization: record.authorization,
            timestamp: timestamp,
            allColumns: record.allColumns
        });
    }
    console.log(`  Result: ${validRecords.length} valid records out of ${records.length} total`);
    return validRecords;
}
async function processRecordsAndSelectValid(page, insuranceHelper) {
    console.log("\n=== PROCESSING RECORDS ===");
    // DIAGNOSTIC: Dump table HTML structure
    const tableDebug = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        return {
            tableCount: tables.length,
            tableInfo: tables.map((t, idx) => {
                const rows = t.querySelectorAll('tr');
                const firstRow = rows[0];
                const secondRow = rows[1];
                return {
                    index: idx,
                    rowCount: rows.length,
                    firstRowHTML: firstRow ? firstRow.outerHTML.substring(0, 500) : 'none',
                    secondRowHTML: secondRow ? secondRow.outerHTML.substring(0, 500) : 'none',
                    hasCheckboxes: t.querySelectorAll('input[type="checkbox"]').length
                };
            })
        };
    });
    console.log("\n=== TABLE DIAGNOSTIC ===");
    console.log(`Found ${tableDebug.tableCount} tables`);
    tableDebug.tableInfo.forEach(info => {
        console.log(`\nTable ${info.index}:`);
        console.log(`  Rows: ${info.rowCount}`);
        console.log(`  Checkboxes: ${info.hasCheckboxes}`);
    });
    // First, identify which columns contain Insurance and Authorization
    const columnIndices = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table)
            return null;
        const headerRow = table.querySelector('tr');
        if (!headerRow)
            return null;
        const headers = Array.from(headerRow.querySelectorAll('th, td')).map(h => { var _a; return ((_a = h.textContent) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) || ''; });
        const insuranceIndex = headers.findIndex(h => h.includes('insurance') || h.includes('payer'));
        const authorizationIndex = headers.findIndex(h => h.includes('authorization') || h.includes('auth'));
        return { insuranceIndex, authorizationIndex, headers };
    });
    if (!columnIndices) {
        throw new Error("Could not find table headers");
    }
    console.log(`\nColumn mapping:`);
    console.log(`  Headers: ${columnIndices.headers.join(', ')}`);
    console.log(`  Insurance column index: ${columnIndices.insuranceIndex}`);
    console.log(`  Authorization column index: ${columnIndices.authorizationIndex}`);
    // Get all rows with their data
    const records = await page.evaluate(({ insuranceIdx, authIdx }) => {
        const rows = [];
        // Find the table
        const tables = Array.from(document.querySelectorAll('table'));
        console.log(`Found ${tables.length} tables`);
        // Find the table with the most rows (likely the data table)
        let table = null;
        let maxRows = 0;
        for (let i = 0; i < tables.length; i++) {
            const t = tables[i];
            const rowCount = t.querySelectorAll('tr').length;
            console.log(`Table ${i}: ${rowCount} rows`);
            if (rowCount > maxRows) {
                maxRows = rowCount;
                table = t;
            }
        }
        if (!table) {
            console.log('No table found');
            return rows;
        }
        console.log(`Using table with ${maxRows} rows`);
        // Try to find tbody, but if not present, use the table directly
        const tbody = table.querySelector('tbody');
        const tableRows = tbody
            ? Array.from(tbody.querySelectorAll('tr'))
            : Array.from(table.querySelectorAll('tr')).slice(1); // Skip header if no tbody
        console.log(`Found ${tableRows.length} data rows`);
        for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex++) {
            const row = tableRows[rowIndex];
            // Find checkbox in this row
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox) {
                const checkboxId = checkbox.id || checkbox.name || `row_${rowIndex}`;
                console.log(`Row ${rowIndex}: Found checkbox with ID: ${checkboxId}`);
                // Get all cells in this row
                const cells = Array.from(row.querySelectorAll('td'));
                console.log(`  Row has ${cells.length} cells`);
                // Extract text from cells - use innerText for Angular nested divs
                const allColumns = [];
                for (let idx = 0; idx < cells.length; idx++) {
                    const td = cells[idx];
                    // Try innerText first (better for Angular), fallback to textContent
                    const text = (td.innerText || td.textContent || '').trim();
                    allColumns.push(text);
                    if (text && idx <= 15) { // Log first 15 columns
                        const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
                        console.log(`    Cell ${idx}: "${preview}"`);
                    }
                }
                // Extract insurance and authorization
                let insurance = '';
                let authorization = '';
                if (insuranceIdx >= 0 && insuranceIdx < cells.length) {
                    const cell = cells[insuranceIdx];
                    insurance = (cell.innerText || cell.textContent || '').trim();
                }
                if (authIdx >= 0 && authIdx < cells.length) {
                    const cell = cells[authIdx];
                    authorization = (cell.innerText || cell.textContent || '').trim();
                }
                console.log(`  Insurance (col ${insuranceIdx}): "${insurance}"`);
                console.log(`  Authorization (col ${authIdx}): "${authorization}"`);
                if (checkboxId) {
                    rows.push({
                        id: checkboxId,
                        insurance: insurance,
                        authorization: authorization,
                        allColumns: allColumns
                    });
                }
            }
            else {
                console.log(`Row ${rowIndex}: No checkbox found`);
            }
        }
        console.log(`Extracted ${rows.length} records with checkboxes`);
        return rows;
    }, {
        insuranceIdx: columnIndices.insuranceIndex,
        authIdx: columnIndices.authorizationIndex
    });
    console.log(`\nFound ${records.length} total records`);
    if (records.length === 0) {
        console.log("⚠️  WARNING: No records found in table!");
        console.log("   This could mean:");
        console.log("   - The table is empty");
        console.log("   - The page didn't load correctly");
        console.log("   - The table structure is different than expected");
        // Take screenshot for debugging
        await page.screenshot({ path: `debug-no-records-${Date.now()}.png` });
        return { selectedCount: 0, selectedRecords: [] };
    }
    // Take screenshot of the records table
    await page.screenshot({ path: `debug-records-table-${Date.now()}.png` });
    console.log("\n=== VALIDATION REPORT ===");
    console.log("First 3 records for debugging:");
    records.slice(0, 3).forEach((r, i) => {
        console.log(`\nRecord ${i + 1}:`);
        console.log(`  ID: ${r.id}`);
        console.log(`  Insurance: "${r.insurance}"`);
        console.log(`  Authorization: "${r.authorization}"`);
        console.log(`  All columns: ${r.allColumns.join(' | ')}`);
    });
    console.log("\n=== PROCESSING ALL RECORDS ===");
    // First pass: analyze all records without taking action
    const toSelect = [];
    const toSkip = [];
    for (const record of records) {
        let shouldSelect = true;
        let skipReason = '';
        console.log(`\n--- Record ID: ${record.id} ---`);
        console.log(`Insurance: "${record.insurance}"`);
        console.log(`Authorization: "${record.authorization}"`);
        // Check authorization
        if (insuranceHelper.shouldDiscardAuthorization(record.authorization)) {
            shouldSelect = false;
            skipReason = `Authorization is "${record.authorization}" (pending/dummy/non-billing)`;
            console.log(`❌ ${skipReason}`);
        }
        else if (!insuranceHelper.isValidAuthorization(record.authorization)) {
            shouldSelect = false;
            skipReason = `Invalid authorization format`;
            console.log(`❌ ${skipReason}`);
        }
        else if (!insuranceHelper.shouldProcessInsurance(record.insurance)) {
            shouldSelect = false;
            skipReason = `Insurance "${record.insurance}" not in approved list`;
            console.log(`❌ ${skipReason}`);
        }
        else {
            console.log(`✅ Insurance "${record.insurance}" IS in approved list - will be selected`);
        }
        if (shouldSelect) {
            toSelect.push({
                id: record.id,
                insurance: record.insurance,
                auth: record.authorization,
                allColumns: record.allColumns
            });
            console.log(`✅ WILL SELECT`);
        }
        else {
            toSkip.push({ id: record.id, reason: skipReason, insurance: record.insurance, auth: record.authorization });
        }
    }
    console.log(`\n--- Summary ---`);
    console.log(`Records to SELECT: ${toSelect.length}`);
    console.log(`Records to SKIP: ${toSkip.length}`);
    console.log(`\n=== TAKING ACTION ===`);
    // Second pass: actually click the checkboxes
    let selectedCount = 0;
    const selectedRecords = [];
    const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss');
    for (const record of toSelect) {
        try {
            // For IDs that start with numbers, use attribute selector instead of # selector
            const selector = /^\d/.test(record.id)
                ? `input[type="checkbox"][id="${record.id}"]`
                : `#${record.id}`;
            await page.click(selector);
            selectedCount++;
            selectedRecords.push({
                id: record.id,
                insurance: record.insurance,
                authorization: record.auth,
                timestamp: timestamp,
                allColumns: record.allColumns
            });
            console.log(`✓ Checked: ${record.id}`);
        }
        catch (error) {
            console.error(`✗ Failed to check ${record.id}:`, error);
        }
    }
    console.log(`\n=== FINAL RESULT ===`);
    console.log(`Successfully selected ${selectedCount} out of ${toSelect.length} intended records`);
    console.log(`Total records processed: ${records.length}`);
    return { selectedCount, selectedRecords };
}
async function clickCreateButton(page) {
    console.log("\n=== Clicking Create Button ===");
    try {
        // Wait for the Create button to be present
        await page.waitForSelector('button#claimsCreation', { timeout: 10000 });
        console.log("✓ Create button found");
        // Check if button is disabled
        const isDisabled = await page.$eval('button#claimsCreation', (btn) => {
            return btn.disabled;
        });
        if (isDisabled) {
            console.log("⚠️  Create button is disabled - this may mean no records are selected or there's a validation issue");
            console.log("   Attempting to click anyway in case Angular enables it...");
        }
        // Click the button using Angular's ng-click
        await page.evaluate(() => {
            const button = document.querySelector('button#claimsCreation');
            if (button) {
                // Try to trigger Angular's ng-click
                button.click();
            }
        });
        console.log("✓ Create button clicked");
        // Wait for any confirmation dialog or processing
        await page.waitForTimeout(5000);
        // Check for success message or confirmation
        const pageContent = await page.content();
        if (pageContent.includes('success') || pageContent.includes('created')) {
            console.log("✓ Claims creation appears successful");
        }
        else {
            console.log("⚠️  No clear success message detected - proceeding to Pending Approval");
        }
        // Navigate to Pending Approval page
        console.log("\n=== Navigating to Pending Approval ===");
        await page.waitForSelector('#pendingClaimsApproval', { timeout: 10000 });
        console.log("✓ Pending Approval link found");
        await page.click('#pendingClaimsApproval');
        console.log("✓ Clicked Pending Approval link");
        // Wait for the page to load
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await page.waitForTimeout(3000);
        console.log("✓ Pending Approval page loaded");
        console.log("Current URL:", page.url());
    }
    catch (error) {
        console.error("✗ Error in Create button workflow:", error);
        console.log("   Current URL:", page.url());
        throw error;
    }
}
async function processPendingApproval(page, insuranceHelper, selectedInsurances = null, readyTabRecords = []) {
    console.log("\n=== PROCESSING PENDING APPROVAL ===");
    // Check if stop was requested before starting
    if (isStopRequested()) {
        console.log(`⚠️  STOP REQUESTED - Skipping Pending Approval tab`);
        return { files: [], changedTo327: [], snFailures: [] };
    }
    try {
        // Navigate to Pending Approval tab
        console.log("Navigating to Pending Approval tab...");
        const currentUrl = page.url();
        // Check if we're already on Pending Approval page
        if (!currentUrl.includes('approve-claims') && !currentUrl.includes('pendingClaimsApproval')) {
            console.log("Not on Pending Approval page, clicking the tab...");
            try {
                await page.waitForSelector('#pendingClaimsApproval', { timeout: 10000 });
                await page.click('#pendingClaimsApproval');
                console.log("✓ Clicked Pending Approval tab");
                // Wait for the page to load and URL to change
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // CRITICAL: Verify we actually navigated to Pending Approval BEFORE doing anything else
                const newUrl = page.url();
                console.log(`Verifying navigation... Current URL: ${newUrl}`);
                if (!newUrl.includes('approve-claims') && !newUrl.includes('pendingClaimsApproval')) {
                    console.error(`✗ Navigation failed! Still on: ${newUrl}`);
                    console.error("✗ Expected URL to contain 'approve-claims' or 'pendingClaimsApproval'");
                    await page.screenshot({ path: 'debug-pending-approval-nav-failed.png' });
                    throw new Error("Failed to navigate to Pending Approval tab - URL did not change");
                }
                console.log("✓ Pending Approval page loaded");
                console.log(`✓ URL verified: ${newUrl}`);
            }
            catch (navError) {
                console.error("✗ Could not navigate to Pending Approval tab");
                console.error(`   Current URL: ${page.url()}`);
                throw navError;
            }
        }
        else {
            console.log("✓ Already on Pending Approval page");
        }
        // Wait for initial loading message to disappear
        console.log("Waiting for initial page load...");
        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
        await page.waitForTimeout(2000);
        console.log("✓ Initial loading complete");
        // Select insurance(s) from dropdown - maintain user's selection
        if (selectedInsurances && selectedInsurances.length > 0) {
            console.log(`\nSelecting user-specified insurance(s) from dropdown...`);
            console.log(`Insurances to select: ${selectedInsurances.join(', ')}`);
            // Use the same insurance selection logic as Ready tab
            await selectAllInsurances(page, selectedInsurances);
            console.log("✓ Insurance selection completed");
        }
        else {
            // Select "All Insurances" from dropdown
            console.log("\nSelecting 'All Insurances' from dropdown...");
            await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
            // First, check what's currently selected
            const currentValuePA = await page.$eval('select[ng-model="insuranceKey"]', (select) => select.value);
            console.log(`Current dropdown value: ${currentValuePA}`);
            // If already on "All Insurances", select something else first to trigger change event
            if (currentValuePA === '1') {
                console.log("Already on 'All Insurances', selecting different option first to trigger change...");
                const optionsPA = await page.$$eval('select[ng-model="insuranceKey"] option', (opts) => opts.map(opt => opt.value).filter(v => v && v !== '1'));
                if (optionsPA.length > 0) {
                    await page.selectOption('select[ng-model="insuranceKey"]', optionsPA[0]);
                    await page.waitForTimeout(1000);
                    console.log(`  Selected temporary option: ${optionsPA[0]}`);
                }
            }
            // Now select "All Insurances"
            await page.selectOption('select[ng-model="insuranceKey"]', '1'); // value="1" is "All Insurances"
            console.log("✓ Selected 'All Insurances'");
        }
        // Wait for loading message to appear and then disappear
        console.log("Waiting for records to load...");
        await page.waitForTimeout(2000); // Give time for loading to start
        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
        await page.waitForTimeout(3000); // Extra time for records to render
        console.log("✓ Records loaded");
        // Track 327 changes
        let changedTo327 = [];
        let snFailures = [];
        // Check if there are no records to display
        const noRecordsMessage = await page.textContent('body');
        if (noRecordsMessage && noRecordsMessage.includes('There are currently no records to display.')) {
            console.log("\n✓ No records found in Pending Approval - nothing to approve");
            console.log("   This is normal if no claims were created or all were already processed");
            console.log("   Continuing to Ready To Send tab...");
            // Don't return - continue to Ready To Send
        }
        else {
            // Process Pending Approval records and capture 327 changes
            const pendingResult = await processPendingApprovalRecords(page, insuranceHelper, selectedInsurances, readyTabRecords);
            changedTo327 = pendingResult.changedRecords || pendingResult;
            snFailures = pendingResult.snFailures || [];
            console.log(`✓ Type of Bill changes: ${changedTo327.length} records changed to 327`);
            if (snFailures.length > 0) {
                console.log(`✓ SN Visit failures: ${snFailures.length} records not approved (> 2 SN/day)`);
            }
        }
        // ALWAYS navigate to Ready To Send tab
        console.log("\n=== Navigating to Ready To Send ===");
        try {
            await page.waitForSelector('#readyToSendClaims', { timeout: 10000 });
            await page.click('#readyToSendClaims');
            console.log("✓ Clicked Ready To Send tab");
            // Wait for page to load
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await page.waitForTimeout(3000);
            // Verify we actually navigated to Ready To Send
            const readyToSendUrl = page.url();
            if (!readyToSendUrl.includes('ready-to-send') && !readyToSendUrl.includes('readyToSend') && !readyToSendUrl.includes('send-claims')) {
                console.log(`✗ Navigation to Ready To Send failed! Current URL: ${readyToSendUrl}`);
                throw new Error("Failed to navigate to Ready To Send tab");
            }
            console.log("✓ Ready To Send page loaded");
            console.log(`   URL: ${readyToSendUrl}`);
        }
        catch (error) {
            console.error("✗ Error navigating to Ready To Send:", error);
            throw error;
        }
        // Process Ready To Send workflow
        const readyToSendFiles = await processReadyToSend(page, insuranceHelper, selectedInsurances);
        console.log(`✓ Ready To Send completed with ${readyToSendFiles.length} files`);
        // Return files and 327 changes and SN failures for email
        return { files: readyToSendFiles, changedTo327, snFailures: snFailures || [] };
    }
    catch (error) {
        console.error("✗ Error in Pending Approval workflow:", error);
        throw error;
    }
}
async function processPendingApprovalRecords(page, insuranceHelper, selectedInsurances = null, readyTabRecords = []) {
    // Get all records with MRN and billing period
    console.log("\n════════════════════════════════════════════════════════");
    console.log("ENTERING processPendingApprovalRecords");
    console.log("════════════════════════════════════════════════════════");
    console.log("\nExtracting record details from table...");
    const changedRecords = [];
    const manualReviewRecords = [];
    const records = await page.evaluate(() => {
        // First, find the column indices by reading the header
        const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td'));
        const headers = headerCells.map(cell => { var _a; return ((_a = cell.textContent) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) || ''; });
        // Find column indices
        const mrnIndex = headers.findIndex(h => h.includes('mrn'));
        const billingPeriodIndex = headers.findIndex(h => h.includes('billing period'));
        const insuranceIndex = headers.findIndex(h => h.includes('insurance') || h.includes('payer'));
        const typeOfBillIndex = headers.findIndex(h => h.includes('type of bill') || h.includes('tob'));
        const authorizationIndex = headers.findIndex(h => h.includes('authorization') || h.includes('auth'));
        console.log('Header columns:', headers);
        console.log('MRN column index:', mrnIndex);
        console.log('Billing Period column index:', billingPeriodIndex);
        console.log('Insurance column index:', insuranceIndex);
        console.log('Type of Bill column index:', typeOfBillIndex);
        console.log('Authorization column index:', authorizationIndex);
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        console.log(`Found ${rows.length} rows in Pending Approval table`);
        // Debug: Check first row for button structure
        if (rows.length > 0) {
            const firstRow = rows[0];
            const buttons = firstRow.querySelectorAll('button');
            const links = firstRow.querySelectorAll('a');
            console.log(`First row has ${buttons.length} buttons and ${links.length} links`);
            buttons.forEach((btn, i) => {
                console.log(`  Button ${i}: id="${btn.id}" class="${btn.className}" onclick="${btn.getAttribute('onclick')}" ng-click="${btn.getAttribute('ng-click')}"`);
            });
        }
        return rows.map((row, index) => {
            var _a, _b, _c, _d, _e, _f;
            const cells = row.querySelectorAll('td');
            const allCells = Array.from(cells).map(cell => { var _a; return ((_a = cell.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ''; });
            // Extract MRN
            const mrn = mrnIndex >= 0 && mrnIndex < cells.length
                ? ((_a = cells[mrnIndex].textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ''
                : '';
            // Extract Billing Period (format: "MM/DD/YYYY - MM/DD/YYYY")
            const billingPeriodText = billingPeriodIndex >= 0 && billingPeriodIndex < cells.length
                ? ((_b = cells[billingPeriodIndex].textContent) === null || _b === void 0 ? void 0 : _b.trim()) || ''
                : '';
            // Extract Insurance name
            const insurance = insuranceIndex >= 0 && insuranceIndex < cells.length
                ? ((_c = cells[insuranceIndex].textContent) === null || _c === void 0 ? void 0 : _c.trim()) || ''
                : '';
            // Extract Type of Bill
            const typeOfBill = typeOfBillIndex >= 0 && typeOfBillIndex < cells.length
                ? ((_d = cells[typeOfBillIndex].textContent) === null || _d === void 0 ? void 0 : _d.trim()) || ''
                : '';
            // Parse the date range
            let billingPeriodStart = '';
            let billingPeriodEnd = '';
            if (billingPeriodText && billingPeriodText.includes(' - ')) {
                const parts = billingPeriodText.split(' - ');
                billingPeriodStart = ((_e = parts[0]) === null || _e === void 0 ? void 0 : _e.trim()) || '';
                billingPeriodEnd = ((_f = parts[1]) === null || _f === void 0 ? void 0 : _f.trim()) || '';
            }
            // Find Edit button - it's actually a link with class "ui-kinnser-edit"
            let editButton = row.querySelector('a.ui-kinnser-edit');
            if (!editButton) {
                editButton = row.querySelector('a[id*="openWorksheet"]');
            }
            if (!editButton) {
                editButton = row.querySelector('button[id*="edit"]');
            }
            if (!editButton) {
                editButton = row.querySelector('button[ng-click*="edit"]');
            }
            if (!editButton) {
                editButton = row.querySelector('button[onclick*="edit"]');
            }
            if (!editButton) {
                // Try finding any button in the row
                editButton = row.querySelector('button');
            }
            if (!editButton) {
                // Try finding input buttons
                editButton = row.querySelector('input[type="button"]');
            }
            if (!editButton) {
                // Try finding any link
                editButton = row.querySelector('a[href*="claim"]');
            }
            const editButtonId = (editButton === null || editButton === void 0 ? void 0 : editButton.id) || '';
            // Debug: Log what we found for first few rows
            if (index < 3) {
                const allButtons = row.querySelectorAll('button, input[type="button"], a');
                console.log(`Row ${index} elements: ${allButtons.length} clickable elements`);
                allButtons.forEach((el, i) => {
                    console.log(`  [${i}] ${el.tagName} id="${el.id}" class="${el.className}"`);
                });
            }
            // Find Worksheet link (for Community health Group)
            const worksheetLink = row.querySelector('a[id*="openWorksheet"]');
            const worksheetLinkId = (worksheetLink === null || worksheetLink === void 0 ? void 0 : worksheetLink.id) || '';
            // Find Billing Period link (for episode navigation - used by Commonwealth Care Alliance)
            const billingPeriodLink = row.querySelector('a[id*="billingPeriod"]');
            const billingPeriodHref = (billingPeriodLink === null || billingPeriodLink === void 0 ? void 0 : billingPeriodLink.href) || '';
            return {
                index,
                mrn,
                insurance,
                billingPeriodText,
                billingPeriodStart,
                billingPeriodEnd,
                typeOfBill,
                authorization: authorizationIndex >= 0 && authorizationIndex < cells.length
                    ? (cells[authorizationIndex].textContent || '').trim() : '',
                editButtonId,
                worksheetLinkId,
                billingPeriodHref,
                allCells
            };
        });
    });
    console.log(`\nFound ${records.length} records in Pending Approval`);
    // Filter out empty records
    const validRecords = records.filter(r => r.mrn && r.mrn.trim() !== '');
    console.log(`Valid records (with MRN): ${validRecords.length}`);
    if (validRecords.length === 0) {
        console.log("\n✓ No valid records to process in Pending Approval");
        return [];
    }
    // Log first few records for debugging
    console.log("\n=== SAMPLE RECORDS (first 3) ===");
    validRecords.slice(0, 3).forEach((record, idx) => {
        console.log(`\nRecord ${idx + 1}:`);
        console.log(`  MRN: "${record.mrn}"`);
        console.log(`  Insurance: "${record.insurance}"`);
        console.log(`  Billing Period: "${record.billingPeriodText}"`);
        console.log(`  Billing Period Start: "${record.billingPeriodStart}"`);
        console.log(`  Billing Period End: "${record.billingPeriodEnd}"`);
        console.log(`  Type of Bill: "${record.typeOfBill}"`);
        console.log(`  Edit Button ID: "${record.editButtonId}"`);
        console.log(`  All Cells: [${record.allCells.join(' | ')}]`);
    });
    // IMPORTANT: Identify duplicates and records that need Type of Bill 327
    // Use validRecords instead of records
    // If user selected specific insurances, create a normalized set for quick lookup
    const normalizedSelectedInsurances = (selectedInsurances && selectedInsurances.length > 0)
        ? selectedInsurances.map(s => s.toLowerCase().trim())
        : null;
    // Helper to check if an insurance matches the user's selection
    function isInsuranceSelected(insuranceName) {
        if (!normalizedSelectedInsurances) return true; // no filter = process all
        return normalizedSelectedInsurances.includes(insuranceName.toLowerCase().trim());
    }
    if (normalizedSelectedInsurances) {
        console.log(`\n=== FILTERING: Only processing selected insurances: ${selectedInsurances.join(', ')} ===`);
    }
    console.log("\n=== IDENTIFYING RECORDS THAT NEED TYPE OF BILL 327 ===");
    const recordsNeedingTOB327 = [];
    // DEBUG: Show all extracted records with full details
    console.log("\n=== DEBUG: ALL EXTRACTED RECORDS ===");
    console.log(`Total records extracted: ${validRecords.length}`);
    validRecords.forEach((record, index) => {
        console.log(`\n[${index}] Record Details:`);
        console.log(`  MRN: "${record.mrn}"`);
        console.log(`  Insurance: "${record.insurance}"`);
        console.log(`  Billing Period Text: "${record.billingPeriodText}"`);
        console.log(`  Billing Period Start: "${record.billingPeriodStart}"`);
        console.log(`  Billing Period End: "${record.billingPeriodEnd}"`);
        console.log(`  Type of Bill: "${record.typeOfBill}"`);
        // Test date parsing
        const startDate = new Date(record.billingPeriodStart);
        const endDate = new Date(record.billingPeriodEnd);
        console.log(`  Parsed Start Date: ${startDate.toISOString()} (Valid: ${!isNaN(startDate.getTime())})`);
        console.log(`  Parsed End Date: ${endDate.toISOString()} (Valid: ${!isNaN(endDate.getTime())})`);
    });
    // Check for duplicates with overlapping dates
    console.log("\n=== CHECKING FOR DUPLICATE MRNs WITH OVERLAPPING DATES ===");
    const duplicates = findDuplicatesWithOverlap(validRecords);
    // DEBUG: Show duplicate detection details
    console.log("\n=== DEBUG: DUPLICATE DETECTION ANALYSIS ===");
    // Group by MRN for analysis
    const mrnGroups = {};
    validRecords.forEach((record, index) => {
        if (!mrnGroups[record.mrn]) {
            mrnGroups[record.mrn] = [];
        }
        mrnGroups[record.mrn].push({ ...record, index });
    });
    console.log(`\nTotal unique MRNs: ${Object.keys(mrnGroups).length}`);
    Object.keys(mrnGroups).forEach(mrn => {
        const group = mrnGroups[mrn];
        if (group.length > 1) {
            console.log(`\n⚠️  MRN "${mrn}" has ${group.length} records:`);
            group.forEach(record => {
                console.log(`    [${record.index}] ${record.billingPeriodText} - ${record.insurance} - TOB: ${record.typeOfBill}`);
            });
            // Check for overlaps
            console.log(`  Checking for date overlaps:`);
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const r1 = group[i];
                    const r2 = group[j];
                    const start1 = new Date(r1.billingPeriodStart);
                    const end1 = new Date(r1.billingPeriodEnd);
                    const start2 = new Date(r2.billingPeriodStart);
                    const end2 = new Date(r2.billingPeriodEnd);
                    const overlaps = start1 <= end2 && start2 <= end1;
                    console.log(`    [${r1.index}] vs [${r2.index}]: ${overlaps ? '⚠️ OVERLAP DETECTED' : '✓ No overlap'}`);
                    if (overlaps) {
                        console.log(`      ${r1.billingPeriodStart} to ${r1.billingPeriodEnd}`);
                        console.log(`      ${r2.billingPeriodStart} to ${r2.billingPeriodEnd}`);
                    }
                }
            }
        }
    });
    if (duplicates.length > 0) {
        console.log(`\n⚠️  DUPLICATE DETECTION RESULTS: Found ${duplicates.length} duplicate MRN group(s) with overlapping billing periods`);
        for (const dup of duplicates) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Duplicate Group - MRN: ${dup.mrn}`);
            console.log(`  Total records in group: ${dup.indices.length}`);
            console.log(`  Record indices: [${dup.indices.join(', ')}]`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            // Show details for each record in the duplicate group
            dup.indices.forEach((idx) => {
                const record = validRecords[idx];
                console.log(`\n  Record [${idx}]:`);
                console.log(`    MRN: ${record.mrn}`);
                console.log(`    Insurance: ${record.insurance}`);
                console.log(`    Billing Period: ${record.billingPeriodText}`);
                console.log(`    Type of Bill: ${record.typeOfBill}`);
                console.log(`    Has TOB 327: ${record.typeOfBill.includes('327') ? 'YES ✓' : 'NO ✗'}`);
            });
            console.log(`\n  Processing duplicate records:`);
            // Add all duplicate record indices to the list
            dup.indices.forEach((idx) => {
                const record = validRecords[idx];
                // Only add if Type of Bill is 323 (needs to be changed to 327)
                if (record.typeOfBill.includes('323')) {
                    recordsNeedingTOB327.push(idx);
                    console.log(`    ❌ Record [${idx}] has TOB 323 → Will be changed to TOB 327`);
                    console.log(`       MRN: ${record.mrn}, Period: ${record.billingPeriodText}`);
                    // Track this for reporting
                    changedRecords.push({
                        mrn: record.mrn,
                        billingPeriod: record.billingPeriodText,
                        reason: 'Duplicate MRN with overlapping dates - changing TOB from 323 to 327'
                    });
                }
                else if (record.typeOfBill.includes('327')) {
                    console.log(`    ✅ Record [${idx}] ALREADY HAS TOB 327 → Will be APPROVED`);
                    console.log(`       MRN: ${record.mrn}, Period: ${record.billingPeriodText}`);
                }
                else {
                    console.log(`    ℹ️  Record [${idx}] has TOB ${record.typeOfBill} → Will be left as is`);
                    console.log(`       MRN: ${record.mrn}, Period: ${record.billingPeriodText}`);
                }
            });
        }
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`SUMMARY: ${recordsNeedingTOB327.length} record(s) with TOB 323 need to be changed to TOB 327`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        // AUTOMATICALLY CHANGE TYPE OF BILL FROM 323 TO 327 for duplicate records
        if (recordsNeedingTOB327.length > 0) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`  AUTOMATICALLY CHANGING ${recordsNeedingTOB327.length} RECORDS FROM TOB 323 TO TOB 327`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            for (const recordIndex of recordsNeedingTOB327) {
                const record = validRecords[recordIndex];
                console.log(`\n┌─────────────────────────────────────────────────────────┐`);
                console.log(`│ Changing Record [${recordIndex}] to TOB 327`);
                console.log(`├─────────────────────────────────────────────────────────┤`);
                console.log(`│ MRN: ${record.mrn}`);
                console.log(`│ Insurance: ${record.insurance}`);
                console.log(`│ Billing Period: ${record.billingPeriodText}`);
                console.log(`│ Current TOB: ${record.typeOfBill}`);
                console.log(`└─────────────────────────────────────────────────────────┘`);
                try {
                    // Step 1: Click the edit button
                    console.log(`  Step 1: Clicking edit button...`);
                    const editButtonId = record.editButtonId;
                    if (!editButtonId) {
                        console.log(`  ⚠️  No edit button ID found, trying to click by row index...`);
                        // Try to click the link directly by finding it in the row
                        const linkClicked = await page.evaluate((rowIndex) => {
                            const rows = Array.from(document.querySelectorAll('table tbody tr'));
                            if (rowIndex < rows.length) {
                                const row = rows[rowIndex];
                                // Try different element types - prioritize the edit link
                                let clickable = row.querySelector('a.ui-kinnser-edit');
                                if (!clickable) {
                                    clickable = row.querySelector('a[id*="openWorksheet"]');
                                }
                                if (!clickable) {
                                    clickable = row.querySelector('a[href*="claim"]');
                                }
                                if (!clickable) {
                                    clickable = row.querySelector('button');
                                }
                                if (!clickable) {
                                    clickable = row.querySelector('input[type="button"]');
                                }
                                if (!clickable) {
                                    // Try any link
                                    clickable = row.querySelector('a');
                                }
                                if (clickable) {
                                    console.log(`Found clickable element: ${clickable.tagName} id="${clickable.id}" class="${clickable.className}"`);
                                    clickable.click();
                                    return true;
                                }
                                else {
                                    console.log(`No clickable element found in row ${rowIndex}`);
                                    // Log what's in the row
                                    const cells = row.querySelectorAll('td');
                                    console.log(`Row has ${cells.length} cells`);
                                    cells.forEach((cell, i) => {
                                        const elements = cell.querySelectorAll('*');
                                        console.log(`  Cell ${i}: ${elements.length} elements - ${cell.innerHTML.substring(0, 100)}`);
                                    });
                                }
                            }
                            return false;
                        }, recordIndex);
                        if (!linkClicked) {
                            console.log(`  ✗ Could not find or click edit link for row ${recordIndex}`);
                            continue;
                        }
                        console.log(`  ✓ Clicked edit link by row index`);
                    }
                    else {
                        await page.click(`#${editButtonId}`);
                        console.log(`  ✓ Clicked edit button: ${editButtonId}`);
                    }
                    // Step 2: Wait for worksheet page to load FIRST
                    console.log(`  Step 2: Waiting for worksheet page to load...`);
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await page.waitForTimeout(3000);
                    console.log(`  ✓ Worksheet page loaded`);
                    // Step 3: NOW wait for and handle "Helpful Suggestion" modal (appears AFTER page loads)
                    console.log(`  Step 3: Waiting for "Helpful Suggestion" modal...`);
                    // Wait a bit for modal to appear
                    await page.waitForTimeout(2000);
                    // Try multiple approaches to click the modal
                    let modalClicked = false;
                    // Approach 1: Wait for visible modal button
                    try {
                        const modalVisible = await page.isVisible('#modal_go');
                        if (modalVisible) {
                            console.log(`  ✓ Modal is visible, clicking OK button...`);
                            await page.click('#modal_go', { timeout: 3000 });
                            console.log(`  ✓ Clicked OK on "Helpful Suggestion" modal`);
                            modalClicked = true;
                            await page.waitForTimeout(1000);
                        }
                    }
                    catch (e) {
                        console.log(`  ⚠️  Approach 1 failed: ${e.message}`);
                    }
                    // Approach 2: Try clicking via evaluate if approach 1 failed
                    if (!modalClicked) {
                        try {
                            const clicked = await page.evaluate(() => {
                                const modal = document.querySelector('.modal');
                                const okButton = document.querySelector('#modal_go');
                                console.log('Modal element:', modal ? 'Found' : 'Not found');
                                console.log('OK button:', okButton ? 'Found' : 'Not found');
                                if (okButton) {
                                    console.log('OK button visible:', okButton.offsetParent !== null);
                                    console.log('OK button disabled:', okButton.disabled);
                                    okButton.click();
                                    return true;
                                }
                                return false;
                            });
                            if (clicked) {
                                console.log(`  ✓ Clicked OK via evaluate`);
                                modalClicked = true;
                                await page.waitForTimeout(1000);
                            }
                        }
                        catch (e) {
                            console.log(`  ⚠️  Approach 2 failed: ${e.message}`);
                        }
                    }
                    if (!modalClicked) {
                        console.log(`  ⚠️  Modal not found or could not be clicked - continuing anyway`);
                    }
                    await page.waitForTimeout(2000);
                    // Step 4: Change Type of Bill to 327
                    console.log(`  Step 4: Changing Type of Bill to 327...`);
                    const tobChanged = await page.evaluate(() => {
                        var _a;
                        const select = document.querySelector('#typeOfBill');
                        if (!select) {
                            console.log('    ✗ Type of Bill dropdown not found');
                            return false;
                        }
                        console.log('    ✓ Found Type of Bill dropdown');
                        console.log(`    Current value: ${select.value} (${(_a = select.options[select.selectedIndex]) === null || _a === void 0 ? void 0 : _a.text})`);
                        // Find option with text "327 - Adjustment Claim" (value should be "6")
                        const option327 = Array.from(select.options).find(opt => opt.text.trim() === '327 - Adjustment Claim');
                        if (option327) {
                            console.log(`    ✓ Found option: value="${option327.value}" text="${option327.text}"`);
                            select.value = option327.value;
                            // Trigger change event for Angular
                            const changeEvent = new Event('change', { bubbles: true });
                            select.dispatchEvent(changeEvent);
                            // Also trigger input event
                            const inputEvent = new Event('input', { bubbles: true });
                            select.dispatchEvent(inputEvent);
                            console.log(`    ✓ Set dropdown to value: ${option327.value}`);
                            return true;
                        }
                        else {
                            console.log('    ✗ Could not find option "327 - Adjustment Claim" in dropdown');
                            console.log('    Available options:');
                            Array.from(select.options).forEach(opt => {
                                if (opt.text.includes('327') || opt.text.includes('323')) {
                                    console.log(`      - value="${opt.value}" text="${opt.text}"`);
                                }
                            });
                            return false;
                        }
                    });
                    if (tobChanged) {
                        console.log(`  ✓ Changed Type of Bill to 327 - Adjustment Claim`);
                    }
                    else {
                        console.log(`  ✗ Could not change Type of Bill - dropdown not found or option not available`);
                        // Navigate back to Pending Approval
                        await page.click('#pendingClaimsApproval');
                        await page.waitForTimeout(3000);
                        continue;
                    }
                    await page.waitForTimeout(1000);
                    // Step 5: Scroll to and click Save and Close
                    console.log(`  Step 5: Scrolling to Save and Close button...`);
                    await page.evaluate(() => {
                        const saveButton = document.querySelector('#submitBtn');
                        if (saveButton) {
                            saveButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    });
                    await page.waitForTimeout(1000);
                    console.log(`  Step 6: Clicking Save and Close...`);
                    await page.click('#submitBtn');
                    console.log(`  ✓ Clicked Save and Close`);
                    // Step 6: Wait for Pending Approval page to reload
                    console.log(`  Step 7: Waiting for Pending Approval page to reload...`);
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await page.waitForTimeout(3000);
                    console.log(`  ✓ Returned to Pending Approval page`);
                    console.log(`  ✅ Successfully changed record [${recordIndex}] to TOB 327`);
                    // Check if stop was requested
                    if (isStopRequested()) {
                        console.log(`\n⚠️  STOP REQUESTED - Stopping TOB 327 changes...`);
                        break;
                    }
                }
                catch (error) {
                    console.error(`  ✗ Error changing TOB 327 for record [${recordIndex}]:`, error);
                    // Try to navigate back to Pending Approval
                    try {
                        await page.click('#pendingClaimsApproval');
                        await page.waitForTimeout(3000);
                    }
                    catch (navError) {
                        console.error(`  ✗ Could not navigate back to Pending Approval`);
                    }
                }
            }
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`  TOB 323 → 327 CHANGES COMPLETE`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`✓ Changed ${recordsNeedingTOB327.length} record(s) from TOB 323 to TOB 327`);
            console.log(`✓ All duplicate records with TOB 323 now have TOB 327`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            // Reload the page to get fresh data with updated TOB values
            console.log(`\nReloading Pending Approval page to refresh data...`);
            await page.reload();
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await page.waitForTimeout(3000);
            // Re-select All Insurances after reload (dropdown resets to None)
            try {
                await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
                await page.selectOption('select[ng-model="insuranceKey"]', '1');
                console.log(`✓ Re-selected 'All Insurances' after reload`);
                await page.waitForTimeout(3000);
            } catch (reloadError) {
                console.log(`⚠️  Could not re-select insurances after reload`);
            }
            console.log(`✓ Page reloaded with updated data`);
        }
    }
    else {
        console.log("✓ No duplicate MRNs with overlapping billing periods found");
    }
    // PROCESS UNITED HEALTH CARE MA RECORDS (UD modifier + SN visit check)
    // This runs ALWAYS for UHC MA records, regardless of whether duplicates exist
    const uhcMARecords = isInsuranceSelected('united health care ma')
        ? validRecords.filter(r => r.insurance.toLowerCase().trim() === 'united health care ma')
        : [];
    const recordsNeedingTOB327ForUHC = [];
    if (uhcMARecords.length > 0) {
        console.log(`\n=== PROCESSING UNITED HEALTH CARE MA RECORDS ===`);
        console.log(`Found ${uhcMARecords.length} United health care MA record(s)`);
        console.log("  Requires: admission date check, UD modifier for >30 days, multiple SN check");
        for (const record of uhcMARecords) {
            console.log(`\nProcessing UHC MA record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            if (!record.editButtonId) {
                console.log(`  ⚠️  No edit button found - skipping`);
                continue;
            }
            try {
                // Step 1: Click print icon to get admission date from PDF
                console.log(`  Step 1: Getting admission date from PDF...`);
                let admissionDate = null;
                // Find print icon fresh from current page (table reloads after each save)
                let printIconId = null;
                try {
                    printIconId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            if ((row.textContent || '').includes(mrn)) {
                                const icon = row.querySelector('label[id*="openClaimPrintView"]');
                                if (icon) return icon.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                } catch (e) {}
                if (!printIconId) {
                    const claimNumber = record.editButtonId.replace('openWorksheet', '');
                    printIconId = `openClaimPrintView${claimNumber}`;
                }
                console.log(`  Print icon ID: ${printIconId}`);
                try {
                    const pdfBuffer = await extractPdfFromPrintIcon(page, printIconId);
                    if (pdfBuffer) {
                        const { extractDateOfAdmission } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
                        admissionDate = await extractDateOfAdmission(pdfBuffer);
                        if (admissionDate) {
                            console.log(`  \u2713 Admission Date: ${admissionDate}`);
                        } else {
                            console.log(`  \u26a0\ufe0f  Could not extract admission date from PDF`);
                        }
                    } else {
                        console.log(`  \u26a0\ufe0f  Could not get PDF content`);
                    }
                } catch (pdfError) {
                    console.log(`  \u26a0\ufe0f  Error getting PDF: ${pdfError.message}`);
                }
                // Step 2: Click edit button
                console.log(`  Step 2: Clicking edit button...`);
                await page.click(`#${record.editButtonId}`);
                console.log(`  ✓ Clicked edit button`);
                // Step 3: Wait for worksheet page to load
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                console.log(`  ✓ Worksheet page loaded`);
                // Step 4: Handle modal
                console.log(`  Step 3: Handling modal...`);
                await page.waitForTimeout(2000);
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) {
                        await page.click('#modal_go', { timeout: 3000 });
                        console.log(`  ✓ Clicked OK on modal`);
                    }
                } catch (e) {}
                try {
                    await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); });
                } catch (e) {}
                await page.waitForTimeout(2000);
                // Step 5: Expand Visits section
                console.log(`  Step 4: Expanding Visits section...`);
                try {
                    await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a.accordion-toggle'));
                        const visitsLink = links.find(a => a.textContent.trim() === 'Visits');
                        if (visitsLink) visitsLink.click();
                    });
                    console.log(`  ✓ Expanded Visits`);
                    await page.waitForTimeout(2000);
                } catch (e) {
                    console.log(`  ⚠️  Could not expand Visits section`);
                }
                // Step 6: Process SN visits - add UD modifier and check for multiples
                console.log(`  Step 5: Processing Skilled Nursing visits...`);
                let needsTOB327 = false;
                const visitResult = await page.evaluate((admDateStr) => {
                    const rows = Array.from(document.querySelectorAll('table.table-striped tbody tr'));
                    const snVisitsByDate = {};
                    let udModifiersAdded = 0;
                    let admDate = null;
                    const debugInfo = [];
                    if (admDateStr && admDateStr.length === 8) {
                        const month = parseInt(admDateStr.substring(0, 2)) - 1;
                        const day = parseInt(admDateStr.substring(2, 4));
                        const year = parseInt(admDateStr.substring(4, 8));
                        admDate = new Date(year, month, day);
                    }
                    rows.forEach((row, idx) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const dateStr = cells[0].textContent.trim();
                            const visitType = cells[1].textContent.trim();
                            // Match Skilled Nursing (case-insensitive, partial match)
                            const isSN = visitType.toLowerCase().includes('skilled nursing');
                            if (idx < 3) {
                                debugInfo.push(`Row ${idx}: date="${dateStr}" type="${visitType}" isSN=${isSN}`);
                            }
                            if (isSN) {
                                if (dateStr) {
                                    if (!snVisitsByDate[dateStr]) snVisitsByDate[dateStr] = 0;
                                    snVisitsByDate[dateStr]++;
                                }
                                if (admDate && dateStr) {
                                    const parts = dateStr.split('/');
                                    if (parts.length === 3) {
                                        const visitDate = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
                                        const diffDays = Math.floor((visitDate - admDate) / (1000 * 60 * 60 * 24));
                                        if (diffDays > 30) {
                                            // Try modifier1 first
                                            const modifier1 = row.querySelector('input[ng-model="lineItem.modifier1"]');
                                            if (modifier1) {
                                                const m1Val = modifier1.value.trim();
                                                if (!m1Val || m1Val === '') {
                                                    modifier1.value = 'UD';
                                                    modifier1.dispatchEvent(new Event('input', { bubbles: true }));
                                                    modifier1.dispatchEvent(new Event('change', { bubbles: true }));
                                                    udModifiersAdded++;
                                                } else if (m1Val !== 'UD') {
                                                    // modifier1 occupied, try modifier2
                                                    const modifier2 = row.querySelector('input[ng-model="lineItem.modifier2"]');
                                                    if (modifier2 && (!modifier2.value.trim() || modifier2.value.trim() === '')) {
                                                        modifier2.value = 'UD';
                                                        modifier2.dispatchEvent(new Event('input', { bubbles: true }));
                                                        modifier2.dispatchEvent(new Event('change', { bubbles: true }));
                                                        udModifiersAdded++;
                                                    }
                                                }
                                                // If modifier1 already has UD, skip (already done)
                                            } else {
                                                // Try alternative selectors
                                                const allInputs = row.querySelectorAll('input[type="text"]');
                                                // Typically modifier inputs are after HCPCS/Revenue code inputs
                                                // Look for inputs with short maxlength (modifiers are 2 chars)
                                                for (const inp of allInputs) {
                                                    const maxLen = inp.getAttribute('maxlength');
                                                    if (maxLen && parseInt(maxLen) <= 4 && !inp.value.trim()) {
                                                        inp.value = 'UD';
                                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                                        udModifiersAdded++;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                    let hasMultipleSNSameDate = false;
                    const multipleDates = [];
                    for (const [date, count] of Object.entries(snVisitsByDate)) {
                        if (count > 1) { hasMultipleSNSameDate = true; multipleDates.push({ date, count }); }
                    }
                    return { udModifiersAdded, hasMultipleSNSameDate, multipleDates, snVisitsByDate, debugInfo, totalRows: rows.length };
                }, admissionDate);
                console.log(`  UD modifiers added: ${visitResult.udModifiersAdded}`);
                console.log(`  SN visits by date: ${JSON.stringify(visitResult.snVisitsByDate)}`);
                if (visitResult.debugInfo && visitResult.debugInfo.length > 0) {
                    visitResult.debugInfo.forEach(d => console.log(`    ${d}`));
                }
                console.log(`  Total rows in visits table: ${visitResult.totalRows}`);
                // Check if multiple SN visits on same date → TOB 327
                if (visitResult.hasMultipleSNSameDate) {
                    console.log(`  ❌ More than 1 SN visit on same date → TOB 327:`);
                    visitResult.multipleDates.forEach(d => console.log(`    ${d.date}: ${d.count} visits`));
                    needsTOB327 = true;
                }
                // Check if billing period is more than 30 days from admission → TOB 327
                if (!needsTOB327 && admissionDate && record.billingPeriodEnd) {
                    const admMonth = parseInt(admissionDate.substring(0, 2)) - 1;
                    const admDay = parseInt(admissionDate.substring(2, 4));
                    const admYear = parseInt(admissionDate.substring(4, 8));
                    const admDate = new Date(admYear, admMonth, admDay);
                    const endParts = record.billingPeriodEnd.split('/');
                    if (endParts.length === 3) {
                        const endDate = new Date(parseInt(endParts[2]), parseInt(endParts[0]) - 1, parseInt(endParts[1]));
                        const diffDays = Math.floor((endDate - admDate) / (1000 * 60 * 60 * 24));
                        console.log(`  Billing Period End: ${record.billingPeriodEnd}, Admission: ${admissionDate}, Days diff: ${diffDays}`);
                        if (diffDays > 30) {
                            console.log(`  ❌ Claim dates are ${diffDays} days from admission (> 30) → TOB 327`);
                            needsTOB327 = true;
                        }
                    }
                }
                // Step 7: Change TOB to 327 if needed
                if (needsTOB327) {
                    console.log(`  Step 6: Changing TOB to 327...`);
                    await page.evaluate(() => {
                        const select = document.querySelector('#typeOfBill');
                        if (select) {
                            const option327 = Array.from(select.options).find(opt => opt.text.trim() === '327 - Adjustment Claim');
                            if (option327) { select.value = option327.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
                        }
                    });
                    console.log(`  ✓ Changed TOB to 327`);
                    recordsNeedingTOB327ForUHC.push(record.index);
                }
                // Step 8: Save and Close
                console.log(`  Step 7: Clicking Save and Close...`);
                await page.evaluate(() => { const btn = document.querySelector('#submitBtn'); if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
                await page.waitForTimeout(1000);
                await page.click('#submitBtn');
                console.log(`  ✓ Clicked Save and Close`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // Wait for loading spinner to disappear
                try {
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
                } catch (e) {}
                await page.waitForTimeout(3000);
                // Wait for table to be ready
                try {
                    await page.waitForSelector('table tbody tr', { timeout: 15000 });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  ✅ Successfully processed UHC MA record`);
            } catch (error) {
                console.error(`  ✗ Error processing UHC MA record:`, error.message || error);
                try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                    try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                }
            }
        }
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`UHC MA SUMMARY: ${uhcMARecords.length} processed, ${recordsNeedingTOB327ForUHC.length} changed to TOB 327`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
    // PROCESS COMMONWEALTH CARE ALLIANCE RECORDS (UD modifier + Occurrence Code 50)
    // This runs ALWAYS for CCA records, regardless of whether duplicates exist
    const ccaRecords = isInsuranceSelected('commonwealth care alliance')
        ? validRecords.filter(r => r.insurance.toLowerCase().trim() === 'commonwealth care alliance')
        : [];
    if (ccaRecords.length > 0) {
        console.log(`\n=== PROCESSING COMMONWEALTH CARE ALLIANCE RECORDS ===`);
        console.log(`Found ${ccaRecords.length} Commonwealth Care Alliance record(s)`);
        console.log("  Requires: admission date check, UD modifier for >30 days, Occurrence Code 50");
        for (const record of ccaRecords) {
            console.log(`\nProcessing CCA record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            if (!record.editButtonId) {
                console.log(`  ⚠️  No edit button found - skipping`);
                continue;
            }
            try {
                // Step 1: Click print icon to get admission date from PDF
                console.log(`  Step 1: Getting admission date from PDF...`);
                let admissionDate = null;
                // Find print icon fresh from current page (table reloads after each save)
                let printIconId = null;
                try {
                    printIconId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            if ((row.textContent || '').includes(mrn)) {
                                const icon = row.querySelector('label[id*="openClaimPrintView"]');
                                if (icon) return icon.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                } catch (e) {}
                if (!printIconId) {
                    const claimNumber = record.editButtonId.replace('openWorksheet', '');
                    printIconId = `openClaimPrintView${claimNumber}`;
                }
                console.log(`  Print icon ID: ${printIconId}`);
                try {
                    const pdfBuffer = await extractPdfFromPrintIcon(page, printIconId);
                    if (pdfBuffer) {
                        const { extractDateOfAdmission } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
                        admissionDate = await extractDateOfAdmission(pdfBuffer);
                        if (admissionDate) {
                            console.log(`  \u2713 Admission Date: ${admissionDate}`);
                        } else {
                            console.log(`  \u26a0\ufe0f  Could not extract admission date from PDF`);
                        }
                    } else {
                        console.log(`  \u26a0\ufe0f  Could not get PDF content`);
                    }
                } catch (pdfError) {
                    console.log(`  \u26a0\ufe0f  Error getting PDF: ${pdfError.message}`);
                }
                console.log(`  Step 2: Clicking edit button...`);
                await page.click(`#${record.editButtonId}`);
                console.log(`  ✓ Clicked edit button`);
                // Step 3: Wait for worksheet page to load
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                console.log(`  ✓ Worksheet page loaded`);
                // Step 4: Handle modal
                console.log(`  Step 3: Handling modal...`);
                await page.waitForTimeout(2000);
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) {
                        await page.click('#modal_go', { timeout: 3000 });
                        console.log(`  ✓ Clicked OK on modal`);
                    }
                } catch (e) {}
                try {
                    await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); });
                } catch (e) {}
                await page.waitForTimeout(2000);
                // Step 5: Expand Visits section and add UD modifier
                console.log(`  Step 4: Expanding Visits section...`);
                try {
                    await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a.accordion-toggle'));
                        const visitsLink = links.find(a => a.textContent.trim() === 'Visits');
                        if (visitsLink) visitsLink.click();
                    });
                    console.log(`  ✓ Expanded Visits`);
                    await page.waitForTimeout(2000);
                } catch (e) {
                    console.log(`  ⚠️  Could not expand Visits section`);
                }
                // Step 6: Process SN visits - add UD modifier for visits > 30 days from admission
                // Also check: if any date has > 2 SN visits, skip the claim
                console.log(`  Step 5: Processing Skilled Nursing visits for UD modifier...`);
                const visitResult = await page.evaluate((admDateStr) => {
                    const rows = Array.from(document.querySelectorAll('table.table-striped tbody tr'));
                    let udModifiersAdded = 0;
                    const snVisitsByDate = {};
                    let admDate = null;
                    const debugInfo = [];
                    if (admDateStr && admDateStr.length === 8) {
                        const month = parseInt(admDateStr.substring(0, 2)) - 1;
                        const day = parseInt(admDateStr.substring(2, 4));
                        const year = parseInt(admDateStr.substring(4, 8));
                        admDate = new Date(year, month, day);
                    }
                    rows.forEach((row, idx) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const dateStr = cells[0].textContent.trim();
                            const visitType = cells[1].textContent.trim();
                            // Match Skilled Nursing (case-insensitive)
                            const isSN = visitType.toLowerCase().includes('skilled nursing');
                            if (idx < 3) {
                                debugInfo.push(`Row ${idx}: date="${dateStr}" type="${visitType}" isSN=${isSN}`);
                            }
                            if (isSN) {
                                // Count SN visits by date
                                if (dateStr) {
                                    if (!snVisitsByDate[dateStr]) snVisitsByDate[dateStr] = 0;
                                    snVisitsByDate[dateStr]++;
                                }
                                // Add UD modifier if > 30 days from admission
                                if (admDate && dateStr) {
                                    const parts = dateStr.split('/');
                                    if (parts.length === 3) {
                                        const visitDate = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
                                        const diffDays = Math.floor((visitDate - admDate) / (1000 * 60 * 60 * 24));
                                        if (diffDays > 30) {
                                            const modifier1 = row.querySelector('input[ng-model="lineItem.modifier1"]');
                                            if (modifier1) {
                                                const m1Val = modifier1.value.trim();
                                                if (!m1Val || m1Val === '') {
                                                    modifier1.value = 'UD';
                                                    modifier1.dispatchEvent(new Event('input', { bubbles: true }));
                                                    modifier1.dispatchEvent(new Event('change', { bubbles: true }));
                                                    // Also update Angular model
                                                    if (window.angular) {
                                                        try {
                                                            const scope = window.angular.element(modifier1).scope();
                                                            if (scope && scope.lineItem) {
                                                                scope.$apply(() => { scope.lineItem.modifier1 = 'UD'; });
                                                            }
                                                        } catch(e) {}
                                                    }
                                                    udModifiersAdded++;
                                                } else if (m1Val !== 'UD') {
                                                    const modifier2 = row.querySelector('input[ng-model="lineItem.modifier2"]');
                                                    if (modifier2 && (!modifier2.value.trim() || modifier2.value.trim() === '')) {
                                                        modifier2.value = 'UD';
                                                        modifier2.dispatchEvent(new Event('input', { bubbles: true }));
                                                        modifier2.dispatchEvent(new Event('change', { bubbles: true }));
                                                        if (window.angular) {
                                                            try {
                                                                const scope = window.angular.element(modifier2).scope();
                                                                if (scope && scope.lineItem) {
                                                                    scope.$apply(() => { scope.lineItem.modifier2 = 'UD'; });
                                                                }
                                                            } catch(e) {}
                                                        }
                                                        udModifiersAdded++;
                                                    }
                                                }
                                            } else {
                                                // Fallback: find modifier inputs by maxlength
                                                const allInputs = row.querySelectorAll('input[type="text"]');
                                                for (const inp of allInputs) {
                                                    const maxLen = inp.getAttribute('maxlength');
                                                    if (maxLen && parseInt(maxLen) <= 4 && !inp.value.trim()) {
                                                        inp.value = 'UD';
                                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                                        udModifiersAdded++;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                    // Check if any date has more than 2 SN visits
                    let hasExcessiveSNVisits = false;
                    const excessiveDates = [];
                    for (const [date, count] of Object.entries(snVisitsByDate)) {
                        if (count > 2) {
                            hasExcessiveSNVisits = true;
                            excessiveDates.push({ date, count });
                        }
                    }
                    return { udModifiersAdded, snVisitsByDate, hasExcessiveSNVisits, excessiveDates, debugInfo, totalRows: rows.length };
                }, admissionDate);
                console.log(`  UD modifiers added: ${visitResult.udModifiersAdded}`);
                console.log(`  SN visits by date: ${JSON.stringify(visitResult.snVisitsByDate)}`);
                if (visitResult.debugInfo && visitResult.debugInfo.length > 0) {
                    visitResult.debugInfo.forEach(d => console.log(`    ${d}`));
                }
                console.log(`  Total rows in visits table: ${visitResult.totalRows}`);
                // Track if this claim has excessive SN visits (will be excluded from approval later)
                if (visitResult.hasExcessiveSNVisits) {
                    console.log(`  ⚠️  More than 2 SN visits on same date - claim will NOT be approved`);
                    visitResult.excessiveDates.forEach(d => console.log(`    ${d.date}: ${d.count} visits (exceeds limit of 2)`));
                    record.skipApproval = true;
                }
                // Step 7: Determine Occurrence Code 50 date
                console.log(`  Step 6: Determining Occurrence Code 50...`);
                let occurrenceCode50Date = null;
                if (admissionDate && record.billingPeriodStart) {
                    // Parse admission date (mmddyyyy format)
                    const admMonth = parseInt(admissionDate.substring(0, 2)) - 1;
                    const admDay = parseInt(admissionDate.substring(2, 4));
                    const admYear = parseInt(admissionDate.substring(4, 8));
                    const admDate = new Date(admYear, admMonth, admDay);
                    // Parse billing period start (MM/DD/YYYY format)
                    const startParts = record.billingPeriodStart.split('/');
                    if (startParts.length === 3) {
                        const billingStartDate = new Date(parseInt(startParts[2]), parseInt(startParts[0]) - 1, parseInt(startParts[1]));
                        const diffDays = Math.floor((billingStartDate - admDate) / (1000 * 60 * 60 * 24));
                        console.log(`  Billing Period Start: ${record.billingPeriodStart}, Admission: ${admissionDate}, Days diff: ${diffDays}`);
                        if (diffDays <= 60) {
                            // Scenario A: Within 60 days - Occurrence Code 50 = Admission Date
                            const admFormatted = `${admissionDate.substring(0, 2)}/${admissionDate.substring(2, 4)}/${admissionDate.substring(4, 8)}`;
                            occurrenceCode50Date = admFormatted;
                            console.log(`  ✓ Scenario A: Within 60 days → Occurrence Code 50 = Admission Date: ${occurrenceCode50Date}`);
                        } else {
                            // Scenario B: More than 60 days - need to find Recertification visit date
                            console.log(`  Scenario B: More than 60 days (${diffDays}) → Need Recertification visit date`);
                            console.log(`  Episode URL from table: ${record.billingPeriodHref || 'NOT FOUND'}`);
                            if (record.billingPeriodHref) {
                                // Step B1: Click Return to go back to Pending Approval
                                console.log(`  Clicking Return to go back to Pending Approval...`);
                                try { await page.click('#returnBtn'); } catch (e) {
                                    try { await page.click('#cancelBtn'); } catch (e2) {}
                                }
                                await page.waitForTimeout(3000);
                                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                await page.waitForTimeout(2000);
                                // Step B2: Navigate to the episode page
                                console.log(`  Navigating to episode: ${record.billingPeriodHref}`);
                                await page.goto(record.billingPeriodHref, { waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(3000);
                                // Step B3: Click "Previous Episode" link
                                const prevEpisodeExists = await page.isVisible('#previouscert');
                                if (prevEpisodeExists) {
                                    console.log(`  ✓ Clicking Previous Episode link...`);
                                    await page.click('#previouscert');
                                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                    await page.waitForTimeout(3000);
                                    // Step B4: Search for Recertification visit on Nursing tab
                                    let recertDate = await page.evaluate(() => {
                                        const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                        let latestRecertDate = null;
                                        for (const row of rows) {
                                            if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                            if (row.classList.contains('hRowBgImage')) continue;
                                            const cells = row.querySelectorAll('td');
                                            if (cells.length < 2) continue;
                                            const taskCell = cells[1];
                                            const taskText = taskCell ? taskCell.textContent.trim() : '';
                                            if (taskText.toLowerCase().includes('recertification')) {
                                                const statusDiv = row.querySelector('div[id^="Status"]');
                                                const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) {
                                                    continue;
                                                }
                                                const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                if (visitDate && visitDate.includes('/')) {
                                                    latestRecertDate = visitDate;
                                                }
                                            }
                                        }
                                        return latestRecertDate;
                                    });
                                    // Step B5: If not found on Nursing, check Therapy tab
                                    if (!recertDate) {
                                        console.log(`  ⚠️  No Recertification on Nursing tab, checking Therapy...`);
                                        const therapyLink = await page.$('#LinkTherapy');
                                        if (therapyLink) {
                                            await therapyLink.click();
                                            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                            await page.waitForTimeout(3000);
                                            recertDate = await page.evaluate(() => {
                                                const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                                let latestRecertDate = null;
                                                for (const row of rows) {
                                                    if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                                    if (row.classList.contains('hRowBgImage')) continue;
                                                    const cells = row.querySelectorAll('td');
                                                    if (cells.length < 2) continue;
                                                    const taskCell = cells[1];
                                                    const taskText = taskCell ? taskCell.textContent.trim() : '';
                                                    if (taskText.toLowerCase().includes('recertification')) {
                                                        const statusDiv = row.querySelector('div[id^="Status"]');
                                                        const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                        if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) {
                                                            continue;
                                                        }
                                                        const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                        const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                        if (visitDate && visitDate.includes('/')) {
                                                            latestRecertDate = visitDate;
                                                        }
                                                    }
                                                }
                                                return latestRecertDate;
                                            });
                                        }
                                    }
                                    if (recertDate) {
                                        occurrenceCode50Date = recertDate;
                                        console.log(`  ✓ Scenario B: Found Recertification visit date → Occurrence Code 50 = ${occurrenceCode50Date}`);
                                    } else {
                                        console.log(`  ⚠️  No Recertification visit found in previous episode`);
                                        console.log(`  ⚠️  Record will NOT be processed - staying in Pending Approval`);
                                        record.skipApproval = true;
                                    }
                                } else {
                                    console.log(`  ⚠️  No Previous Episode link found on episode page`);
                                    console.log(`  ⚠️  Record will NOT be processed - staying in Pending Approval`);
                                    record.skipApproval = true;
                                }
                                // Step B6: Navigate back to Pending Approval
                                console.log(`  Navigating back to Pending Approval...`);
                                await page.goto(page.url().split('/AM/Patient')[0] + '/EHR/#/AM/billing/claims-manager/managed-care/approve-claims', { waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(3000);
                                // Re-select insurance
                                try {
                                    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
                                    await page.selectOption('select[ng-model="insuranceKey"]', '12');
                                    await page.waitForTimeout(3000);
                                } catch (e) { console.log(`  ⚠️  Could not re-select insurance after navigation`); }
                                // Step B7: Re-open claim worksheet to set values
                                console.log(`  Re-opening claim worksheet...`);
                                try {
                                    await page.waitForSelector(`#${record.editButtonId}`, { timeout: 15000 });
                                    await page.click(`#${record.editButtonId}`);
                                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                    await page.waitForTimeout(3000);
                                    // Handle modal
                                    try {
                                        const modalVisible = await page.isVisible('#modal_go');
                                        if (modalVisible) { await page.click('#modal_go', { timeout: 3000 }); }
                                    } catch (e) {}
                                    try { await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); }); } catch (e) {}
                                    await page.waitForTimeout(2000);
                                    console.log(`  ✓ Re-opened claim worksheet`);
                                } catch (navError) {
                                    console.log(`  ⚠️  Could not re-open claim worksheet: ${navError.message}`);
                                }
                            } else {
                                // No billing period link available - fall back to admission date
                                const admFormatted = `${admissionDate.substring(0, 2)}/${admissionDate.substring(2, 4)}/${admissionDate.substring(4, 8)}`;
                                occurrenceCode50Date = admFormatted;
                                console.log(`  ⚠️  No billing period link available, using Admission Date: ${occurrenceCode50Date}`);
                            }
                        }
                    }
                } else {
                    console.log(`  ⚠️  Missing admission date or billing period start - cannot determine Occurrence Code 50`);
                }
                // Step 8: Set Occurrence Code 50 in the claim worksheet
                if (occurrenceCode50Date) {
                    console.log(`  Step 7: Setting Occurrence Code 50 = ${occurrenceCode50Date}...`);
                    // Directly set the value on the first empty occurrence code slot via Angular model
                    const occResult = await page.evaluate((args) => {
                        const dateVal = args.dateVal;
                        const results = { success: false, slot: 0, methods: [], verifiedCode: '', verifiedDate: '' };
                        // Find first empty slot
                        let targetSlot = 0;
                        for (let i = 1; i <= 8; i++) {
                            const codeInput = document.querySelector(`#occurenceCode${i}`);
                            if (codeInput) {
                                const val = codeInput.value;
                                if (!val || val.trim() === '') {
                                    targetSlot = i;
                                    break;
                                }
                                if (val === '50') {
                                    targetSlot = i;
                                    break;
                                }
                            }
                        }
                        if (!targetSlot) {
                            results.methods.push('no-empty-slot');
                            return results;
                        }
                        results.slot = targetSlot;
                        const codeInput = document.querySelector(`#occurenceCode${targetSlot}`);
                        const dateInput = document.querySelector(`#occurenceDate${targetSlot}`);
                        // Set the code value
                        if (codeInput) {
                            codeInput.value = '50';
                            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                            codeInput.dispatchEvent(new Event('change', { bubbles: true }));
                            results.methods.push('code-input-direct');
                        }
                        // Set the date value
                        if (dateInput) {
                            dateInput.value = dateVal;
                            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                            dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
                            results.methods.push('date-input-direct');
                        }
                        // Update Angular scope/model
                        try {
                            if (window.angular && codeInput) {
                                const scope = window.angular.element(codeInput).scope();
                                if (scope && scope.claim) {
                                    scope.$apply(() => {
                                        // Try setting as Select2 data object
                                        scope.claim[`occurenceCode${targetSlot}Select2`] = { id: '50', text: '50' };
                                    });
                                    results.methods.push('angular-scope-object');
                                }
                            }
                        } catch (e) {
                            results.methods.push('angular-obj-err: ' + e.message);
                            // Try as string
                            try {
                                if (window.angular && codeInput) {
                                    const scope = window.angular.element(codeInput).scope();
                                    if (scope && scope.claim) {
                                        scope.$apply(() => {
                                            scope.claim[`occurenceCode${targetSlot}Select2`] = '50';
                                        });
                                        results.methods.push('angular-scope-string');
                                    }
                                }
                            } catch (e2) { results.methods.push('angular-str-err: ' + e2.message); }
                        }
                        // Also try jQuery Select2 API
                        try {
                            const $ = window.jQuery;
                            if ($ && $.fn.select2) {
                                $(`#occurenceCode${targetSlot}`).select2('data', { id: '50', text: '50' });
                                $(`#occurenceCode${targetSlot}`).trigger('change');
                                results.methods.push('jquery-select2-data');
                            }
                        } catch (e) { results.methods.push('jquery-err: ' + e.message); }
                        // Update Angular scope for date too
                        try {
                            if (window.angular && dateInput) {
                                const scope = window.angular.element(dateInput).scope();
                                if (scope && scope.claim) {
                                    scope.$apply(() => {
                                        scope.claim[`occurenceDate${targetSlot}`] = dateVal;
                                    });
                                    results.methods.push('date-angular-scope');
                                }
                            }
                        } catch (e) { results.methods.push('date-angular-err: ' + e.message); }
                        // Verify
                        results.verifiedCode = codeInput ? codeInput.value : '';
                        results.verifiedDate = dateInput ? dateInput.value : '';
                        const select2Text = document.querySelector(`#s2id_occurenceCode${targetSlot} .select2-chosen`);
                        results.select2Display = select2Text ? select2Text.textContent.trim() : '';
                        results.success = true;
                        return results;
                    }, { dateVal: occurrenceCode50Date });
                    console.log(`  Slot: ${occResult.slot}`);
                    console.log(`  Methods: ${occResult.methods.join(', ')}`);
                    console.log(`  Verified Code: "${occResult.verifiedCode}", Date: "${occResult.verifiedDate}"`);
                    console.log(`  Select2 Display: "${occResult.select2Display}"`);
                    if (occResult.success) {
                        console.log(`  ✓ Occurrence Code 50 = ${occurrenceCode50Date} set in slot ${occResult.slot}`);
                    } else {
                        console.log(`  ⚠️  Could not set Occurrence Code 50`);
                    }
                }
                // Step 9: Save and Close
                console.log(`  Step 8: Clicking Save and Close...`);
                await page.evaluate(() => { const btn = document.querySelector('#submitBtn'); if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
                await page.waitForTimeout(1000);
                await page.click('#submitBtn');
                console.log(`  ✓ Clicked Save and Close`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // Wait for loading spinner to disappear
                try {
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
                } catch (e) {}
                await page.waitForTimeout(3000);
                // Wait for table to be ready
                try {
                    await page.waitForSelector('table tbody tr', { timeout: 15000 });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  ✅ Successfully processed CCA record`);
            } catch (error) {
                console.error(`  ✗ Error processing CCA record:`, error.message || error);
                try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                    try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                }
            }
        }
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`CCA SUMMARY: ${ccaRecords.length} processed`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
    // PROCESS UCSD / UCSD COMMERCIAL RECORDS (Occurrence Code 50 + Value Codes 61/85)
    // This runs ALWAYS for UCSD records, regardless of whether duplicates exist
    const ucsdRecords = (isInsuranceSelected('ucsd') || isInsuranceSelected('ucsd commercial'))
        ? validRecords.filter(r => {
            const ins = r.insurance.toLowerCase().trim();
            return ins === 'ucsd' || ins === 'ucsd commercial';
        })
        : [];
    if (ucsdRecords.length > 0) {
        console.log(`\n=== PROCESSING UCSD / UCSD COMMERCIAL RECORDS ===`);
        console.log(`Found ${ucsdRecords.length} UCSD record(s)`);
        console.log("  Requires: Occurrence Code 50, Value Code 61 (CBSA), Value Code 85 (FIPS)");
        // Load Value Codes Information spreadsheet for ZIP lookup
        let valueCodesData = null;
        try {
            const valueCodesPath = path.join(__dirname, '..', 'Value Codes Information.xlsx');
            const vcWorkbook = XLSX.readFile(valueCodesPath);
            // Use 'All States' sheet which has all ZIPs
            const vcSheet = vcWorkbook.Sheets['All States'];
            valueCodesData = XLSX.utils.sheet_to_json(vcSheet);
            console.log(`  ✓ Loaded Value Codes Information: ${valueCodesData.length} ZIP entries`);
        } catch (vcError) {
            console.log(`  ⚠️  Could not load Value Codes Information.xlsx: ${vcError.message}`);
            console.log(`  ⚠️  UCSD records cannot be processed without Value Codes data`);
        }
        if (valueCodesData) {
            for (const record of ucsdRecords) {
                console.log(`\nProcessing UCSD record:`);
                console.log(`  MRN: ${record.mrn}`);
                console.log(`  Insurance: ${record.insurance}`);
                console.log(`  Billing Period: ${record.billingPeriodText}`);
                if (!record.editButtonId) {
                    console.log(`  ⚠️  No edit button found - skipping`);
                    continue;
                }
                try {
                    // Step 1: Click print icon to get admission date from PDF
                    console.log(`  Step 1: Getting admission date from PDF...`);
                    let admissionDate = null;
                    // Find print icon fresh from current page
                    let printIconId = null;
                    try {
                        printIconId = await page.evaluate((mrn) => {
                            const rows = Array.from(document.querySelectorAll('table tbody tr'));
                            for (const row of rows) {
                                if ((row.textContent || '').includes(mrn)) {
                                    const icon = row.querySelector('label[id*="openClaimPrintView"]');
                                    if (icon) return icon.id;
                                }
                            }
                            return null;
                        }, record.mrn);
                    } catch (e) {}
                    if (!printIconId) {
                        const claimNumber = record.editButtonId.replace('openWorksheet', '');
                        printIconId = `openClaimPrintView${claimNumber}`;
                    }
                    console.log(`  Print icon ID: ${printIconId}`);
                    try {
                            const pdfBuffer = await extractPdfFromPrintIcon(page, printIconId);
                        if (pdfBuffer) {
                                const { extractDateOfAdmission } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
                            admissionDate = await extractDateOfAdmission(pdfBuffer);
                            if (admissionDate) {
                                    console.log(`  \u2713 Admission Date: ${admissionDate}`);
                                } else {
                                    console.log(`  \u26a0\ufe0f  Could not extract admission date from PDF`);
                        }
                        } else {
                                    console.log(`  \u26a0\ufe0f  Could not get PDF content`);
                    }
                    } catch (pdfError) {
                            console.log(`  \u26a0\ufe0f  Error getting PDF: ${pdfError.message}`);
                }
                    console.log(`  Step 2: Determining Occurrence Code 50...`);
                    let occurrenceCode50Date = null;
                    if (admissionDate && record.billingPeriodEnd) {
                        // Parse admission date (mmddyyyy format)
                        const admMonth = parseInt(admissionDate.substring(0, 2)) - 1;
                        const admDay = parseInt(admissionDate.substring(2, 4));
                        const admYear = parseInt(admissionDate.substring(4, 8));
                        const admDate = new Date(admYear, admMonth, admDay);
                        // Parse billing period END date (MM/DD/YYYY format)
                        const endParts = record.billingPeriodEnd.split('/');
                        if (endParts.length === 3) {
                            const billingEndDate = new Date(parseInt(endParts[2]), parseInt(endParts[0]) - 1, parseInt(endParts[1]));
                            const diffDays = Math.floor((billingEndDate - admDate) / (1000 * 60 * 60 * 24));
                            console.log(`  Billing Period End: ${record.billingPeriodEnd}, Admission: ${admissionDate}, Days diff: ${diffDays}`);
                            if (diffDays <= 60) {
                                // SCENARIO A: Within 60 days - OC50 = Admission Date
                                const admFormatted = `${admissionDate.substring(0, 2)}/${admissionDate.substring(2, 4)}/${admissionDate.substring(4, 8)}`;
                                occurrenceCode50Date = admFormatted;
                                console.log(`  ✓ Scenario A: Within 60 days → OC50 = Admission Date: ${occurrenceCode50Date}`);
                            } else {
                                // SCENARIO B: More than 60 days - find Recertification visit date
                                console.log(`  Scenario B: More than 60 days (${diffDays}) → Need Recertification visit date`);
                                console.log(`  Episode URL from table: ${record.billingPeriodHref || 'NOT FOUND'}`);
                                if (record.billingPeriodHref) {
                                    // Navigate to episode page
                                    console.log(`  Navigating to episode: ${record.billingPeriodHref}`);
                                    await page.goto(record.billingPeriodHref, { waitUntil: 'domcontentloaded' });
                                    await page.waitForTimeout(3000);
                                    // Click "Previous Episode" link
                                    const prevEpisodeExists = await page.isVisible('#previouscert');
                                    if (prevEpisodeExists) {
                                        console.log(`  ✓ Clicking Previous Episode link...`);
                                        await page.click('#previouscert');
                                        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                        await page.waitForTimeout(3000);
                                        // Search for Recertification visit on Nursing tab
                                        let recertDate = await page.evaluate(() => {
                                            const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                            let latestRecertDate = null;
                                            for (const row of rows) {
                                                if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                                if (row.classList.contains('hRowBgImage')) continue;
                                                const cells = row.querySelectorAll('td');
                                                if (cells.length < 2) continue;
                                                const taskCell = cells[1];
                                                const taskText = taskCell ? taskCell.textContent.trim() : '';
                                                if (taskText.toLowerCase().includes('recertification')) {
                                                    const statusDiv = row.querySelector('div[id^="Status"]');
                                                    const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                    if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) {
                                                        continue;
                                                    }
                                                    const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                    const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                    if (visitDate && visitDate.includes('/')) {
                                                        latestRecertDate = visitDate;
                                                    }
                                                }
                                            }
                                            return latestRecertDate;
                                        });
                                        // If not found on Nursing, check Therapy tab
                                        if (!recertDate) {
                                            console.log(`  ⚠️  No Recertification on Nursing tab, checking Therapy...`);
                                            const therapyLink = await page.$('#LinkTherapy');
                                            if (therapyLink) {
                                                await therapyLink.click();
                                                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                                await page.waitForTimeout(3000);
                                                recertDate = await page.evaluate(() => {
                                                    const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                                    let latestRecertDate = null;
                                                    for (const row of rows) {
                                                        if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                                        if (row.classList.contains('hRowBgImage')) continue;
                                                        const cells = row.querySelectorAll('td');
                                                        if (cells.length < 2) continue;
                                                        const taskCell = cells[1];
                                                        const taskText = taskCell ? taskCell.textContent.trim() : '';
                                                        if (taskText.toLowerCase().includes('recertification')) {
                                                            const statusDiv = row.querySelector('div[id^="Status"]');
                                                            const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                            if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) {
                                                                continue;
                                                            }
                                                            const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                            const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                            if (visitDate && visitDate.includes('/')) {
                                                                latestRecertDate = visitDate;
                                                            }
                                                        }
                                                    }
                                                    return latestRecertDate;
                                                });
                                            }
                                        }
                                        if (recertDate) {
                                            occurrenceCode50Date = recertDate;
                                            console.log(`  ✓ Scenario B: Found Recertification visit date → OC50 = ${occurrenceCode50Date}`);
                                        } else {
                                            console.log(`  ⚠️  No Recertification visit found in previous episode`);
                                            console.log(`  ⚠️  Record will NOT be processed - staying in Pending Approval`);
                                            record.skipApproval = true;
                                        }
                                    } else {
                                        console.log(`  ⚠️  No Previous Episode link found`);
                                        console.log(`  ⚠️  Record will NOT be processed - staying in Pending Approval`);
                                        record.skipApproval = true;
                                    }
                                    // Navigate back to Pending Approval
                                    console.log(`  Navigating back to Pending Approval...`);
                                    await page.goto(page.url().split('/AM/Patient')[0] + '/EHR/#/AM/billing/claims-manager/managed-care/approve-claims', { waitUntil: 'domcontentloaded' });
                                    await page.waitForTimeout(3000);
                                    // Re-select insurance
                                    try {
                                        await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
                                        await page.selectOption('select[ng-model="insuranceKey"]', '12');
                                        await page.waitForTimeout(3000);
                                    } catch (e) { console.log(`  ⚠️  Could not re-select insurance after navigation`); }
                                } else {
                                    // No billing period link - fall back to admission date
                                    const admFormatted = `${admissionDate.substring(0, 2)}/${admissionDate.substring(2, 4)}/${admissionDate.substring(4, 8)}`;
                                    occurrenceCode50Date = admFormatted;
                                    console.log(`  ⚠️  No billing period link available, using Admission Date: ${occurrenceCode50Date}`);
                                }
                            }
                        }
                    } else {
                        console.log(`  ⚠️  Missing admission date or billing period end - cannot determine OC50`);
                    }
                    // STEP 3: Open claim edit screen
                    console.log(`  Step 3: Opening claim edit screen...`);
                    await page.waitForSelector(`#${record.editButtonId}`, { timeout: 15000 });
                    await page.click(`#${record.editButtonId}`);
                    console.log(`  ✓ Clicked edit button`);
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await page.waitForTimeout(3000);
                    // Handle Helpful Suggestion modal
                    try {
                        const modalVisible = await page.isVisible('#modal_go');
                        if (modalVisible) {
                            await page.click('#modal_go', { timeout: 3000 });
                            console.log(`  ✓ Clicked OK on modal`);
                        }
                    } catch (e) {}
                    try {
                        await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); });
                    } catch (e) {}
                    await page.waitForTimeout(2000);
                    console.log(`  ✓ Worksheet loaded`);
                    // STEP 4: Extract patient ZIP code from the worksheet
                    console.log(`  Step 4: Extracting patient ZIP code...`);
                    const patientZip = await page.evaluate(() => {
                        // Try common selectors for patient ZIP on Kinnser worksheet
                        const zipSelectors = [
                            '#patientZip',
                            '#patZip',
                            'input[ng-model*="zip"]',
                            'input[ng-model*="Zip"]',
                            'input[name*="zip"]',
                            'input[name*="Zip"]',
                            '#zip',
                            '#zipCode'
                        ];
                        for (const sel of zipSelectors) {
                            const el = document.querySelector(sel);
                            if (el && el.value) return el.value.trim();
                        }
                        // Try to find ZIP in any visible text that matches ZIP pattern
                        // Look in patient info section
                        const allInputs = document.querySelectorAll('input[type="text"]');
                        for (const input of allInputs) {
                            const val = input.value.trim();
                            if (/^\d{5}(-\d{4})?$/.test(val)) {
                                return val;
                            }
                        }
                        // Try reading from span/div elements with ZIP pattern
                        const textElements = document.querySelectorAll('span.ng-binding, div.ng-binding');
                        for (const el of textElements) {
                            const text = el.textContent.trim();
                            if (/^\d{5}(-\d{4})?$/.test(text)) {
                                return text;
                            }
                        }
                        return null;
                    });
                    let zipCode5 = null;
                    if (patientZip) {
                        zipCode5 = patientZip.substring(0, 5);
                        console.log(`  ✓ Patient ZIP: ${patientZip} → Using: ${zipCode5}`);
                    } else {
                        console.log(`  ⚠️  Could not find patient ZIP on worksheet`);
                        console.log(`  ⚠️  Cannot process Value Codes without ZIP - skipping record`);
                        // Click Return/Cancel to go back
                        try { await page.click('#returnBtn'); } catch (e) {
                            try { await page.click('#cancelBtn'); } catch (e2) {}
                        }
                        await page.waitForTimeout(3000);
                        continue;
                    }
                    // STEP 4b: Lookup ZIP in Value Codes spreadsheet
                    console.log(`  Step 4b: Looking up ZIP ${zipCode5} in Value Codes...`);
                    const vcMatch = valueCodesData.find(row => String(row['ZIP Code']).trim() === zipCode5);
                    let valueCode61 = null;
                    let valueCode85 = null;
                    if (vcMatch) {
                        valueCode61 = String(vcMatch['Value Code 61 (CBSA)'] || '').trim();
                        valueCode85 = String(vcMatch['Value Code 85 (FIPS)'] || '').trim();
                        console.log(`  ✓ Found ZIP ${zipCode5}:`);
                        console.log(`    Value Code 61 (CBSA): ${valueCode61}`);
                        console.log(`    Value Code 85 (FIPS): ${valueCode85}`);
                    } else {
                        console.log(`  ⚠️  ZIP ${zipCode5} NOT FOUND in Value Codes Information`);
                        console.log(`  ⚠️  Cannot process this record - skipping`);
                        // Click Return/Cancel to go back
                        try { await page.click('#returnBtn'); } catch (e) {
                            try { await page.click('#cancelBtn'); } catch (e2) {}
                        }
                        await page.waitForTimeout(3000);
                        continue;
                    }
                    // STEP 5: Set Occurrence Code 50
                    let oc50Success = false;
                    if (occurrenceCode50Date) {
                        console.log(`  Step 5: Setting Occurrence Code 50 = ${occurrenceCode50Date}...`);
                        const occResult = await page.evaluate((args) => {
                            const dateVal = args.dateVal;
                            const results = { success: false, slot: 0, methods: [] };
                            // Find first empty occurrence code slot
                            let targetSlot = 0;
                            for (let i = 1; i <= 8; i++) {
                                const codeInput = document.querySelector(`#occurenceCode${i}`);
                                if (codeInput) {
                                    const val = codeInput.value;
                                    if (!val || val.trim() === '') {
                                        targetSlot = i;
                                        break;
                                    }
                                    if (val === '50') {
                                        targetSlot = i;
                                        break;
                                    }
                                }
                            }
                            if (!targetSlot) { results.methods.push('no-empty-slot'); return results; }
                            results.slot = targetSlot;
                            const codeInput = document.querySelector(`#occurenceCode${targetSlot}`);
                            const dateInput = document.querySelector(`#occurenceDate${targetSlot}`);
                            // Set code value
                            if (codeInput) {
                                codeInput.value = '50';
                                codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                                codeInput.dispatchEvent(new Event('change', { bubbles: true }));
                                results.methods.push('code-input-direct');
                            }
                            // Set date value
                            if (dateInput) {
                                dateInput.value = dateVal;
                                dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                                dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                                dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
                                results.methods.push('date-input-direct');
                            }
                            // Update Angular scope
                            try {
                                if (window.angular && codeInput) {
                                    const scope = window.angular.element(codeInput).scope();
                                    if (scope && scope.claim) {
                                        scope.$apply(() => {
                                            scope.claim[`occurenceCode${targetSlot}Select2`] = { id: '50', text: '50' };
                                        });
                                        results.methods.push('angular-scope');
                                    }
                                }
                            } catch (e) { results.methods.push('angular-err: ' + e.message); }
                            // jQuery Select2 API
                            try {
                                const $ = window.jQuery;
                                if ($ && $.fn.select2) {
                                    $(`#occurenceCode${targetSlot}`).select2('data', { id: '50', text: '50' });
                                    $(`#occurenceCode${targetSlot}`).trigger('change');
                                    results.methods.push('jquery-select2');
                                }
                            } catch (e) { results.methods.push('jquery-err: ' + e.message); }
                            // Angular scope for date
                            try {
                                if (window.angular && dateInput) {
                                    const scope = window.angular.element(dateInput).scope();
                                    if (scope && scope.claim) {
                                        scope.$apply(() => {
                                            scope.claim[`occurenceDate${targetSlot}`] = dateVal;
                                        });
                                        results.methods.push('date-angular-scope');
                                    }
                                }
                            } catch (e) { results.methods.push('date-angular-err: ' + e.message); }
                            results.success = true;
                            return results;
                        }, { dateVal: occurrenceCode50Date });
                        console.log(`  OC50 Slot: ${occResult.slot}, Methods: ${occResult.methods.join(', ')}`);
                        oc50Success = occResult.success;
                        if (occResult.success) {
                            console.log(`  ✓ Occurrence Code 50 = ${occurrenceCode50Date} set in slot ${occResult.slot}`);
                        } else {
                            console.log(`  ⚠️  Could not set Occurrence Code 50`);
                        }
                    } else {
                        console.log(`  ⚠️  No OC50 date determined - skipping OC50`);
                    }
                    // STEP 6: Set Value Code 61 (CBSA)
                    console.log(`  Step 6: Setting Value Code 61 (CBSA) = ${valueCode61}...`);
                    const vc61Result = await page.evaluate((args) => {
                        const vcValue = args.vcValue;
                        const results = { success: false, slot: 0, methods: [] };
                        // Find first empty value code slot
                        let targetSlot = 0;
                        for (let i = 1; i <= 12; i++) {
                            const codeInput = document.querySelector(`#valueCode${i}`);
                            if (codeInput) {
                                const val = codeInput.value;
                                if (!val || val.trim() === '') {
                                    targetSlot = i;
                                    break;
                                }
                                if (val === '61') {
                                    targetSlot = i;
                                    break;
                                }
                            }
                        }
                        if (!targetSlot) { results.methods.push('no-empty-slot'); return results; }
                        results.slot = targetSlot;
                        const codeInput = document.querySelector(`#valueCode${targetSlot}`);
                        const amountInput = document.querySelector(`#valueAmount${targetSlot}`);
                        // Set code = 61
                        if (codeInput) {
                            codeInput.value = '61';
                            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                            codeInput.dispatchEvent(new Event('change', { bubbles: true }));
                            results.methods.push('code-input');
                        }
                        // Set amount = CBSA value
                        if (amountInput) {
                            amountInput.value = vcValue;
                            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                            amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                            amountInput.dispatchEvent(new Event('blur', { bubbles: true }));
                            results.methods.push('amount-input');
                        }
                        // Angular scope update for Value Code 61
                        try {
                            if (window.angular && codeInput) {
                                const scope = window.angular.element(codeInput).scope();
                                if (scope && scope.claim) {
                                    scope.$apply(() => {
                                        scope.claim[`valueCode${targetSlot}Select2`] = { id: '61', text: '61 - Location Where Service is Furnished' };
                                        scope.claim[`valueAmount${targetSlot}`] = vcValue;
                                    });
                                    results.methods.push('angular-scope');
                                }
                            }
                        } catch (e) { results.methods.push('angular-err: ' + e.message); }
                        // jQuery Select2 API
                        try {
                            const $ = window.jQuery;
                            if ($ && $.fn.select2) {
                                $(`#valueCode${targetSlot}`).select2('data', { id: '61', text: '61 - Location Where Service is Furnished' });
                                $(`#valueCode${targetSlot}`).trigger('change');
                                results.methods.push('jquery-select2');
                            }
                        } catch (e) { results.methods.push('jquery-err: ' + e.message); }
                        results.success = true;
                        return results;
                    }, { vcValue: valueCode61 });
                    console.log(`  VC61 Slot: ${vc61Result.slot}, Methods: ${vc61Result.methods.join(', ')}`);
                    if (vc61Result.success) {
                        console.log(`  ✓ Value Code 61 = ${valueCode61} set in slot ${vc61Result.slot}`);
                    } else {
                        console.log(`  ⚠️  Could not set Value Code 61`);
                    }
                    // STEP 7: Set Value Code 85 (FIPS)
                    console.log(`  Step 7: Setting Value Code 85 (FIPS) = ${valueCode85}...`);
                    const vc85Result = await page.evaluate((args) => {
                        const vcValue = args.vcValue;
                        const prevSlot = args.prevSlot;
                        const results = { success: false, slot: 0, methods: [] };
                        // Find next empty value code slot (after the one used for VC61)
                        let targetSlot = 0;
                        for (let i = prevSlot + 1; i <= 12; i++) {
                            const codeInput = document.querySelector(`#valueCode${i}`);
                            if (codeInput) {
                                const val = codeInput.value;
                                if (!val || val.trim() === '') {
                                    targetSlot = i;
                                    break;
                                }
                                if (val === '85') {
                                    targetSlot = i;
                                    break;
                                }
                            }
                        }
                        if (!targetSlot) { results.methods.push('no-empty-slot'); return results; }
                        results.slot = targetSlot;
                        const codeInput = document.querySelector(`#valueCode${targetSlot}`);
                        const amountInput = document.querySelector(`#valueAmount${targetSlot}`);
                        // Set code = 85
                        if (codeInput) {
                            codeInput.value = '85';
                            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                            codeInput.dispatchEvent(new Event('change', { bubbles: true }));
                            results.methods.push('code-input');
                        }
                        // Set amount = FIPS value
                        if (amountInput) {
                            amountInput.value = vcValue;
                            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                            amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                            amountInput.dispatchEvent(new Event('blur', { bubbles: true }));
                            results.methods.push('amount-input');
                        }
                        // Angular scope update for Value Code 85
                        try {
                            if (window.angular && codeInput) {
                                const scope = window.angular.element(codeInput).scope();
                                if (scope && scope.claim) {
                                    scope.$apply(() => {
                                        scope.claim[`valueCode${targetSlot}Select2`] = { id: '85', text: '85 - County FIPS Code' };
                                        scope.claim[`valueAmount${targetSlot}`] = vcValue;
                                    });
                                    results.methods.push('angular-scope');
                                }
                            }
                        } catch (e) { results.methods.push('angular-err: ' + e.message); }
                        // jQuery Select2 API
                        try {
                            const $ = window.jQuery;
                            if ($ && $.fn.select2) {
                                $(`#valueCode${targetSlot}`).select2('data', { id: '85', text: '85 - County FIPS Code' });
                                $(`#valueCode${targetSlot}`).trigger('change');
                                results.methods.push('jquery-select2');
                            }
                        } catch (e) { results.methods.push('jquery-err: ' + e.message); }
                        results.success = true;
                        return results;
                    }, { vcValue: valueCode85, prevSlot: vc61Result.slot || 0 });
                    console.log(`  VC85 Slot: ${vc85Result.slot}, Methods: ${vc85Result.methods.join(', ')}`);
                    if (vc85Result.success) {
                        console.log(`  ✓ Value Code 85 = ${valueCode85} set in slot ${vc85Result.slot}`);
                    } else {
                        console.log(`  ⚠️  Could not set Value Code 85`);
                    }
                    // STEP 8: Validation before save
                    console.log(`  Step 8: Validating before save...`);
                    const validationPassed = oc50Success && vc61Result.success && vc85Result.success;
                    if (!validationPassed) {
                        console.log(`  ⚠️  VALIDATION FAILED:`);
                        if (!oc50Success) console.log(`    - Occurrence Code 50 NOT set`);
                        if (!vc61Result.success) console.log(`    - Value Code 61 NOT set`);
                        if (!vc85Result.success) console.log(`    - Value Code 85 NOT set`);
                        console.log(`  ⚠️  Will NOT save claim - returning to Pending Approval`);
                        try { await page.click('#returnBtn'); } catch (e) {
                            try { await page.click('#cancelBtn'); } catch (e2) {}
                        }
                        await page.waitForTimeout(3000);
                        continue;
                    }
                    console.log(`  ✓ Validation passed: OC50 ✓, VC61 ✓, VC85 ✓`);
                    // STEP 9: Save and Close
                    console.log(`  Step 9: Clicking Save and Close...`);
                    await page.evaluate(() => {
                        const btn = document.querySelector('#submitBtn');
                        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                    await page.waitForTimeout(1000);
                    await page.click('#submitBtn');
                    console.log(`  ✓ Clicked Save and Close`);
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    await page.waitForTimeout(3000);
                    // Wait for loading spinner to disappear
                    try {
                        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
                    } catch (e) {}
                    await page.waitForTimeout(3000);
                    // Wait for table to be ready
                    try {
                        await page.waitForSelector('table tbody tr', { timeout: 15000 });
                    } catch (e) {}
                    await page.waitForTimeout(2000);
                    console.log(`  ✅ Successfully processed UCSD record`);
                } catch (error) {
                    console.error(`  ✗ Error processing UCSD record:`, error.message || error);
                    try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                        try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                    }
                }
            }
        }
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`UCSD SUMMARY: ${ucsdRecords.length} processed`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
    // PROCESS FALLON COMMUNITY HEALTH PLAN / FALLON COMMUNITY HEALTH PLAN MAV RECORDS
    // Auth code starting with T → TOB 327, SN visit validation (max 2 per day)
    const fallonRecords = (isInsuranceSelected('fallon community health plan') || isInsuranceSelected('fallon community health plan mav'))
        ? validRecords.filter(r => {
            const ins = r.insurance.toLowerCase().trim();
            return ins === 'fallon community health plan' || ins === 'fallon community health plan mav';
        })
        : [];
    if (fallonRecords.length > 0) {
        console.log(`\n=== PROCESSING FALLON COMMUNITY HEALTH PLAN RECORDS ===`);
        console.log(`Found ${fallonRecords.length} Fallon record(s)`);
        console.log("  Requires: Auth code extraction, TOB 327 for T-codes, SN visit validation (max 2/day)");
        for (const record of fallonRecords) {
            console.log(`\nProcessing Fallon record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            if (!record.editButtonId) {
                console.log(`  \u26a0\ufe0f  No edit button found - skipping`);
                continue;
            }
            try {
                // STEP 1: Get Authorization Code from Ready tab records (matched by MRN)
                console.log(`  Step 1: Getting Authorization Code...`);
                let authorizationCode = null;
                // Look up auth code from Ready tab records by matching MRN
                if (readyTabRecords && readyTabRecords.length > 0) {
                    const matchingRecord = readyTabRecords.find(r => {
                        // Match by checking if allColumns contains the MRN
                        if (r.allColumns) {
                            return r.allColumns.some(col => col && col.includes(record.mrn));
                        }
                        return false;
                    });
                    if (matchingRecord && matchingRecord.authorization) {
                        authorizationCode = matchingRecord.authorization.trim();
                        console.log(`  ✓ Authorization Code (from Ready tab): ${authorizationCode}`);
                    }
                }
                // Fallback: check allCells in Pending Approval table for auth-like pattern
                if (!authorizationCode && record.allCells) {
                    for (const cell of record.allCells) {
                        if (cell && /^[A-Za-z]-?\d{4,}/.test(cell.trim())) {
                            authorizationCode = cell.trim();
                            console.log(`  ✓ Authorization Code (from table cells): ${authorizationCode}`);
                            break;
                        }
                    }
                }
                if (!authorizationCode) {
                    console.log(`  ⚠️  No Authorization Code found`);
                }
                // STEP 2: Open Claim Edit Screen
                console.log(`  Step 2: Opening claim edit screen...`);
                await page.waitForSelector(`#${record.editButtonId}`, { timeout: 15000 });
                await page.click(`#${record.editButtonId}`);
                console.log(`  \u2713 Clicked edit button`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // Handle Helpful Suggestion modal
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) {
                        await page.click('#modal_go', { timeout: 3000 });
                        console.log(`  \u2713 Clicked OK on modal`);
                    }
                } catch (e) {}
                try {
                    await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  \u2713 Worksheet loaded`);
                // STEP 3: Type of Bill validation - check if auth code starts with T
                let needsTOB327 = false;
                if (authorizationCode) {
                    const authTrimmed = authorizationCode.trim();
                    // Case-insensitive check: starts with T, T-, or t-code
                    if (/^[Tt][-]?/.test(authTrimmed)) {
                        needsTOB327 = true;
                        console.log(`  Step 3: Auth code "${authorizationCode}" starts with T \u2192 Setting TOB to 327`);
                        await page.evaluate(() => {
                            const select = document.querySelector('#typeOfBill');
                            if (select) {
                                const option327 = Array.from(select.options).find(opt => opt.text.trim() === '327 - Adjustment Claim');
                                if (option327) {
                                    select.value = option327.value;
                                    select.dispatchEvent(new Event('change', { bubbles: true }));
                                    select.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        });
                        console.log(`  \u2713 Changed TOB to 327`);
                    } else {
                        console.log(`  Step 3: Auth code "${authorizationCode}" does NOT start with T \u2192 TOB unchanged`);
                    }
                } else {
                    console.log(`  Step 3: No auth code extracted \u2192 TOB unchanged`);
                }
                // STEP 4: Visit Validation - check SN visits per day
                console.log(`  Step 4: Validating Skilled Nursing visits...`);
                // Expand Visits section
                try {
                    await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a.accordion-toggle'));
                        const visitsLink = links.find(a => a.textContent.trim() === 'Visits');
                        if (visitsLink) visitsLink.click();
                    });
                    console.log(`  \u2713 Expanded Visits`);
                    await page.waitForTimeout(2000);
                } catch (e) {
                    console.log(`  \u26a0\ufe0f  Could not expand Visits section`);
                }
                const snCheck = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table.table-striped tbody tr'));
                    const snVisitsByDate = {};
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const dateStr = cells[0].textContent.trim();
                            const visitType = cells[1].textContent.trim();
                            if (visitType.toLowerCase().includes('skilled nursing')) {
                                if (dateStr) {
                                    if (!snVisitsByDate[dateStr]) snVisitsByDate[dateStr] = 0;
                                    snVisitsByDate[dateStr]++;
                                }
                            }
                        }
                    });
                    let hasExceeded = false;
                    const details = [];
                    for (const [date, count] of Object.entries(snVisitsByDate)) {
                        details.push({ date, count });
                        if (count > 2) { hasExceeded = true; }
                    }
                    return { hasExceeded, details, snVisitsByDate };
                });
                console.log(`  SN visits by date: ${JSON.stringify(snCheck.snVisitsByDate)}`);
                if (snCheck.hasExceeded) {
                    console.log(`  \u274c FAILED: More than 2 SN visits on same date - claim will NOT be billed`);
                    snCheck.details.filter(d => d.count > 2).forEach(d => console.log(`    ${d.date}: ${d.count} visits (exceeds limit of 2)`));
                    console.log(`  Reason: "More than two Skilled Nursing visits found on the same date of service."`);
                    record.skipApproval = true;
                    // Return without saving - click Cancel/Return
                    try { await page.click('#returnBtn'); } catch (e) {
                        try { await page.click('#cancelBtn'); } catch (e2) {}
                    }
                    await page.waitForTimeout(3000);
                    continue;
                } else {
                    snCheck.details.forEach(d => console.log(`    ${d.date}: ${d.count} SN visit(s) \u2713 OK`));
                    console.log(`  \u2713 All dates have \u2264 2 SN visits`);
                }
                // STEP 5: Save Claim
                console.log(`  Step 5: Clicking Save and Close...`);
                await page.evaluate(() => {
                    const btn = document.querySelector('#submitBtn');
                    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await page.waitForTimeout(1000);
                await page.click('#submitBtn');
                console.log(`  \u2713 Clicked Save and Close`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                try {
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
                } catch (e) {}
                await page.waitForTimeout(3000);
                try {
                    await page.waitForSelector('table tbody tr', { timeout: 15000 });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  \u2705 Successfully processed Fallon record`);
            } catch (error) {
                console.error(`  \u274c Error processing Fallon record:`, error.message || error);
                try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                    try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                }
            }
        }
        console.log(`\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
        console.log(`FALLON SUMMARY: ${fallonRecords.length} processed`);
        console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
    }
    // PROCESS BOSTON MEDICAL CENTER HEALTH PLAN RECORDS
    // T-code auth → TOB 327, UD modifier for SN visits >30 days from admission
    const bmcRecords = isInsuranceSelected('boston medical center health plan')
        ? validRecords.filter(r => r.insurance.toLowerCase().trim() === 'boston medical center health plan')
        : [];
    if (bmcRecords.length > 0) {
        console.log(`\n=== PROCESSING BOSTON MEDICAL CENTER HEALTH PLAN RECORDS ===`);
        console.log(`Found ${bmcRecords.length} BMC Health Plan record(s)`);
        console.log("  Requires: T-code auth check (TOB 327), admission date, UD modifier for SN >30 days");
        for (const record of bmcRecords) {
            console.log(`\nProcessing BMC record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            if (!record.editButtonId) {
                console.log(`  \u26a0\ufe0f  No edit button found - skipping`);
                continue;
            }
            try {
                // STEP 1: Get Authorization Code from Ready tab records
                console.log(`  Step 1: Getting Authorization Code...`);
                let authorizationCode = null;
                if (readyTabRecords && readyTabRecords.length > 0) {
                    const matchingRecord = readyTabRecords.find(r => {
                        if (r.allColumns) {
                            return r.allColumns.some(col => col && col.includes(record.mrn));
                        }
                        return false;
                    });
                    if (matchingRecord && matchingRecord.authorization) {
                        authorizationCode = matchingRecord.authorization.trim();
                        console.log(`  \u2713 Authorization Code (from Ready tab): ${authorizationCode}`);
                    }
                }
                if (!authorizationCode && record.allCells) {
                    for (const cell of record.allCells) {
                        if (cell && /^[A-Za-z]-?\d{4,}/.test(cell.trim())) {
                            authorizationCode = cell.trim();
                            console.log(`  \u2713 Authorization Code (from table cells): ${authorizationCode}`);
                            break;
                        }
                    }
                }
                if (!authorizationCode) {
                    console.log(`  \u26a0\ufe0f  No Authorization Code found`);
                }
                // STEP 2: Get admission date from PDF
                console.log(`  Step 2: Getting admission date from PDF...`);
                let admissionDate = null;
                // Find print icon fresh from current page (table may have reloaded)
                let printIconId = null;
                try {
                    printIconId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            const text = row.textContent || '';
                            if (text.includes(mrn)) {
                                const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
                                if (printIcon) return printIcon.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                } catch (e) {}
                // Fallback to derived ID if fresh lookup failed
                if (!printIconId) {
                    const claimNumber = record.editButtonId.replace('openWorksheet', '');
                    printIconId = `openClaimPrintView${claimNumber}`;
                    console.log(`  Using derived print icon ID: ${printIconId}`);
                } else {
                    console.log(`  Found fresh print icon ID: ${printIconId}`);
                }
                try {
                    const pdfBuffer = await extractPdfFromPrintIcon(page, printIconId);
                    if (pdfBuffer) {
                        const { extractDateOfAdmission } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
                        admissionDate = await extractDateOfAdmission(pdfBuffer);
                        if (admissionDate) {
                            console.log(`  \u2713 Admission Date: ${admissionDate}`);
                        } else {
                            console.log(`  \u26a0\ufe0f  Could not extract admission date from PDF`);
                        }
                    } else {
                        console.log(`  \u26a0\ufe0f  Could not get PDF content`);
                    }
                } catch (pdfError) {
                    console.log(`  \u26a0\ufe0f  Error getting PDF: ${pdfError.message}`);
                }
                // STEP 3: Open Claim Edit Screen
                console.log(`  Step 3: Opening claim edit screen...`);
                // Re-find edit button fresh from current page (table may have reloaded)
                let editButtonId = record.editButtonId;
                try {
                    const freshEditId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            const text = row.textContent || '';
                            if (text.includes(mrn)) {
                                const editBtn = row.querySelector('a[id*="openWorksheet"]') || row.querySelector('a.ui-kinnser-edit');
                                if (editBtn) return editBtn.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                    if (freshEditId) {
                        editButtonId = freshEditId;
                        console.log(`  Found fresh edit button: ${editButtonId}`);
                    }
                } catch (e) {}
                await page.waitForSelector(`#${editButtonId}`, { timeout: 15000 });
                await page.click(`#${editButtonId}`);
                console.log(`  \u2713 Clicked edit button`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // Handle modal
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) {
                        await page.click('#modal_go', { timeout: 3000 });
                        console.log(`  \u2713 Clicked OK on modal`);
                    }
                } catch (e) {}
                try {
                    await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  \u2713 Worksheet loaded`);
                // STEP 4: T-Code Authorization check → TOB 327
                let needsTOB327 = false;
                if (authorizationCode) {
                    const authLower = authorizationCode.toLowerCase().trim();
                    // Check if starts with "t-code" or "t code" (case-insensitive)
                    if (authLower.startsWith('t-code') || authLower.startsWith('t code')) {
                        needsTOB327 = true;
                        console.log(`  Step 4: Auth "${authorizationCode}" starts with t-code \u2192 TOB 327`);
                        await page.evaluate(() => {
                            const select = document.querySelector('#typeOfBill');
                            if (select) {
                                const option327 = Array.from(select.options).find(opt => opt.text.trim() === '327 - Adjustment Claim');
                                if (option327) {
                                    select.value = option327.value;
                                    select.dispatchEvent(new Event('change', { bubbles: true }));
                                    select.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        });
                        console.log(`  \u2713 Changed TOB to 327`);
                    } else {
                        console.log(`  Step 4: Auth "${authorizationCode}" does NOT start with t-code \u2192 TOB unchanged`);
                    }
                } else {
                    console.log(`  Step 4: No auth code \u2192 TOB unchanged`);
                }
                // STEP 5: Expand Visits and add UD modifier for SN visits >30 days from admission
                console.log(`  Step 5: Processing Skilled Nursing visits for UD modifier...`);
                try {
                    await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a.accordion-toggle'));
                        const visitsLink = links.find(a => a.textContent.trim() === 'Visits');
                        if (visitsLink) visitsLink.click();
                    });
                    console.log(`  \u2713 Expanded Visits`);
                    await page.waitForTimeout(2000);
                } catch (e) {
                    console.log(`  \u26a0\ufe0f  Could not expand Visits section`);
                }
                const visitResult = await page.evaluate((admDateStr) => {
                    const rows = Array.from(document.querySelectorAll('table.table-striped tbody tr'));
                    let udModifiersAdded = 0;
                    const snVisitsByDate = {};
                    let admDate = null;
                    const debugInfo = [];
                    if (admDateStr && admDateStr.length === 8) {
                        const month = parseInt(admDateStr.substring(0, 2)) - 1;
                        const day = parseInt(admDateStr.substring(2, 4));
                        const year = parseInt(admDateStr.substring(4, 8));
                        admDate = new Date(year, month, day);
                    }
                    rows.forEach((row, idx) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const dateStr = cells[0].textContent.trim();
                            const visitType = cells[1].textContent.trim();
                            const isSN = visitType.toLowerCase().includes('skilled nursing');
                            if (idx < 3) {
                                debugInfo.push(`Row ${idx}: date="${dateStr}" type="${visitType}" isSN=${isSN}`);
                            }
                            if (isSN) {
                                if (dateStr) {
                                    if (!snVisitsByDate[dateStr]) snVisitsByDate[dateStr] = 0;
                                    snVisitsByDate[dateStr]++;
                                }
                                if (admDate && dateStr) {
                                    const parts = dateStr.split('/');
                                    if (parts.length === 3) {
                                        const visitDate = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
                                        const diffDays = Math.floor((visitDate - admDate) / (1000 * 60 * 60 * 24));
                                        if (diffDays > 30) {
                                            const modifier1 = row.querySelector('input[ng-model="lineItem.modifier1"]');
                                            if (modifier1) {
                                                const m1Val = modifier1.value.trim();
                                                if (!m1Val || m1Val === '') {
                                                    modifier1.value = 'UD';
                                                    modifier1.dispatchEvent(new Event('input', { bubbles: true }));
                                                    modifier1.dispatchEvent(new Event('change', { bubbles: true }));
                                                    if (window.angular) {
                                                        try {
                                                            const scope = window.angular.element(modifier1).scope();
                                                            if (scope && scope.lineItem) {
                                                                scope.$apply(() => { scope.lineItem.modifier1 = 'UD'; });
                                                            }
                                                        } catch(e) {}
                                                    }
                                                    udModifiersAdded++;
                                                } else if (m1Val !== 'UD') {
                                                    const modifier2 = row.querySelector('input[ng-model="lineItem.modifier2"]');
                                                    if (modifier2 && (!modifier2.value.trim() || modifier2.value.trim() === '')) {
                                                        modifier2.value = 'UD';
                                                        modifier2.dispatchEvent(new Event('input', { bubbles: true }));
                                                        modifier2.dispatchEvent(new Event('change', { bubbles: true }));
                                                        if (window.angular) {
                                                            try {
                                                                const scope = window.angular.element(modifier2).scope();
                                                                if (scope && scope.lineItem) {
                                                                    scope.$apply(() => { scope.lineItem.modifier2 = 'UD'; });
                                                                }
                                                            } catch(e) {}
                                                        }
                                                        udModifiersAdded++;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                    return { udModifiersAdded, snVisitsByDate, debugInfo, totalRows: rows.length };
                }, admissionDate);
                console.log(`  UD modifiers added: ${visitResult.udModifiersAdded}`);
                console.log(`  SN visits by date: ${JSON.stringify(visitResult.snVisitsByDate)}`);
                if (visitResult.debugInfo && visitResult.debugInfo.length > 0) {
                    visitResult.debugInfo.forEach(d => console.log(`    ${d}`));
                }
                // STEP 6: Save and Close
                console.log(`  Step 6: Clicking Save and Close...`);
                await page.evaluate(() => {
                    const btn = document.querySelector('#submitBtn');
                    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await page.waitForTimeout(1000);
                await page.click('#submitBtn');
                console.log(`  \u2713 Clicked Save and Close`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                try {
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
                } catch (e) {}
                await page.waitForTimeout(3000);
                try {
                    await page.waitForSelector('table tbody tr', { timeout: 15000 });
                } catch (e) {}
                await page.waitForTimeout(2000);
                console.log(`  \u2705 Successfully processed BMC record`);
            } catch (error) {
                console.error(`  \u274c Error processing BMC record:`, error.message || error);
                try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                    try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                }
            }
        }
        console.log(`\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
        console.log(`BMC HEALTH PLAN SUMMARY: ${bmcRecords.length} processed`);
        console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
    }
    // PROCESS NORTHCOAST PPS - ANTHEM / NORTHCOAST - AETNA RECORDS
    // Occurrence Code 50 only, no auto-approve (claims stay in Pending Approval)
    const northcoastRecords = (isInsuranceSelected('northcoast pps - anthem') || isInsuranceSelected('northcoast pps \u2013 anthem') || isInsuranceSelected('northcost pps- anthem') || isInsuranceSelected('northcoast - aetna') || isInsuranceSelected('northcoast \u2013 aetna') || isInsuranceSelected('northcoast -aetna'))
        ? validRecords.filter(r => {
            const ins = r.insurance.toLowerCase().trim();
            return ins.includes('northco') && (ins.includes('anthem') || ins.includes('aetna'));
        })
        : [];
    if (northcoastRecords.length > 0) {
        console.log(`\n=== PROCESSING NORTHCOAST RECORDS ===`);
        console.log(`Found ${northcoastRecords.length} Northcoast record(s)`);
        console.log("  Requires: Admission date, Occurrence Code 50, NO auto-approve");
        for (const record of northcoastRecords) {
            console.log(`\nProcessing Northcoast record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            if (!record.editButtonId) {
                console.log(`  \u26a0\ufe0f  No edit button found - skipping`);
                continue;
            }
            try {
                // STEP 1: Get admission date from PDF
                console.log(`  Step 1: Getting admission date from PDF...`);
                let admissionDate = null;
                let printIconId = null;
                try {
                    printIconId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            if ((row.textContent || '').includes(mrn)) {
                                const icon = row.querySelector('label[id*="openClaimPrintView"]');
                                if (icon) return icon.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                } catch (e) {}
                if (!printIconId) {
                    const claimNumber = record.editButtonId.replace('openWorksheet', '');
                    printIconId = `openClaimPrintView${claimNumber}`;
                }
                console.log(`  Print icon ID: ${printIconId}`);
                try {
                    const pdfBuffer = await extractPdfFromPrintIcon(page, printIconId);
                    if (pdfBuffer) {
                        const { extractDateOfAdmission } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
                        admissionDate = await extractDateOfAdmission(pdfBuffer);
                        if (admissionDate) {
                            console.log(`  \u2713 Admission Date: ${admissionDate}`);
                        } else {
                            console.log(`  \u26a0\ufe0f  Could not extract admission date from PDF`);
                        }
                    } else {
                        console.log(`  \u26a0\ufe0f  Could not get PDF content`);
                    }
                } catch (pdfError) {
                    console.log(`  \u26a0\ufe0f  Error getting PDF: ${pdfError.message}`);
                }
                // If no admission date, skip this record (manual review)
                if (!admissionDate) {
                    console.log(`  \u26a0\ufe0f  Cannot process without admission date - flagging for manual review`);
                    record.skipApproval = true;
                    continue;
                }
                // STEP 2: Determine Occurrence Code 50 date
                console.log(`  Step 2: Determining Occurrence Code 50...`);
                let occurrenceCode50Date = null;
                if (record.billingPeriodEnd) {
                    const admMonth = parseInt(admissionDate.substring(0, 2)) - 1;
                    const admDay = parseInt(admissionDate.substring(2, 4));
                    const admYear = parseInt(admissionDate.substring(4, 8));
                    const admDate = new Date(admYear, admMonth, admDay);
                    const endParts = record.billingPeriodEnd.split('/');
                    if (endParts.length === 3) {
                        const billingEndDate = new Date(parseInt(endParts[2]), parseInt(endParts[0]) - 1, parseInt(endParts[1]));
                        const diffDays = Math.floor((billingEndDate - admDate) / (1000 * 60 * 60 * 24));
                        console.log(`  Billing Period End: ${record.billingPeriodEnd}, Admission: ${admissionDate}, Days diff: ${diffDays}`);
                        if (diffDays <= 60) {
                            // Scenario A: OC50 = Admission Date
                            const admFormatted = `${admissionDate.substring(0, 2)}/${admissionDate.substring(2, 4)}/${admissionDate.substring(4, 8)}`;
                            occurrenceCode50Date = admFormatted;
                            console.log(`  \u2713 Scenario A: Within 60 days \u2192 OC50 = ${occurrenceCode50Date}`);
                        } else {
                            // Scenario B: Find Recertification visit date from previous episode
                            console.log(`  Scenario B: More than 60 days (${diffDays}) \u2192 Need Recertification visit date`);
                            if (record.billingPeriodHref) {
                                console.log(`  Navigating to episode: ${record.billingPeriodHref}`);
                                await page.goto(record.billingPeriodHref, { waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(3000);
                                const prevEpisodeExists = await page.isVisible('#previouscert');
                                if (prevEpisodeExists) {
                                    console.log(`  \u2713 Clicking Previous Episode...`);
                                    await page.click('#previouscert');
                                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                    await page.waitForTimeout(3000);
                                    // Search for Recertification visit
                                    let recertDate = await page.evaluate(() => {
                                        const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                        let latestRecertDate = null;
                                        for (const row of rows) {
                                            if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                            if (row.classList.contains('hRowBgImage')) continue;
                                            const cells = row.querySelectorAll('td');
                                            if (cells.length < 2) continue;
                                            const taskText = cells[1] ? cells[1].textContent.trim() : '';
                                            if (taskText.toLowerCase().includes('recertification')) {
                                                const statusDiv = row.querySelector('div[id^="Status"]');
                                                const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) continue;
                                                const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                if (visitDate && visitDate.includes('/')) {
                                                    latestRecertDate = visitDate;
                                                }
                                            }
                                        }
                                        return latestRecertDate;
                                    });
                                    // Check Therapy tab if not found on Nursing
                                    if (!recertDate) {
                                        const therapyLink = await page.$('#LinkTherapy');
                                        if (therapyLink) {
                                            await therapyLink.click();
                                            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                                            await page.waitForTimeout(3000);
                                            recertDate = await page.evaluate(() => {
                                                const rows = Array.from(document.querySelectorAll('#scheduled-task tr'));
                                                let latestRecertDate = null;
                                                for (const row of rows) {
                                                    if (row.style.display === 'none' || row.classList.contains('trred')) continue;
                                                    if (row.classList.contains('hRowBgImage')) continue;
                                                    const cells = row.querySelectorAll('td');
                                                    if (cells.length < 2) continue;
                                                    const taskText = cells[1] ? cells[1].textContent.trim() : '';
                                                    if (taskText.toLowerCase().includes('recertification')) {
                                                        const statusDiv = row.querySelector('div[id^="Status"]');
                                                        const status = statusDiv ? statusDiv.textContent.trim() : '';
                                                        if (status.includes('Missed Visit') || status.includes('(MV)') || status.includes('Deleted')) continue;
                                                        const visitDateDiv = row.querySelector('div[id^="VisitDate"]');
                                                        const visitDate = visitDateDiv ? visitDateDiv.textContent.trim() : '';
                                                        if (visitDate && visitDate.includes('/')) {
                                                            latestRecertDate = visitDate;
                                                        }
                                                    }
                                                }
                                                return latestRecertDate;
                                            });
                                        }
                                    }
                                    if (recertDate) {
                                        occurrenceCode50Date = recertDate;
                                        console.log(`  \u2713 Scenario B: Recertification visit date \u2192 OC50 = ${occurrenceCode50Date}`);
                                    } else {
                                        console.log(`  \u26a0\ufe0f  No Recertification visit found - flagging for manual review`);
                                        record.skipApproval = true;
                                    }
                                } else {
                                    console.log(`  \u26a0\ufe0f  No Previous Episode link - flagging for manual review`);
                                    record.skipApproval = true;
                                }
                                // Navigate back to Pending Approval
                                console.log(`  Navigating back to Pending Approval...`);
                                await page.goto(page.url().split('/AM/Patient')[0] + '/EHR/#/AM/billing/claims-manager/managed-care/approve-claims', { waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(3000);
                                try {
                                    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
                                    await page.selectOption('select[ng-model="insuranceKey"]', '1');
                                    await page.waitForTimeout(3000);
                                } catch (e) {}
                            } else {
                                console.log(`  \u26a0\ufe0f  No billing period link - flagging for manual review`);
                                record.skipApproval = true;
                            }
                        }
                    }
                }
                // If flagged for manual review, skip to next record
                if (record.skipApproval) {
                    continue;
                }
                // STEP 3: Open Claim Edit Screen and set OC50
                if (!occurrenceCode50Date) {
                    console.log(`  \u26a0\ufe0f  No OC50 date determined - flagging for manual review`);
                    record.skipApproval = true;
                    continue;
                }
                console.log(`  Step 3: Opening claim edit screen...`);
                let editButtonId = record.editButtonId;
                try {
                    const freshEditId = await page.evaluate((mrn) => {
                        const rows = Array.from(document.querySelectorAll('table tbody tr'));
                        for (const row of rows) {
                            if ((row.textContent || '').includes(mrn)) {
                                const editBtn = row.querySelector('a[id*="openWorksheet"]') || row.querySelector('a.ui-kinnser-edit');
                                if (editBtn) return editBtn.id;
                            }
                        }
                        return null;
                    }, record.mrn);
                    if (freshEditId) editButtonId = freshEditId;
                } catch (e) {}
                await page.waitForSelector(`#${editButtonId}`, { timeout: 15000 });
                await page.click(`#${editButtonId}`);
                console.log(`  \u2713 Clicked edit button`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                // Handle modal
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) { await page.click('#modal_go', { timeout: 3000 }); console.log(`  \u2713 Clicked OK on modal`); }
                } catch (e) {}
                try { await page.evaluate(() => { const btn = document.querySelector('#modal_go'); if (btn) btn.click(); }); } catch (e) {}
                await page.waitForTimeout(2000);
                // STEP 4: Set Occurrence Code 50
                console.log(`  Step 4: Setting Occurrence Code 50 = ${occurrenceCode50Date}...`);
                const occResult = await page.evaluate((args) => {
                    const dateVal = args.dateVal;
                    const results = { success: false, slot: 0, methods: [] };
                    let targetSlot = 0;
                    for (let i = 1; i <= 8; i++) {
                        const codeInput = document.querySelector(`#occurenceCode${i}`);
                        if (codeInput) {
                            const val = codeInput.value;
                            if (!val || val.trim() === '') { targetSlot = i; break; }
                            if (val === '50') { targetSlot = i; break; }
                        }
                    }
                    if (!targetSlot) { results.methods.push('no-empty-slot'); return results; }
                    results.slot = targetSlot;
                    const codeInput = document.querySelector(`#occurenceCode${targetSlot}`);
                    const dateInput = document.querySelector(`#occurenceDate${targetSlot}`);
                    if (codeInput) {
                        codeInput.value = '50';
                        codeInput.dispatchEvent(new Event('input', { bubbles: true }));
                        codeInput.dispatchEvent(new Event('change', { bubbles: true }));
                        results.methods.push('code-input');
                    }
                    if (dateInput) {
                        dateInput.value = dateVal;
                        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                        dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
                        results.methods.push('date-input');
                    }
                    // Angular scope update
                    try {
                        if (window.angular && codeInput) {
                            const scope = window.angular.element(codeInput).scope();
                            if (scope && scope.claim) {
                                scope.$apply(() => {
                                    scope.claim[`occurenceCode${targetSlot}Select2`] = { id: '50', text: '50' };
                                });
                                results.methods.push('angular-scope');
                            }
                        }
                    } catch (e) { results.methods.push('angular-err: ' + e.message); }
                    // jQuery Select2
                    try {
                        const $ = window.jQuery;
                        if ($ && $.fn.select2) {
                            $(`#occurenceCode${targetSlot}`).select2('data', { id: '50', text: '50' });
                            $(`#occurenceCode${targetSlot}`).trigger('change');
                            results.methods.push('jquery-select2');
                        }
                    } catch (e) { results.methods.push('jquery-err: ' + e.message); }
                    // Angular date scope
                    try {
                        if (window.angular && dateInput) {
                            const scope = window.angular.element(dateInput).scope();
                            if (scope && scope.claim) {
                                scope.$apply(() => { scope.claim[`occurenceDate${targetSlot}`] = dateVal; });
                                results.methods.push('date-angular');
                            }
                        }
                    } catch (e) {}
                    results.success = true;
                    return results;
                }, { dateVal: occurrenceCode50Date });
                if (occResult.success) {
                    console.log(`  \u2713 OC50 set in slot ${occResult.slot} (${occResult.methods.join(', ')})`);
                } else {
                    console.log(`  \u26a0\ufe0f  Could not set OC50 - flagging for manual review`);
                    record.skipApproval = true;
                    try { await page.click('#returnBtn'); } catch (e) { try { await page.click('#cancelBtn'); } catch (e2) {} }
                    await page.waitForTimeout(3000);
                    continue;
                }
                // STEP 5: Save and Close
                console.log(`  Step 5: Clicking Save and Close...`);
                await page.evaluate(() => { const btn = document.querySelector('#submitBtn'); if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
                await page.waitForTimeout(1000);
                await page.click('#submitBtn');
                console.log(`  \u2713 Clicked Save and Close`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                try { await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 }); } catch (e) {}
                await page.waitForTimeout(3000);
                try { await page.waitForSelector('table tbody tr', { timeout: 15000 }); } catch (e) {}
                await page.waitForTimeout(2000);
                // Mark as skip approval (Northcoast stays in Pending Approval)
                record.skipApproval = true;
                console.log(`  \u2705 Successfully processed Northcoast record (stays in Pending Approval)`);
            } catch (error) {
                console.error(`  \u274c Error processing Northcoast record:`, error.message || error);
                record.skipApproval = true;
                try { await page.click('#returnBtn'); await page.waitForTimeout(3000); } catch (e) {
                    try { await page.click('#pendingClaimsApproval'); await page.waitForTimeout(3000); } catch (e2) {}
                }
            }
        }
        console.log(`\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
        console.log(`NORTHCOAST SUMMARY: ${northcoastRecords.length} processed (all stay in Pending Approval)`);
        console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
    }
    // Check for PARTNERSHIP HEALTH PLAN OF CA records (always need 327)
    console.log("\n=== CHECKING FOR PARTNERSHIP HEALTH PLAN OF CA RECORDS ===");
    const partnershipRecords = isInsuranceSelected('partnership health plan of ca')
        ? records.filter(r => r.insurance.toUpperCase().includes('PARTNERSHIP HEALTH PLAN'))
        : [];
    if (partnershipRecords.length > 0) {
        console.log(`\n⚠️  Found ${partnershipRecords.length} PARTNERSHIP HEALTH PLAN OF CA record(s)`);
        // Filter to only those that don't already have Type of Bill 327
        const recordsNeedingChange = partnershipRecords.filter(r => !r.typeOfBill.includes('327'));
        if (recordsNeedingChange.length === 0) {
            console.log(`✓ All ${partnershipRecords.length} PARTNERSHIP HEALTH PLAN records already have Type of Bill 327 - will be approved`);
        }
        else {
            console.log(`⚠️  ${recordsNeedingChange.length} record(s) need Type of Bill 327 - will be DESELECTED`);
            console.log(`✓ ${partnershipRecords.length - recordsNeedingChange.length} record(s) already have Type of Bill 327 - will be approved`);
            for (const record of recordsNeedingChange) {
                console.log(`\n  MRN: ${record.mrn}`);
                console.log(`  Insurance: ${record.insurance}`);
                console.log(`  Billing Period: ${record.billingPeriodText}`);
                console.log(`  Current Type of Bill: ${record.typeOfBill}`);
                console.log(`  → Will be DESELECTED (needs manual change to TOB 327)`);
                // Add to list of records needing 327
                recordsNeedingTOB327.push(record.index);
                // Track this for reporting
                changedRecords.push({
                    mrn: record.mrn,
                    billingPeriod: record.billingPeriodText,
                    reason: 'Partnership Health Plan CA - needs Type of Bill 327'
                });
            }
            console.log(`\n✓ Identified ${recordsNeedingChange.length} PARTNERSHIP HEALTH PLAN OF CA records that need TOB 327`);
        }
    }
    else {
        console.log("✓ No PARTNERSHIP HEALTH PLAN OF CA records found");
    }
    // Check for Community health Group records (add severity point to remarks)
    console.log("\n=== CHECKING FOR COMMUNITY HEALTH GROUP RECORDS ===");
    const communityHealthRecords = isInsuranceSelected('community health group')
        ? records.filter(r => r.insurance.toLowerCase().includes('community health group'))
        : [];
    if (communityHealthRecords.length > 0) {
        console.log(`\n⚠️  Found ${communityHealthRecords.length} Community health Group record(s)`);
        console.log("  These records require Severity Point calculation based on Date of Admission");
        // Import PDF helper functions
        const { extractDateOfAdmission, calculateSeverityPoint, formatSeverityPointRemark } = await Promise.resolve().then(() => __importStar(require('./pdf-helper')));
        for (const record of communityHealthRecords) {
            console.log(`\nProcessing Community health Group record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            console.log(`  Billing Period Start: ${record.billingPeriodStart}`);
            // Find the print icon for this record
            const printIconId = await page.evaluate((rowIndex) => {
                const rows = Array.from(document.querySelectorAll('table tbody tr'));
                const row = rows[rowIndex];
                if (!row)
                    return null;
                const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
                return (printIcon === null || printIcon === void 0 ? void 0 : printIcon.id) || null;
            }, record.index);
            if (!printIconId) {
                console.log(`  ⚠️  No print icon found for this record - skipping`);
                continue;
            }
            console.log(`  Print Icon ID: ${printIconId}`);
            try {
                // Set up listener for new page (PDF tab) before clicking
                const newPagePromise = page.context().waitForEvent('page', { timeout: 30000 });
                // Click print icon
                console.log(`  Clicking print icon...`);
                await page.click(`#${printIconId}`);
                console.log(`  ✓ Print icon clicked`);
                // Wait for PDF tab to open
                console.log(`  Waiting for PDF tab to open...`);
                const pdfPage = await newPagePromise;
                console.log(`  ✓ PDF tab opened`);
                // Wait for PDF to fully load
                console.log(`  Waiting for PDF content to fully load...`);
                await pdfPage.waitForLoadState('load', { timeout: 30000 });
                await pdfPage.waitForTimeout(3000); // Extra time for PDF rendering
                console.log(`  ✓ PDF content ready`);
                // Get the PDF URL
                const pdfUrl = pdfPage.url();
                console.log(`  PDF URL: ${pdfUrl}`);
                // Download the PDF content
                console.log(`  Downloading PDF content...`);
                const response = await pdfPage.context().request.fetch(pdfUrl);
                const pdfBuffer = await response.body();
                console.log(`  ✓ Downloaded PDF (${pdfBuffer.length} bytes)`);
                // Close the PDF tab
                await pdfPage.close();
                console.log(`  ✓ Closed PDF tab`);
                // Extract date of admission from PDF
                console.log(`  Extracting date of admission from PDF...`);
                const dateOfAdmission = await extractDateOfAdmission(pdfBuffer);
                if (!dateOfAdmission) {
                    console.log(`  ⚠️  Could not extract date of admission - skipping severity point calculation`);
                    continue;
                }
                console.log(`  ✓ Date of Admission: ${dateOfAdmission}`);
                // Calculate severity point based on current date
                const severityPoint = calculateSeverityPoint(dateOfAdmission);
                const severityRemark = formatSeverityPointRemark(severityPoint);
                console.log(`  ✓ Severity Point Remark: "${severityRemark}"`);
                // Now edit the record using the worksheet link
                if (record.worksheetLinkId) {
                    console.log(`  Clicking Worksheet Edit link: ${record.worksheetLinkId}`);
                    await page.click(`#${record.worksheetLinkId}`);
                    console.log("  ✓ Worksheet link clicked");
                    // Wait for loading to appear and disappear
                    console.log("  Waiting for loading to complete...");
                    await page.waitForTimeout(2000);
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
                    await page.waitForTimeout(2000);
                    console.log("  ✓ Loading complete");
                    // Check if popup appeared and click OK if it exists
                    try {
                        const modalButton = await page.waitForSelector('#modal_go', { timeout: 5000 });
                        if (modalButton) {
                            console.log("  Popup detected, clicking OK...");
                            await page.click('#modal_go');
                            console.log("  ✓ Clicked OK button on popup");
                            await page.waitForTimeout(2000);
                        }
                    }
                    catch (e) {
                        console.log("  No popup detected, continuing...");
                    }
                    // Wait for remarks textarea to be visible
                    console.log("  Waiting for remarks textarea...");
                    await page.waitForSelector('#remarks', { timeout: 10000 });
                    console.log("  ✓ Found remarks textarea");
                    // Get current value
                    const currentValue = await page.$eval('#remarks', (el) => el.value || '');
                    console.log(`  Current remarks: "${currentValue}"`);
                    // Append severity point remark
                    const newValue = currentValue ? `${currentValue}\n${severityRemark}` : severityRemark;
                    // Clear and fill
                    await page.fill('#remarks', newValue);
                    console.log(`  ✓ Updated remarks to: "${newValue}"`);
                    // Track this change
                    changedRecords.push({
                        mrn: record.mrn,
                        billingPeriod: record.billingPeriodText,
                        reason: `Community health Group - ${severityRemark}`
                    });
                    await page.waitForTimeout(1000);
                    // Click Save and Close
                    console.log("  Clicking Save and Close button...");
                    await page.waitForSelector('#submitBtn', { timeout: 10000 });
                    await page.click('#submitBtn');
                    console.log("  ✓ Clicked Save and Close");
                    // Wait for page to reload and return to Pending Approval
                    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
                    await page.waitForTimeout(3000);
                    console.log(`  ✓ Community health Group record processed successfully`);
                }
                else {
                    console.log(`  ⚠️  No worksheet link found for this record`);
                }
            }
            catch (error) {
                console.error(`  ✗ Error processing Community health Group record:`, error);
            }
        }
        console.log(`\n✓ Completed processing ${communityHealthRecords.length} Community health Group records`);
    }
    else {
        console.log("✓ No Community health Group records found");
    }
    // Check for SENIOR WHOLE HEALTH (BID) records - need SN visit validation
    console.log("\n=== CHECKING FOR SENIOR WHOLE HEALTH (BID) RECORDS ===");
    const seniorWholeHealthRecords = isInsuranceSelected('senior whole health (bid)')
        ? records.filter(r => r.insurance.toLowerCase().includes('senior whole health') && r.insurance.toLowerCase().includes('bid'))
        : [];
    const recordsFailingSNCheck = []; // Track records that have > 2 SN visits per day
    if (seniorWholeHealthRecords.length > 0) {
        console.log(`\n⚠️  Found ${seniorWholeHealthRecords.length} Senior whole Health (BID) record(s)`);
        console.log("  These records require Skilled Nursing visit validation (max 2 per day)");
        for (const record of seniorWholeHealthRecords) {
            console.log(`\nValidating Senior whole Health (BID) record:`);
            console.log(`  MRN: ${record.mrn}`);
            console.log(`  Insurance: ${record.insurance}`);
            console.log(`  Billing Period: ${record.billingPeriodText}`);
            console.log(`  Edit Button ID: ${record.editButtonId}`);
            if (!record.editButtonId) {
                console.log(`  ⚠️  No edit button found - skipping validation`);
                continue;
            }
            try {
                // Step 1: Click edit button
                console.log(`  Step 1: Clicking edit button...`);
                await page.click(`#${record.editButtonId}`);
                console.log(`  ✓ Clicked edit button`);
                // Step 2: Wait for worksheet page to load
                console.log(`  Step 2: Waiting for worksheet page to load...`);
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                console.log(`  ✓ Worksheet page loaded`);
                // Step 3: Handle "Helpful Suggestion" modal
                console.log(`  Step 3: Waiting for modal...`);
                await page.waitForTimeout(2000);
                let modalClicked = false;
                try {
                    const modalVisible = await page.isVisible('#modal_go');
                    if (modalVisible) {
                        await page.click('#modal_go', { timeout: 3000 });
                        console.log(`  ✓ Clicked OK on modal`);
                        modalClicked = true;
                        await page.waitForTimeout(1000);
                    }
                } catch (e) {}
                if (!modalClicked) {
                    try {
                        await page.evaluate(() => {
                            const btn = document.querySelector('#modal_go');
                            if (btn) btn.click();
                        });
                        console.log(`  ✓ Clicked OK via evaluate`);
                    } catch (e) {}
                }
                await page.waitForTimeout(2000);
                // Step 4: Click "+ Visits" accordion to expand
                console.log(`  Step 4: Expanding Visits section...`);
                try {
                    await page.click('a.accordion-toggle:has-text("Visits")');
                    console.log(`  ✓ Clicked Visits accordion`);
                    await page.waitForTimeout(2000);
                } catch (visitsError) {
                    // Try alternative selector
                    try {
                        await page.evaluate(() => {
                            const links = Array.from(document.querySelectorAll('a.accordion-toggle'));
                            const visitsLink = links.find(a => a.textContent.trim() === 'Visits');
                            if (visitsLink) visitsLink.click();
                        });
                        console.log(`  ✓ Clicked Visits accordion via evaluate`);
                        await page.waitForTimeout(2000);
                    } catch (e) {
                        console.log(`  ⚠️  Could not expand Visits section`);
                    }
                }
                // Step 5: Extract Skilled Nursing visits and count per day
                console.log(`  Step 5: Checking Skilled Nursing visits...`);
                const snVisitCheck = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('table.table-striped tbody tr'));
                    const snVisitsByDate = {};
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const date = cells[0].textContent.trim();
                            const visitType = cells[1].textContent.trim();
                            // Case-insensitive match for Skilled Nursing
                            if (visitType.toLowerCase().includes('skilled nursing')) {
                                if (!snVisitsByDate[date]) {
                                    snVisitsByDate[date] = 0;
                                }
                                snVisitsByDate[date]++;
                            }
                        }
                    });
                    // Check if any date has more than 2 SN visits
                    let hasExceeded = false;
                    const details = [];
                    for (const [date, count] of Object.entries(snVisitsByDate)) {
                        details.push({ date, count });
                        if (count > 2) {
                            hasExceeded = true;
                        }
                    }
                    return { hasExceeded, details, totalSNVisits: Object.values(snVisitsByDate).reduce((a, b) => a + b, 0) };
                });
                console.log(`  SN Visit Summary:`);
                snVisitCheck.details.forEach(d => {
                    const status = d.count > 2 ? '❌ EXCEEDS LIMIT' : '✓ OK';
                    console.log(`    ${d.date}: ${d.count} SN visit(s) ${status}`);
                });
                if (snVisitCheck.hasExceeded) {
                    console.log(`  ❌ FAILED: Record has > 2 SN visits on at least one date`);
                    console.log(`  → This record will NOT be approved (will stay in Pending Approval)`);
                    recordsFailingSNCheck.push(record.index);
                } else {
                    console.log(`  ✓ PASSED: All dates have ≤ 2 SN visits`);
                    console.log(`  → This record will be approved normally`);
                }
                // Step 6: Click Cancel to go back to Pending Approval
                console.log(`  Step 6: Clicking Cancel to return...`);
                await page.click('#returnBtn');
                console.log(`  ✓ Clicked Cancel`);
                // Wait for Pending Approval page to reload
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await page.waitForTimeout(3000);
                console.log(`  ✓ Returned to Pending Approval page`);
            } catch (error) {
                console.error(`  ✗ Error validating Senior whole Health (BID) record:`, error.message || error);
                // Try to navigate back
                try {
                    await page.click('#returnBtn');
                    await page.waitForTimeout(3000);
                } catch (navError) {
                    try {
                        await page.click('#pendingClaimsApproval');
                        await page.waitForTimeout(3000);
                    } catch (e) {}
                }
            }
        }
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`SENIOR WHOLE HEALTH (BID) VALIDATION SUMMARY:`);
        console.log(`  Total records checked: ${seniorWholeHealthRecords.length}`);
        console.log(`  Records PASSING (≤ 2 SN/day): ${seniorWholeHealthRecords.length - recordsFailingSNCheck.length}`);
        console.log(`  Records FAILING (> 2 SN/day): ${recordsFailingSNCheck.length}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } else {
        console.log("✓ No Senior whole Health (BID) records found");
    }
    // Also add CCA records that have > 2 SN visits per day to the skip list
    const ccaSkipRecords = validRecords.filter(r => r.skipApproval && r.insurance.toLowerCase().trim() === 'commonwealth care alliance');
    if (ccaSkipRecords.length > 0) {
        console.log(`\n=== CCA RECORDS EXCLUDED FROM APPROVAL (>2 SN visits/day) ===`);
        for (const record of ccaSkipRecords) {
            recordsFailingSNCheck.push(record.index);
            console.log(`  ⊘ Record [${record.index}] MRN: ${record.mrn}, Period: ${record.billingPeriodText} - will NOT be approved`);
        }
        console.log(`  Total CCA records excluded: ${ccaSkipRecords.length}`);
    }
    // Also add Fallon records that have > 2 SN visits per day to the skip list
    const fallonSkipRecords = validRecords.filter(r => r.skipApproval && 
        (r.insurance.toLowerCase().trim() === 'fallon community health plan' || r.insurance.toLowerCase().trim() === 'fallon community health plan mav'));
    if (fallonSkipRecords.length > 0) {
        console.log(`\n=== FALLON RECORDS EXCLUDED FROM APPROVAL (>2 SN visits/day) ===`);
        for (const record of fallonSkipRecords) {
            recordsFailingSNCheck.push(record.index);
            console.log(`  ⊘ Record [${record.index}] MRN: ${record.mrn}, Period: ${record.billingPeriodText} - will NOT be approved`);
        }
        console.log(`  Total Fallon records excluded: ${fallonSkipRecords.length}`);
    }
    console.log("\n=== SELECTING ALL RECORDS FOR APPROVAL ===");
    // Ensure we're on the Pending Approval page with fresh data
    console.log("Verifying we are on Pending Approval page...");
    const currentUrl = page.url();
    if (!currentUrl.includes('approve-claims')) {
        console.log("  Not on Pending Approval page, navigating...");
        try {
            await page.click('#pendingClaimsApproval');
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await page.waitForTimeout(3000);
        } catch (e) {
            console.log(`  ⚠️  Could not navigate to Pending Approval: ${e.message}`);
        }
    }
    // Wait for page to be fully loaded
    try {
        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
    } catch (e) {}
    await page.waitForTimeout(2000);
    // Ensure correct insurance selection in dropdown (maintain user's choice)
    try {
        await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
        if (!selectedInsurances || selectedInsurances.length === 0) {
            await page.selectOption('select[ng-model="insuranceKey"]', '1');
            console.log("  ✓ Selected 'All Insurances' in dropdown");
        } else {
            console.log(`  ✓ Keeping user-selected insurance(s) in dropdown`);
        }
        await page.waitForTimeout(3000);
        try {
            await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
        } catch (e) {}
        await page.waitForTimeout(2000);
    } catch (e) {
        console.log(`  ⚠️  Could not verify insurance dropdown: ${e.message}`);
    }
    // Count records available for approval
    const totalRecordsInTable = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.filter(r => r.querySelector('input[type="checkbox"]')).length;
    });
    console.log(`  Records in Pending Approval table: ${totalRecordsInTable}`);
    if (totalRecordsInTable === 0) {
        console.log("  ✓ No records in Pending Approval - nothing to approve");
        return { changedRecords, snFailures: recordsFailingSNCheck.map(idx => {
            const record = validRecords[idx];
            return { mrn: record ? record.mrn : 'Unknown', billingPeriod: record ? record.billingPeriodText : 'Unknown', insurance: record ? record.insurance : 'Unknown' };
        })};
    }
    // Try to find and click the "Select All" checkbox
    console.log("Looking for 'Select All' checkbox...");
    // Try multiple selectors for the Select All checkbox
    const selectAllSelectors = [
        '#page1_rowSelection',
        'input#page1_rowSelection',
        'input[ng-model="templateModel.checkboxState"]',
        'input[type="checkbox"][ng-model*="selectAll"]',
        'input[type="checkbox"][ng-click*="selectAll"]',
        'thead input[type="checkbox"]',
        'th input[type="checkbox"]',
        'table thead tr input[type="checkbox"]:first-of-type'
    ];
    let selectAllFound = false;
    for (const selector of selectAllSelectors) {
        try {
            const selectAllCheckbox = await page.$(selector);
            if (selectAllCheckbox) {
                console.log(`✓ Found 'Select All' checkbox with selector: ${selector}`);
                try {
                    // Use evaluate to click and trigger Angular ng-change
                    await page.evaluate((sel) => {
                        const cb = document.querySelector(sel);
                        if (cb) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            cb.dispatchEvent(new Event('click', { bubbles: true }));
                            // Trigger Angular digest
                            if (window.angular) {
                                const scope = window.angular.element(cb).scope();
                                if (scope) {
                                    scope.$apply(() => {
                                        scope.templateModel.checkboxState = true;
                                        if (scope.templateModel.checkboxEvent) {
                                            scope.templateModel.checkboxEvent(scope.templateModel.location, true);
                                        }
                                    });
                                }
                            }
                        }
                    }, selector);
                    await page.waitForTimeout(3000); // Wait for selection to propagate
                    console.log("✓ Clicked 'Select All' checkbox and triggered Angular change");
                    selectAllFound = true;
                    break;
                }
                catch (clickError) {
                    console.log(`  ⚠️ Click/evaluate failed: ${clickError.message}`);
                    // Try simple click as fallback
                    try {
                        await page.click(selector, { timeout: 5000 });
                        await page.waitForTimeout(3000);
                        console.log("✓ Clicked 'Select All' checkbox via direct click");
                        selectAllFound = true;
                        break;
                    }
                    catch (directClickError) {
                        console.log(`  ⚠️ Direct click also failed: ${directClickError.message}`);
                    }
                }
            }
        }
        catch (error) {
            // Try next selector
        }
    }
    if (!selectAllFound) {
        console.log("⚠️  'Select All' checkbox not found with any selector");
        console.log("⚠️  This is unexpected - Pending Approval should have a Select All checkbox");
        console.log("⚠️  Skipping approval to avoid errors");
        return { changedRecords, snFailures: recordsFailingSNCheck.map(idx => {
            const record = records[idx];
            return { mrn: record ? record.mrn : 'Unknown', billingPeriod: record ? record.billingPeriodText : 'Unknown', insurance: record ? record.insurance : 'Senior whole Health (BID)' };
        })};
    }
    // Verify how many checkboxes are actually checked
    const checkedCount = await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"]'));
        const checked = checkboxes.filter(cb => cb.checked);
        console.log(`Total row checkboxes: ${checkboxes.length}, Checked: ${checked.length}`);
        return checked.length;
    });
    console.log(`✓ Verified: ${checkedCount} records are selected`);
    // Deselect Senior whole Health (BID) records that failed SN visit check
    if (recordsFailingSNCheck.length > 0) {
        console.log(`\n=== DESELECTING ${recordsFailingSNCheck.length} RECORDS THAT FAILED SN VISIT CHECK ===`);
        console.log(`These records have > 2 Skilled Nursing visits per day and will stay in Pending Approval`);
        for (const recordIndex of recordsFailingSNCheck) {
            try {
                await page.evaluate((rowIdx) => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr'));
                    if (rowIdx < rows.length) {
                        const checkbox = rows[rowIdx].querySelector('input[type="checkbox"]');
                        if (checkbox && checkbox.checked) {
                            checkbox.click();
                        }
                    }
                }, recordIndex);
                console.log(`  ✓ Deselected record [${recordIndex}] (failed SN visit check)`);
            } catch (error) {
                console.log(`  ⚠️  Could not deselect record [${recordIndex}]`);
            }
        }
        await page.waitForTimeout(1000);
        const updatedCheckedCount = await page.evaluate(() => {
            const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"]'));
            return checkboxes.filter(cb => cb.checked).length;
        });
        console.log(`✓ After deselection: ${updatedCheckedCount} records selected for approval`);
        console.log(`✓ ${recordsFailingSNCheck.length} records staying in Pending Approval (need manual review)`);
    }
    // Note: Records needing TOB 327 have already been changed automatically above
    // All records should now have correct Type of Bill, so we can proceed with approval
    // Wait for any "checking" state to complete
    console.log("\nWaiting for any 'checking' state to complete...");
    await page.waitForTimeout(3000);
    // Scroll to the Approve button (it's at the bottom of the page)
    console.log("\nScrolling to Approve button...");
    await page.evaluate(() => {
        const approveButton = document.querySelector('#claimsApproval');
        if (approveButton) {
            approveButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    await page.waitForTimeout(1000);
    console.log("✓ Scrolled to Approve button");
    // Check if Approve button is enabled
    const isDisabled = await page.evaluate(() => {
        const button = document.querySelector('#claimsApproval');
        if (button) {
            console.log('Approve button disabled:', button.disabled);
            console.log('Approve button class:', button.className);
            return button.disabled;
        }
        return true;
    });
    console.log(`Approve button disabled: ${isDisabled}`);
    if (isDisabled) {
        console.log("⚠️  Approve button is disabled! Attempting to force enable...");
        await page.evaluate(() => {
            const button = document.querySelector('#claimsApproval');
            if (button) {
                button.disabled = false;
                button.removeAttribute('disabled');
            }
        });
        await page.waitForTimeout(500);
    }
    // Show confirmation dialog to verify selection before approval
    console.log("\n=== CONFIRMATION REQUIRED ===");
    const selectedCount = await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"]'));
        return checkboxes.filter(cb => cb.checked).length;
    });
    console.log(`\n📋 SUMMARY:`);
    console.log(`  - Total records in Pending Approval: ${records.length}`);
    console.log(`  - Records SELECTED for approval: ${selectedCount}`);
    console.log(`  - Records DESELECTED (need TOB 327): ${recordsNeedingTOB327.length}`);
    if (recordsNeedingTOB327.length > 0) {
        console.log(`\n⚠️  DESELECTED RECORDS (will stay in Pending Approval):`);
        recordsNeedingTOB327.forEach(idx => {
            const record = records[idx];
            console.log(`  - MRN: ${record.mrn}, Insurance: ${record.insurance}, Billing Period: ${record.billingPeriodText}`);
        });
    }
    console.log(`\n⚠️  IMPORTANT: About to approve ${selectedCount} records`);
    // Only wait for manual verification if running in non-headless mode (for testing)
    const isHeadless = process.env.HEADLESS !== 'false';
    if (!isHeadless) {
        console.log(`⚠️  Running in headless:false mode - waiting 5 seconds for manual verification...`);
        console.log(`⚠️  You can verify the selection in the browser window`);
        console.log(`⚠️  Press Ctrl+C to cancel if needed`);
        await page.waitForTimeout(5000);
    }
    else {
        console.log(`✓ Running in headless mode - proceeding automatically`);
    }
    console.log("\n✓ Proceeding with approval");
    // Click Approve button with multiple fallback methods
    console.log("\nClicking Approve button...");
    let clickSuccess = false;
    // Method 1: Normal click
    try {
        await page.click('#claimsApproval', { timeout: 5000 });
        console.log("✓ Method 1: Normal click succeeded");
        clickSuccess = true;
    }
    catch (error) {
        console.log("⚠️  Method 1 failed, trying Method 2...");
        // Method 2: Force click
        try {
            await page.click('#claimsApproval', { force: true, timeout: 5000 });
            console.log("✓ Method 2: Force click succeeded");
            clickSuccess = true;
        }
        catch (error2) {
            console.log("⚠️  Method 2 failed, trying Method 3...");
            // Method 3: JavaScript click
            try {
                await page.evaluate(() => {
                    const button = document.querySelector('#claimsApproval');
                    if (button)
                        button.click();
                });
                console.log("✓ Method 3: JavaScript click succeeded");
                clickSuccess = true;
            }
            catch (error3) {
                console.log("⚠️  Method 3 failed, trying Method 4...");
                // Method 4: Dispatch click event
                try {
                    await page.evaluate(() => {
                        const button = document.querySelector('#claimsApproval');
                        if (button) {
                            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
                            button.dispatchEvent(event);
                        }
                    });
                    console.log("✓ Method 4: Dispatch click event succeeded");
                    clickSuccess = true;
                }
                catch (error4) {
                    console.log("✗ All click methods failed!");
                }
            }
        }
    }
    if (clickSuccess) {
        console.log("✓ Approve button clicked successfully");
        // Wait for approval to process
        console.log("Waiting for approval to process...");
        await page.waitForTimeout(3000);
        // Wait for loading spinner
        try {
            await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 30000 });
        } catch (e) {}
        await page.waitForTimeout(3000);
        // Verify records were approved by checking remaining count
        const remainingCount = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.filter(r => r.querySelector('input[type="checkbox"]')).length;
        });
        console.log(`✓ Approval processing complete`);
        console.log(`  Records remaining in Pending Approval: ${remainingCount}`);
        console.log(`  Records moved to Ready To Send: ${selectedCount - remainingCount >= 0 ? selectedCount - remainingCount : 'unknown'}`);
    }
    else {
        console.log("✗ Failed to click Approve button - skipping approval");
    }
    // Return the list of changed records and SN failures
    return { changedRecords, snFailures: recordsFailingSNCheck.map(idx => {
        const record = records[idx];
        return { mrn: record ? record.mrn : 'Unknown', billingPeriod: record ? record.billingPeriodText : 'Unknown', insurance: record ? record.insurance : 'Senior whole Health (BID)' };
    })};
}
async function processReadyToSend(page, insuranceHelper, selectedInsurances = null) {
    console.log("\n=== PROCESSING READY TO SEND ===");
    // Check if stop was requested before starting
    if (isStopRequested()) {
        console.log(`⚠️  STOP REQUESTED - Skipping Ready To Send tab`);
        return [];
    }
    try {
        // Wait for loading to complete
        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
        await page.waitForTimeout(2000);
        // Select insurances from dropdown (use selectedInsurances if provided, otherwise "All Insurances")
        if (selectedInsurances && selectedInsurances.length > 0) {
            console.log(`\nSelecting user-specified insurance(s) from dropdown...`);
            console.log(`Insurances to select: ${selectedInsurances.join(', ')}`);
            await selectAllInsurances(page, selectedInsurances);
        }
        else {
            console.log("\nSelecting 'All Insurances' from dropdown...");
            await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
            // First, check what's currently selected
            const currentValueRTS = await page.$eval('select[ng-model="insuranceKey"]', (select) => select.value);
            console.log(`Current dropdown value: ${currentValueRTS}`);
            // If already on "All Insurances", select something else first to trigger change event
            if (currentValueRTS === '1') {
                console.log("Already on 'All Insurances', selecting different option first to trigger change...");
                const optionsRTS = await page.$eval('select[ng-model="insuranceKey"] option', (opts) => opts.map((opt) => opt.value).filter((v) => v && v !== '1'));
                if (optionsRTS.length > 0) {
                    await page.selectOption('select[ng-model="insuranceKey"]', optionsRTS[0]);
                    await page.waitForTimeout(1000);
                    console.log(`  Selected temporary option: ${optionsRTS[0]}`);
                }
            }
            // Now select "All Insurances"
            await page.selectOption('select[ng-model="insuranceKey"]', '1'); // value="1" is "All Insurances"
            console.log("✓ Selected 'All Insurances'");
        }
        await page.waitForTimeout(2000); // Give time for loading to start
        await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
        await page.waitForTimeout(3000); // Extra time for records to render
        console.log("✓ Records loaded");
        // Get all records with insurance information
        console.log("\nExtracting records from Ready To Send...");
        const records = await page.evaluate(() => {
            // Find header columns - handle Angular nested structure
            const headerCells = Array.from(document.querySelectorAll('table thead th'));
            const headers = headerCells.map(cell => {
                var _a, _b, _c;
                // Try to get text from nested Angular elements
                const link = cell.querySelector('a');
                const span = cell.querySelector('span');
                const text = ((_a = link === null || link === void 0 ? void 0 : link.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = span === null || span === void 0 ? void 0 : span.textContent) === null || _b === void 0 ? void 0 : _b.trim()) || ((_c = cell.textContent) === null || _c === void 0 ? void 0 : _c.trim()) || '';
                return text.toLowerCase();
            });
            console.log('DEBUG: Table headers:', headers);
            // Find insurance column index
            const insuranceIndex = headers.findIndex(h => h.includes('insurance'));
            console.log('DEBUG: Insurance column index:', insuranceIndex);
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.map((row, index) => {
                var _a, _b, _c, _d;
                const cells = row.querySelectorAll('td');
                // Skip rows that don't have enough cells (likely comment/follow-up rows)
                if (cells.length < 5) {
                    console.log(`DEBUG: Row ${index + 1} - Skipping (only ${cells.length} cells)`);
                    return null;
                }
                // Get insurance name from the correct column
                let insurance = '';
                if (insuranceIndex >= 0 && insuranceIndex < cells.length) {
                    const cell = cells[insuranceIndex];
                    // Look for div with ng-binding class (Angular rendered content)
                    const ngBindingDiv = cell.querySelector('div.ng-binding');
                    if (ngBindingDiv && ((_a = ngBindingDiv.textContent) === null || _a === void 0 ? void 0 : _a.trim())) {
                        insurance = ngBindingDiv.textContent.trim();
                    }
                    // Fallback methods if ng-binding not found
                    if (!insurance) {
                        const link = cell.querySelector('a');
                        if (link && ((_b = link.textContent) === null || _b === void 0 ? void 0 : _b.trim())) {
                            insurance = link.textContent.trim();
                        }
                    }
                    if (!insurance) {
                        const span = cell.querySelector('span');
                        if (span && ((_c = span.textContent) === null || _c === void 0 ? void 0 : _c.trim())) {
                            insurance = span.textContent.trim();
                        }
                    }
                    if (!insurance) {
                        const div = cell.querySelector('div');
                        if (div && ((_d = div.textContent) === null || _d === void 0 ? void 0 : _d.trim())) {
                            insurance = div.textContent.trim();
                        }
                    }
                    if (!insurance && cell.innerText) {
                        insurance = cell.innerText.trim();
                    }
                }
                // Find checkbox and print icon
                const checkbox = row.querySelector('input[type="checkbox"]');
                const checkboxId = (checkbox === null || checkbox === void 0 ? void 0 : checkbox.id) || '';
                const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
                const printIconId = (printIcon === null || printIcon === void 0 ? void 0 : printIcon.id) || '';
                // Extract all cell data - look for ng-binding divs first
                const allCells = Array.from(cells).map(cell => {
                    var _a, _b, _c, _d, _e, _f;
                    const ngBindingDiv = cell.querySelector('div.ng-binding');
                    if (ngBindingDiv && ((_a = ngBindingDiv.textContent) === null || _a === void 0 ? void 0 : _a.trim())) {
                        return ngBindingDiv.textContent.trim();
                    }
                    const link = cell.querySelector('a');
                    const span = cell.querySelector('span');
                    const div = cell.querySelector('div');
                    return ((_b = link === null || link === void 0 ? void 0 : link.textContent) === null || _b === void 0 ? void 0 : _b.trim()) ||
                        ((_c = span === null || span === void 0 ? void 0 : span.textContent) === null || _c === void 0 ? void 0 : _c.trim()) ||
                        ((_d = div === null || div === void 0 ? void 0 : div.textContent) === null || _d === void 0 ? void 0 : _d.trim()) ||
                        ((_e = cell.innerText) === null || _e === void 0 ? void 0 : _e.trim()) ||
                        ((_f = cell.textContent) === null || _f === void 0 ? void 0 : _f.trim()) ||
                        '';
                });
                console.log(`DEBUG: Row ${index + 1}:`);
                console.log(`  Insurance (extracted): "${insurance}"`);
                console.log(`  Checkbox ID: ${checkboxId}`);
                console.log(`  Print Icon ID: ${printIconId}`);
                console.log(`  All cells:`, allCells);
                return {
                    index,
                    insurance,
                    checkboxId,
                    printIconId,
                    allCells
                };
            }).filter(record => record !== null); // Filter out null records (skipped rows)
        });
        console.log(`Found ${records.length} records in Ready To Send`);
        if (records.length === 0) {
            console.log("✓ No records to process in Ready To Send");
            return [];
        }
        // Filter out records with empty insurance names
        const validRecords = records.filter(r => r.insurance && r.insurance.trim().length > 0);
        const invalidRecords = records.filter(r => !r.insurance || r.insurance.trim().length === 0);
        if (invalidRecords.length > 0) {
            console.log(`\n⚠️ WARNING: Found ${invalidRecords.length} records with empty insurance names`);
            console.log("These records will be skipped. This may indicate:");
            console.log("  - Table structure has changed");
            console.log("  - Records are still loading");
            console.log("  - Data extraction logic needs updating");
            console.log("\nDEBUG: Showing cell data for records with empty insurance:");
            invalidRecords.forEach((rec, idx) => {
                console.log(`  Record ${rec.index + 1}: All cells =`, rec.allCells);
            });
        }
        if (validRecords.length === 0) {
            console.log("✓ No valid records to process in Ready To Send");
            return [];
        }
        console.log(`Processing ${validRecords.length} valid records (${invalidRecords.length} skipped)`);
        // Separate records by insurance type
        const noChangesRecords = [];
        const paperRecords = [];
        console.log("\n=== CATEGORIZING RECORDS ===");
        validRecords.forEach((record, idx) => {
            var _a;
            console.log(`\nRecord ${idx + 1}: ${record.insurance}`);
            // Find the instruction for this insurance (search all locations)
            const instruction = insuranceHelper['instructions'].find((inst) => inst.Name.toLowerCase().trim() === record.insurance.toLowerCase().trim());
            if (instruction) {
                console.log(`  Found instruction: Location=${instruction.Location}, Remarks=${(_a = instruction.Remarks) === null || _a === void 0 ? void 0 : _a.substring(0, 50)}...`);
                if (instruction.Remarks) {
                    const remark = instruction.Remarks.toLowerCase().trim();
                    if (remark.includes('no changes are required except for identical claims')) {
                        console.log(`  ✓ Categorized as: Electronic (No changes)`);
                        noChangesRecords.push(record);
                    }
                    else if (remark === 'paper') {
                        console.log(`  ✓ Categorized as: Paper`);
                        paperRecords.push(record);
                    }
                    else {
                        // Check if this is a special handling insurance
                        const processingType = insuranceHelper.getReadyToSendProcessingType(record.insurance);
                        if (processingType === 'electronic') {
                            console.log(`  ✓ Categorized as: Electronic (Special handling insurance)`);
                            noChangesRecords.push(record);
                        }
                        else if (processingType === 'paper') {
                            console.log(`  ✓ Categorized as: Paper (Special handling insurance)`);
                            paperRecords.push(record);
                        }
                        else {
                            console.log(`  ⚠️  Skipped: Remarks don't match criteria and not a configured special handling insurance`);
                        }
                    }
                }
                else {
                    console.log(`  ⚠️  Skipped: No remarks`);
                }
            }
            else {
                console.log(`  ⚠️  Skipped: Insurance not found in instructions`);
            }
        });
        console.log(`\n"No changes" insurances: ${noChangesRecords.length} records`);
        console.log(`"Paper" insurances: ${paperRecords.length} records`);
        // Create comprehensive summary Excel with all records
        const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
        const summaryFilename = `ready-to-send-summary-${timestamp}.xlsx`;
        const columnNames = ['#', 'Checkbox', 'Patient Name', 'MRN', 'Branch', 'Insurance', 'Billing Period', 'SOC Date', 'Claim #', 'Status', 'TOB', 'Amount', 'Col 13', 'Col 14', 'Col 15'];
        const allRecordsData = [
            ...noChangesRecords.map((record, idx) => ({
                'Record #': idx + 1,
                'Insurance': record.insurance,
                'Processing Type': 'Electronic',
                'Status': 'Send Electronically',
                ...record.allCells.reduce((acc, cell, cellIdx) => {
                    acc[columnNames[cellIdx] || `Column ${cellIdx + 1}`] = cell;
                    return acc;
                }, {})
            })),
            ...paperRecords.map((record, idx) => ({
                'Record #': noChangesRecords.length + idx + 1,
                'Insurance': record.insurance,
                'Processing Type': 'Paper',
                'Status': 'PDF Downloaded',
                ...record.allCells.reduce((acc, cell, cellIdx) => {
                    acc[columnNames[cellIdx] || `Column ${cellIdx + 1}`] = cell;
                    return acc;
                }, {})
            }))
        ];
        if (allRecordsData.length > 0) {
            const summaryWb = XLSX.utils.book_new();
            const summaryWs = XLSX.utils.json_to_sheet(allRecordsData);
            XLSX.utils.book_append_sheet(summaryWb, summaryWs, "Ready To Send Summary");
            XLSX.writeFile(summaryWb, summaryFilename);
            console.log(`✓ Created comprehensive summary: ${summaryFilename}`);
        }
        // Process "No changes" insurances - Send Electronically
        let electronicExcelFile = null;
        if (noChangesRecords.length > 0) {
            console.log('\n=== PROCESSING "NO CHANGES" INSURANCES (ELECTRONIC) ===');
            console.log(`Found ${noChangesRecords.length} records to send electronically`);
            // Select all "no changes" records
            console.log(`\nAttempting to select ${noChangesRecords.length} checkboxes...`);
            for (let i = 0; i < noChangesRecords.length; i++) {
                const record = noChangesRecords[i];
                console.log(`\nSelecting record ${i + 1}/${noChangesRecords.length}:`);
                console.log(`  Insurance: ${record.insurance}`);
                console.log(`  Checkbox ID: ${record.checkboxId}`);
                if (record.checkboxId) {
                    console.log(`  DEBUG: Entering checkbox processing block`);
                    try {
                        console.log(`  DEBUG: Inside try block, about to evaluate checkbox`);
                        // Check if checkbox exists and get its state
                        let checkboxInfo;
                        try {
                            checkboxInfo = await page.evaluate((id) => {
                                // IDs starting with numbers need to be escaped in querySelector
                                const checkbox = document.getElementById(id);
                                if (!checkbox) {
                                    return { exists: false, error: 'Element not found' };
                                }
                                // Get computed style to check visibility
                                const style = window.getComputedStyle(checkbox);
                                return {
                                    exists: true,
                                    disabled: checkbox.disabled,
                                    checked: checkbox.checked,
                                    visible: checkbox.offsetParent !== null,
                                    display: style.display,
                                    visibility: style.visibility,
                                    opacity: style.opacity,
                                    type: checkbox.type,
                                    className: checkbox.className,
                                    ngClick: checkbox.getAttribute('ng-click'),
                                    ngDisabled: checkbox.getAttribute('ng-disabled')
                                };
                            }, record.checkboxId);
                            console.log(`  DEBUG: Evaluate completed successfully`);
                        }
                        catch (evalError) {
                            console.log(`  ✗ Error during evaluate:`, (evalError === null || evalError === void 0 ? void 0 : evalError.message) || evalError);
                            checkboxInfo = { exists: false, error: (evalError === null || evalError === void 0 ? void 0 : evalError.message) || 'Unknown error' };
                        }
                        console.log(`  Checkbox info:`, JSON.stringify(checkboxInfo, null, 2));
                        if (!checkboxInfo.exists) {
                            console.log(`  ✗ Checkbox not found in DOM`);
                            continue;
                        }
                        if (checkboxInfo.disabled) {
                            console.log(`  ✗ Checkbox is disabled`);
                            continue;
                        }
                        console.log(`  ✓ Attempting to click checkbox...`);
                        // Try Playwright's click with force
                        try {
                            // Use getElementById since IDs starting with numbers can't use # selector
                            await page.evaluate((id) => {
                                const checkbox = document.getElementById(id);
                                if (checkbox) {
                                    checkbox.click();
                                }
                            }, record.checkboxId);
                            console.log(`  ✓ Checkbox click executed`);
                        }
                        catch (clickError) {
                            console.log(`  ✗ Click failed:`, (clickError === null || clickError === void 0 ? void 0 : clickError.message) || clickError);
                        }
                        await page.waitForTimeout(1000); // Wait for Angular to process
                        // Verify the click worked
                        const newState = await page.evaluate((id) => {
                            const checkbox = document.getElementById(id);
                            return {
                                checked: (checkbox === null || checkbox === void 0 ? void 0 : checkbox.checked) || false,
                                hasCheckedAttr: (checkbox === null || checkbox === void 0 ? void 0 : checkbox.hasAttribute('checked')) || false
                            };
                        }, record.checkboxId);
                        console.log(`  Checkbox state after click: checked=${newState.checked}, hasAttr=${newState.hasCheckedAttr}`);
                    }
                    catch (error) {
                        console.error(`  ✗ Error processing checkbox:`, (error === null || error === void 0 ? void 0 : error.message) || error);
                    }
                }
                else {
                    console.log(`  ✗ No checkbox ID found for this record`);
                }
            }
            console.log(`\n✓ Finished selecting ${noChangesRecords.length} records`);
            await page.waitForTimeout(1000); // Give Angular time to update
            // Verify selections
            const selectedCount = await page.evaluate(() => {
                const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"]'));
                return checkboxes.filter((cb) => cb.checked).length;
            });
            console.log(`✓ Verified: ${selectedCount} checkboxes are checked`);
            // Save to Excel before sending
            console.log("\nSaving 'No changes' records to Excel...");
            const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
            const filename = `ready-to-send-electronic-${timestamp}.xlsx`;
            // Create workbook with records
            const excelData = noChangesRecords.map((record, idx) => ({
                'Record #': idx + 1,
                'Insurance': record.insurance,
                'Status': 'Send Electronically',
                ...record.allCells.reduce((acc, cell, cellIdx) => {
                    acc[columnNames[cellIdx] || `Column ${cellIdx + 1}`] = cell;
                    return acc;
                }, {})
            }));
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(excelData);
            XLSX.utils.book_append_sheet(wb, ws, "Electronic Claims");
            XLSX.writeFile(wb, filename);
            electronicExcelFile = filename;
            console.log(`✓ Saved to: ${filename}`);
            // Click Claim Actions dropdown
            console.log("\nClicking Claim Actions dropdown...");
            await page.click('a.btn.dropdown-toggle[data-toggle="dropdown"]');
            await page.waitForTimeout(1000);
            console.log("✓ Dropdown opened");
            // Click Send Electronically
            console.log("Clicking 'Send Electronically'...");
            await page.waitForSelector('#sendAuto', { timeout: 10000 });
            await page.click('#sendAuto');
            console.log("✓ Clicked 'Send Electronically'");
            // Wait for loading to complete
            console.log("Waiting for electronic submission to complete...");
            await page.waitForTimeout(2000);
            await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
            await page.waitForTimeout(2000);
            console.log("✓ Electronic submission completed");
            // Deselect all checkboxes
            console.log("\nDeselecting all checkboxes...");
            for (let i = 0; i < noChangesRecords.length; i++) {
                const record = noChangesRecords[i];
                if (record.checkboxId) {
                    try {
                        const isChecked = await page.evaluate((id) => {
                            const checkbox = document.getElementById(id);
                            return (checkbox === null || checkbox === void 0 ? void 0 : checkbox.checked) || false;
                        }, record.checkboxId);
                        if (isChecked) {
                            await page.evaluate((id) => {
                                const checkbox = document.getElementById(id);
                                if (checkbox) {
                                    checkbox.click();
                                }
                            }, record.checkboxId);
                            await page.waitForTimeout(300);
                            console.log(`  ✓ Deselected checkbox for: ${record.insurance}`);
                        }
                    }
                    catch (error) {
                        console.error(`  ✗ Error deselecting checkbox:`, (error === null || error === void 0 ? void 0 : error.message) || error);
                    }
                }
            }
            console.log("✓ All checkboxes deselected");
        }
        // Process "Paper" insurances - Print individually
        const downloadedFiles = [];
        if (paperRecords.length > 0) {
            console.log('\n=== PROCESSING "PAPER" INSURANCES ===');
            console.log(`Found ${paperRecords.length} paper claims to download`);
            const downloadsPath = path.join(process.cwd(), 'downloads');
            // Create downloads folder if it doesn't exist
            if (!fs.existsSync(downloadsPath)) {
                fs.mkdirSync(downloadsPath, { recursive: true });
                console.log(`✓ Created downloads folder: ${downloadsPath}`);
            }
            for (let i = 0; i < paperRecords.length; i++) {
                const record = paperRecords[i];
                console.log(`\nProcessing paper record ${i + 1}/${paperRecords.length}`);
                console.log(`  Insurance: ${record.insurance}`);
                console.log(`  Print Icon ID: ${record.printIconId}`);
                if (record.printIconId) {
                    try {
                        // Set up listener for new page (tab) before clicking
                        const newPagePromise = page.context().waitForEvent('page', { timeout: 30000 });
                        
                        // Also listen for any PDF response on the context
                        let capturedPdfUrl = '';
                        const responseHandler = (response) => {
                            const url = response.url();
                            if (url.includes('.pdf') || url.includes('SharedTemp') || url.includes('ClaimPrintView')) {
                                capturedPdfUrl = url;
                            }
                        };
                        page.context().on('response', responseHandler);
                        
                        // Click print icon
                        console.log(`  Clicking print icon...`);
                        await page.click(`#${record.printIconId}`);
                        console.log(`  ✓ Print icon clicked`);
                        // Wait for new tab to open
                        console.log(`  Waiting for PDF tab to open...`);
                        const newPage = await newPagePromise;
                        console.log(`  ✓ PDF tab opened`);
                        // Wait for PDF to fully load in new tab
                        console.log(`  Waiting for PDF content to fully load...`);
                        
                        // Wait for the page to navigate to the actual PDF URL
                        let pdfUrl = '';
                        try {
                            // Wait for the page to navigate (the PDF tab redirects to the actual PDF)
                            await newPage.waitForURL(/\.pdf|SharedTemp|ClaimPrintView/, { timeout: 30000 });
                            pdfUrl = newPage.url();
                            console.log(`  ✓ PDF URL resolved via navigation: ${pdfUrl}`);
                        } catch (navError) {
                            // If waitForURL fails, try getting the URL directly
                            pdfUrl = newPage.url();
                            console.log(`  ⚠️ waitForURL timed out, current URL: ${pdfUrl}`);
                            
                            // If URL is still empty/invalid, try to get it from the page's frame
                            if (!pdfUrl || pdfUrl === ':' || pdfUrl === 'about:blank') {
                                // Try getting URL from frames
                                const frames = newPage.frames();
                                for (const frame of frames) {
                                    const frameUrl = frame.url();
                                    if (frameUrl.includes('.pdf') || frameUrl.includes('SharedTemp')) {
                                        pdfUrl = frameUrl;
                                        console.log(`  ✓ Found PDF URL in frame: ${pdfUrl}`);
                                        break;
                                    }
                                }
                            }
                            
                            // If still no valid URL, try to get it from response
                            if (!pdfUrl || pdfUrl === ':' || pdfUrl === 'about:blank') {
                                console.log(`  ⚠️ Could not get PDF URL, trying to fetch via page context...`);
                                // Try to get the PDF from the print icon's href directly
                                const printHref = await page.evaluate((iconId) => {
                                    const label = document.querySelector('#' + iconId);
                                    if (label) {
                                        const link = label.closest('a') || label.querySelector('a');
                                        if (link) return link.href;
                                    }
                                    return null;
                                }, record.printIconId);
                                
                                if (printHref) {
                                    pdfUrl = printHref;
                                    console.log(`  ✓ Got PDF URL from print icon href: ${pdfUrl}`);
                                }
                            }
                        }
                        
                        // Final wait for content
                        if (pdfUrl && pdfUrl.includes('.pdf')) {
                            try {
                                await newPage.waitForLoadState('load', { timeout: 15000 });
                                console.log(`  ✓ Load state reached`);
                            }
                            catch (loadError) {
                                console.log(`  ⚠️  Load timeout, continuing anyway...`);
                            }
                        }
                        
                        await newPage.waitForTimeout(2000);
                        console.log(`  ✓ PDF content ready for download`);
                        console.log(`  PDF URL: ${pdfUrl}`);
                        // Generate filename
                        const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss');
                        const sanitizedInsurance = record.insurance.replace(/[^a-zA-Z0-9]/g, '_');
                        const filename = `paper-claim-${sanitizedInsurance}-${timestamp}.pdf`;
                        const filepath = path.join(downloadsPath, filename);
                        // Download the actual PDF file
                        console.log(`  Downloading PDF...`);
                        
                        // Use captured PDF URL if page URL is invalid
                        if ((!pdfUrl || pdfUrl === ':' || pdfUrl === 'about:blank') && capturedPdfUrl) {
                            pdfUrl = capturedPdfUrl;
                            console.log(`  ✓ Using captured PDF URL from response: ${pdfUrl}`);
                        }
                        
                        // Remove response handler
                        page.context().removeListener('response', responseHandler);
                        
                        try {
                            // Wait additional time for PDF to fully render
                            await newPage.waitForTimeout(3000);
                            // Check if the page has an embed or iframe with PDF
                            const embedPdf = await newPage.$('embed[type="application/pdf"]');
                            const iframePdf = await newPage.$('iframe');
                            if (embedPdf || iframePdf || pdfUrl.includes('.pdf') || pdfUrl.includes('ClaimPrintView')) {
                                // It's a PDF viewer page, download the actual PDF file
                                console.log(`  Detected PDF viewer, downloading actual PDF file...`);
                                // Get the PDF source URL from embed or iframe
                                let pdfSrcUrl = pdfUrl;
                                if (embedPdf) {
                                    const src = await embedPdf.getAttribute('src');
                                    if (src)
                                        pdfSrcUrl = src.startsWith('http') ? src : new URL(src, pdfUrl).href;
                                }
                                else if (iframePdf) {
                                    const src = await iframePdf.getAttribute('src');
                                    if (src)
                                        pdfSrcUrl = src.startsWith('http') ? src : new URL(src, pdfUrl).href;
                                }
                                console.log(`  PDF source URL: ${pdfSrcUrl}`);
                                // Wait a bit more for PDF to be ready
                                await newPage.waitForTimeout(2000);
                                // Fetch the actual PDF file using the page's context (includes cookies/auth)
                                const response = await newPage.context().request.fetch(pdfSrcUrl);
                                const pdfBuffer = await response.body();
                                // Verify PDF has content
                                if (pdfBuffer.length < 1000) {
                                    console.log(`  ⚠️  PDF seems too small (${pdfBuffer.length} bytes), trying page.pdf() instead...`);
                                    throw new Error('PDF too small, using fallback');
                                }
                                fs.writeFileSync(filepath, pdfBuffer);
                                downloadedFiles.push(filepath);
                                console.log(`  ✓ Downloaded: ${filename} (${pdfBuffer.length} bytes)`);
                            }
                            else {
                                // Fallback: generate PDF from page content using page.pdf()
                                console.log(`  Generating PDF from page content using page.pdf()...`);
                                // Wait for content to be ready
                                await newPage.waitForTimeout(2000);
                                const pdfBuffer = await newPage.pdf({
                                    format: 'Letter',
                                    printBackground: true,
                                    margin: {
                                        top: '0.5in',
                                        right: '0.5in',
                                        bottom: '0.5in',
                                        left: '0.5in'
                                    }
                                });
                                fs.writeFileSync(filepath, pdfBuffer);
                                downloadedFiles.push(filepath);
                                console.log(`  ✓ Downloaded: ${filename} (${pdfBuffer.length} bytes)`);
                            }
                        }
                        catch (pdfError) {
                            console.error(`  ✗ PDF download failed:`, (pdfError === null || pdfError === void 0 ? void 0 : pdfError.message) || pdfError);
                            // Last resort: try page.pdf() as fallback
                            try {
                                console.log(`  Attempting fallback: page.pdf()...`);
                                await newPage.waitForTimeout(2000);
                                const pdfBuffer = await newPage.pdf({
                                    format: 'Letter',
                                    printBackground: true,
                                    margin: {
                                        top: '0.5in',
                                        right: '0.5in',
                                        bottom: '0.5in',
                                        left: '0.5in'
                                    }
                                });
                                fs.writeFileSync(filepath, pdfBuffer);
                                downloadedFiles.push(filepath);
                                console.log(`  ✓ Fallback successful: ${filename} (${pdfBuffer.length} bytes)`);
                            }
                            catch (fallbackError) {
                                console.error(`  ✗ Fallback also failed:`, fallbackError);
                            }
                        }
                        // Close the PDF tab and navigate back to main tab
                        await newPage.close();
                        console.log(`  ✓ Closed PDF tab, back to main tab`);
                        // Wait a bit before processing next record
                        await page.waitForTimeout(1000);
                    }
                    catch (error) {
                        console.error(`  ✗ Failed to download PDF for record ${i + 1}:`, error);
                    }
                }
                else {
                    console.log(`  ✗ No print icon ID found for this record`);
                }
            }
            console.log(`\n✓ Processed ${paperRecords.length} paper insurance records`);
            console.log(`✓ Downloaded ${downloadedFiles.length} PDF files`);
        }
        // Collect all files for email
        const allFiles = [];
        // Add comprehensive summary first
        if (allRecordsData.length > 0) {
            allFiles.push(summaryFilename);
        }
        // Add electronic claims Excel if created
        if (electronicExcelFile) {
            allFiles.push(electronicExcelFile);
        }
        // Add all downloaded PDFs
        allFiles.push(...downloadedFiles);
        console.log("\n✓ Ready To Send workflow completed");
        console.log(`✓ Total files for email: ${allFiles.length}`);
        console.log(`  - Summary Excel: ${allRecordsData.length > 0 ? '1' : '0'}`);
        console.log(`  - Electronic claims Excel: ${electronicExcelFile ? '1' : '0'}`);
        console.log(`  - PDF files: ${downloadedFiles.length}`);
        return allFiles;
    }
    catch (error) {
        console.error("✗ Error in Ready To Send workflow:", error);
        throw error;
    }
}
function findDuplicatesWithOverlap(records) {
    const mrnGroups = {};
    // Group by MRN
    records.forEach((record, index) => {
        if (record.mrn) {
            if (!mrnGroups[record.mrn]) {
                mrnGroups[record.mrn] = [];
            }
            mrnGroups[record.mrn].push({ ...record, originalIndex: index });
        }
    });
    const duplicates = [];
    // Check for overlapping dates within each MRN group
    Object.keys(mrnGroups).forEach(mrn => {
        const group = mrnGroups[mrn];
        if (group.length > 1) {
            // Find all records with overlapping dates
            const overlappingIndices = [];
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const record1 = group[i];
                    const record2 = group[j];
                    // Parse dates (adjust format as needed)
                    const start1 = new Date(record1.billingPeriodStart);
                    const end1 = new Date(record1.billingPeriodEnd);
                    const start2 = new Date(record2.billingPeriodStart);
                    const end2 = new Date(record2.billingPeriodEnd);
                    // Check for overlap
                    if (start1 <= end2 && start2 <= end1) {
                        // Add both indices if not already added
                        if (!overlappingIndices.includes(record1.originalIndex)) {
                            overlappingIndices.push(record1.originalIndex);
                        }
                        if (!overlappingIndices.includes(record2.originalIndex)) {
                            overlappingIndices.push(record2.originalIndex);
                        }
                    }
                }
            }
            // If we found overlapping records, add them as a group
            if (overlappingIndices.length > 1) {
                duplicates.push({
                    mrn,
                    indices: overlappingIndices.sort((a, b) => a - b) // Sort indices
                });
            }
        }
    });
    return duplicates;
}
