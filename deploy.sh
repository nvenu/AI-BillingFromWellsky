#!/bin/bash

# Deployment script for Kinnser Billing Automation
# This script ensures clean deployment with no duplicate processes

set -e  # Exit on any error

echo "=========================================="
echo "Kinnser Billing Automation - Deployment"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Pull latest code
echo -e "${YELLOW}[1/6] Pulling latest code from git...${NC}"
git pull
echo -e "${GREEN}✓ Code updated${NC}"
echo ""

# Step 2: Clean old build
echo -e "${YELLOW}[2/6] Cleaning old build...${NC}"
rm -rf dist
echo -e "${GREEN}✓ Old build removed${NC}"
echo ""

# Step 3: Build new code
echo -e "${YELLOW}[3/6] Building TypeScript code...${NC}"
npm run build
echo -e "${GREEN}✓ Build completed${NC}"
echo ""

# Step 4: Stop all PM2 processes for this app
echo -e "${YELLOW}[4/6] Stopping existing PM2 processes...${NC}"
sudo -u ubuntu pm2 delete kinnser-billing-automation 2>/dev/null || echo "No existing process found"
echo -e "${GREEN}✓ Old processes stopped${NC}"
echo ""

# Step 5: Start fresh PM2 process
echo -e "${YELLOW}[5/6] Starting application with PM2...${NC}"
sudo -u ubuntu pm2 start ecosystem.config.js
sudo -u ubuntu pm2 save
echo -e "${GREEN}✓ Application started${NC}"
echo ""

# Step 6: Show status and logs
echo -e "${YELLOW}[6/6] Checking application status...${NC}"
sudo -u ubuntu pm2 list
echo ""
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo ""
echo "View logs with: sudo -u ubuntu pm2 logs kinnser-billing-automation"
echo "Check status with: sudo -u ubuntu pm2 list"
echo ""
