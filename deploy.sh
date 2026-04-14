#!/bin/bash

# Kinnser Billing Automation - Production Deployment Script
# Run this on the server: billingfromwellsky.solifetec.com

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /var/www/kinnser-billing-automation || exit 1

# Pull latest code from GitHub
echo "📥 Pulling latest code..."
git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed! Aborting deployment."
    exit 1
fi

# Restart PM2 application
echo "🔄 Restarting PM2 application..."
pm2 restart kinnser-billing-automation

# Save PM2 configuration
pm2 save

# Show status
echo ""
echo "📊 Application Status:"
pm2 status kinnser-billing-automation

echo ""
echo "📝 Recent Logs:"
pm2 logs kinnser-billing-automation --lines 20 --nostream

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔍 To monitor logs: pm2 logs kinnser-billing-automation"
echo "🌐 Web interface: https://billingfromwellsky.solifetec.com/billing"
echo "💚 Health check: curl http://localhost:8080/health"
