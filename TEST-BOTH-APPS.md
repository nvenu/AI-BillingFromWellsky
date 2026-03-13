# Testing Both Apps Together Locally

## Your Setup

```
helperfunctions.solifetec.com (Separate app with its own server)
  └── index.html (updated with button)
  └── Button links to → AI-Billing app

AI-Billing (This Kinnser automation app)
  └── Runs on its own server
  └── Serves the billing interface
```

## Local Testing Steps

### Step 1: Start AI-Billing Server

**Terminal 1:**
```bash
cd /path/to/AI-Billing
npm install
npm run build
npm start
```

Expected output:
```
Server running at http://localhost:8080
```

**Verify it works:**
- Open browser: http://localhost:8080
- You should see the Kinnser Billing Automation interface
- Leave this terminal running

### Step 2: Start helperfunctions Server

**Terminal 2:**
```bash
cd /path/to/helperfunctions
# Use whatever command starts your helperfunctions server
npm start
# or
node server.js
# or
python -m http.server 3000
# or whatever you use
```

Expected output:
```
Server running at http://localhost:3000
(or whatever port your helperfunctions uses)
```

### Step 3: Update Button URL for Local Testing

In your helperfunctions `index.html`, temporarily change the button URL:

**For Production (what you'll use when deployed):**
```html
<a href="https://billing.helperfunctions.solifetec.com">
  Kinnser Billing Automation
</a>
```

**For Local Testing (change to this temporarily):**
```html
<a href="http://localhost:8080">
  Kinnser Billing Automation
</a>
```

### Step 4: Test the Flow

1. **Open helperfunctions in browser:**
   ```
   http://localhost:3000
   (or whatever port your helperfunctions uses)
   ```

2. **Find your button** on the helperfunctions page

3. **Click the button**
   - Should open http://localhost:8080 in a new tab
   - Should show the Kinnser Billing Automation interface

4. **Test the billing automation:**
   - Click "Aspire - San Diego" button
   - Watch the automation run (2-3 minutes)
   - Verify results are displayed

## Testing Checklist

### helperfunctions App:
- [ ] Server starts successfully
- [ ] Page loads at http://localhost:3000 (or your port)
- [ ] Button is visible on the page
- [ ] Button has correct styling
- [ ] Button URL points to http://localhost:8080 (for local testing)

### AI-Billing App:
- [ ] Server starts successfully
- [ ] Page loads at http://localhost:8080
- [ ] All 10 office cards are displayed
- [ ] Interface looks correct

### Integration Test:
- [ ] Click button on helperfunctions page
- [ ] AI-Billing page opens in new tab
- [ ] Can click an office button
- [ ] Automation runs successfully
- [ ] Records are selected
- [ ] Excel file is created
- [ ] Results are displayed

## Visual Flow

```
┌─────────────────────────────────────┐
│  Terminal 1                         │
│  cd AI-Billing                      │
│  npm start                          │
│  → Running on http://localhost:8080 │
└─────────────────────────────────────┘
              ↑
              │ Button links to
              │
┌─────────────────────────────────────┐
│  Terminal 2                         │
│  cd helperfunctions                 │
│  npm start                          │
│  → Running on http://localhost:3000 │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Browser                            │
│  1. Visit http://localhost:3000     │
│  2. Click button                    │
│  3. Opens http://localhost:8080     │
│  4. Test billing automation         │
└─────────────────────────────────────┘
```

## Quick Test Commands

**Terminal 1 (AI-Billing):**
```bash
cd AI-Billing
npm start
```

**Terminal 2 (helperfunctions):**
```bash
cd helperfunctions
npm start  # or your start command
```

**Terminal 3 (Optional - Test health):**
```bash
# Test AI-Billing health
curl http://localhost:8080/health

# Test helperfunctions (if it has a health endpoint)
curl http://localhost:3000/health
```

## Common Issues

### Issue: Button doesn't open AI-Billing

**Check:**
1. Is AI-Billing server running? (Terminal 1)
2. Is button URL correct? (should be http://localhost:8080 for local testing)
3. Check browser console for errors

### Issue: Port already in use

**AI-Billing (port 8080):**
```bash
lsof -i :8080
kill -9 [PID]
# Or use different port
PORT=8081 npm start
```

**helperfunctions (port 3000):**
```bash
lsof -i :3000
kill -9 [PID]
# Or use different port in your server config
```

### Issue: CORS errors

If you see CORS errors in browser console, this is normal for local testing with different ports. It won't be an issue in production when both are on the same domain.

To fix for local testing, you can add CORS headers to AI-Billing server.ts (temporary, for testing only):

```typescript
// Add this to server.ts temporarily
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
```

## Before Deploying to Production

Once local testing is successful:

1. **Change button URL back to production:**
   ```html
   <!-- Change from -->
   <a href="http://localhost:8080">
   
   <!-- Back to -->
   <a href="https://billing.helperfunctions.solifetec.com">
   ```

2. **Remove CORS headers** (if you added them for testing)

3. **Deploy both apps** to your production server

## Production Deployment

After local testing works:

1. **Deploy AI-Billing** to `/opt/kinnser-billing/` on port 8080
2. **Configure Nginx** for subdomain billing.helperfunctions.solifetec.com
3. **Deploy helperfunctions** with the updated index.html
4. **Test production** - button should open billing.helperfunctions.solifetec.com

See **SIMPLE-BUTTON-SETUP.md** for production deployment steps.

## Example: If helperfunctions uses Python

If your helperfunctions is a Python app:

```bash
# Terminal 1 - AI-Billing
cd AI-Billing
npm start

# Terminal 2 - helperfunctions
cd helperfunctions
python app.py
# or
python -m http.server 3000
# or
flask run
```

## Example: If helperfunctions uses PHP

```bash
# Terminal 1 - AI-Billing
cd AI-Billing
npm start

# Terminal 2 - helperfunctions
cd helperfunctions
php -S localhost:3000
```

## Stop Both Servers

Press `Ctrl+C` in each terminal to stop the servers.

## Summary

1. Start AI-Billing on port 8080
2. Start helperfunctions on its port (e.g., 3000)
3. Update button URL to http://localhost:8080 for testing
4. Test the flow: helperfunctions → button → AI-Billing
5. Once working, deploy to production with production URLs
