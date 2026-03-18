# Quick Start - Deploy with GitHub

## 🚀 Deploy to billingfromwellsky.solifetec.com in 10 Steps

---

## Local Machine (Steps 1-3)

### 1️⃣ Push to GitHub
```bash
cd /path/to/AI-BillingFromWellsky

# Initialize and commit (if not done)
git init
git add .
git commit -m "Initial commit"

# Add remote and push (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/kinnser-billing-automation.git
git branch -M main
git push -u origin main
```

### 2️⃣ Verify .gitignore
```bash
# Make sure these are NOT pushed to GitHub:
cat .gitignore
```
Should include: `.env`, `node_modules/`, `dist/`, `downloads/`, `*.pdf`, `*.xlsx`

### 3️⃣ Create GitHub Personal Access Token (for private repo)
1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` (full control)
4. Copy the token (save it securely)

---

## Server (Steps 4-10)

### 4️⃣ SSH into Server
```bash
ssh user@your-server-ip
```

### 5️⃣ Clone Repository
```bash
sudo mkdir -p /var/www/kinnser-billing
sudo chown $USER:$USER /var/www/kinnser-billing
cd /var/www

# Clone (use your token as password if private repo)
git clone https://github.com/YOUR_USERNAME/kinnser-billing-automation.git kinnser-billing
cd kinnser-billing
```

### 6️⃣ Install & Build
```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
npm run build
mkdir -p logs downloads
```

### 7️⃣ Create .env File
```bash
nano .env
```
Add:
```env
KINNSER_USER=your_kinnser_username
KINNSER_PASS=your_kinnser_password
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your_email@solifetec.com
SMTP_PASS=your_email_password
PORT=8080
NODE_ENV=production
```
Save and secure:
```bash
chmod 600 .env
```

### 8️⃣ Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/billingfromwellsky.solifetec.com
```
Paste:
```nginx
server {
    listen 80;
    server_name billingfromwellsky.solifetec.com;
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
    client_max_body_size 50M;
}
```
Enable:
```bash
sudo ln -s /etc/nginx/sites-available/billingfromwellsky.solifetec.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 9️⃣ Setup SSL & DNS
```bash
# SSL
sudo certbot --nginx -d billingfromwellsky.solifetec.com

# DNS: Add A record in your DNS provider
# Name: billingfromwellsky
# Value: [Same IP as helperfunction.solifetec.com]
```

### 🔟 Start Application
```bash
cd /var/www/kinnser-billing
pm2 start ecosystem.config.js
pm2 save
pm2 logs kinnser-billing-automation
```

---

## ✅ Verify

### Test:
```bash
curl http://localhost:8080/health
```

### Access:
- Main: https://billingfromwellsky.solifetec.com
- Test: https://billingfromwellsky.solifetec.com/test-pdf.html

---

## 🔄 Update Later

### Local:
```bash
git add .
git commit -m "Update description"
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

## 🆘 Quick Troubleshooting

```bash
# Check status
pm2 status

# View logs
pm2 logs kinnser-billing-automation

# Restart
pm2 restart kinnser-billing-automation

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check port
sudo lsof -i :8080
```

---

## 📚 Full Documentation

- **DEPLOY-WITH-GITHUB.md** - Complete GitHub deployment guide
- **DEPLOY-CHECKLIST-EXISTING-SERVER.txt** - Detailed checklist
- **DEPLOYMENT-SUMMARY.md** - Quick reference

---

**Done!** 🎉

Your application should now be running at:
**https://billingfromwellsky.solifetec.com**
