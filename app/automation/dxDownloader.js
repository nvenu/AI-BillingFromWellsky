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

class DXReportDownloader {
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
    
    this.log('success', '✅ Logged in successfully');
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

  async downloadDXReport() {
    this.log('info', '🔵 Looking for "Primary Payer" button...');
    
    await this.page.waitForTimeout(2000);
    
    try {
      await this.page.click('#ManagedCareClaims', { timeout: 10000 });
      this.log('success', '✅ Clicked "Primary Payer"');
    } catch (e) {
      this.log('error', `❌ Failed to click Primary Payer: ${e.message}`);
      throw new Error('"Primary Payer" button not found');
    }
    
    await this.page.waitForTimeout(2000);
    
    this.log('info', '🔍 Looking for "Not Ready" option...');
    
    try {
      await this.page.waitForSelector('#managedCare-not-ready', { state: 'visible', timeout: 10000 });
      await this.page.click('#managedCare-not-ready');
      this.log('success', '✅ Clicked "Not Ready"');
    } catch (e) {
      this.log('error', `❌ Failed to click Not Ready: ${e.message}`);
      throw new Error('"Not Ready" option not found');
    }
    
    this.log('info', '⏳ Waiting for Not Ready page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    // Wait for loading to complete
    try {
      await this.page.waitForSelector('.loading, [ng-show*="loading"]', { 
        state: 'hidden', 
        timeout: 15000 
      });
      this.log('info', '   Loading completed');
    } catch (e) {
      this.log('info', '   No loading indicator found');
    }
    
    // Select "All Insurances" from dropdown
    this.log('info', '📋 Looking for insurance dropdown...');
    
    try {
      await this.page.waitForSelector('select[ng-model="insuranceKey"]', { state: 'visible', timeout: 10000 });
      await this.page.selectOption('select[ng-model="insuranceKey"]', '1'); // Value 1 = All Insurances
      this.log('success', '✅ Selected "All Insurances"');
    } catch (e) {
      this.log('error', `❌ Failed to select insurance: ${e.message}`);
      throw new Error('Insurance dropdown not found');
    }
    
    this.log('info', '⏳ Waiting for records to load after insurance selection...');
    
    // Wait a moment for loading to start
    await this.page.waitForTimeout(1000);
    
    // Wait for loading indicator to disappear OR table data to appear
    try {
      // Wait for loading to complete by checking for:
      // 1. Loading indicator to disappear
      // 2. OR table rows to appear (actual data)
      await Promise.race([
        this.page.waitForSelector('.loading, [ng-show*="loading"], .spinner, .ks-loading', { 
          state: 'hidden', 
          timeout: 60000 
        }),
        this.page.waitForSelector('table tbody tr td', { 
          state: 'visible', 
          timeout: 60000 
        })
      ]);
      this.log('info', '   Initial load detected');
      
      // Now wait for table rows to be visible (confirms data is loaded)
      await this.page.waitForSelector('table tbody tr', { 
        state: 'visible', 
        timeout: 60000 
      });
      this.log('success', '✅ Table data loaded');
      
    } catch (e) {
      this.log('info', '   Could not detect loading completion, waiting additional time...');
      await this.page.waitForTimeout(10000);
    }
    
    // Additional wait to ensure records are fully rendered
    await this.page.waitForTimeout(2000);
    
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
      await this.page.waitForSelector('#tabExport', { state: 'visible', timeout: 10000 });
      this.log('success', '✅ Found export button');
      
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      await this.page.click('#tabExport');
      this.log('success', '✅ Clicked export button');
      
      this.log('info', '⏳ Waiting for export dialog...');
      await this.page.waitForTimeout(2000);
      
      // Look for "Save File" button
      this.log('info', '💾 Looking for "Save File" button...');
      const saveSelectors = [
        '#btnSaveLinkText',
        'a#btnSaveLinkText',
        'text="Save File"'
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
      const filename = `DX_Not_Ready_${sanitizedLocation}_${date}.xlsx`;
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
      const rows = await this.page.$$('table tbody tr');
      
      if (rows.length === 0) {
        this.log('info', '   No tbody rows found');
        return 0;
      }
      
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
    
    await this.page.waitForTimeout(2000);
    
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
          const result = await this.downloadDXReport();
          
          this.log('success', `✅ Completed for ${swapUser}: ${result.count} records`);
          
          allResults.push({ 
            location: swapUser,
            date: date,
            count: result.count,
            downloaded: result.downloaded,
            filename: result.filename || null,
            success: true
          });
          
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
      
      this.log('success', '\n🎉 All DX reports complete!');
      
      return allResults;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default DXReportDownloader;
