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

class DeviationReportDownloader {
  constructor(io = null) {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    
    if (!this.username || !this.password) {
      throw new Error('KINNSER_USERNAME and KINNSER_PASSWORD must be set in .env file');
    }
    
    this.browser = null;
    this.page = null;
    this.io = io;
    this.currentSwapUser = null;
  }

  log(type, message) {
    console.log(`[${type}] ${message}`);
    if (this.io) {
      this.io.emit('log', { type, message, timestamp: new Date().toISOString() });
    }
  }

  async initialize() {
    this.log('info', '🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: true,
      timeout: 60000
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(30000);
    this.log('success', '✅ Browser initialized');
  }

  async login() {
    this.log('info', '🔐 Logging into Kinnser...');
    await this.page.goto('https://kinnser.net/', { waitUntil: 'domcontentloaded' });
    
    this.page.on('dialog', async dialog => {
      this.log('info', `🔔 Dialog appeared: ${dialog.type()}`);
      this.log('info', `📝 Dialog message: ${dialog.message()}`);
      this.log('info', '👆 Clicking OK on dialog...');
      await dialog.accept();
      this.log('success', '✅ Clicked OK on dialog');
    });
    
    this.log('info', '⌨️  Filling username...');
    await this.page.fill('input[type="text"]', this.username);
    this.log('success', '✅ Username filled');
    
    this.log('info', '🔑 Filling password...');
    await this.page.fill('input[type="password"]', this.password);
    this.log('success', '✅ Password filled');
    
    this.log('info', '👆 Clicking "Log in" button (#login_btn)...');
    await this.page.click('#login_btn');
    this.log('success', '✅ Clicked "Log in" button');
    
    this.log('info', '⏳ Waiting for new page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    this.log('success', '✅ New page loaded!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
  }

  async navigateToReports() {
    this.log('info', '📂 Looking for "Go To" menu button...');
    
    const gotoSelectors = [
      'a.menuButton[onclick*="gotoMenu"]',
      'a[onclick*="buttonClick(event, \'gotoMenu\')"]',
      'a.menuButton:has-text("Go To")',
      'text="Go To"'
    ];
    
    let gotoClicked = false;
    for (const selector of gotoSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found "Go To" with selector: ${selector}`);
            await this.page.click(selector);
            this.log('success', '✅ Clicked "Go To"');
            gotoClicked = true;
            break;
          }
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!gotoClicked) {
      this.log('error', '❌ Could not find "Go To"');
      throw new Error('"Go To" not found');
    }
    
    this.log('info', '⏳ Waiting for menu to appear...');
    await this.page.waitForTimeout(2000);
    
    this.log('info', '📊 Looking for "Reports / Admin"...');
    
    const reportsSelectors = [
      'text="Reports / Admin"',
      'text="Reports/Admin"',
      'a:has-text("Reports / Admin")',
      'a:has-text("Reports/Admin")',
      'text="Reports"',
      'a:has-text("Reports")'
    ];
    
    let reportsClicked = false;
    for (const selector of reportsSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found "Reports / Admin" with selector: ${selector}`);
            await this.page.click(selector);
            this.log('success', '✅ Clicked "Reports / Admin"');
            reportsClicked = true;
            break;
          }
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!reportsClicked) {
      this.log('error', '❌ Could not find "Reports / Admin"');
      throw new Error('"Reports / Admin" not found');
    }
    
    this.log('info', '⏳ Waiting for Reports page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    this.log('success', '✅ Reports page loaded!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
  }

  async getDeviationCount() {
    this.log('info', '📊 Looking for "Schedule Deviation" link...');
    
    await this.page.evaluate(() => window.scrollBy(0, 500));
    await this.page.waitForTimeout(1000);
    
    const deviationSelectors = [
      'a.HotBox:has-text("Schedule Deviation")',
      'a:has-text("Schedule Deviation")',
      'strong:has-text("Schedule Deviation")',
      'text="Schedule Deviation"'
    ];
    
    let deviationClicked = false;
    for (const selector of deviationSelectors) {
      try {
        this.log('info', `   Trying selector: ${selector}`);
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found "Schedule Deviation" with selector: ${selector}`);
            await element.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            
            const tagName = await element.evaluate(el => el.tagName);
            if (tagName === 'STRONG') {
              this.log('info', '   Found <strong> tag, looking for parent link...');
              const parentLink = await element.evaluateHandle(el => el.closest('a'));
              if (parentLink) {
                await parentLink.click();
                this.log('success', '✅ Clicked parent link of "Schedule Deviation"');
              } else {
                await element.click();
                this.log('success', '✅ Clicked "Schedule Deviation"');
              }
            } else {
              await this.page.click(selector);
              this.log('success', '✅ Clicked "Schedule Deviation"');
            }
            deviationClicked = true;
            break;
          } else {
            this.log('info', '   Element found but not visible');
          }
        } else {
          this.log('info', '   Element not found with this selector');
        }
      } catch (e) {
        this.log('info', `   Error with selector: ${e.message}`);
      }
    }
    
    if (!deviationClicked) {
      this.log('error', '❌ Could not find "Schedule Deviation"');
      throw new Error('"Schedule Deviation" not found');
    }
    
    this.log('info', '⏳ Waiting for Schedule Deviation page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    this.log('success', '✅ Schedule Deviation page loaded!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
    
    // Count records on the page
    this.log('info', '🔢 Counting records...');
    
    // Try to find table rows or record count
    let recordCount = 0;
    try {
      // Try to count table rows (excluding header)
      const rows = await this.page.$$('table tr');
      if (rows.length > 1) {
        recordCount = rows.length - 1; // Subtract header row
        this.log('success', `✅ Found ${recordCount} records in table`);
      } else {
        // Try alternative methods to count records
        const allTables = await this.page.$$('table');
        this.log('info', `   Found ${allTables.length} tables on page`);
        
        // Look for the main data table
        for (const table of allTables) {
          const tableRows = await table.$$('tr');
          if (tableRows.length > recordCount) {
            recordCount = tableRows.length - 1;
          }
        }
        this.log('success', `✅ Counted ${recordCount} records`);
      }
    } catch (error) {
      this.log('error', `❌ Error counting records: ${error.message}`);
      recordCount = 0;
    }
    
    return recordCount;
  }

  async selectSwapUser(swapUser) {
    this.log('info', `👤 Selecting swapUser: ${swapUser}...`);
    
    const swapUserSelectors = [
      '#swapUser',
      'select#swapUser',
      '[name="swapUser"]',
      'select[name="swapUser"]'
    ];
    
    let userSelected = false;
    for (const selector of swapUserSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          this.log('info', `✅ Found swapUser dropdown with selector: ${selector}`);
          
          try {
            await this.page.selectOption(selector, swapUser);
            this.log('success', `✅ Selected swapUser: ${swapUser}`);
            userSelected = true;
            break;
          } catch (e) {
            await this.page.selectOption(selector, { label: swapUser });
            this.log('success', `✅ Selected swapUser by label: ${swapUser}`);
            userSelected = true;
            break;
          }
        }
      } catch (e) {
        this.log('info', `   Error with selector: ${e.message}`);
      }
    }
    
    if (!userSelected) {
      this.log('error', '❌ Could not find or select swapUser dropdown');
      throw new Error('swapUser dropdown not found');
    }
    
    await this.page.waitForTimeout(2000);
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
        this.log('info', `\n========== Processing swapUser: ${swapUser} ==========`);
        
        try {
          const currentUrl = this.page.url();
          this.log('info', `📍 Current URL: ${currentUrl}`);
          
          if (currentUrl.includes('login')) {
            this.log('error', '❌ Session expired, need to re-login');
            await this.login();
          }
          
          await this.selectSwapUser(swapUser);
          this.currentSwapUser = swapUser;
          
          await this.navigateToReports();
          const recordCount = await this.getDeviationCount();
          
          this.log('success', `✅ Completed for ${swapUser}: ${recordCount} records`);
          
          allResults.push({ 
            location: swapUser,
            date: date,
            count: recordCount,
            success: true
          });
          
          // Navigate back to inbox for next user
          this.log('info', '🏠 Returning to inbox page...');
          await this.page.goto('https://kinnser.net/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(3000);
          this.log('success', '✅ Back at inbox, ready for next user');
          
        } catch (error) {
          this.log('error', `❌ Failed for ${swapUser}: ${error.message}`);
          allResults.push({ 
            location: swapUser,
            date: date,
            count: 0,
            success: false,
            error: error.message
          });
        }
      }
      
      this.log('success', '\n🎉 All deviation counts complete!');
      this.log('info', `📊 Processed ${allResults.length} locations`);
      
      return allResults;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default DeviationReportDownloader;
