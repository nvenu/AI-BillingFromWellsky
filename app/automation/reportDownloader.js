import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REPORTS = [
  'Past Due Visits'
  // Add more reports after this one works:
  // 'Pending Authorizations',
  // 'Missing Documentation',
  // 'Incomplete Visits',
  // 'Billing Summary',
  // 'Patient Census'
];

class KinnserReportDownloader {
  constructor(io = null) {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    this.dataDir = path.join(__dirname, '..', 'data');
    this.browser = null;
    this.page = null;
    this.io = io;
  }

  log(type, message) {
    console.log(`[${type}] ${message}`);
    if (this.io) {
      this.io.emit('log', { type, message, timestamp: new Date().toISOString() });
    }
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    
    // Create screenshots directory
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
    try {
      const filename = `${name.replace(/\s+/g, '_')}_${Date.now()}.png`;
      const filepath = path.join(this.screenshotDir, filename);
      await this.page.screenshot({ path: filepath, fullPage: false });
      this.log('info', `📸 Screenshot saved: /screenshots/${filename}`);
      return `/screenshots/${filename}`;
    } catch (error) {
      this.log('error', `Failed to take screenshot: ${error.message}`);
      return null;
    }
  }

  async inspectPage() {
    try {
      const url = this.page.url();
      const title = await this.page.title();
      
      this.log('info', `📄 Page Title: "${title}"`);
      this.log('info', `🔗 URL: ${url}`);
      
      // List visible buttons
      const buttons = await this.page.$$eval('button, input[type="submit"], a.button, [role="button"]', 
        elements => elements.slice(0, 10).map(el => ({
          text: el.textContent?.trim() || el.value || el.getAttribute('aria-label') || 'No text',
          tag: el.tagName,
          type: el.type,
          id: el.id,
          class: el.className
        }))
      );
      
      if (buttons.length > 0) {
        this.log('info', `🔘 Found ${buttons.length} clickable elements:`);
        buttons.forEach((btn, i) => {
          this.log('info', `   ${i + 1}. "${btn.text}" (${btn.tag}${btn.id ? '#' + btn.id : ''})`);
        });
      }
      
      // List visible links
      const links = await this.page.$$eval('a', 
        elements => elements.slice(0, 10).map(el => ({
          text: el.textContent?.trim() || 'No text',
          href: el.href
        })).filter(l => l.text && l.text.length < 50)
      );
      
      if (links.length > 0) {
        this.log('info', `🔗 Found ${links.length} links:`);
        links.forEach((link, i) => {
          this.log('info', `   ${i + 1}. "${link.text}"`);
        });
      }
    } catch (error) {
      this.log('error', `Failed to inspect page: ${error.message}`);
    }
  }

  async login() {
    this.log('info', '🔐 Logging into Kinnser...');
    this.log('info', `📍 Navigating to https://kinnser.net/login.cfm`);
    await this.page.goto('https://kinnser.net/login.cfm', { waitUntil: 'networkidle' });
    
    await this.takeScreenshot('01_login_page');
    await this.inspectPage();
    
    this.log('info', '⌨️  Filling username in appropriate text box...');
    // Try to find username field
    const usernameSelectors = [
      'input[name="username"]',
      'input[id="username"]',
      'input[type="text"]',
      'input[placeholder*="username" i]',
      'input[placeholder*="user" i]'
    ];
    
    let usernameFilled = false;
    for (const selector of usernameSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await this.page.fill(selector, this.username);
          this.log('info', `✅ Filled username with selector: ${selector}`);
          usernameFilled = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!usernameFilled) {
      this.log('error', '❌ Could not find username field!');
      await this.takeScreenshot('ERROR_username_field_not_found');
      throw new Error('Username field not found');
    }
    
    this.log('info', '🔑 Filling password in appropriate text box...');
    // Try to find password field
    const passwordSelectors = [
      'input[name="password"]',
      'input[id="password"]',
      'input[type="password"]',
      'input[placeholder*="password" i]'
    ];
    
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await this.page.fill(selector, this.password);
          this.log('info', `✅ Filled password with selector: ${selector}`);
          passwordFilled = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!passwordFilled) {
      this.log('error', '❌ Could not find password field!');
      await this.takeScreenshot('ERROR_password_field_not_found');
      throw new Error('Password field not found');
    }
    
    await this.takeScreenshot('02_credentials_filled');
    
    this.log('info', '👆 Looking for "Log In" button...');
    
    // Try multiple selectors for "Log In" button - prioritize the ID we found
    const loginSelectors = [
      '#login_btn',  // Specific ID from the logs
      'button#login_btn',
      'button:has-text("Log in")',  // Note: lowercase "in"
      'button:has-text("Log In")',
      'input[value="Log In"]',
      'button:has-text("Login")',
      'input[value="Login"]',
      'text="Log in"',
      'text="Log In"',
      'text="Login"',
      'button[type="submit"]',
      'input[type="submit"]',
      '[aria-label*="Log In"]',
      '[aria-label*="Login"]'
    ];
    
    let loginClicked = false;
    for (const selector of loginSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            this.log('info', `✅ Found "Log In" button with selector: ${selector}`);
            await this.page.click(selector);
            this.log('success', '✅ Clicked "Log In" button');
            loginClicked = true;
            break;
          }
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!loginClicked) {
      this.log('error', '❌ Could not find "Log In" button!');
      await this.takeScreenshot('ERROR_login_button_not_found');
      throw new Error('"Log In" button not found');
    }
    
    this.log('info', '⏳ Waiting 10 seconds for popup to appear...');
    await this.page.waitForTimeout(10000); // Wait 10 seconds for popup
    await this.takeScreenshot('03_after_login_click');
    
    // Handle popup - wait for it and click OK
    this.log('info', '🔍 Looking for popup OK button...');
    await this.handlePopup();
    
    this.log('info', '⏳ Waiting for new page to stabilize...');
    await this.page.waitForLoadState('networkidle');
    
    await this.takeScreenshot('04_new_page_loaded');
    await this.inspectPage();
    
    this.log('success', '✅ Login successful and new page loaded!');
    this.log('info', `📍 Current URL: ${this.page.url()}`);
  }

  async handlePopup() {
    try {
      // Wait a bit for popup to appear
      this.log('info', '⏳ Waiting for popup to appear...');
      await this.page.waitForTimeout(2000);
      
      // Try to find and click OK button in popup
      const okSelectors = [
        'button:has-text("OK")',
        'button:has-text("Ok")',
        'input[value="OK"]',
        'input[value="Ok"]',
        'text="OK"',
        'text="Ok"',
        '[role="button"]:has-text("OK")',
        '.modal button:has-text("OK")',
        '.popup button:has-text("OK")',
        '.dialog button:has-text("OK")',
        '[class*="modal"] button',
        '[class*="popup"] button',
        '[class*="dialog"] button'
      ];
      
      let okClicked = false;
      for (const selector of okSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              this.log('info', `✅ Found popup OK button with selector: ${selector}`);
              await this.page.click(selector);
              this.log('success', '✅ Clicked OK on popup');
              okClicked = true;
              break;
            }
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      if (okClicked) {
        await this.takeScreenshot('03b_popup_dismissed');
        this.log('info', '⏳ Waiting 15 seconds for new page to load...');
        await this.page.waitForTimeout(15000); // Wait 15 seconds
        this.log('success', '✅ 15 second wait complete');
      } else {
        this.log('info', '💡 No visible popup found - may have auto-dismissed');
      }
    } catch (error) {
      this.log('info', `💡 Popup handling: ${error.message}`);
    }
  }

  async navigateToReports() {
    this.log('info', '📂 Navigating to Reports section...');
    
    await this.takeScreenshot('05_before_goto_click');
    await this.inspectPage();
    
    this.log('info', '👆 Looking for "Go To" button/dropdown...');
    
    // Try multiple selectors for "Go To" - including dropdown variations
    const gotoSelectors = [
      'text="Go To"',
      'text=/^Go To$/i',
      'button:has-text("Go To")',
      'a:has-text("Go To")',
      'select:has-text("Go To")',
      '[aria-label*="Go To"]',
      '[title*="Go To"]',
      'span:has-text("Go To")',
      'div:has-text("Go To")',
      '.goto',
      '#goto',
      '[class*="goto"]',
      '[id*="goto"]'
    ];
    
    let gotoClicked = false;
    for (const selector of gotoSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          this.log('info', `✅ Found "Go To" with selector: ${selector}`);
          
          // Check if it's a select/dropdown
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          this.log('info', `   Element type: ${tagName}`);
          
          if (tagName === 'select') {
            // It's a dropdown - we'll handle it differently
            this.log('info', '   This is a dropdown/select element');
            await this.page.click(selector);
          } else {
            await this.page.click(selector);
          }
          
          gotoClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!gotoClicked) {
      this.log('error', '❌ Could not find "Go To" button!');
      this.log('info', '💡 Trying to find any element containing "Go"...');
      
      // Last resort - find anything with "Go" in it
      try {
        const allElements = await this.page.$$eval('button, a, select, span, div', 
          elements => elements.map(el => ({
            text: el.textContent?.trim(),
            tag: el.tagName,
            id: el.id,
            class: el.className
          })).filter(el => el.text && el.text.toLowerCase().includes('go'))
        );
        
        this.log('info', `Found ${allElements.length} elements containing "go":`);
        allElements.slice(0, 5).forEach((el, i) => {
          this.log('info', `   ${i + 1}. "${el.text}" (${el.tag})`);
        });
      } catch (e) {
        // Ignore
      }
      
      await this.takeScreenshot('ERROR_goto_not_found');
      throw new Error('"Go To" button not found');
    }
    
    await this.page.waitForTimeout(1500);
    await this.takeScreenshot('06_goto_menu_opened');
    await this.inspectPage();
    
    this.log('info', '👆 Looking for Reports option...');
    
    // Try multiple selectors for Reports
    const reportSelectors = [
      'text="Reports"',
      'text=/^Reports$/i',
      'a:has-text("Reports")',
      'button:has-text("Reports")',
      'option:has-text("Reports")',
      'text="Reports / Admin"',
      'text="Reports/Admin"',
      'text="Admin"',
      '[href*="report"]',
      '[href*="Report"]',
      '[value*="report"]',
      'li:has-text("Reports")'
    ];
    
    let reportsClicked = false;
    for (const selector of reportSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          this.log('info', `✅ Found Reports with selector: ${selector}`);
          
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          this.log('info', `   Element type: ${tagName}`);
          
          if (tagName === 'option') {
            // It's a dropdown option - select it
            const value = await element.evaluate(el => el.value);
            await this.page.selectOption('select', value);
            this.log('info', `   Selected option with value: ${value}`);
          } else {
            await this.page.click(selector);
          }
          
          reportsClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!reportsClicked) {
      this.log('error', '❌ Could not find Reports link!');
      await this.takeScreenshot('ERROR_reports_not_found');
      throw new Error('Reports link not found');
    }
    
    await this.page.waitForLoadState('networkidle');
    await this.takeScreenshot('07_reports_page');
    await this.inspectPage();
    
    this.log('success', '✅ Reached Reports section');
  }

  async downloadReport(reportName) {
    this.log('info', `📊 Processing report: ${reportName}`);
    
    try {
      await this.takeScreenshot(`07_before_${reportName.replace(/\s+/g, '_')}`);
      
      this.log('info', `👆 Looking for "${reportName}"...`);
      
      // Try multiple selectors
      const reportSelectors = [
        `text=${reportName}`,
        `a:has-text("${reportName}")`,
        `button:has-text("${reportName}")`,
        `[title="${reportName}"]`
      ];
      
      let reportClicked = false;
      for (const selector of reportSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            this.log('info', `✅ Found report with selector: ${selector}`);
            await this.page.click(selector);
            reportClicked = true;
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      if (!reportClicked) {
        this.log('error', `❌ Could not find report: ${reportName}`);
        await this.takeScreenshot(`ERROR_${reportName.replace(/\s+/g, '_')}_not_found`);
        throw new Error(`Report "${reportName}" not found`);
      }
      
      await this.page.waitForLoadState('networkidle');
      await this.takeScreenshot(`08_${reportName.replace(/\s+/g, '_')}_opened`);
      await this.inspectPage();
      
      this.log('info', '⏳ Setting up download...');
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      this.log('info', '👆 Looking for Excel export button...');
      
      // Try multiple selectors for Excel button
      const excelSelectors = [
        'text="To Excel"',
        'button:has-text("Excel")',
        'a:has-text("Excel")',
        '[title*="Excel"]',
        'text="Export to Excel"',
        'text="Download Excel"'
      ];
      
      let excelClicked = false;
      for (const selector of excelSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            this.log('info', `✅ Found Excel button with selector: ${selector}`);
            await this.page.click(selector);
            excelClicked = true;
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      if (!excelClicked) {
        this.log('error', '❌ Could not find Excel export button!');
        await this.takeScreenshot(`ERROR_excel_button_not_found`);
        throw new Error('Excel export button not found');
      }
      
      this.log('info', '⬇️  Waiting for download...');
      const download = await downloadPromise;
      
      const date = new Date().toISOString().split('T')[0];
      const filename = `${reportName.replace(/\s+/g, '_')}_${date}.xlsx`;
      const filepath = path.join(this.dataDir, filename);
      
      this.log('info', `💾 Saving as: ${filename}`);
      await download.saveAs(filepath);
      this.log('success', `✅ Saved: ${filename}`);
      
      return { reportName, filepath, success: true };
    } catch (error) {
      this.log('error', `❌ Error downloading ${reportName}: ${error.message}`);
      await this.takeScreenshot(`ERROR_${reportName.replace(/\s+/g, '_')}_failed`);
      return { reportName, success: false, error: error.message };
    }
  }

  async downloadAllReports() {
    const results = [];
    this.log('info', `📋 Starting download of ${REPORTS.length} reports...`);
    
    for (let i = 0; i < REPORTS.length; i++) {
      const reportName = REPORTS[i];
      this.log('info', `\n--- Report ${i + 1}/${REPORTS.length} ---`);
      
      try {
        await this.navigateToReports();
        const result = await this.downloadReport(reportName);
        results.push(result);
        
        this.log('info', '⏸️  Waiting 2 seconds before next report...');
        await this.page.waitForTimeout(2000);
      } catch (error) {
        this.log('error', `❌ Failed: ${error.message}`);
        results.push({ reportName, success: false, error: error.message });
      }
    }
    
    return results;
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
      const results = await this.downloadAllReports();
      
      this.log('info', '\n=== 📊 Download Summary ===');
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      this.log('info', `✅ Successful: ${successful}`);
      this.log('info', `❌ Failed: ${failed}`);
      
      results.forEach(r => {
        const icon = r.success ? '✅' : '❌';
        this.log(r.success ? 'success' : 'error', `${icon} ${r.reportName}`);
      });
      
      this.log('success', '\n🎉 Download process complete!');
      
      return results;
    } catch (error) {
      this.log('error', `❌ Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const downloader = new KinnserReportDownloader(null);
  downloader.run()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default KinnserReportDownloader;
