const pdf = require('pdf-parse');

/**
 * Extract date of admission from UB-04 claim form PDF
 * The date is in mmddyyyy format (e.g., 12052025 for December 5, 2025)
 * In UB-04 forms, the admission date typically appears after birth date and gender (F/M)
 */
export async function extractDateOfAdmission(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const data = await pdf(pdfBuffer);
    const text = data.text;
    
    console.log("  DEBUG: PDF text length:", text.length);
    
    // Find all 8-digit dates in the PDF
    const allDatesPattern = /\b(\d{8})\b/g;
    const allDates = text.match(allDatesPattern);
    
    if (!allDates || allDates.length === 0) {
      console.log("  ⚠️  No 8-digit dates found in PDF");
      return null;
    }
    
    console.log(`  ✓ Found potential date(s): ${allDates.join(', ')}`);
    
    // Filter for dates with year 2020-2030 (admission dates, not birth dates or claim IDs)
    const validDates = allDates.filter((date: string) => {
      const year = parseInt(date.substring(4, 8));
      const month = parseInt(date.substring(0, 2));
      const day = parseInt(date.substring(2, 4));
      
      // Validate year range
      if (year < 2020 || year > 2030) return false;
      
      // Validate month (1-12)
      if (month < 1 || month > 12) return false;
      
      // Validate day (1-31)
      if (day < 1 || day > 31) return false;
      
      return true;
    });
    
    if (validDates.length === 0) {
      console.log("  ⚠️  No valid dates found (year 2020-2030 with valid month/day)");
      return null;
    }
    
    console.log(`  ✓ Filtered valid dates (2020-2030): ${validDates.join(', ')}`);
    
    // Strategy 1: Look for pattern "birth_date [whitespace] F/M [whitespace] admission_date"
    // This is the typical UB-04 format where admission date follows birth date and gender
    for (const date of validDates) {
      // Look for this date preceded by F or M (gender) and another 8-digit number (birth date)
      const pattern = new RegExp(`\\b\\d{8}\\s+[FM]\\s+${date}\\b`);
      if (pattern.test(text)) {
        console.log(`  ✓ Date of Admission (found after birth date and gender): ${date}`);
        return date;
      }
    }
    
    console.log("  ⚠️  Could not find date in birth_date-gender-admission pattern");
    
    // Strategy 2: Return the earliest valid date (most likely admission date)
    validDates.sort();
    const admissionDate = validDates[0];
    
    console.log(`  ✓ Date of Admission (earliest valid date): ${admissionDate}`);
    return admissionDate;
    
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
