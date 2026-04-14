import * as XLSX from "xlsx";

export interface InsuranceInstruction {
  Location: string;
  Name: string;
  Remarks: string;
}

export class InsuranceHelper {
  private instructions: InsuranceInstruction[] = [];
  private noChangesInsurances: Set<string> = new Set();

  constructor(excelFilePath: string) {
    this.loadInstructions(excelFilePath);
  }

  private loadInstructions(filePath: string): void {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    this.instructions = XLSX.utils.sheet_to_json(sheet);

    // Build a set of insurance names that have either:
    // 1. "No changes are required except for identical claims"
    // 2. Exactly "Paper" as the remark
    // 3. Special handling insurances (like Community health Group with Severity points)
    this.instructions.forEach(instruction => {
      if (instruction.Remarks) {
        const remarkLower = instruction.Remarks.toLowerCase().trim();
        const nameLower = instruction.Name.toLowerCase().trim();
        
        // Check for "no changes" remark
        if (remarkLower.includes("no changes are required except for identical claims")) {
          this.noChangesInsurances.add(nameLower);
        }
        // Check for exactly "paper" remark (case-insensitive)
        else if (remarkLower === "paper") {
          this.noChangesInsurances.add(nameLower);
        }
        // Special handling: Community health Group (Severity points)
        else if (nameLower === "community health group" && remarkLower.includes("severity point")) {
          this.noChangesInsurances.add(nameLower);
          console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
        }
      }
    });

    console.log(`Loaded ${this.instructions.length} insurance instructions`);
    console.log(`Found ${this.noChangesInsurances.size} insurances with 'no changes' or 'paper' remark`);
    console.log("Insurances to process:", Array.from(this.noChangesInsurances).sort());
  }

  /**
   * Check if an insurance name matches the "no changes except identical claims" criteria
   * CRITICAL: Uses EXACT match only to prevent incorrect selections
   */
  shouldProcessInsurance(insuranceName: string): boolean {
    if (!insuranceName) return false;
    
    const normalizedName = insuranceName.toLowerCase().trim();
    
    // EXACT match only - no partial matching to avoid errors
    const isMatch = this.noChangesInsurances.has(normalizedName);
    
    // Log for audit trail with detailed comparison
    if (isMatch) {
      console.log(`  ✓ EXACT MATCH: "${insuranceName}" is in approved list`);
    } else {
      // Show close matches for debugging
      const closeMatches = Array.from(this.noChangesInsurances).filter(approved => 
        approved.includes(normalizedName) || normalizedName.includes(approved)
      );
      if (closeMatches.length > 0) {
        console.log(`  ⚠️  NO EXACT MATCH for "${insuranceName}"`);
        console.log(`     Close matches found: ${closeMatches.join(', ')}`);
        console.log(`     Normalized input: "${normalizedName}"`);
      }
    }
    
    return isMatch;
  }

  /**
   * Get detailed match information for debugging
   */
  getMatchDetails(insuranceName: string): { 
    isMatch: boolean; 
    normalizedInput: string; 
    exactMatchFound: string | null;
  } {
    const normalizedName = insuranceName.toLowerCase().trim();
    const isMatch = this.noChangesInsurances.has(normalizedName);
    
    return {
      isMatch,
      normalizedInput: normalizedName,
      exactMatchFound: isMatch ? normalizedName : null
    };
  }

  /**
   * Check if authorization should be discarded
   */
  shouldDiscardAuthorization(authorization: string): boolean {
    if (!authorization) return false;
    
    const auth = authorization.toLowerCase().trim();
    return auth === "pending" || auth === "dummy" || auth === "non-billing";
  }

  /**
   * Check if authorization is valid for processing
   */
  isValidAuthorization(authorization: string): boolean {
    if (!authorization) return true; // blank is valid
    
    const auth = authorization.toLowerCase().trim();
    
    // Discard these
    if (this.shouldDiscardAuthorization(authorization)) {
      return false;
    }
    
    // Valid: numeric, alphanumeric, blank, or "na"
    return auth === "na" || auth === "" || /^[a-z0-9]+$/i.test(auth);
  }

  getInstructionsByLocation(location: string): InsuranceInstruction[] {
    return this.instructions.filter(i => i.Location === location);
  }

  /**
   * Get all unique insurance names that should be processed (have "no changes" remark)
   */
  getAllProcessableInsurances(): string[] {
    return Array.from(this.noChangesInsurances).sort();
  }

  /**
   * Get insurances by location that should be processed
   * Includes insurances with "no changes" remark OR exactly "paper" remark
   */
  getProcessableInsurancesByLocation(location: string): string[] {
    const locationInstructions = this.getInstructionsByLocation(location);
    return locationInstructions
      .filter(instruction => {
        if (!instruction.Remarks) return false;
        const remarkLower = instruction.Remarks.toLowerCase().trim();
        const nameLower = instruction.Name.toLowerCase().trim();
        
        return remarkLower.includes("no changes are required except for identical claims") || 
               remarkLower === "paper" ||
               (nameLower === "community health group" && remarkLower.includes("severity point"));
      })
      .map(instruction => instruction.Name)
      .sort();
  }

  /**
   * Check if an insurance requires special handling (custom logic)
   */
  requiresSpecialHandling(insuranceName: string): boolean {
    const nameLower = insuranceName.toLowerCase().trim();
    return nameLower === "community health group";
  }

  /**
   * Get the special handling type for an insurance
   */
  getSpecialHandlingType(insuranceName: string): string | null {
    const nameLower = insuranceName.toLowerCase().trim();
    
    if (nameLower === "community health group") {
      return "severity-points";
    }
    
    return null;
  }
}
