# Production Deployment Checklist

## ✅ Code Configuration

- [x] **Headless mode enabled** - Browser runs in headless mode (no UI)
- [x] **Port 8080** - Server configured to run on port 8080
- [x] **Email always sent** - Email sent even when 0 records processed
- [x] **All 3 tabs processed** - Ready → Pending Approval → Ready To Send (always)
- [x] **Insurance dropdown fix** - Forces reload by selecting different option first
- [x] **Multi-column insurance UI** - Insurance selection displays in 2-3 columns
- [x] **Comprehensive logging** - Detailed console output for debugging
- [x] **Error handling** - Graceful error handling throughout

## 📋 Pre-Deployment Steps

### 1. Environment Variables
Ensure `.env` file exists on server with:
```bash
KINNSER_USER=your_actual_username
KINNSER_PASS=your_actual_password
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your_email@solifetec.com
SMTP_PASS=your_office365_password
EMAIL_RECIPIENTS=nvenu@solifetec.com, adua@HomeCareForYou.com, rtyagi@homecareforyou.com
```

### 2. Insurance Instructions File
- [x] `Insurance Instructions.xlsx` is included in the repository
- [x] File contains Location, Name, and Remarks columns
- [x] Insurances with "No changes are required except for identical claims" are processed electronically
- [x] Insurances with exactly "Paper" are processed as PDF downloads

### 3. Server Requirements
- Node.js 18+ installed
- PM2 installed globally: `npm install -g pm2`
- Nginx configured with SSL (Certbot)
- Playwright browsers installed: `npx playwright install chromium`

## 🚀 Deployment Commands

### On Server (billingfromwellsky.solifetec.com)

```bash
# 1. Navigate to project directory
cd /path/to/kinnser-billing-automation

# 2. Pull latest code from GitHub
git pull origin main

# 3. Install dependencies
npm install

# 4. Build TypeScript
npm run build

# 5. Restart PM2 application
pm2 restart kinnser-billing-automation

# 6. Check status
pm2 status
pm2 logs kinnser-billing-automation --lines 50

# 7. Save PM2 configuration
pm2 save
```

## 🔍 Post-Deployment Verification

### 1. Check Server Status
```bash
# Check if server is running
curl http://localhost:8080/health

# Should return:
# {"status":"ok","timestamp":"...","uptime":...,"version":"1.0.0"}
```

### 2. Check Web Interface
- Visit: https://billingfromwellsky.solifetec.com/billing
- Verify office buttons are displayed
- Click an office button
- Verify insurance selection modal opens
- Verify insurances display in 2-3 columns

### 3. Test Automation (Optional)
- Select a test office with known insurances
- Select specific insurances
- Click "Process Selected"
- Monitor console logs: `pm2 logs kinnser-billing-automation`
- Verify email is received (even if 0 records)

## 📊 Monitoring

### PM2 Commands
```bash
# View logs
pm2 logs kinnser-billing-automation

# View last 100 lines
pm2 logs kinnser-billing-automation --lines 100

# Monitor CPU/Memory
pm2 monit

# Restart if needed
pm2 restart kinnser-billing-automation

# Stop application
pm2 stop kinnser-billing-automation

# Start application
pm2 start kinnser-billing-automation
```

### Log Files
- Error logs: `./logs/err.log`
- Output logs: `./logs/out.log`
- Combined logs: `./logs/combined.log`

### Generated Files
- Action logs: `action-log-YYYY-MM-DD_HH-mm-ss.txt` and `.xlsx`
- Ready To Send summary: `ready-to-send-summary-YYYY-MM-DD_HH-mm-ss.xlsx`
- Electronic claims: `ready-to-send-electronic-YYYY-MM-DD_HH-mm-ss.xlsx`
- Paper claims: `downloads/paper-claim-INSURANCE-N-YYYY-MM-DD_HH-mm-ss.pdf`

## 🔐 Security Checklist

- [x] `.env` file not committed to Git (in `.gitignore`)
- [x] Credentials stored in environment variables only
- [x] HTTPS enabled via Nginx + Certbot
- [x] Server accessible only via domain (not direct IP)

## 📧 Email Configuration

### Recipients
- nvenu@solifetec.com
- adua@HomeCareForYou.com
- rtyagi@homecareforyou.com

### Email Scenarios
1. **Records processed**: Full report with attachments
2. **No records processed**: Email with "[NO RECORDS PROCESSED]" in subject

## 🐛 Troubleshooting

### Browser Issues
If Playwright browser fails:
```bash
# Reinstall Chromium
npx playwright install chromium

# Install system dependencies (Ubuntu/Debian)
npx playwright install-deps chromium
```

### Email Not Sending
- Check SMTP credentials in `.env`
- Verify Office 365 account allows SMTP
- Check if MFA requires App Password
- Review logs: `pm2 logs kinnser-billing-automation | grep -i email`

### Port Already in Use
```bash
# Find process using port 8080
lsof -i :8080

# Kill process if needed
kill -9 <PID>

# Restart PM2
pm2 restart kinnser-billing-automation
```

## 📝 Workflow Summary

### Ready Tab
1. Navigate to Billing Manager
2. Select "Ready" from Primary Payer dropdown
3. Select "All Insurances"
4. Process all pages, select valid records
5. Save to Excel (if records selected)
6. Click Create button (if records selected)

### Pending Approval Tab
1. Navigate to Pending Approval tab
2. Select "All Insurances" (force reload if needed)
3. Extract records with MRN and billing period
4. Check for duplicate MRNs with overlapping dates
5. Edit duplicates: Set Type of Bill to 327 (Adjustment Claim)
6. Select all records
7. Click Approve button

### Ready To Send Tab
1. Navigate to Ready To Send tab
2. Select "All Insurances" (force reload if needed)
3. Extract all records
4. Categorize by insurance type:
   - "No changes" → Electronic submission
   - "Paper" → PDF download
5. Create summary Excel
6. Process electronic claims: Select checkboxes, click "Send Electronically"
7. Process paper claims: Click print icon, download PDF for each
8. Collect all files for email

### Email
- Always sent (even with 0 records)
- Includes all Excel files and PDFs as attachments
- Clear summary of what was processed

## ✅ Production Ready!

All systems configured and ready for production deployment.
