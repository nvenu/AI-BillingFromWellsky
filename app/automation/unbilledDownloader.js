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
      headless: true,
      timeout: 60000,
      downloadsPath: this.downloadPath
    });
    
    const context = await this.browser.newContext({
      acceptDownloads: true
    });
    
    this.page = await context.newPage();
    this.page.setDefaultTimeout(30000);
    this.log('success', '✅ Browser initialized');
  }

  async login() {
    this.log('info', '🔐 Navigating to login page...');
    await this.page.goto('https://kinnser.net/login.cfm', { waitUntil: 'domcontentloaded' });
    
    this.log('info', '📝 Entering credentials...');
    await this.page.fill('input[name="username"]', this.username);
    await this.page.fill('input[name="password"]', this.password);
    
    this.log('info', '🔓 Clicking login button...');
    await this.page.click('input[type="submit"], button[type="submit"]');
    
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);
    
    // Check for and close any popup
    await this.closePopupIfPresent();
    
    this.log('success', '✅ Login successful');
  }

  async closePopupIfPresent() {
    this.log('info', '🔍 Checking for popup...');
    try {
      // Look for common popup close buttons
      const closeSelectors = [
        'button.close',
        '.modal-close',
        '[aria-label="Close"]',
        '.popup-close',
        'button[data-dismiss="modal"]',
        '.pendo-close-guide-x',
        'button.pendo-close-guide-x',
        '[class*="close"]'
      ];
      
      for (const selector of closeSelectors) {
        const closeBtn = await this.page.$(selector);
        if (closeBtn && await closeBtn.isVisible()) {
          await closeBtn.click();
          this.log('success', '✅ Closed popup');
          await this.page.waitForTimeout(1000);
          return;
        }
      }
      
      this.log('info', '   No popup found');
    } catch (e) {
      this.log('info', '   No popup to close');
    }
  }

  async navigateToBillingManager() {
    this.log('info', '📂 Looking for "Go To" menu...');
    
    const gotoSelectors = [
      'text="Go To"',
      'a:has-text("Go To")',
      '#goto-menu',
      '[data-toggle="dropdown"]:has-text("Go To")'
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
    try {
      await this.page.waitForSelector('.loading, [ng-show*="loading"], .spinner', { 
        state: 'hidden', 
        timeout: 30000 
      });
    } catch (e) {
      // Loading indicator might not be present
    }
    
    await this.page.waitForTimeout(2000);
    this.log('success', '✅ Billing Manager loaded');
  }

  async downloadUnbilledReport() {
    this.log('info', '📊 Looking for "Managed Care Unbilled Report" link...');
    
    try {
      await this.page.waitForSelector('#managed-care-unbilled-report-link, a:has-text("Managed Care Unbilled Report")', { 
        state: 'visible', 
        timeout: 15000 
      });
      await this.page.click('#managed-care-unbilled-report-link, a:has-text("Managed Care Unbilled Report")');
      this.log('success', '✅ Clicked "Managed Care Unbilled Report"');
    } catch (e) {
      this.log('error', `❌ Failed to click Managed Care Unbilled Report: ${e.message}`);
      throw new Error('Managed Care Unbilled Report link not found');
    }
    
    this.log('info', '⏳ Waiting for report page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);
    
    // Wait for loading to complete
    try {
      await this.page.waitForSelector('.loading-message, .loading', { state: 'hidden', timeout: 30000 });
    } catch (e) {
      this.log('info', '   Loading indicator not found');
    }
    
    await this.page.waitForTimeout(2000);
    this.log('success', '✅ Report page loaded');
    
    // Click "Select All" for Branch
    this.log('info', '🏢 Selecting all Branches...');
    try {
      await this.page.waitForSelector('#filter_Branch_btn_select_all', { state: 'visible', timeout: 10000 });
      await this.page.click('#filter_Branch_btn_select_all');
      this.log('success', '✅ Selected all Branches');
    } catch (e) {
      this.log('error', `❌ Failed to select all Branches: ${e.message}`);
    }
    
    await this.page.waitForTimeout(1000);
    
    // Click "Select All" for Payer Type
    this.log('info', '💳 Selecting all Payer Types...');
    try {
      await this.page.waitForSelector('#filter_Payer_Type_btn_select_all', { state: 'visible', timeout: 10000 });
      await this.page.click('#filter_Payer_Type_btn_select_all');
      this.log('success', '✅ Selected all Payer Types');
    } catch (e) {
      this.log('error', `❌ Failed to select all Payer Types: ${e.message}`);
    }
    
    await this.page.waitForTimeout(1000);
    
    // Click "Select All" for Insurance
    this.log('info', '🏥 Selecting all Insurances...');
    try {
      await this.page.waitForSelector('#filter_Insurance_btn_select_all', { state: 'visible', timeout: 10000 });
      await this.page.click('#filter_Insurance_btn_select_all');
      this.log('success', '✅ Selected all Insurances');
    } catch (e) {
      this.log('error', `❌ Failed to select all Insurances: ${e.message}`);
    }
    
    await this.page.waitForTimeout(1000);
    
    // Click "Apply Filters"
    this.log('info', '🔍 Clicking Apply Filters...');
    try {
      await this.page.waitForSelector('#aggrid_btnfetch1', { state: 'visible', timeout: 10000 });
      await this.page.click('#aggrid_btnfetch1');
      this.log('success', '✅ Clicked Apply Filters');
    } catch (e) {
      this.log('error', `❌ Failed to click Apply Filters: ${e.message}`);
      throw new Error('Apply Filters button not found');
    }
    
    this.log('info', '⏳ Waiting for data to load...');
    
    // Wait for loading to appear and disappear
    await this.page.waitForTimeout(2000);
    try {
      await this.page.waitForSelector('.loading-message, .loading', { state: 'visible', timeout: 5000 });
      this.log('info', '   Loading indicator appeared');
      await this.page.waitForSelector('.loading-message, .loading', { state: 'hidden', timeout: 120000 });
      this.log('info', '   Loading completed');
    } catch (e) {
      this.log('info', '   Loading indicator not detected, waiting...');
      await this.page.waitForTimeout(10000);
    }
    
    // Wait for table to be visible
    await this.page.waitForTimeout(5000);
    this.log('success', '✅ Data loaded');
    
    // Click Export
    this.log('info', '📥 Looking for Export button...');
    try {
      await this.page.waitForSelector('text="EXPORT", div:has-text("EXPORT")', { state: 'visible', timeout: 15000 });
      await this.page.click('text="EXPORT"');
      this.log('success', '✅ Clicked Export');
    } catch (e) {
      this.log('error', `❌ Failed to click Export: ${e.message}`);
      throw new Error('Export button not found');
    }
    
    this.log('info', '⏳ Waiting for export to prepare...');
    
    // Wait for loading to complete
    await this.page.waitForTimeout(2000);
    try {
      await this.page.waitForSelector('.loading-message, .loading', { state: 'hidden', timeout: 60000 });
    } catch (e) {
      this.log('info', '   No loading indicator');
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
