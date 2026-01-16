import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const REPORTS = [
  'Past Due Visits',
  'Pending Authorizations',
  'Missing Documentation',
  'Incomplete Visits',
  'Billing Summary',
  'Patient Census'
];

class KinnserReportDownloader {
  constructor() {
    this.username = process.env.KINNSER_USERNAME;
    this.password = process.env.KINNSER_PASSWORD;
    this.dataDir = process.env.DATA_DIR || './data/reports';
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.browser = await chromium.launch({ 
      headless: true,
      timeout: 60000
    });
    this.page = await this.browser.newPage();
    
    // Set download path
    await this.page.context().setDefaultTimeout(30000);
  }

  async login() {
    console.log('Logging into Kinnser...');
    await this.page.goto('https://kinnser.net/login.cfm', { waitUntil: 'networkidle' });
    
    // Fill login form
    await this.page.fill('input[name="username"], input[type="text"]', this.username);
    await this.page.fill('input[name="password"], input[type="password"]', this.password);
    
    // Click login button
    await this.page.click('button[type="submit"], input[type="submit"]');
    
    // Wait for navigation after login
    await this.page.waitForLoadState('networkidle');
    console.log('Login successful');
  }

  async navigateToReports() {
    console.log('Navigating to Reports/Admin...');
    
    // Click Menu
    await this.page.click('text=Menu, a[href*="menu"], button:has-text("Menu")');
    await this.page.waitForTimeout(1000);
    
    // Click Reports / Admin
    await this.page.click('text=Reports, text=Admin, a:has-text("Reports")');
    await this.page.waitForLoadState('networkidle');
  }

  async downloadReport(reportName) {
    console.log(`Downloading report: ${reportName}`);
    
    try {
      // Click on the report
      await this.page.click(`text=${reportName}`);
      await this.page.waitForLoadState('networkidle');
      
      // Setup download listener
      const downloadPromise = this.page.waitForEvent('download');
      
      // Click "To Excel" button
      await this.page.click('text="To Excel", button:has-text("Excel"), a:has-text("Excel")');
      
      const download = await downloadPromise;
      
      // Generate filename with date
      const date = new Date().toISOString().split('T')[0];
      const filename = `${reportName.replace(/\s+/g, '_')}_${date}.xlsx`;
      const filepath = path.join(this.dataDir, filename);
      
      // Save the file
      await download.saveAs(filepath);
      console.log(`Saved: ${filename}`);
      
      return filepath;
    } catch (error) {
      console.error(`Error downloading ${reportName}:`, error.message);
      return null;
    }
  }

  async downloadAllReports() {
    const results = [];
    
    for (const reportName of REPORTS) {
      try {
        await this.navigateToReports();
        const filepath = await this.downloadReport(reportName);
        results.push({ reportName, filepath, success: !!filepath });
        
        // Wait between downloads
        await this.page.waitForTimeout(2000);
      } catch (error) {
        console.error(`Failed to download ${reportName}:`, error.message);
        results.push({ reportName, filepath: null, success: false, error: error.message });
      }
    }
    
    return results;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.login();
      const results = await this.downloadAllReports();
      
      console.log('\n=== Download Summary ===');
      results.forEach(r => {
        console.log(`${r.reportName}: ${r.success ? '✓' : '✗'}`);
      });
      
      return results;
    } catch (error) {
      console.error('Error in report downloader:', error);
      throw error;
    } finally {
      await this.close();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const downloader = new KinnserReportDownloader();
  downloader.run()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default KinnserReportDownloader;
