"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const email_helper_1 = require("./email-helper");
const date_fns_1 = require("date-fns");
const fs = __importStar(require("fs"));
// Load environment variables
(0, dotenv_1.config)();
async function sendEmailWithFiles() {
    // Files to attach
    const files = [
        'selected-records-MA-Nightingale___Taunton-2026-04-06_12-14-51.xlsx',
        'ready-to-send-summary-2026-04-06_12-16-28.xlsx',
        'ready-to-send-electronic-2026-04-06_12-17-51.xlsx'
    ];
    // Check if files exist
    const existingFiles = files.filter(f => fs.existsSync(f));
    const missingFiles = files.filter(f => !fs.existsSync(f));
    if (missingFiles.length > 0) {
        console.log(`⚠️  Warning: ${missingFiles.length} file(s) not found:`);
        missingFiles.forEach(f => console.log(`  - ${f}`));
    }
    if (existingFiles.length === 0) {
        console.error('✗ No files found to send!');
        process.exit(1);
    }
    console.log(`\n✓ Found ${existingFiles.length} file(s) to send:`);
    existingFiles.forEach(f => console.log(`  - ${f}`));
    // Email body
    const timestamp = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const emailBody = `
Kinnser Billing Automation Report
Generated: ${timestamp}

OFFICES PROCESSED: Nightingale - Taunton

READY TAB SUMMARY:
Nightingale - Taunton: 196 records selected

Total records selected from Ready tab: 196
Total offices processed: 1

TYPE OF BILL CHANGES (327 - Adjustment Claim):
No duplicate records found - no Type of Bill changes needed

WORKFLOW STATUS:
✓ Ready tab: 196 records selected and Create button clicked
✓ Pending Approval tab: Processed (duplicates fixed if found)
✓ Ready To Send tab: Records processed and submitted

ATTACHED FILES (${existingFiles.length} total):

1. Ready Tab Excel Files (1):
   - selected-records-MA-Nightingale___Taunton-2026-04-06_12-14-51.xlsx

2. Ready To Send Files (2):
   - Summary Excel: 1 file(s)
   - Electronic Claims Excel: Included if applicable
   - Paper Claims PDFs: 0 file(s)
   - ready-to-send-summary-2026-04-06_12-16-28.xlsx
   - ready-to-send-electronic-2026-04-06_12-17-51.xlsx

ACTIONS TAKEN:
✓ Electronic claims sent automatically
✓ Paper claims downloaded as PDFs
✓ All files attached to this email
  `;
    try {
        console.log('\n=== Sending Email ===');
        await (0, email_helper_1.sendEmail)({
            to: process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com",
            subject: `Kinnser Billing Report - Nightingale - Taunton - ${(0, date_fns_1.format)(new Date(), 'yyyy-MM-dd_HH-mm-ss')}`,
            body: emailBody,
            attachments: existingFiles
        });
        console.log(`✓ Email sent successfully to ${process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com"}`);
        console.log(`  Total attachments: ${existingFiles.length}`);
    }
    catch (error) {
        console.error('✗ Failed to send email:', error);
        process.exit(1);
    }
}
// Run the function
sendEmailWithFiles().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
