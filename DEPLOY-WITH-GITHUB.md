# Deploy to billingfromwellsky.solifetec.com using GitHub

## Overview
Deploy Kinnser Billing Automation using GitHub repository
- **Domain**: billingfromwellsky.solifetec.com
- **Server**: Same as helperfunction.solifetec.com (Ubuntu)
- **Method**: Git clone/pull from GitHub
- **Port**: 8080 (internal, proxied by Nginx)

---

## 📋 Step 1: Prepare GitHub Repository (Local Machine)

### 1.1 Initialize Git (if not already done)
```bash
cd /path/to/AI-BillingFromWellsky

# Initialize git
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Kinnser Billing Automation"
```

### 1.2 Create GitHub Repository
1. Go to https://github.com
2. Click "New repository"
3. Name: `kinnser-billing-automation` (or your preferred name)
4. Choose: Private (recommended for security)
5. Don't initialize with README (we already have files)
6. Click "Create repository"

### 1.3 Push to GitHub
```bash
# Add remote (replace with your GitHub username/org)
git remote add origin https://github.com/YOUR_USERNAME/kinnser-billing-automation.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### 1.4 Verify .gitignore
Make sure sensitive files are NOT pushed:
```bash
# Check .gitignore includes:
cat .gitignore
```

Should include:
```
node_modules/
dist/
.env
*.log
logs/
downloads/
*.pdf
*.xlsx
.DS_Store
```

---

## 🖥️ Step 2: Clone Repository on Server

### 2.1 SSH into server
```bash
ssh user@your-server-ip
```

### 2.2 Install Git (if not already installed)
```bash
# Check if git is installed
git --version

# If not installed:
sudo apt update
sudo apt install git -y
```

### 2.3 Setup GitHub authentication

**Option A: Using Personal Access Token (Recommended for private repos)**
```bash
# Generate token at: https://github.com/settings/tokens
# Select scopes: repo (full control of private repositories)
# Copy the token (you'll use it as password when cloning)
```

**Option B: Using SSH Key**
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@solifetec.com"

# Copy public key
cat ~/.ssh/id_ed25519.pub

# Add to GitHub: Settings → SSH and GPG keys → New SSH key
```

### 2.4 Clone repository
```bash
# Create directory
sudo mkdir -p /var/www/kinnser-billing
sudo chown $USER:$USER /var/www/kinnser-billing

# Clone repository
cd /var/www
git clone https://github.com/YOUR_USERNAME/kinnser-billing-automation.git kinnser-billing

# Or with SSH:
# git clone git@github.com:YOUR_USERNAME/kinnser-billing-automation.git kinnser-billing

# Navigate to directory
cd kinnser-billing
```

---

## ⚙️ Step 3: Setup Application

### 3.1 Install dependencies
```bash
npm install
```

### 3.2 Install Playwright browsers
```bash
npx playwright install chromium
npx playwright install-deps chromium
```

### 3.3 Build application
```bash
npm run build
```

### 3.4 Create necessary directories
```bash
mkdir -p logs downloads
```

### 3.5 Create .env file
```bash
nano .env
```

Add your credentials:
```env
# Kinnser Credentials
KINNSER_USER=your_actual_kinnser_username
KINNSER_PASS=your_actual_kinnser_password

# Email Configuration (Office 365)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your_actual_email@solifetec.com
SMTP_PASS=your_actual_email_password

# Server Configuration
PORT=8080
NODE_ENV=production
```

Save (Ctrl+X, Y, Enter) and secure:
```bash
chmod 600 .env
```

---

## 🌐 Step 4: Configure Nginx

### 4.1 Create Nginx configuration
```bash
sudo nano /etc/nginx/sites-available/billingfromwellsky.solifetec.com
```

Paste this configuration:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name billingfromwellsky.solifetec.com;

    access_log /var/log/nginx/kinnser-billing-access.log;
    error_log /var/log/nginx/kinnser-billing-error.log;

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
        
        # Timeouts for long-running automation
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    client_max_body_size 50M;
}
```

### 4.2 Enable site
```bash
sudo ln -s /etc/nginx/sites-available/billingfromwellsky.solifetec.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔒 Step 5: Setup SSL Certificate

```bash
sudo certbot --nginx -d billingfromwellsky.solifetec.com
```

Follow prompts and choose to redirect HTTP to HTTPS.

---

## 🌍 Step 6: Configure DNS

In your DNS provider:

**Add A Record:**
- Type: `A`
- Name: `billingfromwellsky`
- Value: `[Same IP as helperfunction.solifetec.com]`
- TTL: `Auto` or `3600`

Wait 5-30 minutes for DNS propagation.

---

## ▶️ Step 7: Start Application with PM2

```bash
cd /var/www/kinnser-billing
pm2 start ecosystem.config.js
pm2 save
```

Verify:
```bash
pm2 status
pm2 logs kinnser-billing-automation
```

---

## ✅ Step 8: Verify Deployment

### Test locally:
```bash
curl http://localhost:8080/health
```

### Test from browser:
```
https://billingfromwellsky.solifetec.com
```

### Test PDF download:
```
https://billingfromwellsky.solifetec.com/test-pdf.html
```

---

## 🔄 Update Application (Future Updates)

### On Local Machine:
```bash
# Make changes to code
git add .
git commit -m "Description of changes"
git push origin main
```

### On Server:
```bash
cd /var/www/kinnser-billing

# Backup .env
cp .env .env.backup

# Pull latest changes
git pull origin main

# Restore .env (in case it was accidentally committed)
cp .env.backup .env

# Install any new dependencies
npm install

# Rebuild
npm run build

# Restart application
pm2 restart kinnser-billing-automation

# Check logs
pm2 logs kinnser-billing-automation
```

---

## 🔧 Useful Git Commands

### Check status
```bash
git status
git log --oneline -5
```

### Pull specific branch
```bash
git checkout main
git pull origin main
```

### Discard local changes (be careful!)
```bash
git reset --hard origin/main
```

### View remote URL
```bash
git remote -v
```

---

## 📚 Quick Reference

### Application Management
```bash
# Navigate to app
cd /var/www/kinnser-billing

# Pull updates
git pull origin main

# Install & build
npm install && npm run build

# Restart
pm2 restart kinnser-billing-automation

# View logs
pm2 logs kinnser-billing-automation
```

### PM2 Commands
```bash
pm2 status                              # Check status
pm2 logs kinnser-billing-automation     # View logs
pm2 restart kinnser-billing-automation  # Restart
pm2 stop kinnser-billing-automation     # Stop
pm2 monit                               # Monitor
```

### Nginx Commands
```bash
sudo nginx -t                           # Test config
sudo systemctl reload nginx             # Reload
sudo tail -f /var/log/nginx/kinnser-billing-access.log
```

---

## 🔐 Security Best Practices

### 1. Never commit .env file
```bash
# Verify .env is in .gitignore
cat .gitignore | grep .env
```

### 2. Use private repository
- Keep repository private on GitHub
- Only grant access to authorized team members

### 3. Use Personal Access Tokens
- Don't use your GitHub password
- Use tokens with minimal required permissions
- Rotate tokens regularly

### 4. Secure .env on server
```bash
chmod 600 .env
```

---

## 🆘 Troubleshooting

### Git pull fails
```bash
# Check remote
git remote -v

# Check branch
git branch

# Force pull (careful - overwrites local changes)
git fetch origin
git reset --hard origin/main
```

### Authentication issues
```bash
# Update remote URL with token
git remote set-url origin https://YOUR_TOKEN@github.com/YOUR_USERNAME/kinnser-billing-automation.git

# Or use SSH
git remote set-url origin git@github.com:YOUR_USERNAME/kinnser-billing-automation.git
```

### Application won't start after update
```bash
# Check logs
pm2 logs kinnser-billing-automation --lines 50

# Verify .env exists
ls -la .env

# Rebuild
npm install
npm run build
pm2 restart kinnser-billing-automation
```

---

## 📋 Deployment Checklist

- [ ] GitHub repository created (private)
- [ ] Code pushed to GitHub
- [ ] .gitignore configured (excludes .env, node_modules, etc.)
- [ ] Server has Git installed
- [ ] GitHub authentication configured (token or SSH)
- [ ] Repository cloned to /var/www/kinnser-billing
- [ ] Dependencies installed (npm install)
- [ ] Playwright browsers installed
- [ ] Application built (npm run build)
- [ ] .env file created with credentials
- [ ] Nginx configured
- [ ] SSL certificate obtained
- [ ] DNS configured
- [ ] PM2 started
- [ ] Application accessible via domain
- [ ] PDF download tested
- [ ] Email functionality tested

---

## 🎯 Advantages of GitHub Deployment

✅ Version control - Track all changes  
✅ Easy updates - Just `git pull`  
✅ Collaboration - Multiple developers can contribute  
✅ Rollback - Easy to revert to previous versions  
✅ Backup - Code is backed up on GitHub  
✅ CI/CD ready - Can add automated testing/deployment later  

---

**Repository**: https://github.com/YOUR_USERNAME/kinnser-billing-automation  
**Domain**: billingfromwellsky.solifetec.com  
**Server Path**: /var/www/kinnser-billing  
**PM2 Name**: kinnser-billing-automation
