import "dotenv/config";
import { chromium, Page, Browser } from "playwright";
import { InsuranceHelper } from "./insurance-helper";
import { OFFICES, Office } from "./office-config";
import { sendEmail } from "./email-helper";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import * as fs from "fs";

interface SelectedRecord {
  id: string;
  insurance: string;
  authorization: string;
  timestamp: string;
  allColumns: string[];
}

async function selectOffice(page: Page, office: Office): Promise<void> {
  console.log(`\n=== Selecting Office: ${office.name} ===`);
  
  // Make sure we're on a page where the office selector exists
  // If we're deep in billing manager, go back to home first
  const currentUrl = page.url();
  if (currentUrl.includes('/billing')) {
    console.log("Navigating back to home page...");
    await page.goto(currentUrl.split('/EHR/')[0] + '/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }
  
  // Wait for the office selector dropdown
  await page.waitForSelector('#swapUser', { timeout: 20000 });
  
  // Select the office
  await page.selectOption('#swapUser', office.value);
  console.log(`✓ Selected office: ${office.name}`);
  
  // Wait for page to reload after office change
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Wait for any loading to complete
  await waitForLoadingToComplete(page);
  
  console.log(`✓ Office switched to ${office.name}`);
}

async function processOffice(page: Page, office: Office, insuranceHelper: InsuranceHelper): Promise<{records: SelectedRecord[], filename: string | null}> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`PROCESSING OFFICE: ${office.name} (${office.stateCode})`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    // 1. Navigate to Billing Manager
    await navigateToBillingManager(page);

    // 2. Click Primary Payer dropdown and select Ready
    await applyFilters(page);

    // 3. Select All Insurances from dropdown
    await selectAllInsurances(page);

    // 4. Wait for results table to load
    await waitForResultsTable(page);

    // 5. Process records and select valid ones
    const { selectedCount, selectedRecords } = await processRecordsAndSelectValid(page, insuranceHelper);

    // 6. Save selected records to Excel for audit trail
    let filename: string | null = null;
    if (selectedRecords.length > 0) {
      const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      filename = `selected-records-${office.stateCode}-${office.name.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.xlsx`;
      saveSelectedRecordsToExcel(selectedRecords, filename);
    }

    // 7. Click Create button - DISABLED FOR VERIFICATION
    // TODO: Re-enable after verifying selections are correct
    /*
    if (selectedCount > 0) {
      await clickCreateButton(page);
      console.log(`✓ Claims creation initiated for ${office.name}`);
    } else {
      console.log(`No records selected for ${office.name}, skipping Create button`);
    }
    */
    console.log(`⚠️  Create button NOT clicked - verification mode enabled`);
    console.log(`   Review the Excel files to verify selections before enabling Create button`);

    console.log(`✓ Successfully processed ${selectedCount} records for ${office.name}`);
    return { records: selectedRecords, filename };
    
  } catch (error) {
    console.error(`✗ Error processing office ${office.name}:`, error);
    throw error;
  }
}

function saveSelectedRecordsToExcel(records: SelectedRecord[], filename: string): void {
  if (records.length === 0) {
    console.log("⚠️  No records to save");
    return;
  }

  console.log(`\n=== Saving Excel File ===`);
  console.log(`Records to save: ${records.length}`);
  console.log(`Filename: ${filename}`);

  // Create worksheet data
  const wsData = [
    ['Timestamp', 'Record ID', 'Insurance', 'Authorization', 'All Columns'],
    ...records.map(r => [
      r.timestamp,
      r.id,
      r.insurance,
      r.authorization,
      r.allColumns.join(' | ')
    ])
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
    } else {
      console.error(`✗ File was not created: ${filename}`);
    }
  } catch (error) {
    console.error(`✗ Failed to save Excel file:`, error);
    throw error;
  }
}

/**
 * Automates login and processing of Ready billing records for selected office(s)
 * @param officeValue - Office value to process, or 'all' for all offices
 */
export async function loginAndProcessOffices(officeValue: string = 'all'): Promise<{
  totalRecords: number;
  filesCreated: number;
  emailSent: boolean;
  summary: Array<{office: string, count: number}>;
}> {
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load insurance instructions
    const insuranceHelper = new InsuranceHelper("Insurance Instructions.xlsx");

    // 1. Login
    await performLogin(page);

    // Determine which offices to process
    const officesToProcess = officeValue === 'all' 
      ? OFFICES 
      : OFFICES.filter(o => o.value === officeValue);

    if (officesToProcess.length === 0) {
      throw new Error(`Office not found: ${officeValue}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`STARTING PROCESSING`);
    console.log(`Offices to process: ${officesToProcess.length}`);
    officesToProcess.forEach(o => console.log(`  - ${o.name} (${o.stateCode})`));
    console.log(`${'='.repeat(80)}`);

    const allSelectedRecords: SelectedRecord[] = [];
    const summary: Array<{office: string, count: number}> = [];
    const excelFiles: string[] = [];

    // 2. Process each office
    for (let i = 0; i < officesToProcess.length; i++) {
      const office = officesToProcess[i];
      
      console.log(`\n[${i + 1}/${officesToProcess.length}] Processing ${office.name}...`);
      
      // Select the office
      await selectOffice(page, office);
      
      // Process this office
      const { records: officeRecords, filename } = await processOffice(page, office, insuranceHelper);
      allSelectedRecords.push(...officeRecords);
      summary.push({ office: office.name, count: officeRecords.length });
      if (filename) {
        excelFiles.push(filename);
      }
      
      console.log(`✓ Completed ${office.name}: ${officeRecords.length} records selected`);
      
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
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    if (officesToProcess.length > 1 && allSelectedRecords.length > 0) {
      const summaryFilename = `SUMMARY-${officesToProcess.length}-offices-${timestamp}.xlsx`;
      saveSelectedRecordsToExcel(allSelectedRecords, summaryFilename);
      excelFiles.push(summaryFilename);
    }

    // 5. Send email with all Excel files
    let emailSent = false;
    if (excelFiles.length > 0) {
      console.log(`\n=== Sending Email ===`);
      try {
        const officeNames = officesToProcess.map(o => o.name).join(', ');
        const emailBody = `
Kinnser Billing Automation Report
Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}

OFFICES PROCESSED: ${officeNames}

SUMMARY:
${summary.map(s => `${s.office}: ${s.count} records`).join('\n')}

Total records selected: ${allSelectedRecords.length}
Total offices processed: ${officesToProcess.length}

Attached files: ${excelFiles.length}
${excelFiles.map(f => `- ${f}`).join('\n')}

Note: Create button was NOT clicked (verification mode).
Please review the attached files before proceeding.
        `;

        await sendEmail({
          to: "nvenu@solifetec.com",
          subject: `Kinnser Billing Report - ${officeNames} - ${timestamp}`,
          body: emailBody,
          attachments: excelFiles
        });
        
        emailSent = true;
        console.log(`✓ Email sent successfully to nvenu@solifetec.com`);
      } catch (emailError) {
        console.error(`✗ Failed to send email:`, emailError);
        console.log(`Excel files saved locally: ${excelFiles.join(', ')}`);
      }
    }

    return {
      totalRecords: allSelectedRecords.length,
      filesCreated: excelFiles.length,
      emailSent,
      summary
    };

  } catch (error) {
    console.error("Error in billing automation:", error);
    throw error;
  } finally {
    if (browser) {
      // Keep browser open for a moment to see final state
      await new Promise(resolve => setTimeout(resolve, 3000));
      await browser.close();
    }
  }
}

async function waitForLoadingToComplete(page: Page): Promise<void> {
  console.log("Waiting for loading to complete...");
  
  // Wait a moment for loading to potentially start
  await page.waitForTimeout(1000);
  
  // Check if loading spinner exists
  const loaderExists = await page.locator('#globalAjaxLoader').count() > 0;
  
  if (loaderExists) {
    console.log("Loading spinner element found, monitoring it...");
    
    // Wait for the loading spinner to become visible first (if it's going to)
    try {
      console.log("Waiting for loading to start (spinner visible)...");
      await page.waitForFunction(() => {
        const loader = document.querySelector('#globalAjaxLoader') as HTMLElement;
        if (!loader) return false;
        const isVisible = loader.offsetParent !== null || window.getComputedStyle(loader).display !== 'none';
        return isVisible;
      }, { timeout: 5000 });
      console.log("✓ Loading spinner is now visible");
    } catch {
      console.log("Loading spinner didn't become visible (might already be done)");
    }
    
    // Now wait for it to be hidden
    console.log("Waiting for loading spinner to hide...");
    await page.waitForFunction(() => {
      const loader = document.querySelector('#globalAjaxLoader') as HTMLElement;
      if (!loader) return true;
      const isHidden = loader.offsetParent === null || window.getComputedStyle(loader).display === 'none';
      return isHidden;
    }, { timeout: 60000 });
    console.log("✓ Loading spinner is now hidden");
  } else {
    console.log("No loading spinner element found on page");
  }
  
  // Give it a moment to render the content after loading completes
  await page.waitForTimeout(2000);
  console.log("✓ Loading complete");
}

async function performLogin(page: Page): Promise<void> {
  const username = process.env.KINNSER_USER;
  const password = process.env.KINNSER_PASS;

  if (!username || !password) {
    throw new Error("KINNSER_USER and KINNSER_PASS environment variables must be set");
  }

  await page.goto("https://kinnser.net/login.cfm", {
    waitUntil: "domcontentloaded"
  });

  await page.fill('input[name="username"], input#username', username);
  await page.fill('input[name="password"], input#password', password);

  // Set up alert handler before clicking login
  page.once('dialog', async dialog => {
    console.log('Alert detected:', dialog.message());
    await dialog.accept(); // Click OK on the alert
  });

  // Click login and wait for any page to load (might be inbox or main page)
  await page.click('#login_btn');
  
  // Wait for navigation to complete (could go to inbox or main page)
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  
  // Wait a bit for any redirects
  await page.waitForTimeout(2000);

  // Verify login success - should not be on login page
  if (page.url().includes("login.cfm")) {
    throw new Error("Login failed - check credentials or MFA requirements");
  }
  
  console.log("Logged in successfully, current URL:", page.url());
}

async function navigateToBillingManager(page: Page): Promise<void> {
  console.log("=== Navigating to Billing Manager ===");
  
  await page.waitForSelector('a.menuButton[onclick*="gotoMenu"]', { timeout: 20000 });
  await page.click('a.menuButton[onclick*="gotoMenu"]');

  await page.waitForSelector('a.menuitem:has-text("Billing Manager")', { timeout: 20000 });
  
  // Click Billing Manager and wait for navigation
  console.log("Clicking Billing Manager...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
    page.click('a.menuitem:has-text("Billing Manager")')
  ]);
  
  console.log("✓ Navigation completed, URL:", page.url());
  
  // Wait for the loading to complete
  console.log("Waiting for Billing Manager page to fully load...");
  await waitForLoadingToComplete(page);
  
  // Verify the Primary Payer button is now visible
  console.log("Checking for Primary Payer button...");
  const buttonVisible = await page.locator('#ManagedCareClaims').isVisible();
  console.log("Primary Payer button visible:", buttonVisible);
  
  if (!buttonVisible) {
    console.error("✗ Primary Payer button not visible after loading");
    await page.screenshot({ path: 'debug-no-button.png' });
    throw new Error("Primary Payer button not found after page load");
  }
  
  console.log("✓ Billing Manager page fully loaded and ready");
}

async function applyFilters(page: Page): Promise<void> {
  console.log("=== Starting applyFilters ===");
  console.log("Current URL:", page.url());
  
  // Wait for Primary Payer dropdown button to be visible
  console.log("Waiting for Primary Payer dropdown (#ManagedCareClaims)...");
  
  try {
    await page.waitForSelector('#ManagedCareClaims', { timeout: 60000 });
    console.log("✓ Found Primary Payer dropdown");
  } catch (error) {
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
  } catch (error) {
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
  
  // Verify we're on the Claims Manager page
  const pageTitle = await page.textContent('h1, h2, .page-title, [class*="title"]').catch(() => '');
  console.log("✓ Page loaded:", pageTitle);
  console.log("=== applyFilters completed ===");
}

async function selectAllInsurances(page: Page): Promise<void> {
  // Wait for the insurance dropdown to be visible
  console.log("Waiting for insurance dropdown...");
  await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 30000 });
  
  // Select "All Insurances" (value="1")
  console.log("Selecting 'All Insurances'...");
  await page.selectOption('select[ng-model="insuranceKey"]', '1');
  
  // Wait for loading to complete after selection
  console.log("Waiting for records to load...");
  await waitForLoadingToComplete(page);
  
  // ADDITIONAL: Wait for Angular to render the data
  console.log("Waiting for Angular to render table data...");
  await page.waitForTimeout(5000); // Give Angular more time to render
  
  // Wait for table rows with actual data
  await page.waitForFunction(() => {
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
  
  console.log("All insurances loaded successfully");
}

async function waitForResultsTable(page: Page): Promise<void> {
  console.log("Waiting for results table with data...");
  
  // Wait for table to exist
  await page.waitForSelector('table', { timeout: 30000 });
  
  // Wait for table to have data rows (not just header)
  await page.waitForFunction(() => {
    const tables = Array.from(document.querySelectorAll("table"));
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const rows = t.querySelectorAll("tr");
      // Need at least 2 rows (header + 1 data row)
      if (rows.length > 1) {
        // Check if data rows have actual content
        const dataRow = rows[1];
        const cells = Array.from(dataRow.querySelectorAll('td'));
        if (cells.length > 0) {
          // Check if at least one cell has text content
          for (let j = 0; j < cells.length; j++) {
            const cell = cells[j];
            if (cell.textContent && cell.textContent.trim().length > 0) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }, { timeout: 30000 });
  
  console.log("✓ Results table with data is ready");
  
  // Give extra time for any dynamic content to fully render
  await page.waitForTimeout(2000);
}

async function processRecordsAndSelectValid(page: Page, insuranceHelper: InsuranceHelper): Promise<{selectedCount: number, selectedRecords: SelectedRecord[]}> {
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
    if (!table) return null;
    
    const headerRow = table.querySelector('tr');
    if (!headerRow) return null;
    
    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(h => 
      h.textContent?.trim().toLowerCase() || ''
    );
    
    const insuranceIndex = headers.findIndex(h => 
      h.includes('insurance') || h.includes('payer')
    );
    const authorizationIndex = headers.findIndex(h => 
      h.includes('authorization') || h.includes('auth')
    );
    
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
    const rows: Array<{
      id: string;
      insurance: string;
      authorization: string;
      allColumns: string[];
    }> = [];
    
    // Find the table
    const tables = Array.from(document.querySelectorAll('table'));
    console.log(`Found ${tables.length} tables`);
    
    // Find the table with the most rows (likely the data table)
    let table: HTMLTableElement | null = null;
    let maxRows = 0;
    
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i] as HTMLTableElement;
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
      const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      
      if (checkbox) {
        const checkboxId = checkbox.id || checkbox.name || `row_${rowIndex}`;
        console.log(`Row ${rowIndex}: Found checkbox with ID: ${checkboxId}`);
        
        // Get all cells in this row
        const cells = Array.from(row.querySelectorAll('td'));
        console.log(`  Row has ${cells.length} cells`);
        
        // Extract text from cells - use innerText for Angular nested divs
        const allColumns: string[] = [];
        for (let idx = 0; idx < cells.length; idx++) {
          const td = cells[idx] as HTMLTableCellElement;
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
          const cell = cells[insuranceIdx] as HTMLTableCellElement;
          insurance = (cell.innerText || cell.textContent || '').trim();
        }
        
        if (authIdx >= 0 && authIdx < cells.length) {
          const cell = cells[authIdx] as HTMLTableCellElement;
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
      } else {
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
  const toSelect: Array<{id: string, insurance: string, auth: string, allColumns: string[]}> = [];
  const toSkip: Array<{id: string, reason: string, insurance: string, auth: string}> = [];
  
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
    } else if (!insuranceHelper.isValidAuthorization(record.authorization)) {
      shouldSelect = false;
      skipReason = `Invalid authorization format`;
      console.log(`❌ ${skipReason}`);
    } else if (!insuranceHelper.shouldProcessInsurance(record.insurance)) {
      shouldSelect = false;
      skipReason = `Insurance "${record.insurance}" not in approved list`;
      console.log(`❌ ${skipReason}`);
    }
    
    if (shouldSelect) {
      toSelect.push({ 
        id: record.id, 
        insurance: record.insurance, 
        auth: record.authorization,
        allColumns: record.allColumns
      });
      console.log(`✅ WILL SELECT`);
    } else {
      toSkip.push({ id: record.id, reason: skipReason, insurance: record.insurance, auth: record.authorization });
    }
  }
  
  console.log(`\n--- Summary ---`);
  console.log(`Records to SELECT: ${toSelect.length}`);
  console.log(`Records to SKIP: ${toSkip.length}`);
  
  console.log(`\n=== TAKING ACTION ===`);
  
  // Second pass: actually click the checkboxes
  let selectedCount = 0;
  const selectedRecords: SelectedRecord[] = [];
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  
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
    } catch (error) {
      console.error(`✗ Failed to check ${record.id}:`, error);
    }
  }
  
  console.log(`\n=== FINAL RESULT ===`);
  console.log(`Successfully selected ${selectedCount} out of ${toSelect.length} intended records`);
  console.log(`Total records processed: ${records.length}`);
  
  return { selectedCount, selectedRecords };
}
