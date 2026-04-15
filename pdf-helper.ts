import { PDFParse } from 'pdf-parse';

/**
 * Extract date of admission from UB-04 claim form PDF
 * The date is in mmddyyyy format (e.g., 12052025 for December 5, 2025)
 */
export async function extractDateOfAdmission(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const text = result.text;
    
    console.log("  DEBUG: PDF text length:", text.length);
    
    // Look for date of admission patterns
    // UB-04 form typically has "Date of Admission" or similar label
    // The date is usually in mmddyyyy format
    
    // Pattern 1: Look for 8-digit date near "admission" keyword
    const admissionPattern = /admission[:\s]*(\d{8})/i;
    const match1 = text.match(admissionPattern);
    if (match1) {
      console.log(`  ✓ Found date of admission (pattern 1): ${match1[1]}`);
      return match1[1];
    }
    
    // Pattern 2: Look for "Statement Covers Period" which contains admission date
    // Format: "Statement Covers Period From: 12052025 Through: 12312025"
    const periodPattern = /statement\s+covers\s+period\s+from[:\s]*(\d{8})/i;
    const match2 = text.match(periodPattern);
    if (match2) {
      console.log(`  ✓ Found date of admission (pattern 2 - Statement Period): ${match2[1]}`);
      return match2[1];
    }
    
    // Pattern 3: Look for "From" date in the billing period section
    const fromPattern = /from[:\s]*(\d{8})/i;
    const match3 = text.match(fromPattern);
    if (match3) {
      console.log(`  ✓ Found date of admission (pattern 3 - From date): ${match3[1]}`);
      return match3[1];
    }
    
    // Pattern 4: Look for any 8-digit date that looks like mmddyyyy
    // This is a fallback - look for dates in valid range
    // Skip dates that are too old (before 2020) as they're likely birth dates
    const datePattern = /\b(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(20[2-9]\d)\b/g;
    const allDates = text.match(datePattern);
    if (allDates && allDates.length > 0) {
      console.log(`  ✓ Found potential admission date(s): ${allDates.join(', ')}`);
      // Return the first valid date found (should be admission date)
      return allDates[0];
    }
    
    console.log("  ⚠️  Could not find date of admission in PDF");
    console.log("  DEBUG: First 500 characters of PDF text:");
    console.log(text.substring(0, 500));
    
    return null;
  } catch (error) {
    console.error("  ✗ Error parsing PDF:", error);
    return null;
  }
}

/**
 * Calculate severity point based on date of admission and current date
 * Severity point increases every 60 days
 * - Days 1-60: Severity point 1
 * - Days 61-120: Severity point 2
 * - Days 121-180: Severity point 3
 * - And so on...
 */
export function calculateSeverityPoint(admissionDate: string): number {
  try {
    // Parse dates from mmddyyyy format
    const admMonth = parseInt(admissionDate.substring(0, 2));
    const admDay = parseInt(admissionDate.substring(2, 4));
    const admYear = parseInt(admissionDate.substring(4, 8));
    
    // Create Date objects
    const admission = new Date(admYear, admMonth - 1, admDay);
    const currentDate = new Date();
    
    // Calculate days difference
    const diffTime = currentDate.getTime() - admission.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    console.log(`  Date of Admission: ${admMonth}/${admDay}/${admYear}`);
    console.log(`  Current Date: ${currentDate.toLocaleDateString()}`);
    console.log(`  Days since admission: ${diffDays}`);
    
    // Calculate severity point using CEIL (1-60 days = 1, 61-120 = 2, etc.)
    const severityPoint = Math.ceil(diffDays / 60);
    
    console.log(`  ✓ Calculated Severity Point: ${severityPoint}`);
    
    return severityPoint;
  } catch (error) {
    console.error("  ✗ Error calculating severity point:", error);
    return 1; // Default to severity point 1
  }
}

/**
 * Format severity point remark for Community health Group
 */
export function formatSeverityPointRemark(severityPoint: number): string {
  return `Severity point ${severityPoint}`;
}
