import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REPORTS = [
  'Past Due Visits'
];

// List of swapUser values to iterate through
const SWAP_USERS = [
  'Nightingale - Taunton',
  'Aspire - Dublin',
  'Aspire - San Diego',
  'Aspire - Scottsdale',
  'Aspire - Yuba City',
  'Nightingale - Las Vegas',
  'Nightingale - Minnetonka',
  'Nightingale - Pompano Beach'
];

class KinnserReportDownloader {
  constructor(io = null) {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    
    if (!this.username || !this.password) {
      throw new Error('KINNSER_USERNAME and KINNSER_PASSWORD must be set in .env file');
    }
    
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
    
    this.screenshotDir = path.join(__dirname, '..', 'public', 'screenshots');
    await fs.mkdir(this.screenshotDir, { recursive: true });
    
    this.log('info', '🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: true,
      timeout: 60000
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(30000);
    this.log('success', '✅ Browser initialized');
  }

  async takeScreenshot(name) {
    return null;
  }

  async login() {
    this.log('info', '🔐 Logging into Kinnser...');
    await this.page.goto('https://kinnser.net/', { waitUntil: 'domcontentloaded' });
    
    await this.takeScreenshot('01_login_page');
    
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
    
    await this.takeScreenshot('02_credentials_filled');
    
    this.log('info', '👆 Clicking "Log in" button (#login_btn)...');
    await this.page.click('#login_btn');
    this.log('success', '✅ Clicked "Log in" button');
    
    await this.takeScreenshot('03_after_login_click');
    
    this.log('info', '⏳ Waiting for new page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    await this.takeScreenshot('04_new_page_loaded');
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
      await this.inspectPage();
      await this.takeScreenshot('ERROR_goto_not_found');
      throw new Error('"Go To" not found');
    }
    
    await this.takeScreenshot('05_goto_clicked');
    
    this.log('info', '⏳ Waiting for menu to appear...');
    await this.page.waitForTimeout(2000);
    
    await this.takeScreenshot('06_goto_menu_appeared');
    this.log('success', '✅ Menu appeared!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
    
    this.log('info', '📊 Looking for "Reports / Admin"...');
    
    const reportsSelectors = [
      'text="Reports / Admin"',
      'text="Reports/Admin"',
      'a:has-text("Reports / Admin")',
      'a:has-text("Reports/Admin")',
      'text="Reports"',
      'a:has-text("Reports")',
      'option:has-text("Reports")',
      '[href*="report"]'
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
      await this.takeScreenshot('ERROR_reports_not_found');
      throw new Error('"Reports / Admin" not found');
    }
    
    await this.takeScreenshot('07_reports_clicked');
    
    this.log('info', '⏳ Waiting for Reports page to load...');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    await this.takeScreenshot('08_reports_page_loaded');
    this.log('success', '✅ Reports page loaded!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
    
    await this.inspectPage();
  }

  async inspectPage() {
    try {
      this.log('info', '🔍 Inspecting page elements...');
      
      const links = await this.page.$$eval('a', 
        elements => elements.slice(0, 30).map(el => ({
          text: el.textContent?.trim() || 'No text',
          href: el.href,
          class: el.className,
          onclick: el.getAttribute('onclick') || ''
        })).filter(l => l.text && l.text.length < 100)
      );
      
      if (links.length > 0) {
        this.log('info', `🔗 Found ${links.length} links:`);
        links.forEach((link, i) => {
          this.log('info', `   ${i + 1}. "${link.text}" ${link.class ? `[${link.class}]` : ''} ${link.onclick ? '[onclick]' : ''}`);
        });
      }
      
      const buttons = await this.page.$$eval('button, input[type="submit"], input[type="button"]', 
        elements => elements.slice(0, 20).map(el => ({
          text: el.textContent?.trim() || el.value || 'No text',
          id: el.id,
          class: el.className
        }))
      );
      
      if (buttons.length > 0) {
        this.log('info', `🔘 Found ${buttons.length} buttons:`);
        buttons.forEach((btn, i) => {
          this.log('info', `   ${i + 1}. "${btn.text}"${btn.id ? ' #' + btn.id : ''}${btn.class ? ' .' + btn.class : ''}`);
        });
      }
    } catch (error) {
      this.log('error', `Failed to inspect page: ${error.message}`);
    }
  }

  async downloadReport(reportName) {
    this.log('info', `📊 Looking for "${reportName}" in ClinicalTasksTable...`);
    
    await this.page.evaluate(() => window.scrollBy(0, 500));
    await this.page.waitForTimeout(1000);
    
    await this.takeScreenshot('09_scrolled_down');
    
    const reportSelectors = [
      `#ClinicalTasksTable strong:has-text("${reportName}")`,
      `table#ClinicalTasksTable strong:has-text("${reportName}")`,
      `.ClinicalTasksTable strong:has-text("${reportName}")`,
      `strong:has-text("${reportName}")`,
      `#ClinicalTasksTable a:has-text("${reportName}")`,
      `table#ClinicalTasksTable a:has-text("${reportName}")`,
      `text="${reportName}"`,
      `a:has-text("${reportName}")`
    ];
    
    let reportClicked = false;
    for (const selector of reportSelectors) {
      try {
        this.log('info', `   Trying selector: ${selector}`);
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found "${reportName}" with selector: ${selector}`);
            await element.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            
            const tagName = await element.evaluate(el => el.tagName);
            if (tagName === 'STRONG') {
              this.log('info', '   Found <strong> tag, looking for parent link...');
              const parentLink = await element.evaluateHandle(el => el.closest('a'));
              if (parentLink) {
                await parentLink.click();
                this.log('success', `✅ Clicked parent link of "${reportName}"`);
              } else {
                await element.click();
                this.log('success', `✅ Clicked "${reportName}"`);
              }
            } else {
              await this.page.click(selector);
              this.log('success', `✅ Clicked "${reportName}"`);
            }
            reportClicked = true;
            break;
          } else {
            this.log('info', `   Element found but not visible`);
          }
        } else {
          this.log('info', `   Element not found with this selector`);
        }
      } catch (e) {
        this.log('info', `   Error with selector: ${e.message}`);
      }
    }
    
    if (!reportClicked) {
      this.log('error', `❌ Could not find "${reportName}"`);
      await this.takeScreenshot(`ERROR_${reportName.replace(/\s+/g, '_')}_not_found`);
      throw new Error(`"${reportName}" not found`);
    }
    
    await this.takeScreenshot(`10_${reportName.replace(/\s+/g, '_')}_clicked`);
    
    this.log('info', `⏳ Waiting for "${reportName}" page to load...`);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(5000);
    
    await this.takeScreenshot(`11_${reportName.replace(/\s+/g, '_')}_page_loaded`);
    this.log('success', `✅ "${reportName}" page loaded!`);
    this.log('info', `📍 Current URL: ${this.page.url()}`);
    
    return await this.downloadExcel(reportName);
  }

  async downloadExcel(reportName) {
    this.log('info', '📥 Looking for Excel download button...');
    
    const excelSelectors = [
      'text="To Excel"',
      'button:has-text("Excel")',
      'a:has-text("Excel")',
      'text="Export to Excel"',
      'text="Download Excel"',
      '[title*="Excel"]',
      'img[alt*="Excel"]',
      'button:has-text("Export")',
      'a:has-text("Export")'
    ];
    
    let excelClicked = false;
    for (const selector of excelSelectors) {
      try {
        this.log('info', `   Trying selector: ${selector}`);
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found Excel button with selector: ${selector}`);
            
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
        }
      } catch (e) {
        this.log('info', `   Error: ${e.message}`);
      }
    }
    
    if (!excelClicked) {
      this.log('error', '❌ Could not find Excel download button');
      await this.takeScreenshot('ERROR_excel_button_not_found');
      throw new Error('Excel download button not found');
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
      await this.initialize();
      await this.login();
      
      const allResults = [];
      
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
          const filepath = await this.downloadReport('Past Due Visits');
          
          this.log('success', `✅ Completed for ${swapUser}`);
          
          allResults.push({ 
            reportName: 'Past Due Visits', 
            swapUser: swapUser,
            success: true,
            filepath: filepath,
            date: new Date().toISOString().split('T')[0]
          });
          
          // Navigate back to inbox for next user
          this.log('info', '🏠 Returning to inbox page...');
          await this.page.goto('https://kinnser.net/AM/Message/inbox.cfm', { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(3000);
          this.log('success', '✅ Back at inbox, ready for next user');
          
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
      this.log('info', `📊 Processed ${allResults.length} users`);
      
      return allResults;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
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
      await this.takeScreenshot('ERROR_swapUser_not_found');
      throw new Error('swapUser dropdown not found');
    }
    
    await this.page.waitForTimeout(2000);
    await this.takeScreenshot(`swapUser_${swapUser}_selected`);
  }
}

export default KinnserReportDownloader;

