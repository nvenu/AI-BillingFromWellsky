# Kinnser Billing Automation - Deployment Guide

## 🎯 Deployment Target
- **Domain**: billingfromwellsky.solifetec.com
- **Server**: Same as helperfunction.solifetec.com (Ubuntu)
- **Method**: GitHub
- **Port**: 8080 (internal, proxied by Nginx)

---

## 📚 Documentation Files

### 🚀 Quick Start (Start Here!)
1. **QUICK-START-GITHUB.md** ⭐ - 10 steps to deploy with GitHub

### 📖 Detailed Guides
2. **DEPLOY-WITH-GITHUB.md** - Complete GitHub deployment guide
3. **GITHUB-DEPLOY-CHECKLIST.txt** - Printable checklist

### ⚙️ Configuration Templates
4. **nginx.conf.template** - Nginx configuration template
5. **ecosystem.config.js** - PM2 configuration
6. **.env.example** - Environment variables template

---

## 🚀 Quick Deployment Steps

**1. Push to GitHub (Local)**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/kinnser-billing-automation.git
git push -u origin main
```

**2. Clone on Server**
```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/kinnser-billing-automation.git kinnser-billing
cd kinnser-billing
```

**3. Setup**
```bash
npm install
npx playwright install chromium
npm run build
nano .env  # Add credentials
chmod 600 .env
```

**4. Configure Nginx & SSL**
```bash
sudo nano /etc/nginx/sites-available/billingfromwellsky.solifetec.com
sudo ln -s /etc/nginx/sites-available/billingfromwellsky.solifetec.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d billingfromwellsky.solifetec.com
```

**5. Start**
```bash
pm2 start ecosystem.config.js
pm2 save
```

**Full guide**: See **QUICK-START-GITHUB.md**

---

## 🔐 Environment Variables

Create `.env` file on server with:

```env
# Kinnser Credentials
KINNSER_USER=your_kinnser_username
KINNSER_PASS=your_kinnser_password

# Email Configuration (Office 365)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your_email@solifetec.com
SMTP_PASS=your_email_password

# Server Configuration
PORT=8080
NODE_ENV=production
```

**Important**: Never commit `.env` to GitHub!

---

## 🌐 DNS Configuration

Add A record in your DNS provider:
- **Type**: A
- **Name**: billingfromwellsky
- **Value**: [Same IP as helperfunction.solifetec.com]
- **TTL**: Auto or 3600

---

## ✅ Verification

### 1. Health Check
```bash
curl http://localhost:8080/health
```

### 2. Web Interface
```
https://billingfromwellsky.solifetec.com
```

### 3. Test PDF Download
```
https://billingfromwellsky.solifetec.com/test-pdf.html
```

### 4. Monitor Logs
```bash
pm2 logs kinnser-billing-automation
```

---

## 🔄 Update Application

### Local Machine:
```bash
git add .
git commit -m "Description of changes"
git push origin main
```

### Server:
```bash
cd /var/www/kinnser-billing
git pull origin main
npm install && npm run build
pm2 restart kinnser-billing-automation
```

---

## 🔧 Common Commands

### PM2
```bash
pm2 status                              # Check status
pm2 logs kinnser-billing-automation     # View logs
pm2 restart kinnser-billing-automation  # Restart
pm2 stop kinnser-billing-automation     # Stop
pm2 monit                               # Monitor
```

### Application
```bash
cd /var/www/kinnser-billing
git pull origin main                    # Update code
npm install                             # Install dependencies
npm run build                           # Build
tail -f logs/combined.log               # View logs
```

### Nginx
```bash
sudo nginx -t                           # Test config
sudo systemctl reload nginx             # Reload
sudo tail -f /var/log/nginx/kinnser-billing-access.log
```

---

## 🎯 Application Features

### Complete Workflow
1. Process Ready tab → Select valid records
2. Create claims
3. Pending Approval → Fix duplicates (Type of Bill 327)
4. Approve claims
5. Ready To Send:
   - Electronic: Send electronically
   - Paper: Download PDFs (fully rendered)
6. Email all files to nvenu@solifetec.com

### Files Generated
- Ready Tab Excel (per office)
- Ready To Send Summary Excel (all records)
- Electronic Claims Excel
- Paper Claims PDFs

### Email Includes
- All Excel files
- All PDF files
- Detailed processing report

---

## 🆘 Troubleshooting

### Application won't start
```bash
pm2 logs kinnser-billing-automation --lines 50
cat .env  # Check credentials
sudo lsof -i :8080  # Check if port is in use
```

### Can't access from browser
```bash
sudo systemctl status nginx
pm2 status
nslookup billingfromwellsky.solifetec.com
```

### Git pull fails
```bash
git status
git pull origin main
# If conflicts: git reset --hard origin/main (careful!)
```

### Playwright issues
```bash
npx playwright install chromium
npx playwright install-deps chromium
```

---

## 📋 Deployment Checklist

- [ ] GitHub repository created (private recommended)
- [ ] Code pushed to GitHub
- [ ] .gitignore configured (excludes .env)
- [ ] Repository cloned on server
- [ ] Dependencies installed
- [ ] Playwright browsers installed
- [ ] Application built
- [ ] .env file created with credentials
- [ ] Nginx configured
- [ ] SSL certificate obtained
- [ ] DNS configured
- [ ] PM2 started
- [ ] Application accessible
- [ ] PDF download tested
- [ ] Email tested

---

## 📞 Support

### Documentation
1. **QUICK-START-GITHUB.md** - Start here! (10 steps)
2. **DEPLOY-WITH-GITHUB.md** - Detailed guide
3. **GITHUB-DEPLOY-CHECKLIST.txt** - Printable checklist

### Logs
```bash
pm2 logs kinnser-billing-automation
tail -f /var/www/kinnser-billing/logs/combined.log
sudo tail -f /var/log/nginx/kinnser-billing-error.log
```

---

## 🔑 Key Information

- **Repository**: https://github.com/YOUR_USERNAME/kinnser-billing-automation
- **Domain**: billingfromwellsky.solifetec.com
- **Server Path**: /var/www/kinnser-billing
- **PM2 Name**: kinnser-billing-automation
- **Port**: 8080 (internal)
- **Email**: nvenu@solifetec.com

---

**Ready to deploy?** Start with **QUICK-START-GITHUB.md** 🚀
