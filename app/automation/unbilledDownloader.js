import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

class UnbilledReportDownloader {
  constructor(io = null) {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    
    if (!this.username || !this.password) {
      throw new Error('KINNSER_USERNAME and KINNSER_PASSWORD must be set in .env file');
    }
    
    this.browser = null;
    this.page = null;
    this.io = io;
    this.downloadPath = path.join(__dirname, '..', 'data');
  }

  log(type, message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp}]${message}`);
    if (this.io) {
      this.io.emit('log', { type, message, timestamp: new Date().toISOString() });
    }
  }

  async deleteOldUnbilledFiles() {
    this.log('info', '🗑️ Deleting old Unbilled Report files...');
    try {
      const files = await fs.readdir(this.downloadPath);
      const unbilledFiles = files.filter(f => f.startsWith('Managed_Care_Unbilled_') && f.endsWith('.xlsx'));
      
      for (const file of unbilledFiles) {
        await fs.unlink(path.join(this.downloadPath, file));
        this.log('info', `   Deleted: ${file}`);
      }
      
      this.log('success', `✅ Deleted ${unbilledFiles.length} old Unbilled files`);
    } catch (error) {
      this.log('error', `❌ Error deleting old files: ${error.message}`);
    }
  }

  async initialize() {
    this.log('info', '🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: true,  // Production mode
      timeout: 60000,
      downloadsPath: this.downloadPath,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const context = await this.browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });
    
    // Remove automation indicators
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Remove chrome automation properties
      window.navigator.chrome = {
        runtime: {},
      };
      
      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    this.page = await context.newPage();
    this.page.setDefaultTimeout(30000);
    this.log('success', '✅ Browser initialized');
  }

  async login() {
    this.log('info', '🔐 Logging into Kinnser...');
    await this.page.goto('https://kinnser.net/', { waitUntil: 'domcontentloaded' });
    
    this.page.on('dialog', async dialog => {
      this.log('info', `🔔 Dialog: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await this.page.fill('input[type="text"]', this.username);
    await this.page.fill('input[type="password"]', this.password);
    await this.page.click('#login_btn');
    
    this.log('info', '⏳ Waiting for login...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    // Check for and close any popup if present
    await this.closePopupIfPresent();
    
    this.log('success', '✅ Logged in successfully');
  }

  async closePopupIfPresent() {
    try {
      const closeSelectors = [
        'button.close',
        '.modal-close',
        '[aria-label="Close"]',
        '.popup-close',
        'button[data-dismiss="modal"]',
        '.pendo-close-guide-x',
        'button.pendo-close-guide-x',
        '.close-button',
        '[class*="close"]'
      ];
      
      for (const selector of closeSelectors) {
        const closeBtn = await this.page.$(selector);
        if (closeBtn && await closeBtn.isVisible()) {
          await closeBtn.click();
          this.log('info', '✅ Closed popup');
          await this.page.waitForTimeout(1000);
          return;
        }
      }
    } catch (e) {
      // No popup to close, continue
    }
  }

  async navigateToBillingManager() {
    this.log('info', '📂 Looking for "Go To" menu...');
    
    const gotoSelectors = [
      'a.menuButton[onclick*="gotoMenu"]',
      'a[onclick*="buttonClick(event, \'gotoMenu\')"]',
      'text="Go To"'
    ];
    
    let gotoClicked = false;
    for (const selector of gotoSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await this.page.click(selector);
          this.log('success', '✅ Clicked "Go To"');
          gotoClicked = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!gotoClicked) {
      throw new Error('"Go To" not found');
    }
    
    await this.page.waitForTimeout(2000);
    
    this.log('info', '💼 Looking for "Billing Manager"...');
    
    const billingSelectors = [
      'text="Billing Manager"',
      'a:has-text("Billing Manager")'
    ];
    
    let billingClicked = false;
    for (const selector of billingSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await this.page.click(selector);
          this.log('success', '✅ Clicked "Billing Manager"');
          billingClicked = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!billingClicked) {
      throw new Error('"Billing Manager" not found');
    }
    
    this.log('info', '⏳ Waiting for Billing Manager to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);
    
    // Wait for loading indicator to disappear
    this.log('info', '⏳ Waiting for loading to complete...');
    try {
      await this.page.waitForSelector('.loading, [ng-show*="loading"], .spinner', { 
        state: 'hidden', 
        timeout: 30000 
      });
      this.log('success', '✅ Loading completed');
    } catch (e) {
      this.log('info', '   Loading indicator not found or already hidden');
    }
    
    await this.page.waitForTimeout(2000);
    
    this.log('success', '✅ Billing Manager loaded');
  }

  async downloadUnbilledReport() {
    this.log('info', '📊 Looking for "Managed Care Unbilled Report" link...');
    
    try {
      // Wait for the link to exist in DOM
      await this.page.waitForSelector('#managed-care-unbilled-report-link', { state: 'attached', timeout: 15000 });
      
      // Use JavaScript click directly (bypasses visibility check)
      await this.page.evaluate(() => {
        const link = document.querySelector('#managed-care-unbilled-report-link');
        if (link) {
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => link.click(), 500);
        }
      });
      
      await this.page.waitForTimeout(2000);
      this.log('success', '✅ Clicked "Managed Care Unbilled Report"');
    } catch (e) {
      this.log('error', `❌ Failed to click Managed Care Unbilled Report: ${e.message}`);
      throw new Error('Managed Care Unbilled Report link not found');
    }
    
    this.log('info', '⏳ Waiting for report page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    // Wait for loading to complete
    try {
      await this.page.waitForSelector('.loading-message, .loading', { state: 'hidden', timeout: 30000 });
      this.log('info', '   Loading completed');
    } catch (e) {
      this.log('info', '   No loading indicator found');
    }
    
    await this.page.waitForTimeout(2000);
    this.log('success', '✅ Report page loaded');
    
    // Try to set filters directly via Angular scope
    this.log('info', '🔧 Setting filters via Angular scope...');
    try {
      await this.page.evaluate(() => {
        // Find the Angular controller scope
        const element = document.querySelector('[ng-controller]') || document.querySelector('[ng-app]');
        if (element) {
          const scope = angular.element(element).scope();
          if (scope) {
            // Try to set all filters to select all
            // This is a guess at the scope variable names - may need adjustment
            if (scope.filters) {
              scope.filters.selectAllBranches = true;
              scope.filters.selectAllPayerTypes = true;
              scope.filters.selectAllInsurances = true;
            }
            scope.$apply();
          }
        }
      });
      this.log('info', '   Attempted to set filters via scope');
    } catch (e) {
      this.log('info', `   Could not set via scope: ${e.message}`);
    }
    
    await this.page.waitForTimeout(1000);
    
    // Click "Select All" for Branch and trigger Angular digest
    this.log('info', '🏢 Selecting all Branches...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Branch_btn_select_all');
        if (btn) {
          btn.click();
          // Trigger Angular digest cycle
          const scope = angular.element(btn).scope();
          if (scope) {
            scope.$apply();
          }
        }
      });
      await this.page.waitForTimeout(2000);
      this.log('success', '✅ Selected all Branches');
    } catch (e) {
      this.log('info', `   Branch filter error: ${e.message}`);
    }
    
    // Click "Select All" for Payer Type and trigger Angular digest
    this.log('info', '💳 Selecting all Payer Types...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Payer_Type_btn_select_all');
        if (btn) {
          btn.click();
          // Trigger Angular digest cycle
          const scope = angular.element(btn).scope();
          if (scope) {
            scope.$apply();
          }
        }
      });
      await this.page.waitForTimeout(2000);
      this.log('success', '✅ Selected all Payer Types');
    } catch (e) {
      this.log('info', `   Payer Type filter error: ${e.message}`);
    }
    
    // Click "Select All" for Insurance and trigger Angular digest
    this.log('info', '🏥 Selecting all Insurances...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Insurance_btn_select_all');
        if (btn) {
          btn.click();
          // Trigger Angular digest cycle
          const scope = angular.element(btn).scope();
          if (scope) {
            scope.$apply();
          }
        }
      });
      await this.page.waitForTimeout(3000);
      this.log('success', '✅ Selected all Insurances');
    } catch (e) {
      this.log('info', `   Insurance filter error: ${e.message}`);
    }
    
    // Click "Apply Filters" using Playwright click
    this.log('info', '🔍 Clicking Apply Filters...');
    
    try {
      await this.page.click('#aggrid_btnfetch1', { timeout: 10000 });
      this.log('success', '✅ Clicked Apply Filters');
    } catch (e) {
      this.log('error', `❌ Failed to click Apply Filters: ${e.message}`);
      throw new Error('Apply Filters button not found');
    }
    
    this.log('info', '⏳ Waiting for data to load...');
    
    // Wait for loading to start
    await this.page.waitForTimeout(3000);
    
    // Wait for loading indicator to appear and then disappear
    try {
      const loadingVisible = await this.page.$('.loading-message, .loading');
      if (loadingVisible) {
        this.log('info', '   Loading indicator detected, waiting for it to disappear...');
        await this.page.waitForSelector('.loading-message, .loading', { 
          state: 'hidden', 
          timeout: 180000 
        });
        this.log('info', '   Loading indicator disappeared');
      }
    } catch (e) {
      this.log('info', '   Loading indicator check: ' + e.message);
    }
    
    // After summary loads, wait 10 seconds for table to load
    this.log('info', '   Waiting for table data to load (10 seconds)...');
    await this.page.waitForTimeout(10000);
    
    // Wait for table rows to appear and stabilize with actual data
    this.log('info', '⏳ Waiting for table rows to load completely...');
    
    let previousRowCount = 0;
    let stableCount = 0;
    let maxAttempts = 20; // 20 attempts * 3 seconds = 60 seconds max wait
    
    for (let i = 0; i < maxAttempts; i++) {
      await this.page.waitForTimeout(3000);
      
      const currentRowCount = await this.page.evaluate(() => {
        return document.querySelectorAll('.ag-row').length;
      });
      
      this.log('info', `   Attempt ${i + 1}/${maxAttempts}: Found ${currentRowCount} rows`);
      
      // Check if row count is stable and greater than 1 (1 row = no data)
      if (currentRowCount === previousRowCount && currentRowCount > 1) {
        stableCount++;
        if (stableCount >= 3) {
          this.log('success', `✅ Table fully loaded with ${currentRowCount} rows`);
          break;
        }
      } else {
        stableCount = 0;
      }
      
      previousRowCount = currentRowCount;
      
      // If we're at the last attempt and still only have 1 or 0 rows, data didn't load
      if (i === maxAttempts - 1 && currentRowCount <= 1) {
        this.log('error', `❌ Table did not load properly - only ${currentRowCount} row(s) after ${maxAttempts * 3} seconds`);
        this.log('error', '❌ The API request for table data (UnbilledPaged) is likely failing');
        throw new Error('Table data did not load - API request failed');
      }
    }
    
    // Extra wait to ensure everything is ready
    await this.page.waitForTimeout(2000);
    
    // Click Export using the file_upload icon
    this.log('info', '📥 Looking for Export button...');
    try {
      // Wait for the export icon to be visible
      await this.page.waitForSelector('i.material-icons:has-text("file_upload")', { 
        state: 'visible', 
        timeout: 15000 
      });
      
      // Click using JavaScript since it's an icon
      await this.page.evaluate(() => {
        const icons = Array.from(document.querySelectorAll('i.material-icons'));
        const exportIcon = icons.find(icon => icon.textContent.trim() === 'file_upload');
        if (exportIcon) {
          exportIcon.click();
        }
      });
      
      this.log('success', '✅ Clicked Export');
    } catch (e) {
      this.log('error', `❌ Failed to click Export: ${e.message}`);
      throw new Error('Export button not found');
    }
    
    this.log('info', '⏳ Waiting for export to prepare...');
    
    // Wait for loading to appear after export click
    await this.page.waitForTimeout(2000);
    
    try {
      const loadingVisible = await this.page.$('.loading-message');
      if (loadingVisible) {
        this.log('info', '   Export loading indicator appeared');
        await this.page.waitForSelector('.loading-message', { 
          state: 'hidden', 
          timeout: 180000 
        });
        this.log('info', '   Export loading completed');
      }
    } catch (e) {
      this.log('info', '   No export loading indicator');
    }
    
    // Wait for download
    this.log('info', '⏳ Waiting for download...');
    try {
      const download = await this.page.waitForEvent('download', { timeout: 60000 });
      
      const date = new Date().toISOString().split('T')[0];
      const filename = `Managed_Care_Unbilled_${date}.xlsx`;
      const filepath = path.join(this.downloadPath, filename);
      
      await download.saveAs(filepath);
      this.log('success', `✅ Downloaded: ${filename}`);
      
      return { downloaded: true, filename };
    } catch (e) {
      this.log('error', `❌ Download failed: ${e.message}`);
      
      // Take screenshot for debugging
      const errorScreenshot = `download_error_${Date.now()}.png`;
      await this.page.screenshot({ path: path.join(this.downloadPath, errorScreenshot), fullPage: true });
      this.log('info', `   Screenshot saved: ${errorScreenshot}`);
      
      // Check if there's an error message on the page
      const errorMessage = await this.page.evaluate(() => {
        const errorEl = document.querySelector('.error-message, .alert-danger, [class*="error"]');
        return errorEl ? errorEl.textContent : 'No error message found';
      });
      this.log('info', `   Page error: ${errorMessage}`);
      
      // Wait a bit before closing so you can see what's happening
      this.log('info', '   Waiting 10 seconds for manual inspection...');
      await this.page.waitForTimeout(10000);
      
      throw new Error('Download failed');
    }
  }

  async close() {
    if (this.browser) {
      this.log('info', '🔒 Closing browser...');
      await this.browser.close();
      this.log('success', '✅ Browser closed');
    }
  }

  async run() {
    try {
      // Delete old files before downloading new ones
      await this.deleteOldUnbilledFiles();
      
      await this.initialize();
      await this.login();
      await this.navigateToBillingManager();
      
      const result = await this.downloadUnbilledReport();
      
      this.log('success', '🎉 Unbilled Report download completed!');
      return result;
    } catch (error) {
      this.log('error', `❌ Error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default UnbilledReportDownloader;
