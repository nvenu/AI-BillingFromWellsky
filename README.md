# Kinnser Billing Automation

Automated billing record processing for Kinnser.net - SOLT Healthcare

## Quick Start

### Local Testing

**Terminal 1 - Start AI-Billing:**
```bash
npm install
npm run build
npm start
```
Server runs on `http://localhost:8080`

**Terminal 2 - Start helperfunctions:**
```bash
cd /path/to/helperfunctions
npm start
```

**Browser:**
1. Visit your helperfunctions page
2. Click the Kinnser Billing button
3. Should open `http://localhost:8080`
4. Test the automation

**Important:** For local testing, update button URL in helperfunctions to `http://localhost:8080`

### Production Deployment

1. **Upload files to server:**
   ```bash
   scp -r *.ts *.js *.json *.xlsx .env user@server:/opt/kinnser-billing/
   ```

2. **On server:**
   ```bash
   cd /opt/kinnser-billing
   npm install
   npx playwright install chromium
   npm run build
   npm run pm2:start
   ```

3. **Configure Nginx** for subdomain `billing.helperfunctions.solifetec.com`:
   ```nginx
   server {
       listen 80;
       server_name billing.helperfunctions.solifetec.com;
       location / {
           proxy_pass http://localhost:8080;
       }
   }
   ```

4. **Add SSL:**
   ```bash
   sudo certbot --nginx -d billing.helperfunctions.solifetec.com
   ```

5. **Update button** in helperfunctions to production URL:
   ```html
   <a href="https://billing.helperfunctions.solifetec.com">
   ```

## Features

- ✅ Automated login to Kinnser.net
- ✅ Multi-office support (10 locations)
- ✅ Insurance validation from Excel rules
- ✅ Authorization validation
- ✅ Automatic record selection
- ✅ Excel report generation
- ✅ Email notifications
- ✅ Modern web interface

## Configuration

### Environment Variables (.env)

```env
KINNSER_USER=your_username
KINNSER_PASS=your_password
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your_email@solifetec.com
SMTP_PASS=your_password
```

### Insurance Rules

Edit `Insurance Instructions.xlsx` - only insurances with "No changes are required except for identical claims" will be processed.

## Commands

```bash
npm start              # Start server (development)
npm run build          # Build TypeScript
npm run prod           # Run production build
npm run pm2:start      # Start with PM2
npm run pm2:stop       # Stop PM2
npm run pm2:restart    # Restart PM2
npm run pm2:logs       # View logs
```

## Files

**Core Application:**
- `kinnser-billing-automation.ts` - Main automation
- `insurance-helper.ts` - Insurance validation
- `email-helper.ts` - Email functionality
- `office-config.ts` - Office configurations
- `server.ts` - Web server

**Configuration:**
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript config
- `ecosystem.config.js` - PM2 config
- `.env` - Credentials (not in git)

**Data:**
- `Insurance Instructions.xlsx` - Insurance rules

**Integration:**
- `button-code-snippet.html` - Button code for helperfunctions

## Offices Supported

1. Nightingale - Taunton (MA)
2. Aspire - Dublin (OH)
3. Aspire - San Diego (SD)
4. Aspire - Scottsdale (AZ)
5. Aspire - Yuba City (YC)
6. Nightingale - Las Vegas (NV)
7. Nightingale - Minnetonka (MN)
8. Nightingale - Pompano Beach (FL)
9. Nightingale - Stamford (CT)
10. Nightingale - Willowbrook (IL)

## How It Works

1. Login to Kinnser.net
2. Select office
3. Navigate to Billing Manager → Primary Payer → Ready
4. Select "All Insurances"
5. Validate insurance and authorization
6. Select valid records
7. Generate Excel report
8. Send email to nvenu@solifetec.com

## Troubleshooting

**Port 8080 in use:**
```bash
lsof -i :8080
kill -9 [PID]
```

**Module not found:**
```bash
rm -rf node_modules
npm install
```

**Playwright issues:**
```bash
npx playwright install chromium
```

**Email not sending:**
- Check SMTP credentials in `.env`
- If MFA enabled, create App Password
- Try `smtp.office365.com` instead

## Support

For issues, check the logs:
```bash
npm run pm2:logs
```

## License

ISC - SOLT Healthcare © 2026
