# Quick Deployment Guide

## One-Command Deployment

After pushing code changes to git, run this single command on the server:

```bash
cd /var/www/html/AI-BillingFromWellsky/AI-BillingFromWellsky && bash deploy.sh
```

That's it! The script will:
1. Pull latest code from git
2. Clean old build files
3. Rebuild TypeScript
4. Stop any existing PM2 processes
5. Start fresh PM2 process with correct Node 18
6. Save PM2 configuration
7. Show status and logs

## What This Prevents

- ✅ No duplicate processes running
- ✅ No old compiled code in dist folder
- ✅ Always uses correct Node.js version (18.20.8)
- ✅ No port conflicts
- ✅ Clean restart every time

## Manual Steps (if needed)

If you need to do it manually:

```bash
cd /var/www/html/AI-BillingFromWellsky/AI-BillingFromWellsky
git pull
rm -rf dist
npm run build
sudo -u ubuntu pm2 delete kinnser-billing-automation
sudo -u ubuntu pm2 start ecosystem.config.js
sudo -u ubuntu pm2 save
sudo -u ubuntu pm2 logs kinnser-billing-automation --lines 10 --nostream
```

## Troubleshooting

### Check if app is running
```bash
sudo -u ubuntu pm2 list
```

### View logs
```bash
sudo -u ubuntu pm2 logs kinnser-billing-automation
```

### Check Node version being used
```bash
sudo -u ubuntu pm2 show kinnser-billing-automation | grep interpreter
```

### Check port 8080
```bash
sudo lsof -i :8080
```

## Important Files

- `ecosystem.config.js` - PM2 configuration (specifies Node 18 path)
- `tsconfig.json` - TypeScript compilation settings
- `deploy.sh` - Automated deployment script
- `.env` - Environment variables (not in git)

## Server Details

- Server Path: `/var/www/html/AI-BillingFromWellsky/AI-BillingFromWellsky`
- PM2 User: `ubuntu`
- Node Version: 18.20.8 (via nvm)
- Node Path: `/home/ubuntu/.nvm/versions/node/v18.20.8/bin/node`
- Port: 8080
- URL: https://billingfromwellsky.solifetec.com/billing
