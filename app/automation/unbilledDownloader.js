import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
    
    // All offices to process (using "All Branches" to get combined data)
    this.processAllBranches = true;
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
      headless: true,  // Production mode
      timeout: 60000,
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
      
      window.navigator.chrome = {
        runtime: {},
      };
      
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

  async navigateToUnbilledReport() {
    this.log('info', '📊 Looking for "Managed Care Unbilled Report" link...');
    
    try {
      await this.page.waitForSelector('#managed-care-unbilled-report-link', { state: 'attached', timeout: 15000 });
      
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
    
    try {
      await this.page.waitForSelector('.loading-message, .loading', { state: 'hidden', timeout: 30000 });
      this.log('info', '   Loading completed');
    } catch (e) {
      this.log('info', '   No loading indicator found');
    }
    
    await this.page.waitForTimeout(2000);
    this.log('success', '✅ Report page loaded');
  }

  async extractReportSummary() {
    this.log('info', '📊 Extracting report summary...');
    
    // Select all filters
    this.log('info', '🏢 Selecting all Branches...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Branch_btn_select_all');
        if (btn) btn.click();
      });
      await this.page.waitForTimeout(1500);
      this.log('success', '✅ Selected all Branches');
    } catch (e) {
      this.log('info', `   Branch filter: ${e.message}`);
    }
    
    this.log('info', '💳 Selecting all Payer Types...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Payer_Type_btn_select_all');
        if (btn) btn.click();
      });
      await this.page.waitForTimeout(1500);
      this.log('success', '✅ Selected all Payer Types');
    } catch (e) {
      this.log('info', `   Payer Type filter: ${e.message}`);
    }
    
    this.log('info', '🏥 Selecting all Insurances...');
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('#filter_Insurance_btn_select_all');
        if (btn) btn.click();
      });
      await this.page.waitForTimeout(2000);
      this.log('success', '✅ Selected all Insurances');
    } catch (e) {
      this.log('info', `   Insurance filter: ${e.message}`);
    }
    
    // Click Apply Filters
    this.log('info', '🔍 Clicking Apply Filters...');
    try {
      await this.page.click('#aggrid_btnfetch1', { timeout: 10000 });
      this.log('success', '✅ Clicked Apply Filters');
    } catch (e) {
      this.log('error', `❌ Failed to click Apply Filters: ${e.message}`);
      throw new Error('Apply Filters button not found');
    }
    
    this.log('info', '⏳ Waiting for summary to load...');
    await this.page.waitForTimeout(5000);
    
    // Wait for loading indicator to disappear
    try {
      await this.page.waitForSelector('.loading-message, .loading', { 
        state: 'hidden', 
        timeout: 60000 
      });
      this.log('info', '   Summary loaded');
    } catch (e) {
      this.log('info', '   Loading check: ' + e.message);
    }
    
    await this.page.waitForTimeout(3000);
    
    // Extract the Report Summary data
    const summaryData = await this.page.evaluate(() => {
      const data = {
        totalUnbilled: '0',
        totalCharges: '0',
        totalVisits: '0',
        byPayerType: {},
        agingSummary: {}
      };
      
      try {
        // Get all text content from the page
        const bodyText = document.body.textContent || '';
        
        // Extract Total Unbilled - look for pattern like "$230.00" after "Total Unbilled"
        const unbilledMatch = bodyText.match(/Total\s+Unbilled[:\s]*\$?([\d,]+\.?\d*)/i);
        if (unbilledMatch) data.totalUnbilled = unbilledMatch[1].replace(/,/g, '');
        
        // Extract Total Charges
        const chargesMatch = bodyText.match(/Total\s+Charges[:\s]*\$?([\d,]+\.?\d*)/i);
        if (chargesMatch) data.totalCharges = chargesMatch[1].replace(/,/g, '');
        
        // Extract Total Visits
        const visitsMatch = bodyText.match(/Total\s+Visits[:\s]*([\d,]+)/i);
        if (visitsMatch) data.totalVisits = visitsMatch[1].replace(/,/g, '');
        
        // Extract Payer Type data
        const payerSection = bodyText.match(/Total\s+Unbilled\s+By\s+Payer\s+Type([\s\S]*?)Aging\s+Summary/i);
        if (payerSection) {
          const payerText = payerSection[1];
          // Match patterns like "Medicare (HMO/Per Visit)$230.00"
          const payerMatches = payerText.matchAll(/([A-Za-z\s\(\)\/\-]+?)\$?([\d,]+\.?\d*)/g);
          for (const match of payerMatches) {
            const payerName = match[1].trim();
            const amount = match[2].replace(/,/g, '');
            if (payerName && amount && parseFloat(amount) > 0) {
              data.byPayerType[payerName] = amount;
            }
          }
        }
        
        // Extract Aging Summary
        const agingBuckets = ['0-30', '31-60', '61-90', '91-120', '121-150', '151-180', '181-210', '211-240', '241+'];
        const agingSection = bodyText.match(/Aging\s+Summary([\s\S]*?)$/i);
        if (agingSection) {
          const agingText = agingSection[1];
          agingBuckets.forEach(bucket => {
            const regex = new RegExp(bucket.replace('+', '\\+') + '[:\\s]*\\$?([\\d,]+\\.?\\d*)', 'i');
            const match = agingText.match(regex);
            if (match) {
              data.agingSummary[bucket] = match[1].replace(/,/g, '');
            }
          });
        }
        
      } catch (e) {
        console.error('Error extracting summary:', e);
      }
      
      return data;
    });
    
    this.log('success', `✅ Extracted summary: $${summaryData.totalUnbilled} unbilled, ${summaryData.totalVisits} visits`);
    
    const date = new Date().toISOString().split('T')[0];
    return {
      date: date,
      ...summaryData
    };
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
      await this.navigateToBillingManager();
      await this.navigateToUnbilledReport();
      
      // Extract summary data (all branches combined)
      const summaryData = await this.extractReportSummary();
      
      this.log('success', '🎉 Unbilled Report extraction completed!');
      return summaryData;
    } catch (error) {
      this.log('error', `❌ Error: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }
}

export default UnbilledReportDownloader;
