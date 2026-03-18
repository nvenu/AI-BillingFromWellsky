# Production Deployment Guide

## ✅ Local Testing Complete - Now Deploy to Production

### Step 1: Prepare Files for Upload

**Files to upload to server:**
```
Core Application:
- kinnser-billing-automation.ts
- insurance-helper.ts
- email-helper.ts
- office-config.ts
- server.ts

Configuration:
- package.json
- package-lock.json
- tsconfig.json
- ecosystem.config.js
- .env (with production credentials)

Data:
- Insurance Instructions.xlsx
```

### Step 2: Upload to Server

**Option A: Using SCP**
```bash
# From your local machine
cd /path/to/AI-Billing

# Upload all files
scp *.ts *.js *.json *.xlsx .env user@your-server:/opt/kinnser-billing/
```

**Option B: Using rsync**
```bash
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '*.xlsx' \
  ./ user@your-server:/opt/kinnser-billing/
```

**Option C: Using SFTP/FileZilla**
- Connect to your server
- Navigate to `/opt/kinnser-billing/`
- Upload all the files listed above

### Step 3: Install on Server

SSH into your server:
```bash
ssh user@your-server
cd /opt/kinnser-billing
```

Install dependencies:
```bash
npm install
npx playwright install chromium
```

Build the project:
```bash
npm run build
```

### Step 4: Configure Environment

Make sure `.env` has production credentials:
```bash
nano .env
```

Should contain:
```env
KINNSER_USER=rtyagi
KINNSER_PASS=Nghhc@123
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=nvenu@solifetec.com
SMTP_PASS=your_production_password
```

### Step 5: Start with PM2

```bash
# Start the application
npm run pm2:start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions shown
```

Verify it's running:
```bash
pm2 status
# Should show: kinnser-billing-automation | online

# Test locally on server
curl http://localhost:8080/health
# Should return: {"status":"ok",...}
```

### Step 6: Configure Nginx

Create Nginx configuration:
```bash
sudo nano /etc/nginx/sites-available/billing
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name billing.helperfunctions.solifetec.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Increase timeout for long-running automation
    location /run-automation {
        proxy_pass http://localhost:8080;
        proxy_read_timeout 600s;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/billing /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7: Add DNS Record

In your DNS provider (GoDaddy, Cloudflare, etc.):
```
Type: A
Name: billing
Value: [Your server IP address]
TTL: 3600
```

Wait a few minutes for DNS to propagate.

### Step 8: Add SSL Certificate

```bash
sudo certbot --nginx -d billing.helperfunctions.solifetec.com
```

Follow the prompts. Certbot will automatically configure SSL.

### Step 9: Update helperfunctions Button

In your helperfunctions `index.html`, change the button URL from local to production:

**Change from:**
```html
<a href="http://localhost:8080">
```

**To:**
```html
<a href="https://billing.helperfunctions.solifetec.com">
```

Deploy the updated helperfunctions to your server.

### Step 10: Test Production

1. **Visit helperfunctions:**
   ```
   https://helperfunctions.solifetec.com
   ```

2. **Click the Kinnser Billing button**
   - Should open: https://billing.helperfunctions.solifetec.com
   - Should show the billing interface

3. **Test one office:**
   - Click "Aspire - San Diego"
   - Wait for automation to complete
   - Verify results

4. **Check outputs:**
   - Excel file should be created on server
   - Email should be sent to nvenu@solifetec.com

## Verification Checklist

- [ ] Files uploaded to `/opt/kinnser-billing/`
- [ ] Dependencies installed (`npm install`)
- [ ] Playwright installed (`npx playwright install chromium`)
- [ ] Project built (`npm run build`)
- [ ] `.env` configured with production credentials
- [ ] PM2 started (`npm run pm2:start`)
- [ ] PM2 saved (`pm2 save`)
- [ ] Nginx configured
- [ ] DNS record added
- [ ] SSL certificate installed
- [ ] helperfunctions button updated to production URL
- [ ] Production test successful

## Monitoring

**View logs:**
```bash
pm2 logs kinnser-billing-automation
```

**Check status:**
```bash
pm2 status
```

**Restart if needed:**
```bash
pm run pm2:restart
```

**View generated files:**
```bash
cd /opt/kinnser-billing
ls -lt *.xlsx | head -5
```

## Troubleshooting

**Can't access billing.helperfunctions.solifetec.com:**
1. Check DNS: `nslookup billing.helperfunctions.solifetec.com`
2. Check Nginx: `sudo nginx -t`
3. Check PM2: `pm2 status`
4. Check firewall: `sudo ufw status`

**Automation not working:**
1. Check logs: `pm2 logs kinnser-billing-automation`
2. Check .env credentials
3. Test locally: `curl http://localhost:8080/health`

**Email not sending:**
1. Check SMTP credentials in `.env`
2. Check logs for email errors
3. Verify Office 365 allows SMTP

## Maintenance

**Update the application:**
```bash
cd /opt/kinnser-billing
# Upload new files
npm install
npm run build
npm run pm2:restart
```

**View logs:**
```bash
pm2 logs kinnser-billing-automation --lines 100
```

**Backup:**
```bash
# Backup .env and Excel file
cp .env .env.backup
cp "Insurance Instructions.xlsx" "Insurance Instructions.backup.xlsx"
```

## Security

- `.env` file permissions: `chmod 600 .env`
- Only allow necessary ports in firewall
- Keep Node.js and dependencies updated
- Regular backups of configuration files

## Support

If you encounter issues:
1. Check PM2 logs
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Verify all services are running
4. Test each component individually

## Summary

Once deployed:
- Billing automation: https://billing.helperfunctions.solifetec.com
- helperfunctions: https://helperfunctions.solifetec.com
- Button on helperfunctions opens billing automation
- Runs automatically, generates Excel, sends email
