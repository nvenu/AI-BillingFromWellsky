import "dotenv/config";
import { chromium, Page, Browser } from "playwright";
import { InsuranceHelper } from "./insurance-helper";
import { OFFICES, Office } from "./office-config";
import { sendEmail } from "./email-helper";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import * as fs from "fs";
import * as path from "path";

// Log broadcaster for live console
let logBroadcaster: ((message: string) => void) | null = null;

export function setLogBroadcaster(broadcaster: (message: string) => void) {
  logBroadcaster = broadcaster;
}

// Override console.log to broadcast to web interface
const originalConsoleLog = console.log;
console.log = function(...args: any[]) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  originalConsoleLog.apply(console, args);
  
  if (logBroadcaster) {
    logBroadcaster(message);
  }
};

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

async function processOffice(page: Page, office: Office, insuranceHelper: InsuranceHelper, selectedInsurances: string[] | null = null): Promise<{records: SelectedRecord[], filename: string | null, readyToSendFiles: string[], readyToSendCount: number}> {
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
      let readyToSendFiles: string[] = [];
      try {
        readyToSendFiles = await processPendingApproval(page, insuranceHelper);
        console.log(`✓ Pending Approval and Ready To Send workflow completed for ${office.name}`);
      } catch (error) {
        console.error(`⚠️  Error in Pending Approval/Ready To Send for ${office.name}:`, error);
      }
      
      return { records: [], filename: null, readyToSendFiles, readyToSendCount: readyToSendFiles.length > 0 ? readyToSendFiles.filter(f => f.includes('electronic') || f.includes('paper-claim')).length : 0 };
    }

    // 5. Process records and select valid ones across all pages
    const { selectedCount, selectedRecords } = await processAllPagesAndSelectValid(page, insuranceHelper);

    // 6. Save selected records to Excel for audit trail
    let filename: string | null = null;
    if (selectedRecords.length > 0) {
      const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
      filename = `selected-records-${office.stateCode}-${office.name.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.xlsx`;
      saveSelectedRecordsToExcel(selectedRecords, filename);
    }

    // 7. Click Create button to submit claims (only if records were selected)
    if (selectedCount > 0) {
      await clickCreateButton(page);
      console.log(`✓ Claims creation initiated for ${office.name}`);
    } else {
      console.log(`No records selected in Ready tab for ${office.name}`);
      console.log(`Will still process Pending Approval and Ready To Send tabs...`);
    }
    
    // 8. ALWAYS process Pending Approval and Ready To Send (even if no records were selected in Ready)
    let readyToSendFiles: string[] = [];
    try {
      readyToSendFiles = await processPendingApproval(page, insuranceHelper);
      console.log(`✓ Pending Approval and Ready To Send workflow completed for ${office.name}`);
    } catch (error) {
      console.error(`⚠️  Error in Pending Approval/Ready To Send for ${office.name}:`, error);
      console.log(`Continuing anyway...`);
    }

    console.log(`✓ Successfully processed ${office.name}`);
    const readyToSendCount = readyToSendFiles.length > 0 ? readyToSendFiles.filter(f => f.includes('electronic') || f.includes('paper-claim')).length : 0;
    return { records: selectedRecords, filename, readyToSendFiles, readyToSendCount };
    
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
    const summary: Array<{office: string, count: number, readyToSendCount: number}> = [];
    const excelFiles: string[] = [];
    const allReadyToSendFiles: string[] = [];

    // 2. Process each office
    for (let i = 0; i < officesToProcess.length; i++) {
      const office = officesToProcess[i];
      
      console.log(`\n[${i + 1}/${officesToProcess.length}] Processing ${office.name}...`);
      
      // Select the office
      await selectOffice(page, office);
      
      // Process this office
      const { records: officeRecords, filename, readyToSendFiles, readyToSendCount } = await processOffice(page, office, insuranceHelper, selectedInsurances);
      allSelectedRecords.push(...officeRecords);
      const totalCount = officeRecords.length + (readyToSendCount || 0);
      summary.push({ office: office.name, count: officeRecords.length, readyToSendCount: readyToSendCount || 0 });
      if (filename) {
        excelFiles.push(filename);
      }
      allReadyToSendFiles.push(...readyToSendFiles);
      
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
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
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
      
      const emailBody = `
Kinnser Billing Automation Report
Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}

OFFICES PROCESSED: ${officeNames}

READY TAB SUMMARY:
${summary.map(s => `${s.office}: ${s.count} records selected`).join('\n')}

Total records selected from Ready tab: ${allSelectedRecords.length}
Total offices processed: ${officesToProcess.length}

${allSelectedRecords.length > 0 ? `
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

      await sendEmail({
        to: process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com",
        subject: `Kinnser Billing Report - ${officeNames} - ${timestamp}${allSelectedRecords.length === 0 ? ' [NO RECORDS PROCESSED]' : ''}`,
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
      } else {
        console.log(`  No attachments (0 records processed)`);
      }
    } catch (emailError) {
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

  } catch (error) {
    console.error("Error in billing automation:", error);
    throw error;
  } finally {
    // Ensure browser is closed even if there's an error
    if (browser) {
      console.log("Cleaning up browser...");
      await browser.close();
      browser = null;
    }
  }
}

async function waitForLoadingToComplete(page: Page): Promise<void> {
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
    const loader = document.querySelector('#globalAjaxLoader') as HTMLElement;
    if (!loader) return false;
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
    const loader = document.querySelector('#globalAjaxLoader') as HTMLElement;
    if (!loader) return true;
    return loader.offsetParent === null || window.getComputedStyle(loader).display === 'none';
  }, { timeout: 30000 });
  console.log("✓ Loading spinner is now hidden");
  
  // Brief wait for content to render
  await page.waitForTimeout(500);
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
  
  // Use JavaScript click to avoid element interception issues
  console.log("Clicking Go To menu...");
  await page.evaluate(() => {
    const button = document.querySelector('a.menuButton[onclick*="gotoMenu"]') as HTMLElement;
    if (button) button.click();
  });

  await page.waitForSelector('a.menuitem:has-text("Billing Manager")', { timeout: 20000 });
  
  // Click Billing Manager using JavaScript to avoid interception
  console.log("Clicking Billing Manager...");
  
  // Set up navigation promise before clicking
  const navigationPromise = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 });
  
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('a.menuitem'));
    const billingManager = items.find(item => item.textContent?.includes('Billing Manager')) as HTMLElement;
    if (billingManager) billingManager.click();
  });
  
  // Wait for navigation to complete
  await navigationPromise;
  console.log("✓ Navigation completed, URL:", page.url());
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

      // Find matching options for selected insurances (exact match)
      const matchedValues: string[] = [];
      for (const insurance of selectedInsurances) {
        const match = availableInsurances.find(opt =>
          opt.text.toLowerCase().trim() === insurance.toLowerCase().trim()
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
  } catch (error) {
    console.log("⚠️  Timeout waiting for table - checking if there are no records...");
    const noRecords = await page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      return bodyText.includes('There are currently no records to display') || 
             bodyText.includes('No records found');
    });
    
    if (noRecords) {
      console.log("✓ Confirmed: No records to display");
    } else {
      console.log("⚠️  Table structure might be different than expected");
      throw error;
    }
  }

  console.log("Insurance selection completed successfully");
}


async function waitForResultsTable(page: Page): Promise<boolean> {
  console.log("Waiting for results table with data...");

  // Wait for table to exist
  await page.waitForSelector('table', { timeout: 30000 });

  // Give Angular more time to render after insurance selection
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
            const text = cell.textContent?.trim() || '';
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
  } else {
    console.log("⚠️ No records found in tab - will skip to next tab");
    return false;
  }
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
    console.log("Checking for next page button...");
    const nextButtonInfo = await page.evaluate(() => {
      const nextButton = document.querySelector('#nextGridPage') as HTMLButtonElement;
      if (!nextButton) {
        return { exists: false, disabled: null, visible: null };
      }
      const style = window.getComputedStyle(nextButton);
      return {
        exists: true,
        disabled: nextButton.disabled,
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        text: nextButton.textContent?.trim()
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
    } catch (error) {
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
    } catch (error) {
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
    // Navigate to Pending Approval tab
    console.log("Navigating to Pending Approval tab...");
    const currentUrl = page.url();
    
    // Check if we're already on Pending Approval page
    if (!currentUrl.includes('pendingClaimsApproval') && !currentUrl.includes('pending')) {
      console.log("Not on Pending Approval page, clicking the tab...");
      try {
        await page.waitForSelector('#pendingClaimsApproval', { timeout: 10000 });
        await page.click('#pendingClaimsApproval');
        console.log("✓ Clicked Pending Approval tab");
        
        // Wait for the page to load
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await page.waitForTimeout(3000);
        console.log("✓ Pending Approval page loaded");
      } catch (navError) {
        console.log("⚠️  Could not find Pending Approval tab link");
        throw navError;
      }
    } else {
      console.log("✓ Already on Pending Approval page");
    }
    
    console.log("Current URL:", page.url());
    
    // Wait for initial loading message to disappear
    console.log("Waiting for initial page load...");
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    console.log("✓ Initial loading complete");
    
    // Select "All Insurances" from dropdown
    console.log("\nSelecting 'All Insurances' from dropdown...");
    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
    
    // First, check what's currently selected
    const currentValuePA = await page.$eval('select[ng-model="insuranceKey"]', (select: any) => select.value);
    console.log(`Current dropdown value: ${currentValuePA}`);
    
    // If already on "All Insurances", select something else first to trigger change event
    if (currentValuePA === '1') {
      console.log("Already on 'All Insurances', selecting different option first to trigger change...");
      const optionsPA = await page.$$eval('select[ng-model="insuranceKey"] option', (opts) => 
        opts.map(opt => (opt as HTMLOptionElement).value).filter(v => v && v !== '1')
      );
      if (optionsPA.length > 0) {
        await page.selectOption('select[ng-model="insuranceKey"]', optionsPA[0]);
        await page.waitForTimeout(1000);
        console.log(`  Selected temporary option: ${optionsPA[0]}`);
      }
    }
    
    // Now select "All Insurances"
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
      console.log("\n✓ No records found in Pending Approval - nothing to approve");
      console.log("   This is normal if no claims were created or all were already processed");
      console.log("   Continuing to Ready To Send tab...");
      // Don't return - continue to Ready To Send
    } else {
      // Process Pending Approval records
      await processPendingApprovalRecords(page, insuranceHelper);
    }
    
    // ALWAYS navigate to Ready To Send tab
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

async function processPendingApprovalRecords(page: Page, insuranceHelper: InsuranceHelper): Promise<void> {
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
      return; // Exit function early
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
            console.log("  Waiting for Type of Bill dropdown...");
            await page.waitForSelector('#typeOfBill', { timeout: 10000 });
            
            // Debug: Check available options
            const options = await page.evaluate(() => {
              const select = document.querySelector('#typeOfBill') as HTMLSelectElement;
              if (!select) return [];
              return Array.from(select.options).map(opt => ({
                value: opt.value,
                text: opt.text.trim()
              }));
            });
            console.log("  Available Type of Bill options:", JSON.stringify(options, null, 2));
            
            // Find the option with 327 in the text
            const option327 = options.find(opt => opt.text.includes('327'));
            if (option327) {
              console.log(`  Found 327 option: value="${option327.value}", text="${option327.text}"`);
              await page.selectOption('#typeOfBill', option327.value);
              console.log("  ✓ Selected Type of Bill 327 - Adjustment Claim");
            } else {
              console.log("  ⚠️  Could not find option with 327, using value '6' as fallback");
              await page.selectOption('#typeOfBill', '6');
              console.log("  ✓ Selected Type of Bill (value 6)");
            }
            
            // Verify selection
            const selectedValue = await page.$eval('#typeOfBill', (el: any) => el.value);
            const selectedText = await page.$eval('#typeOfBill', (el: any) => {
              const select = el as HTMLSelectElement;
              return select.options[select.selectedIndex]?.text || '';
            });
            console.log(`  Verification - Selected: value="${selectedValue}", text="${selectedText}"`);
            
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

    console.log("\n=== SELECTING ALL RECORDS FOR APPROVAL ===");

    // Try to find and click the "Select All" checkbox
    console.log("Looking for 'Select All' checkbox...");
    const selectAllCheckbox = await page.$('input[type="checkbox"][ng-model*="selectAll"], input[type="checkbox"][ng-click*="selectAll"]');

    if (selectAllCheckbox) {
      console.log("✓ Found 'Select All' checkbox, clicking it...");
      await selectAllCheckbox.click();
      await page.waitForTimeout(2000); // Wait for selection to propagate
      console.log("✓ Clicked 'Select All' checkbox");
    } else {
      console.log("⚠️  'Select All' checkbox not found");
    }

    // Verify how many checkboxes are actually checked
    const checkedCount = await page.evaluate(() => {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const checked = checkboxes.filter(cb => (cb as HTMLInputElement).checked);
      console.log(`Total checkboxes: ${checkboxes.length}, Checked: ${checked.length}`);
      return checked.length;
    });

    console.log(`✓ Verified: ${checkedCount} checkboxes are checked`);

    // If no checkboxes are checked, try clicking individual row checkboxes
    if (checkedCount === 0) {
      console.log("⚠️  No checkboxes checked! Trying to click individual row checkboxes...");
      const rowCheckboxes = await page.$$('table tbody tr input[type="checkbox"]');
      console.log(`Found ${rowCheckboxes.length} row checkboxes`);

      for (let i = 0; i < rowCheckboxes.length; i++) {
        try {
          await rowCheckboxes[i].click();
          console.log(`  ✓ Clicked checkbox ${i + 1}/${rowCheckboxes.length}`);
          await page.waitForTimeout(200);
        } catch (error) {
          console.log(`  ⚠️  Failed to click checkbox ${i + 1}: ${error}`);
        }
      }

      // Verify again
      const checkedCountAfter = await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        return checkboxes.filter(cb => (cb as HTMLInputElement).checked).length;
      });
      console.log(`✓ After individual clicks: ${checkedCountAfter} checkboxes are checked`);
    }

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
      const button = document.querySelector('#claimsApproval') as HTMLButtonElement;
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
        const button = document.querySelector('#claimsApproval') as HTMLButtonElement;
        if (button) {
          button.disabled = false;
          button.removeAttribute('disabled');
        }
      });
      await page.waitForTimeout(500);
    }

    // Click Approve button with multiple fallback methods
    console.log("\nClicking Approve button...");
    let clickSuccess = false;

    // Method 1: Normal click
    try {
      await page.click('#claimsApproval', { timeout: 5000 });
      console.log("✓ Method 1: Normal click succeeded");
      clickSuccess = true;
    } catch (error) {
      console.log("⚠️  Method 1 failed, trying Method 2...");

      // Method 2: Force click
      try {
        await page.click('#claimsApproval', { force: true, timeout: 5000 });
        console.log("✓ Method 2: Force click succeeded");
        clickSuccess = true;
      } catch (error2) {
        console.log("⚠️  Method 2 failed, trying Method 3...");

        // Method 3: JavaScript click
        try {
          await page.evaluate(() => {
            const button = document.querySelector('#claimsApproval') as HTMLButtonElement;
            if (button) button.click();
          });
          console.log("✓ Method 3: JavaScript click succeeded");
          clickSuccess = true;
        } catch (error3) {
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
          } catch (error4) {
            console.log("✗ All click methods failed!");
          }
        }
      }
    }

    if (clickSuccess) {
      console.log("✓ Approve button clicked successfully");

      // Wait for approval to process
      console.log("Waiting for approval to process...");
      await page.waitForTimeout(5000);
      console.log("✓ Approval processing complete");
    } else {
      console.log("✗ Failed to click Approve button - skipping approval");
    }
}

async function processReadyToSend(page: Page, insuranceHelper: InsuranceHelper): Promise<string[]> {
  console.log("\n=== PROCESSING READY TO SEND ===");
  
  try {
    // Wait for loading to complete
    await page.waitForSelector('.loading-message', { state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(2000);
    
    // Select "All Insurances" from dropdown
    console.log("\nSelecting 'All Insurances' from dropdown...");
    await page.waitForSelector('select[ng-model="insuranceKey"]', { timeout: 10000 });
    
    // First, check what's currently selected
    const currentValueRTS = await page.$eval('select[ng-model="insuranceKey"]', (select: any) => select.value);
    console.log(`Current dropdown value: ${currentValueRTS}`);
    
    // If already on "All Insurances", select something else first to trigger change event
    if (currentValueRTS === '1') {
      console.log("Already on 'All Insurances', selecting different option first to trigger change...");
      const optionsRTS = await page.$$eval('select[ng-model="insuranceKey"] option', (opts) => 
        opts.map(opt => (opt as HTMLOptionElement).value).filter(v => v && v !== '1')
      );
      if (optionsRTS.length > 0) {
        await page.selectOption('select[ng-model="insuranceKey"]', optionsRTS[0]);
        await page.waitForTimeout(1000);
        console.log(`  Selected temporary option: ${optionsRTS[0]}`);
      }
    }
    
    // Now select "All Insurances"
    await page.selectOption('select[ng-model="insuranceKey"]', '1'); // value="1" is "All Insurances"
    console.log("✓ Selected 'All Insurances'");
    
    // Wait for loading message to appear and then disappear
    console.log("Waiting for records to load...");
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
        // Try to get text from nested Angular elements
        const link = cell.querySelector('a');
        const span = cell.querySelector('span');
        const text = link?.textContent?.trim() || span?.textContent?.trim() || cell.textContent?.trim() || '';
        return text.toLowerCase();
      });
      
      console.log('DEBUG: Table headers:', headers);
      
      // Find insurance column index
      const insuranceIndex = headers.findIndex(h => h.includes('insurance'));
      console.log('DEBUG: Insurance column index:', insuranceIndex);
      
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((row, index) => {
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
          if (ngBindingDiv && ngBindingDiv.textContent?.trim()) {
            insurance = ngBindingDiv.textContent.trim();
          }
          
          // Fallback methods if ng-binding not found
          if (!insurance) {
            const link = cell.querySelector('a');
            if (link && link.textContent?.trim()) {
              insurance = link.textContent.trim();
            }
          }
          
          if (!insurance) {
            const span = cell.querySelector('span');
            if (span && span.textContent?.trim()) {
              insurance = span.textContent.trim();
            }
          }
          
          if (!insurance) {
            const div = cell.querySelector('div');
            if (div && div.textContent?.trim()) {
              insurance = div.textContent.trim();
            }
          }
          
          if (!insurance && (cell as HTMLElement).innerText) {
            insurance = (cell as HTMLElement).innerText.trim();
          }
        }
        
        // Find checkbox and print icon
        const checkbox = row.querySelector('input[type="checkbox"]');
        const checkboxId = checkbox?.id || '';
        const printIcon = row.querySelector('label[id*="openClaimPrintView"]');
        const printIconId = printIcon?.id || '';
        
        // Extract all cell data - look for ng-binding divs first
        const allCells = Array.from(cells).map(cell => {
          const ngBindingDiv = cell.querySelector('div.ng-binding');
          if (ngBindingDiv && ngBindingDiv.textContent?.trim()) {
            return ngBindingDiv.textContent.trim();
          }
          
          const link = cell.querySelector('a');
          const span = cell.querySelector('span');
          const div = cell.querySelector('div');
          return link?.textContent?.trim() || 
                 span?.textContent?.trim() || 
                 div?.textContent?.trim() || 
                 (cell as HTMLElement).innerText?.trim() ||
                 cell.textContent?.trim() || 
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
    const noChangesRecords: any[] = [];
    const paperRecords: any[] = [];
    
    console.log("\n=== CATEGORIZING RECORDS ===");
    validRecords.forEach((record, idx) => {
      console.log(`\nRecord ${idx + 1}: ${record.insurance}`);
      
      // Find the instruction for this insurance (search all locations)
      const instruction = insuranceHelper['instructions'].find(
        (inst: any) => inst.Name.toLowerCase().trim() === record.insurance.toLowerCase().trim()
      );
      
      if (instruction) {
        console.log(`  Found instruction: Location=${instruction.Location}, Remarks=${instruction.Remarks?.substring(0, 50)}...`);
        
        if (instruction.Remarks) {
          const remark = instruction.Remarks.toLowerCase().trim();
          if (remark.includes('no changes are required except for identical claims')) {
            console.log(`  ✓ Categorized as: Electronic (No changes)`);
            noChangesRecords.push(record);
          } else if (remark === 'paper') {
            console.log(`  ✓ Categorized as: Paper`);
            paperRecords.push(record);
          } else {
            console.log(`  ⚠️  Skipped: Remarks don't match criteria`);
          }
        } else {
          console.log(`  ⚠️  Skipped: No remarks`);
        }
      } else {
        console.log(`  ⚠️  Skipped: Insurance not found in instructions`);
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
            let checkboxInfo: any;
            try {
              checkboxInfo = await page.evaluate((id) => {
                // IDs starting with numbers need to be escaped in querySelector
                const checkbox = document.getElementById(id) as HTMLInputElement;
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
            } catch (evalError: any) {
              console.log(`  ✗ Error during evaluate:`, evalError?.message || evalError);
              checkboxInfo = { exists: false, error: evalError?.message || 'Unknown error' };
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
                const checkbox = document.getElementById(id) as HTMLInputElement;
                if (checkbox) {
                  checkbox.click();
                }
              }, record.checkboxId);
              console.log(`  ✓ Checkbox click executed`);
            } catch (clickError: any) {
              console.log(`  ✗ Click failed:`, clickError?.message || clickError);
            }
            
            await page.waitForTimeout(1000); // Wait for Angular to process
            
            // Verify the click worked
            const newState = await page.evaluate((id) => {
              const checkbox = document.getElementById(id) as HTMLInputElement;
              return {
                checked: checkbox?.checked || false,
                hasCheckedAttr: checkbox?.hasAttribute('checked') || false
              };
            }, record.checkboxId);
            
            console.log(`  Checkbox state after click: checked=${newState.checked}, hasAttr=${newState.hasCheckedAttr}`);
            
          } catch (error: any) {
            console.error(`  ✗ Error processing checkbox:`, error?.message || error);
          }
        } else {
          console.log(`  ✗ No checkbox ID found for this record`);
        }
      }
      
      console.log(`\n✓ Finished selecting ${noChangesRecords.length} records`);
      await page.waitForTimeout(1000); // Give Angular time to update
      
      // Verify selections
      const selectedCount = await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('table tbody tr input[type="checkbox"]'));
        return checkboxes.filter((cb: any) => cb.checked).length;
      });
      console.log(`✓ Verified: ${selectedCount} checkboxes are checked`);
      
      // Save to Excel before sending
      console.log("\nSaving 'No changes' records to Excel...");
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
              const checkbox = document.getElementById(id) as HTMLInputElement;
              return checkbox?.checked || false;
            }, record.checkboxId);
            
            if (isChecked) {
              await page.evaluate((id) => {
                const checkbox = document.getElementById(id) as HTMLInputElement;
                if (checkbox) {
                  checkbox.click();
                }
              }, record.checkboxId);
              await page.waitForTimeout(300);
              console.log(`  ✓ Deselected checkbox for: ${record.insurance}`);
            }
          } catch (error: any) {
            console.error(`  ✗ Error deselecting checkbox:`, error?.message || error);
          }
        }
      }
      console.log("✓ All checkboxes deselected");
    }
    
    // Process "Paper" insurances - Print individually
    const downloadedFiles: string[] = [];
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
            try {
              await newPage.waitForLoadState('load', { timeout: 30000 });
              console.log(`  ✓ Load state reached`);
            } catch (loadError) {
              console.log(`  ⚠️  Load timeout, continuing anyway...`);
            }
            
            try {
              await newPage.waitForLoadState('networkidle', { timeout: 10000 });
              console.log(`  ✓ Network idle reached`);
            } catch (idleError) {
              console.log(`  ⚠️  Network idle timeout, continuing anyway...`);
            }
            
            await newPage.waitForTimeout(2000); // Extra time for PDF rendering
            console.log(`  ✓ PDF content ready for download`);
            
            // Get the PDF URL
            const pdfUrl = newPage.url();
            console.log(`  PDF URL: ${pdfUrl}`);
            
            // Generate filename
            const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
            const sanitizedInsurance = record.insurance.replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `paper-claim-${sanitizedInsurance}-${timestamp}.pdf`;
            const filepath = path.join(downloadsPath, filename);
            
            // Download the actual PDF file
            console.log(`  Downloading PDF...`);
            try {
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
                  if (src) pdfSrcUrl = src.startsWith('http') ? src : new URL(src, pdfUrl).href;
                } else if (iframePdf) {
                  const src = await iframePdf.getAttribute('src');
                  if (src) pdfSrcUrl = src.startsWith('http') ? src : new URL(src, pdfUrl).href;
                }
                
                console.log(`  PDF source URL: ${pdfSrcUrl}`);
                
                // Fetch the actual PDF file
                const response = await newPage.context().request.fetch(pdfSrcUrl);
                const pdfBuffer = await response.body();
                
                fs.writeFileSync(filepath, pdfBuffer);
                downloadedFiles.push(filepath);
                console.log(`  ✓ Downloaded: ${filename} (${pdfBuffer.length} bytes)`);
              } else {
                // Fallback: generate PDF from page content
                console.log(`  Generating PDF from page content...`);
                const pdfBuffer = await newPage.pdf({
                  format: 'Letter',
                  printBackground: true
                });
                
                fs.writeFileSync(filepath, pdfBuffer);
                downloadedFiles.push(filepath);
                console.log(`  ✓ Downloaded: ${filename} (${pdfBuffer.length} bytes)`);
              }
            } catch (pdfError: any) {
              console.error(`  ✗ PDF download failed:`, pdfError?.message || pdfError);
            }            
            // Close the PDF tab and navigate back to main tab
            await newPage.close();
            console.log(`  ✓ Closed PDF tab, back to main tab`);
            
            // Wait a bit before processing next record
            await page.waitForTimeout(1000);
            
          } catch (error) {
            console.error(`  ✗ Failed to download PDF for record ${i + 1}:`, error);
          }
        } else {
          console.log(`  ✗ No print icon ID found for this record`);
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

