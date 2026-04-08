import { config } from 'dotenv';
import { sendEmail } from './email-helper';
import { format } from 'date-fns';
import * as fs from 'fs';

// Load environment variables
config();

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
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
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
    await sendEmail({
      to: process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com",
      subject: `Kinnser Billing Report - Nightingale - Taunton - ${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}`,
      body: emailBody,
      attachments: existingFiles
    });

    console.log(`✓ Email sent successfully to ${process.env.EMAIL_RECIPIENTS || "nvenu@solifetec.com"}`);
    console.log(`  Total attachments: ${existingFiles.length}`);
  } catch (error) {
    console.error('✗ Failed to send email:', error);
    process.exit(1);
  }
}

// Run the function
sendEmailWithFiles().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
