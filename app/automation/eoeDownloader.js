import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SWAP_USERS = [
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

class EOEReportDownloader {
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
    this.currentSwapUser = null;
  }

  log(type, message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp}]${message}`);
    if (this.io) {
      this.io.emit('log', { type, message, timestamp: new Date().toISOString() });
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

  async downloadEOEReport() {
    this.log('info', '📋 Looking for "EOE" menu...');
    
    // Wait a bit for page to stabilize
    await this.page.waitForTimeout(2000);
    
    // Try to click EOE menu with better error handling
    try {
      await this.page.click('text="EOE"', { timeout: 10000 });
      this.log('success', '✅ Clicked "EOE"');
    } catch (e) {
      this.log('error', `❌ Failed to click EOE menu: ${e.message}`);
      throw new Error('"EOE" menu not found');
    }
    
    await this.page.waitForTimeout(3000);
    
    this.log('info', '🔍 Looking for "Not Ready" option...');
    
    // Try to click Not Ready with better error handling
    try {
      // Wait for the element to be visible
      await this.page.waitForSelector('#eoe-not-ready', { state: 'visible', timeout: 10000 });
      await this.page.click('#eoe-not-ready');
      this.log('success', '✅ Clicked "Not Ready"');
    } catch (e) {
      this.log('error', `❌ Failed to click Not Ready: ${e.message}`);
      
      // Try alternative selector
      try {
        await this.page.click('text="Not Ready"', { timeout: 5000 });
        this.log('success', '✅ Clicked "Not Ready" (alternative selector)');
      } catch (e2) {
        this.log('error', `❌ Alternative selector also failed: ${e2.message}`);
        throw new Error('"Not Ready" option not found');
      }
    }
    
    this.log('info', '⏳ Waiting for Not Ready page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);
    
    // Wait for any loading indicators
    try {
      await this.page.waitForSelector('.loading, [ng-show*="loading"]', { 
        state: 'hidden', 
        timeout: 15000 
      });
      this.log('info', '   Loading completed');
    } catch (e) {
      this.log('info', '   No loading indicator found');
    }
    
    // Click "Oasis Red Light? Click Here!!" button to load records (if present)
    this.log('info', '🔴 Looking for "Oasis Red Light" button...');
    
    try {
      const oasisSelectors = [
        '#pendo-text-0462efb2',
        'text="Oasis Red Light? Click Here!!"',
        'div:has-text("Oasis Red Light? Click Here!!")'
      ];
      
      let oasisClicked = false;
      for (const selector of oasisSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            this.log('success', '✅ Clicked "Oasis Red Light" button');
            oasisClicked = true;
            break;
          }
        } catch (e) {
          // Try next
        }
      }
      
      if (oasisClicked) {
        this.log('info', '⏳ Waiting for records to load...');
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(5000);
        
        // Wait for any loading indicators
        try {
          await this.page.waitForSelector('.loading, [ng-show*="loading"]', { 
            state: 'hidden', 
            timeout: 15000 
          });
          this.log('info', '   Loading completed');
        } catch (e) {
          this.log('info', '   No loading indicator found');
        }
      } else {
        this.log('info', '   "Oasis Red Light" button not found, checking for records directly...');
      }
      
    } catch (e) {
      this.log('info', `   Could not click Oasis Red Light button: ${e.message}`);
      this.log('info', '   Continuing to check for records...');
    }
    
    // Check if there are records
    this.log('info', '🔢 Checking for records...');
    
    const recordCount = await this.getRecordCount();
    this.log('info', `   Found ${recordCount} records`);
    
    if (recordCount === 0) {
      this.log('info', '   No records to export');
      return { count: 0, downloaded: false };
    }
    
    // Click export button
    this.log('info', '📥 Looking for export button...');
    
    try {
      // Wait for export button to be visible
      await this.page.waitForSelector('#tabExport', { state: 'visible', timeout: 10000 });
      this.log('success', '✅ Found export button');
      
      // Set up download listener BEFORE clicking
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      // Click the export button
      await this.page.click('#tabExport');
      this.log('success', '✅ Clicked export button');
      
      // Wait for the dialog to appear
      this.log('info', '⏳ Waiting for export dialog...');
      await this.page.waitForTimeout(2000);
      
      // Look for "Save File" button in dialog
      this.log('info', '💾 Looking for "Save File" button...');
      const saveSelectors = [
        'text="Save File"',
        'button:has-text("Save File")',
        'a:has-text("Save File")'
      ];
      
      let saveClicked = false;
      for (const selector of saveSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            this.log('success', '✅ Clicked "Save File"');
            saveClicked = true;
            break;
          }
        } catch (e) {
          // Try next
        }
      }
      
      if (!saveClicked) {
        this.log('info', '   "Save File" button not found, download might start automatically');
      }
      
      this.log('info', '⏳ Waiting for download to complete...');
      const download = await downloadPromise;
      
      const date = new Date().toISOString().split('T')[0];
      const sanitizedLocation = this.currentSwapUser.replace(/[^a-zA-Z0-9-]/g, '_');
      const filename = `EOE_Not_Ready_${sanitizedLocation}_${date}.xlsx`;
      const filepath = path.join(this.downloadPath, filename);
      
      await download.saveAs(filepath);
      this.log('success', `✅ Downloaded: ${filename}`);
      
      return { count: recordCount, downloaded: true, filename };
    } catch (e) {
      this.log('error', `❌ Export failed: ${e.message}`);
      throw new Error('Export button not found or download failed');
    }
  }

  async getRecordCount() {
    try {
      // Try to count table rows
      const rows = await this.page.$$('table tbody tr');
      
      if (rows.length === 0) {
        this.log('info', '   No tbody rows found');
        return 0;
      }
      
      // Filter out empty rows (rows with only 1 cell or less)
      let validRowCount = 0;
      for (const row of rows) {
        const cells = await row.$$('td');
        if (cells.length > 1) {
          validRowCount++;
        }
      }
      
      this.log('info', `   Counted ${validRowCount} valid rows (${rows.length} total)`);
      return validRowCount;
    } catch (error) {
      this.log('info', `   Could not count records: ${error.message}`);
      return 0;
    }
  }

  async selectSwapUser(swapUser) {
    this.log('info', `👤 Selecting swapUser: ${swapUser}...`);
    
    const swapUserSelectors = [
      '#swapUser',
      'select#swapUser'
    ];
    
    let userSelected = false;
    for (const selector of swapUserSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await this.page.selectOption(selector, swapUser);
          this.log('success', `✅ Selected swapUser: ${swapUser}`);
          userSelected = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!userSelected) {
      throw new Error('swapUser dropdown not found');
    }
    
    // Wait for the page to start reloading
    await this.page.waitForTimeout(2000);
    
    // Instead of reload, wait for navigation that happens automatically
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      this.log('info', '   Page reloaded after swapUser change');
    } catch (e) {
      this.log('info', '   Page did not reload, continuing...');
    }
    
    await this.page.waitForTimeout(3000);
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
      await this.initialize();
      await this.login();
      
      const allResults = [];
      const date = new Date().toISOString().split('T')[0];
      
      for (const swapUser of SWAP_USERS) {
        this.log('info', `\n========== Processing swapUser: ${swapUser} (${SWAP_USERS.indexOf(swapUser) + 1}/${SWAP_USERS.length}) ==========`);
        
        try {
          const currentUrl = this.page.url();
          
          if (currentUrl.includes('login')) {
            await this.login();
          }
          
          await this.selectSwapUser(swapUser);
          this.currentSwapUser = swapUser;
          
          await this.navigateToBillingManager();
          const result = await this.downloadEOEReport();
          
          this.log('success', `✅ Completed for ${swapUser}: ${result.count} records`);
          
          allResults.push({ 
            location: swapUser,
            date: date,
            count: result.count,
            downloaded: result.downloaded,
            filename: result.filename || null,
            success: true
          });
          
          // Navigate back to inbox
          this.log('info', '🏠 Returning to inbox...');
          await this.page.goto('https://kinnser.net/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(5000);
          
        } catch (error) {
          this.log('error', `❌ Failed for ${swapUser}: ${error.message}`);
          allResults.push({ 
            location: swapUser,
            date: date,
            count: 0,
            downloaded: false,
            success: false,
            error: error.message
          });
          
          try {
            await this.page.goto('https://kinnser.net/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
            await this.page.waitForTimeout(5000);
          } catch (recoveryError) {
            this.log('error', `❌ Recovery failed: ${recoveryError.message}`);
          }
        }
      }
      
      this.log('success', '\n🎉 All EOE reports complete!');
      
      return allResults;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default EOEReportDownloader;
