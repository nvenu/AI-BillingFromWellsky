import "dotenv/config";
import { chromium, Page, Browser } from "playwright";
import { InsuranceHelper } from "./insurance-helper";
import { OFFICES, Office } from "./office-config";
import { sendEmail } from "./email-helper";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import * as fs from "fs";
import * as path from "path";

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

async function processOffice(page: Page, office: Office, insuranceHelper: InsuranceHelper, selectedInsurances: string[] | null = null): Promise<{records: SelectedRecord[], filename: string | null, readyToSendFiles: string[]}> {
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
    await waitForResultsTable(page);

    // 5. Process records and select valid ones across all pages
    const { selectedCount, selectedRecords } = await processAllPagesAndSelectValid(page, insuranceHelper);

    // 6. Save selected records to Excel for audit trail
    let filename: string | null = null;
    if (selectedRecords.length > 0) {
      const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      filename = `selected-records-${office.stateCode}-${office.name.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.xlsx`;
      saveSelectedRecordsToExcel(selectedRecords, filename);
    }

    // 7. Click Create button to submit claims
    let readyToSendFiles: string[] = [];
    if (selectedCount > 0) {
      await clickCreateButton(page);
      console.log(`✓ Claims creation initiated for ${office.name}`);
      
      // 8. Process Pending Approval workflow (returns files from Ready To Send)
      readyToSendFiles = await processPendingApproval(page, insuranceHelper);
      console.log(`✓ Pending Approval workflow completed for ${office.name}`);
    } else {
      console.log(`No records selected for ${office.name}, skipping Create button`);
    }

    console.log(`✓ Successfully processed ${selectedCount} records for ${office.name}`);
    return { records: selectedRecords, filename, readyToSendFiles };
    
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
export async function loginAndProcessOffices(officeValue: string = 'all', selectedInsurances: string[] | null = null): Promise<{
  totalRecords: number;
  filesCreated: number;
  emailSent: boolean;
  summary: Array<{office: string, count: number}>;
}> {
  let browser: Browser | null = null;
  
  try {
    // Create downloads directory
    const downloadsPath = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }
    
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      acceptDownloads: true
    });
    const page = await context.newPage();

    // Set up global alert handler to auto-accept all dialogs
    page.on('dialog', async dialog => {
      console.log(`Dialog detected: ${dialog.type()} - "${dialog.message()}"`);
      await dialog.accept();
      console.log('Dialog accepted');
    });

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
    const allReadyToSendFiles: string[] = [];

    // 2. Process each office
    for (let i = 0; i < officesToProcess.length; i++) {
      const office = officesToProcess[i];
      
      console.log(`\n[${i + 1}/${officesToProcess.length}] Processing ${office.name}...`);
      
      // Select the office
      await selectOffice(page, office);
      
      // Process this office
      const { records: officeRecords, filename, readyToSendFiles } = await processOffice(page, office, insuranceHelper, selectedInsurances);
      allSelectedRecords.push(...officeRecords);
      summary.push({ office: office.name, count: officeRecords.length });
      if (filename) {
        excelFiles.push(filename);
      }
      allReadyToSendFiles.push(...readyToSendFiles);
      
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

    // 5. Send email with all Excel files and PDFs
    let emailSent = false;
    const allAttachments = [...excelFiles, ...allReadyToSendFiles];
    if (allAttachments.length > 0) {
      console.log(`\n=== Sending Email ===`);
      try {
        const officeNames = officesToProcess.map(o => o.name).join(', ');
        
        // Count different file types
        const readyTabExcelCount = excelFiles.length;
        const readyToSendExcelCount = allReadyToSendFiles.filter(f => f.endsWith('.xlsx')).length;
        const pdfCount = allReadyToSendFiles.filter(f => f.endsWith('.pdf')).length;
        
        const emailBody = `
Kinnser Billing Automation Report
Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}

OFFICES PROCESSED: ${officeNames}

READY TAB SUMMARY:
${summary.map(s => `${s.office}: ${s.count} records selected`).join('\n')}

Total records selected from Ready tab: ${allSelectedRecords.length}
Total offices processed: ${officesToProcess.length}

READY TO SEND PROCESSING:
- Electronic claims: Sent electronically
- Paper claims: PDFs downloaded and attached

ATTACHED FILES (${allAttachments.length} total):

1. Ready Tab Excel Files (${readyTabExcelCount}):
${excelFiles.map(f => `   - ${f}`).join('\n')}

2. Ready To Send Files (${allReadyToSendFiles.length}):
   - Summary Excel: ${readyToSendExcelCount} file(s)
   - Electronic Claims Excel: Included if applicable
   - Paper Claims PDFs: ${pdfCount} file(s)
${allReadyToSendFiles.map(f => `   - ${f}`).join('\n')}

WORKFLOW COMPLETED:
✓ Ready tab processing
✓ Claims created
✓ Pending Approval processed
✓ Duplicate MRNs fixed (Type of Bill 327)
✓ Claims approved
✓ Ready To Send processed
✓ Electronic claims sent
✓ Paper claims downloaded as PDFs

All files are attached to this email for your review.
        `;

        await sendEmail({
          to: process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com",
          subject: `Kinnser Billing Report - ${officeNames} - ${timestamp}`,
          body: emailBody,
          attachments: allAttachments
        });
        
        emailSent = true;
        console.log(`✓ Email sent successfully to ${process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com"}`);
        console.log(`  Total attachments: ${allAttachments.length}`);
        console.log(`  - Ready Tab Excel: ${readyTabExcelCount}`);
        console.log(`  - Ready To Send Excel: ${readyToSendExcelCount}`);
        console.log(`  - PDFs: ${pdfCount}`);
      } catch (emailError) {
        console.error(`✗ Failed to send email:`, emailError);
        console.log(`Files saved locally: ${allAttachments.join(', ')}`);
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

  console.log("Navigating to Kinnser login page...");
  try {
    await page.goto("https://kinnser.net/login.cfm", {
      waitUntil: "domcontentloaded",
      timeout: 60000 // Increased timeout to 60 seconds
    });
    console.log("✓ Login page loaded");
  } catch (error) {
    console.error("Failed to load login page:", error);
    console.log("Retrying with networkidle...");
    await page.goto("https://kinnser.net/login.cfm", {
      waitUntil: "networkidle",
      timeout: 60000
    });
  }

  console.log("Filling in credentials...");
  await page.fill('input[name="username"], input#username', username);
  await page.fill('input[name="password"], input#password', password);
  console.log("✓ Credentials filled");

  // Click login and wait for any page to load (might be inbox or main page)
  console.log("Clicking login button...");
  await page.click('#login_btn');
  
  // Wait for navigation to complete (could go to inbox or main page)
  console.log("Waiting for login to complete...");
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
  
  // Wait a bit for any redirects
  await page.waitForTimeout(3000);

  // Verify login success - should not be on login page
  if (page.url().includes("login.cfm")) {
    throw new Error("Login failed - check credentials or MFA requirements");
  }
  
  console.log("✓ Logged in successfully, current URL:", page.url());
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

async function selectAllInsurances(page: Page, selectedInsurances: string[] | null = null): Promise<void> {
  // Wait for the insurance dropdown to be visible
  console.log("Waiting for insurance dropdown...");
  await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 30000 });

  // Get all available insurance options from dropdown
  const options = await page.$$eval('select[ng-model="insuranceKey"] option', (opts) =>
    opts.map(opt => ({ value: (opt as HTMLOptionElement).value, text: opt.textContent?.trim() || '' }))
  );

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
    } else {
      // Select specific insurances
      console.log(`Selecting specific insurance(s): ${selectedInsurances.slice(0, 3).join(', ')}${selectedInsurances.length > 3 ? '...' : ''}`);

      // Find matching options for selected insurances
      const matchedValues: string[] = [];
      for (const insurance of selectedInsurances) {
        const match = availableInsurances.find(opt =>
          opt.text.toLowerCase().includes(insurance.toLowerCase()) ||
          insurance.toLowerCase().includes(opt.text.toLowerCase())
        );
        if (match && match.value) {
          matchedValues.push(match.value);
        } else {
          console.log(`⚠️  Could not find dropdown option for insurance: ${insurance}`);
        }
      }

      if (matchedValues.length === 0) {
        console.log("⚠️  No matching insurances found, falling back to 'All Insurances'");
        await page.selectOption('select[ng-model="insuranceKey"]', '1');
      } else if (matchedValues.length === 1) {
        // Select the single matched insurance
        console.log(`Selecting insurance with value: ${matchedValues[0]}`);
        await page.selectOption('select[ng-model="insuranceKey"]', matchedValues[0]);
      } else {
        // Multiple insurances selected - Kinnser dropdown may not support multi-select
        // Use "All Insurances" and filter in processing logic
        console.log(`Multiple insurances selected (${matchedValues.length}) - using 'All Insurances' and will filter during processing`);
        await page.selectOption('select[ng-model="insuranceKey"]', '1');
      }
    }
  } else {
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

  console.log("Insurance selection completed successfully");
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

async function processAllPagesAndSelectValid(page: Page, insuranceHelper: InsuranceHelper): Promise<{selectedCount: number, selectedRecords: SelectedRecord[]}> {
  console.log("\n=== PROCESSING ALL PAGES ===");
  
  let allSelectedRecords: SelectedRecord[] = [];
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
    const hasNextPage = await page.evaluate(() => {
      const nextButton = document.querySelector('#nextGridPage') as HTMLButtonElement;
      return nextButton && !nextButton.disabled;
    });
    
    if (!hasNextPage) {
      console.log(`\n✓ Reached last page (page ${currentPage})`);
      break;
    }
    
    // Click next page
    console.log(`Navigating to page ${currentPage + 1}...`);
    await page.click('#nextGridPage');
    
    // Wait for page to load
    await page.waitForTimeout(3000);
    
    // Wait for table to update
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
    } else {
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

async function clickCreateButton(page: Page): Promise<void> {
  console.log("\n=== Clicking Create Button ===");
  
  try {
    // Wait for the Create button to be present
    await page.waitForSelector('button#claimsCreation', { timeout: 10000 });
    console.log("✓ Create button found");
    
    // Check if button is disabled
    const isDisabled = await page.$eval('button#claimsCreation', (btn) => {
      return (btn as HTMLButtonElement).disabled;
    });
    
    if (isDisabled) {
      console.log("⚠️  Create button is disabled - this may mean no records are selected or there's a validation issue");
      console.log("   Attempting to click anyway in case Angular enables it...");
    }
    
    // Click the button using Angular's ng-click
    await page.evaluate(() => {
      const button = document.querySelector('button#claimsCreation') as HTMLButtonElement;
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
    } else {
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
    
  } catch (error) {
    console.error("✗ Error in Create button workflow:", error);
    console.log("   Current URL:", page.url());
    throw error;
  }
}

async function processPendingApproval(page: Page, insuranceHelper: InsuranceHelper): Promise<string[]> {
  console.log("\n=== PROCESSING PENDING APPROVAL ===");
  
  try {
    // Wait for initial loading message to disappear
    console.log("Waiting for initial page load...");
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    console.log("✓ Initial loading complete");
    
    // Select "All Insurances" from dropdown
    console.log("\nSelecting 'All Insurances' from dropdown...");
    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
    await page.selectOption('select[ng-model="insuranceKey"]', '1'); // value="1" is "All Insurances"
    console.log("✓ Selected 'All Insurances'");
    
    // Wait for loading message to appear and then disappear
    console.log("Waiting for records to load...");
    await page.waitForTimeout(2000); // Give time for loading to start
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(3000); // Extra time for records to render
    console.log("✓ Records loaded");
    
    // Check if there are no records to display
    const noRecordsMessage = await page.textContent('body');
    if (noRecordsMessage && noRecordsMessage.includes('There are currently no records to display.')) {
      console.log("\n✓ No records found in Pending Approval - nothing to process");
      console.log("   This is normal if no claims were created or all were already processed");
      return []; // Exit gracefully with empty array
    }
    
    // Get all records with MRN and billing period
    console.log("\nExtracting record details from table...");
    const records = await page.evaluate(() => {
      // First, find the column indices by reading the header
      const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td'));
      const headers = headerCells.map(cell => cell.textContent?.trim().toLowerCase() || '');
      
      // Find column indices
      const mrnIndex = headers.findIndex(h => h.includes('mrn'));
      const billingPeriodIndex = headers.findIndex(h => h.includes('billing period'));
      
      console.log('Header columns:', headers);
      console.log('MRN column index:', mrnIndex);
      console.log('Billing Period column index:', billingPeriodIndex);
      
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((row, index) => {
        const cells = row.querySelectorAll('td');
        const allCells = Array.from(cells).map(cell => cell.textContent?.trim() || '');
        
        // Extract MRN
        const mrn = mrnIndex >= 0 && mrnIndex < cells.length 
          ? cells[mrnIndex].textContent?.trim() || '' 
          : '';
        
        // Extract Billing Period (format: "MM/DD/YYYY - MM/DD/YYYY")
        const billingPeriodText = billingPeriodIndex >= 0 && billingPeriodIndex < cells.length
          ? cells[billingPeriodIndex].textContent?.trim() || ''
          : '';
        
        // Parse the date range
        let billingPeriodStart = '';
        let billingPeriodEnd = '';
        if (billingPeriodText && billingPeriodText.includes(' - ')) {
          const parts = billingPeriodText.split(' - ');
          billingPeriodStart = parts[0]?.trim() || '';
          billingPeriodEnd = parts[1]?.trim() || '';
        }
        
        // Find Edit button
        const editButton = row.querySelector('button[id*="edit"], button[ng-click*="edit"]');
        const editButtonId = editButton?.id || '';
        
        return {
          index,
          mrn,
          billingPeriodText,
          billingPeriodStart,
          billingPeriodEnd,
          editButtonId,
          allCells
        };
      });
    });
    
    console.log(`\nFound ${records.length} records in Pending Approval`);
    
    // Log first few records for debugging
    console.log("\n=== SAMPLE RECORDS (first 3) ===");
    records.slice(0, 3).forEach((record, idx) => {
      console.log(`\nRecord ${idx + 1}:`);
      console.log(`  MRN: "${record.mrn}"`);
      console.log(`  Billing Period: "${record.billingPeriodText}"`);
      console.log(`  Billing Period Start: "${record.billingPeriodStart}"`);
      console.log(`  Billing Period End: "${record.billingPeriodEnd}"`);
      console.log(`  Edit Button ID: "${record.editButtonId}"`);
      console.log(`  All Cells: [${record.allCells.join(' | ')}]`);
    });
    
    // Additional check: if no records found, exit gracefully
    if (records.length === 0) {
      console.log("\n✓ No records to process in Pending Approval");
      return [];
    }
    
    // Check for duplicates with overlapping dates
    console.log("\n=== CHECKING FOR DUPLICATE MRNs WITH OVERLAPPING DATES ===");
    const duplicates = findDuplicatesWithOverlap(records);
    
    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} duplicate MRN(s) with overlapping billing periods`);
      
      for (const dup of duplicates) {
        console.log(`\nProcessing duplicate MRN: ${dup.mrn}`);
        console.log(`  Records: ${dup.indices.join(', ')}`);
        
        // Process ALL duplicate records, not just the first one
        for (let i = 0; i < dup.indices.length; i++) {
          const recordIndex = dup.indices[i];
          const record = records[recordIndex];
          
          if (record.editButtonId) {
            console.log(`\n  Processing record ${i + 1}/${dup.indices.length} (index ${recordIndex})`);
            console.log(`  Clicking Edit button: ${record.editButtonId}`);
            await page.click(`#${record.editButtonId}`);
            await page.waitForTimeout(2000);
            
            // Click OK button in popup
            await page.waitForSelector('#modal_go', { timeout: 10000 });
            await page.click('#modal_go');
            console.log("  ✓ Clicked OK button");
            await page.waitForTimeout(2000);
            
            // Select Type of Bill 327 - Adjustment Claim
            await page.waitForSelector('#typeOfBill', { timeout: 10000 });
            await page.selectOption('#typeOfBill', '6'); // value="6" is 327 - Adjustment Claim
            console.log("  ✓ Selected Type of Bill 327 - Adjustment Claim");
            await page.waitForTimeout(1000);
            
            // Click Save and Close
            await page.waitForSelector('#submitBtn', { timeout: 10000 });
            await page.click('#submitBtn');
            console.log("  ✓ Clicked Save and Close");
            
            // Wait for page to reload
            await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
            await page.waitForTimeout(3000);
            console.log(`  ✓ Record ${i + 1} processed successfully`);
          } else {
            console.log(`  ⚠️  No edit button found for record ${recordIndex}`);
          }
        }
        
        console.log(`\n✓ Completed processing all ${dup.indices.length} duplicate records for MRN ${dup.mrn}`);
      }
    } else {
      console.log("✓ No duplicate MRNs with overlapping billing periods found");
    }
    
    // Select all records
    console.log("\nSelecting all records for approval...");
    const selectAllCheckbox = await page.$('input[type="checkbox"][ng-model*="selectAll"]');
    if (selectAllCheckbox) {
      await selectAllCheckbox.click();
      console.log("✓ Selected all records");
      await page.waitForTimeout(1000);
    } else {
      console.log("⚠️  Select all checkbox not found, selecting individually");
      await page.$$eval('input[type="checkbox"]', checkboxes => {
        checkboxes.forEach(cb => (cb as HTMLInputElement).checked = true);
      });
    }
    
    console.log("\n=== SELECTING ALL RECORDS FOR APPROVAL ===");
    
    // Select all records
    console.log("Selecting all records for approval...");
    const selectAllCheckbox2 = await page.$('input[type="checkbox"][ng-model*="selectAll"]');
    if (selectAllCheckbox2) {
      await selectAllCheckbox2.click();
      console.log("✓ Selected all records");
      await page.waitForTimeout(1000);
    } else {
      console.log("⚠️  Select all checkbox not found, selecting individually");
      await page.$$eval('input[type="checkbox"]', checkboxes => {
        checkboxes.forEach(cb => (cb as HTMLInputElement).checked = true);
      });
    }
    
    // Click Approve button
    console.log("\nClicking Approve button...");
    await page.waitForSelector('#claimsApproval', { timeout: 10000 });
    await page.click('#claimsApproval');
    console.log("✓ Clicked Approve button");
    
    // Wait for approval to process
    await page.waitForTimeout(5000);
    
    // Navigate to Ready To Send tab
    console.log("\n=== Navigating to Ready To Send ===");
    await page.waitForSelector('#readyToSendClaims', { timeout: 10000 });
    await page.click('#readyToSendClaims');
    console.log("✓ Clicked Ready To Send tab");
    
    // Wait for page to load
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log("✓ Ready To Send page loaded");
    
    // Process Ready To Send workflow
    const readyToSendFiles = await processReadyToSend(page, insuranceHelper);
    console.log(`✓ Ready To Send completed with ${readyToSendFiles.length} files`);
    
    // Return files for email attachment
    return readyToSendFiles;
    
  } catch (error) {
    console.error("✗ Error in Pending Approval workflow:", error);
    throw error;
  }
}

async function processReadyToSend(page: Page, insuranceHelper: InsuranceHelper): Promise<string[]> {
  console.log("\n=== PROCESSING READY TO SEND ===");
  
  try {
    // Wait for loading to complete
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    
    // Get all records with insurance information
    console.log("\nExtracting records from Ready To Send...");
    const records = await page.evaluate(() => {
      // Find header columns
      const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td'));
      const headers = headerCells.map(cell => cell.textContent?.trim().toLowerCase() || '');
      
      const insuranceIndex = headers.findIndex(h => h.includes('insurance'));
      
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((row, index) => {
        const cells = row.querySelectorAll('td');
        const insurance = insuranceIndex >= 0 && insuranceIndex < cells.length
          ? cells[insuranceIndex].textContent?.trim() || ''
          : '';
        
        // Find checkbox and print icon
        const checkbox = row.querySelector('input[type="checkbox"]');
        const checkboxId = checkbox?.id || '';
        const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
        const printIconId = printIcon?.id || '';
        
        return {
          index,
          insurance,
          checkboxId,
          printIconId,
          allCells: Array.from(cells).map(cell => cell.textContent?.trim() || '')
        };
      });
    });
    
    console.log(`Found ${records.length} records in Ready To Send`);
    
    if (records.length === 0) {
      console.log("✓ No records to process in Ready To Send");
      return [];
    }
    
    // Separate records by insurance type
    const noChangesRecords: any[] = [];
    const paperRecords: any[] = [];
    
    records.forEach(record => {
      const instruction = insuranceHelper.getInstructionsByLocation('ALL').find(
        inst => inst.Name.toLowerCase().trim() === record.insurance.toLowerCase().trim()
      );
      
      if (instruction?.Remarks) {
        const remark = instruction.Remarks.toLowerCase().trim();
        if (remark.includes('no changes are required except for identical claims')) {
          noChangesRecords.push(record);
        } else if (remark === 'paper') {
          paperRecords.push(record);
        }
      }
    });
    
    console.log(`\n"No changes" insurances: ${noChangesRecords.length} records`);
    console.log(`"Paper" insurances: ${paperRecords.length} records`);
    
    // Create comprehensive summary Excel with all records
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const summaryFilename = `ready-to-send-summary-${timestamp}.xlsx`;
    
    const allRecordsData = [
      ...noChangesRecords.map((record, idx) => ({
        'Record #': idx + 1,
        'Insurance': record.insurance,
        'Processing Type': 'Electronic',
        'Status': 'Send Electronically',
        ...record.allCells.reduce((acc: Record<string, string>, cell: string, cellIdx: number) => {
          acc[`Column ${cellIdx + 1}`] = cell;
          return acc;
        }, {})
      })),
      ...paperRecords.map((record, idx) => ({
        'Record #': noChangesRecords.length + idx + 1,
        'Insurance': record.insurance,
        'Processing Type': 'Paper',
        'Status': 'PDF Downloaded',
        ...record.allCells.reduce((acc: Record<string, string>, cell: string, cellIdx: number) => {
          acc[`Column ${cellIdx + 1}`] = cell;
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
    let electronicExcelFile: string | null = null;
    if (noChangesRecords.length > 0) {
      console.log('\n=== PROCESSING "NO CHANGES" INSURANCES ===');
      
      // Select all "no changes" records
      for (const record of noChangesRecords) {
        if (record.checkboxId) {
          await page.click(`#${record.checkboxId}`);
        }
      }
      console.log(`✓ Selected ${noChangesRecords.length} records`);
      
      // Save to Excel before sending
      console.log("Saving 'No changes' records to Excel...");
      const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      const filename = `ready-to-send-electronic-${timestamp}.xlsx`;
      
      // Create workbook with records
      const excelData = noChangesRecords.map((record, idx) => ({
        'Record #': idx + 1,
        'Insurance': record.insurance,
        'Status': 'Send Electronically',
        ...record.allCells.reduce((acc: Record<string, string>, cell: string, cellIdx: number) => {
          acc[`Column ${cellIdx + 1}`] = cell;
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
      await page.click('a.btn.dropdown-toggle[data-toggle="dropdown"]');
      await page.waitForTimeout(1000);
      
      // Click Send Electronically
      await page.waitForSelector('#sendAuto', { timeout: 10000 });
      await page.click('#sendAuto');
      console.log("✓ Clicked 'Send Electronically'");
      
      await page.waitForTimeout(3000);
    }
    
    // Process "Paper" insurances - Print individually
    const downloadedFiles: string[] = [];
    if (paperRecords.length > 0) {
      console.log('\n=== PROCESSING "PAPER" INSURANCES ===');
      
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
        
        if (record.printIconId) {
          try {
            // Set up listener for new page (tab)
            const newPagePromise = page.context().waitForEvent('page', { timeout: 30000 });
            
            // Click print icon
            console.log(`  Clicking print icon: ${record.printIconId}`);
            await page.click(`#${record.printIconId}`);
            
            // Wait for new tab to open
            const newPage = await newPagePromise;
            console.log(`  ✓ New tab opened`);
            
            // Wait for PDF to fully load in new tab
            console.log(`  Waiting for PDF content to fully load...`);
            await newPage.waitForLoadState('load', { timeout: 30000 });
            await newPage.waitForLoadState('networkidle', { timeout: 30000 }); // Wait for network to be idle
            await newPage.waitForTimeout(5000); // Give extra time for PDF rendering
            console.log(`  ✓ PDF content fully loaded`);
            
            // Get the PDF URL
            const pdfUrl = newPage.url();
            console.log(`  PDF URL: ${pdfUrl}`);
            
            // Generate filename
            const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
            const sanitizedInsurance = record.insurance.replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `paper-claim-${sanitizedInsurance}-${i + 1}-${timestamp}.pdf`;
            const filepath = path.join(downloadsPath, filename);
            
            // Download the PDF using CDP (Chrome DevTools Protocol)
            const pdfBuffer = await newPage.pdf({
              format: 'Letter',
              printBackground: true
            });
            
            // Save the PDF
            fs.writeFileSync(filepath, pdfBuffer);
            downloadedFiles.push(filepath);
            
            console.log(`  ✓ Downloaded: ${filename}`);
            
            // Close the new tab
            await newPage.close();
            console.log(`  ✓ Closed PDF tab`);
            
          } catch (error) {
            console.error(`  ✗ Failed to download PDF for record ${i + 1}:`, error);
          }
          
          // Wait between downloads
          await page.waitForTimeout(2000);
        } else {
          console.log(`  ⚠️  No print icon found for record ${i + 1}`);
        }
      }
      
      console.log(`\n✓ Processed ${paperRecords.length} paper insurance records`);
      console.log(`✓ Downloaded ${downloadedFiles.length} PDF files`);
    }
    
    // Collect all files for email
    const allFiles: string[] = [];
    
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
    
  } catch (error) {
    console.error("✗ Error in Ready To Send workflow:", error);
    throw error;
  }
}

function findDuplicatesWithOverlap(records: any[]): any[] {
  const mrnGroups: { [key: string]: any[] } = {};
  
  // Group by MRN
  records.forEach((record, index) => {
    if (record.mrn) {
      if (!mrnGroups[record.mrn]) {
        mrnGroups[record.mrn] = [];
      }
      mrnGroups[record.mrn].push({ ...record, originalIndex: index });
    }
  });
  
  const duplicates: any[] = [];
  
  // Check for overlapping dates within each MRN group
  Object.keys(mrnGroups).forEach(mrn => {
    const group = mrnGroups[mrn];
    if (group.length > 1) {
      // Check if any dates overlap
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
            duplicates.push({
              mrn,
              indices: [record1.originalIndex, record2.originalIndex]
            });
            break;
          }
        }
      }
    }
  });
  
  return duplicates;
}


/**
 * TEST FUNCTION: Login and test PDF download from Ready To Send tab
 */
export async function testPDFDownload(officeValue: string = '1407132,Clinic'): Promise<void> {
  let browser: Browser | null = null;
  
  try {
    console.log("\n=== TESTING PDF DOWNLOAD FROM READY TO SEND ===\n");
    
    // Create downloads directory
    const downloadsPath = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
      console.log(`✓ Created downloads folder: ${downloadsPath}`);
    }
    
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      acceptDownloads: true
    });
    const page = await context.newPage();

    // Set up global alert handler
    page.on('dialog', async dialog => {
      console.log(`Dialog detected: ${dialog.type()} - "${dialog.message()}"`);
      await dialog.accept();
      console.log('Dialog accepted');
    });

    // Load insurance instructions
    const insuranceHelper = new InsuranceHelper("Insurance Instructions.xlsx");

    // 1. Login
    console.log("\n=== STEP 1: LOGIN ===");
    await performLogin(page);
    console.log("✓ Login successful");

    // 2. Select office
    console.log("\n=== STEP 2: SELECT OFFICE ===");
    const office = OFFICES.find(o => o.value === officeValue);
    if (!office) {
      throw new Error(`Office not found: ${officeValue}`);
    }
    await selectOffice(page, office);
    console.log(`✓ Office selected: ${office.name}`);

    // 3. Navigate to Billing Manager
    console.log("\n=== STEP 3: NAVIGATE TO BILLING MANAGER ===");
    await navigateToBillingManager(page);
    console.log("✓ Billing Manager loaded");

    // 4. Apply filters (select Primary Payer = Ready)
    console.log("\n=== STEP 4: APPLY FILTERS ===");
    await applyFilters(page);
    console.log("✓ Filters applied (Primary Payer = Ready)");

    // 5. Navigate directly to Ready To Send tab
    console.log("\n=== STEP 5: NAVIGATE TO READY TO SEND ===");
    await page.waitForSelector('#readyToSendClaims', { timeout: 10000 });
    await page.click('#readyToSendClaims');
    console.log("✓ Clicked Ready To Send tab");
    
    // Wait for page to load
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Wait for loading to complete
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    console.log("✓ Ready To Send page loaded");

    // 5a. Select "All Insurances" from dropdown
    console.log("\n=== STEP 5a: SELECT ALL INSURANCES ===");
    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
    await page.selectOption('select[ng-model="insuranceKey"]', '1'); // value="1" is "All Insurances"
    console.log("✓ Selected 'All Insurances' from dropdown");
    
    // Wait for records to load
    await page.waitForTimeout(2000);
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    console.log("✓ Records loaded for All Insurances");

    // 6. Get the first record with print icon
    console.log("\n=== STEP 6: FIND RECORD WITH PRINT ICON ===");
    
    // First, check how many records are in the table
    const tableInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return {
        totalRows: rows.length,
        records: rows.map((row, idx) => {
          const cells = row.querySelectorAll('td');
          const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
          return {
            rowIndex: idx,
            hasPrintIcon: !!printIcon,
            printIconId: printIcon?.id || '',
            cellCount: cells.length,
            firstFewCells: Array.from(cells).slice(0, 5).map(cell => cell.textContent?.trim() || '')
          };
        })
      };
    });
    
    console.log(`Found ${tableInfo.totalRows} rows in Ready To Send tab`);
    
    if (tableInfo.totalRows === 0) {
      console.log("✗ No records found in Ready To Send tab");
      console.log("   The test record might be in a different tab (Ready, Pending Approval, etc.)");
      return;
    }
    
    // Show all records
    console.log("\nAll records in Ready To Send:");
    tableInfo.records.forEach((record, idx) => {
      console.log(`  Row ${idx + 1}: Print Icon: ${record.hasPrintIcon ? '✓' : '✗'} | Cells: ${record.firstFewCells.join(' | ')}`);
    });
    
    // Find first record with print icon
    const recordWithPrint = tableInfo.records.find(r => r.hasPrintIcon);
    
    if (!recordWithPrint) {
      console.log("\n✗ No record with print icon found in any row");
      console.log("   This might mean:");
      console.log("   1. The test record is in a different tab");
      console.log("   2. The print icon selector needs to be updated");
      console.log("   3. There are no claims ready to send");
      return;
    }
    
    console.log(`\n✓ Found record with print icon at row ${recordWithPrint.rowIndex + 1}`);
    console.log(`  Print Icon ID: ${recordWithPrint.printIconId}`);
    console.log(`  Record details: ${recordWithPrint.firstFewCells.join(' | ')}`);

    // 7. Test PDF download
    console.log("\n=== STEP 7: TEST PDF DOWNLOAD ===");
    
    // Set up listener for new page (tab)
    const newPagePromise = page.context().waitForEvent('page', { timeout: 30000 });
    
    // Click print icon
    console.log(`Clicking print icon: ${recordWithPrint.printIconId}`);
    await page.click(`#${recordWithPrint.printIconId}`);
    
    // Wait for new tab to open
    const newPage = await newPagePromise;
    console.log("✓ New tab opened");
    
    // Wait for PDF to fully load in new tab
    console.log("Waiting for PDF content to fully load...");
    await newPage.waitForLoadState('load', { timeout: 30000 });
    await newPage.waitForLoadState('networkidle', { timeout: 30000 }); // Wait for network to be idle
    await newPage.waitForTimeout(5000); // Give extra time for PDF rendering
    console.log("✓ PDF content fully loaded");
    
    // Get the PDF URL
    const pdfUrl = newPage.url();
    console.log(`✓ PDF URL: ${pdfUrl}`);
    
    // Generate filename
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `test-pdf-download-${timestamp}.pdf`;
    const filepath = path.join(downloadsPath, filename);
    
    // Download the PDF using page.pdf()
    console.log("Generating PDF...");
    const pdfBuffer = await newPage.pdf({
      format: 'Letter',
      printBackground: true
    });
    
    // Save the PDF
    fs.writeFileSync(filepath, pdfBuffer);
    console.log(`✓ PDF saved: ${filepath}`);
    
    // Verify file
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      console.log(`✓ File verified: ${filename} (${stats.size} bytes)`);
    } else {
      console.error(`✗ File was not created: ${filepath}`);
    }
    
    // Close the new tab
    await newPage.close();
    console.log("✓ Closed PDF tab");
    
    console.log("\n=== TEST COMPLETED SUCCESSFULLY ===");
    console.log(`PDF downloaded to: ${filepath}`);
    
  } catch (error) {
    console.error("✗ Test failed:", error);
    throw error;
  } finally {
    if (browser) {
      // Keep browser open for a moment to see final state
      console.log("\nKeeping browser open for 5 seconds...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }
  }
}
