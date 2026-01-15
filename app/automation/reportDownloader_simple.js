import { chromium } from 'playwright';
import fs from 'fs/promises';
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

class KinnserReportDownloader {
  constructor(io = null) {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    this.dataDir = path.join(__dirname, '..', 'data');
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
    await fs.mkdir(this.dataDir, { recursive: true });
    
    this.log('info', '🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: false,
      slowMo: 500,
      timeout: 60000
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(30000);
    this.log('success', '✅ Browser initialized');
  }

  async login() {
    this.log('info', '🔐 Logging into Kinnser...');
    await this.page.goto('https://kinnser.net/', { waitUntil: 'networkidle' });
    
    // Set up dialog handler BEFORE clicking login
    this.page.on('dialog', async dialog => {
      this.log('info', `🔔 Dialog: ${dialog.message()}`);
      await dialog.accept();
      this.log('success', '✅ Dialog accepted');
    });
    
    // Wait for page to be ready
    await this.page.waitForTimeout(2000);
    
    // Find and fill username - try multiple selectors
    this.log('info', '⌨️  Filling username...');
    const usernameSelectors = [
      'input[name="username"]',
      'input[type="text"]',
      '#username',
      'input[placeholder*="username" i]'
    ];
    
    let usernameFilled = false;
    for (const selector of usernameSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.fill(this.username);
          this.log('success', `✅ Username filled with: ${selector}`);
          usernameFilled = true;
          break;
        }
      } catch (e) {}
    }
    
    if (!usernameFilled) {
      this.log('error', '❌ Could not find username field');
      throw new Error('Username field not found');
    }
    
    // Find and fill password
    this.log('info', '🔑 Filling password...');
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password'
    ];
    
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.fill(this.password);
          this.log('success', `✅ Password filled with: ${selector}`);
          passwordFilled = true;
          break;
        }
      } catch (e) {}
    }
    
    if (!passwordFilled) {
      this.log('error', '❌ Could not find password field');
      throw new Error('Password field not found');
    }
    
    await this.page.waitForTimeout(1000);
    
    // Click login button
    this.log('info', '👆 Clicking login button...');
    const loginSelectors = [
      '#login_btn',
      'button#login_btn',
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("Log in")'
    ];
    
    let loginClicked = false;
    for (const selector of loginSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.click();
          this.log('success', `✅ Clicked login with: ${selector}`);
          loginClicked = true;
          break;
        }
      } catch (e) {}
    }
    
    if (!loginClicked) {
      this.log('error', '❌ Could not find login button');
      throw new Error('Login button not found');
    }
    
    // Wait for navigation after login
    this.log('info', '⏳ Waiting for page to load...');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
    
    const currentUrl = this.page.url();
    this.log('info', `📍 Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('login')) {
      this.log('error', '❌ Still on login page - credentials may be wrong');
      throw new Error('Login failed - still on login page');
    }
    
    this.log('success', '✅ Logged in successfully!');
  }

  async navigateToReports() {
    this.log('info', '📂 Looking for "Go To" button...');
    
    const gotoSelectors = [
      'a.menuButton:has-text("Go To")',
      'a[onclick*="gotoMenu"]',
      'text="Go To"',
      'a:has-text("Go To")'
    ];
    
    let gotoClicked = false;
    for (const selector of gotoSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          this.log('info', `✅ Found "Go To" with: ${selector}`);
          await element.click();
          this.log('success', '✅ Clicked "Go To"');
          gotoClicked = true;
          await this.page.waitForTimeout(2000);
          break;
        }
      } catch (e) {
        this.log('info', `   Selector failed: ${selector}`);
      }
    }
    
    if (!gotoClicked) {
      this.log('error', '❌ Could not find "Go To" button');
      throw new Error('"Go To" button not found');
    }
    
    this.log('info', '📊 Looking for "Reports / Admin"...');
    const reportsSelectors = [
      'text="Reports / Admin"',
      'a:has-text("Reports / Admin")',
      'text="Reports"'
    ];
    
    let reportsClicked = false;
    for (const selector of reportsSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await element.click();
          this.log('success', `✅ Clicked "Reports / Admin" with: ${selector}`);
          reportsClicked = true;
          break;
        }
      } catch (e) {}
    }
    
    if (!reportsClicked) {
      this.log('error', '❌ Could not find "Reports / Admin"');
      throw new Error('"Reports / Admin" not found');
    }
    
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
    this.log('success', '✅ Reports page loaded');
  }

  async downloadReport(reportName) {
    this.log('info', `📊 Looking for "${reportName}"...`);
    
    await this.page.evaluate(() => window.scrollBy(0, 500));
    await this.page.waitForTimeout(1000);
    
    const reportSelectors = [
      `#ClinicalTasksTable strong:has-text("${reportName}")`,
      `strong:has-text("${reportName}")`,
      `text="${reportName}"`
    ];
    
    let reportClicked = false;
    for (const selector of reportSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          this.log('info', `✅ Found "${reportName}" with: ${selector}`);
          
          const tagName = await element.evaluate(el => el.tagName);
          if (tagName === 'STRONG') {
            const parentLink = await element.evaluateHandle(el => el.closest('a'));
            if (parentLink) {
              await parentLink.click();
            } else {
              await element.click();
            }
          } else {
            await element.click();
          }
          
          this.log('success', `✅ Clicked "${reportName}"`);
          reportClicked = true;
          break;
        }
      } catch (e) {
        this.log('info', `   Selector failed: ${selector}`);
      }
    }
    
    if (!reportClicked) {
      this.log('error', `❌ Could not find "${reportName}"`);
      throw new Error(`"${reportName}" not found`);
    }
    
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
    
    return await this.downloadExcel(reportName);
  }

  async downloadExcel(reportName) {
    this.log('info', '📥 Looking for Excel button...');
    
    const excelSelectors = [
      'text="To Excel"',
      'a:has-text("Excel")',
      'button:has-text("Excel")'
    ];
    
    let excelClicked = false;
    for (const selector of excelSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          this.log('info', `✅ Found Excel button with: ${selector}`);
          
          const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
          await element.click();
          this.log('info', '⏳ Waiting for download...');
          
          const download = await downloadPromise;
          
          const date = new Date().toISOString().split('T')[0];
          const userPrefix = this.currentSwapUser ? `${this.currentSwapUser}_` : '';
          const filename = `${userPrefix}${reportName.replace(/\s+/g, '_')}_${date}.xlsx`;
          const filepath = path.join(this.dataDir, filename);
          
          await download.saveAs(filepath);
          this.log('success', `✅ Downloaded: ${filename}`);
          
          excelClicked = true;
          return filepath;
        }
      } catch (e) {
        this.log('info', `   Selector failed: ${selector}`);
      }
    }
    
    if (!excelClicked) {
      this.log('error', '❌ Could not find Excel button');
      throw new Error('Excel button not found');
    }
  }

  async selectSwapUser(swapUser) {
    this.log('info', `👤 Selecting: ${swapUser}...`);
    
    const swapUserSelectors = [
      '#swapUser',
      'select#swapUser',
      'select[name="swapUser"]'
    ];
    
    let userSelected = false;
    for (const selector of swapUserSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          await this.page.selectOption(selector, { label: swapUser });
          this.log('success', `✅ Selected: ${swapUser}`);
          userSelected = true;
          await this.page.waitForTimeout(2000);
          break;
        }
      } catch (e) {
        this.log('info', `   Selector failed: ${selector}`);
      }
    }
    
    if (!userSelected) {
      this.log('error', '❌ Could not find swapUser dropdown');
      throw new Error('swapUser dropdown not found');
    }
  }

  async close() {
    if (this.browser) {
      this.log('info', '⏳ Waiting before closing...');
      await this.page.waitForTimeout(5000);
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
      
      for (const swapUser of SWAP_USERS) {
        this.log('info', `\n========== Processing: ${swapUser} ==========`);
        
        try {
          await this.selectSwapUser(swapUser);
          this.currentSwapUser = swapUser;
          
          await this.navigateToReports();
          const filepath = await this.downloadReport('Past Due Visits');
          
          allResults.push({ 
            reportName: 'Past Due Visits', 
            swapUser: swapUser,
            success: true,
            filepath: filepath,
            date: new Date().toISOString().split('T')[0]
          });
          
          this.log('success', `✅ Completed for ${swapUser}`);
          
        } catch (error) {
          this.log('error', `❌ Failed for ${swapUser}: ${error.message}`);
          allResults.push({ 
            reportName: 'Past Due Visits', 
            swapUser: swapUser,
            success: false,
            error: error.message
          });
        }
      }
      
      this.log('success', '\n🎉 All downloads complete!');
      return allResults;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default KinnserReportDownloader;
