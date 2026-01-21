import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

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
    await this.page.waitForTimeout(5000);
    
    this.log('success', '✅ Billing Manager loaded');
  }

  async downloadEOEReport() {
    this.log('info', '📋 Looking for "EOE" menu...');
    
    const eoeSelectors = [
      'text="EOE"',
      'a:has-text("EOE")',
      '[ng-click*="EOE"]'
    ];
    
    let eoeClicked = false;
    for (const selector of eoeSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.click();
          this.log('success', '✅ Clicked "EOE"');
          eoeClicked = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!eoeClicked) {
      throw new Error('"EOE" menu not found');
    }
    
    await this.page.waitForTimeout(2000);
    
    this.log('info', '🔍 Looking for "Not Ready" option...');
    
    const notReadySelectors = [
      'text="Not Ready"',
      'a:has-text("Not Ready")',
      '[ng-click*="notReady"]',
      '[ng-click*="NotReady"]'
    ];
    
    let notReadyClicked = false;
    for (const selector of notReadySelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.click();
          this.log('success', '✅ Clicked "Not Ready"');
          notReadyClicked = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!notReadyClicked) {
      throw new Error('"Not Ready" option not found');
    }
    
    this.log('info', '⏳ Waiting for report to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    // Check if there are records
    this.log('info', '🔢 Checking for records...');
    
    // Count records (you can adjust this selector based on actual page structure)
    const recordCount = await this.getRecordCount();
    this.log('info', `   Found ${recordCount} records`);
    
    if (recordCount === 0) {
      this.log('info', '   No records to export');
      return { count: 0, downloaded: false };
    }
    
    // Click export button
    this.log('info', '📥 Clicking export button...');
    
    const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
    
    const exportClicked = await this.page.click('#tabExport').catch(() => false);
    
    if (!exportClicked) {
      throw new Error('Export button not found or not clickable');
    }
    
    this.log('success', '✅ Clicked export button');
    this.log('info', '⏳ Waiting for download...');
    
    const download = await downloadPromise;
    const date = new Date().toISOString().split('T')[0];
    const sanitizedLocation = this.currentSwapUser.replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `EOE_Not_Ready_${sanitizedLocation}_${date}.xlsx`;
    const filepath = path.join(this.downloadPath, filename);
    
    await download.saveAs(filepath);
    this.log('success', `✅ Downloaded: ${filename}`);
    
    return { count: recordCount, downloaded: true, filename };
  }

  async getRecordCount() {
    try {
      // Try to count table rows or grid items
      const rows = await this.page.$$('table tbody tr, .grid-row, [ng-repeat]');
      return rows.length;
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
    
    await this.page.waitForTimeout(3000);
    await this.page.reload({ waitUntil: 'domcontentloaded' });
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
