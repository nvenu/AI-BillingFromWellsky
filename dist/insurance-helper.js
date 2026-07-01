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
exports.InsuranceHelper = void 0;
const XLSX = __importStar(require("xlsx"));
class InsuranceHelper {
    constructor(excelFilePath) {
        this.instructions = [];
        this.noChangesInsurances = new Set();
        this.loadInstructions(excelFilePath);
    }
    loadInstructions(filePath) {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        this.instructions = XLSX.utils.sheet_to_json(sheet);
        // Build a set of insurance names that have either:
        // 1. "No changes are required except for identical claims"
        // 2. Exactly "Paper" as the remark
        // 3. Special handling insurances (like Community health Group with Severity points)
        // 4. Partnership Health Plan of CA (auto Type of Bill 327)
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
                // Special handling: Partnership Health Plan of CA (auto Type of Bill 327)
                else if (nameLower === "partnership health plan of ca" && remarkLower.includes("taxonomy code")) {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Senior whole Health (BID) - needs SN visit validation
                else if (nameLower === "senior whole health (bid)") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: United health care MA - needs UD modifier + SN visit check
                else if (nameLower === "united health care ma") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Commonwealth Care Alliance - needs UD modifier + Occurrence Code 50
                else if (nameLower === "commonwealth care alliance") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: UCSD - needs Occurrence Code 50 + Value Codes 61/85
                else if (nameLower === "ucsd") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: UCSD Commercial - needs Occurrence Code 50 + Value Codes 61/85
                else if (nameLower === "ucsd commercial") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Fallon Community Health Plan - auth code TOB 327 + SN visit check
                else if (nameLower === "fallon community health plan") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Fallon Community Health Plan MAV - auth code TOB 327 + SN visit check
                else if (nameLower === "fallon community health plan mav") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Boston Medical Center Health Plan - T-code TOB 327 + UD modifier
                else if (nameLower === "boston medical center health plan") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Northcoast PPS - Anthem - Occurrence Code 50
                else if (nameLower === "northcoast pps - anthem" || nameLower === "northcoast pps – anthem") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
                // Special handling: Northcoast - Aetna - Occurrence Code 50
                else if (nameLower === "northcoast - aetna" || nameLower === "northcoast – aetna") {
                    this.noChangesInsurances.add(nameLower);
                    console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
                }
            }
        });
        console.log(`Loaded ${this.instructions.length} insurance instructions`);
        console.log(`Found ${this.noChangesInsurances.size} insurances with 'no changes' or 'paper' remark`);
        // Ensure Commonwealth Care Alliance is always in the processable list (case-insensitive)
        if (!this.noChangesInsurances.has("commonwealth care alliance")) {
            this.noChangesInsurances.add("commonwealth care alliance");
            console.log(`  ℹ️  Added Commonwealth Care Alliance to processable list (hardcoded)`);
        }
        // Ensure UCSD is always in the processable list
        if (!this.noChangesInsurances.has("ucsd")) {
            this.noChangesInsurances.add("ucsd");
            console.log(`  ℹ️  Added UCSD to processable list (hardcoded)`);
        }
        // Ensure UCSD Commercial is always in the processable list
        if (!this.noChangesInsurances.has("ucsd commercial")) {
            this.noChangesInsurances.add("ucsd commercial");
            console.log(`  ℹ️  Added UCSD Commercial to processable list (hardcoded)`);
        }
        // Ensure Fallon Community Health Plan MAV is always in the processable list
        if (!this.noChangesInsurances.has("fallon community health plan mav")) {
            this.noChangesInsurances.add("fallon community health plan mav");
            console.log(`  ℹ️  Added Fallon Community Health Plan MAV to processable list (hardcoded)`);
        }
        // Ensure Boston Medical Center Health Plan is always in the processable list
        if (!this.noChangesInsurances.has("boston medical center health plan")) {
            this.noChangesInsurances.add("boston medical center health plan");
            console.log(`  ℹ️  Added Boston Medical Center Health Plan to processable list (hardcoded)`);
        }
        // Ensure Northcoast PPS - Anthem is always in the processable list
        if (!this.noChangesInsurances.has("northcoast pps - anthem") && !this.noChangesInsurances.has("northcoast pps – anthem")) {
            this.noChangesInsurances.add("northcoast pps - anthem");
            this.noChangesInsurances.add("northcoast pps – anthem");
            console.log(`  ℹ️  Added Northcoast PPS - Anthem to processable list (hardcoded)`);
        }
        // Ensure Northcoast - Aetna is always in the processable list
        if (!this.noChangesInsurances.has("northcoast - aetna") && !this.noChangesInsurances.has("northcoast – aetna")) {
            this.noChangesInsurances.add("northcoast - aetna");
            this.noChangesInsurances.add("northcoast – aetna");
            console.log(`  ℹ️  Added Northcoast - Aetna to processable list (hardcoded)`);
        }
        console.log("Insurances to process:", Array.from(this.noChangesInsurances).sort());
    }
    /**
     * Check if an insurance name matches the "no changes except identical claims" criteria
     * CRITICAL: Uses EXACT match only to prevent incorrect selections
     */
    shouldProcessInsurance(insuranceName) {
        if (!insuranceName)
            return false;
        const normalizedName = insuranceName.toLowerCase().trim();
        // EXACT match only - no partial matching to avoid errors
        const isMatch = this.noChangesInsurances.has(normalizedName);
        // Log for audit trail with detailed comparison
        if (isMatch) {
            console.log(`  ✓ EXACT MATCH: "${insuranceName}" is in approved list`);
        }
        else {
            // Show close matches for debugging
            const closeMatches = Array.from(this.noChangesInsurances).filter(approved => approved.includes(normalizedName) || normalizedName.includes(approved));
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
    getMatchDetails(insuranceName) {
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
    shouldDiscardAuthorization(authorization) {
        if (!authorization)
            return false;
        const auth = authorization.toLowerCase().trim();
        return auth === "pending" || auth === "dummy" || auth === "non-billing";
    }
    /**
     * Check if authorization is valid for processing
     */
    isValidAuthorization(authorization) {
        if (!authorization)
            return true; // blank is valid
        const auth = authorization.toLowerCase().trim();
        // Discard these
        if (this.shouldDiscardAuthorization(authorization)) {
            return false;
        }
        // Valid: numeric, alphanumeric (with hyphens and spaces allowed), blank, or "na"
        return auth === "na" || auth === "" || /^[a-z0-9\-\s]+$/i.test(auth);
    }
    getInstructionsByLocation(location) {
        return this.instructions.filter(i => i.Location === location);
    }
    /**
     * Get all unique insurance names that should be processed (have "no changes" remark)
     */
    getAllProcessableInsurances() {
        return Array.from(this.noChangesInsurances).sort();
    }
    /**
     * Get insurances by location that should be processed
     * Includes insurances with "no changes" remark OR exactly "paper" remark
     */
    getProcessableInsurancesByLocation(location) {
        const locationInstructions = this.getInstructionsByLocation(location);
        return locationInstructions
            .filter(instruction => {
            if (!instruction.Remarks)
                return false;
            const remarkLower = instruction.Remarks.toLowerCase().trim();
            const nameLower = instruction.Name.toLowerCase().trim();
            return remarkLower.includes("no changes are required except for identical claims") ||
                remarkLower === "paper" ||
                (nameLower === "community health group" && remarkLower.includes("severity point")) ||
                (nameLower === "partnership health plan of ca" && remarkLower.includes("taxonomy code")) ||
                (nameLower === "senior whole health (bid)") ||
                (nameLower === "united health care ma") ||
                (nameLower === "commonwealth care alliance") ||
                (nameLower === "ucsd") ||
                (nameLower === "ucsd commercial") ||
                (nameLower === "fallon community health plan") ||
                (nameLower === "fallon community health plan mav") ||
                (nameLower === "boston medical center health plan") ||
                (nameLower === "northcoast pps - anthem") ||
                (nameLower === "northcoast pps – anthem") ||
                (nameLower === "northcoast - aetna") ||
                (nameLower === "northcoast – aetna");
        })
            .map(instruction => instruction.Name)
            .sort();
    }
    /**
     * Check if an insurance requires special handling (custom logic)
     */
    requiresSpecialHandling(insuranceName) {
        const nameLower = insuranceName.toLowerCase().trim();
        return nameLower === "community health group" ||
            nameLower === "partnership health plan of ca";
    }
    /**
     * Get the special handling type for an insurance
     */
    getSpecialHandlingType(insuranceName) {
        const nameLower = insuranceName.toLowerCase().trim();
        if (nameLower === "community health group") {
            return "severity-points";
        }
        if (nameLower === "partnership health plan of ca") {
            return "type-of-bill-327";
        }
        return null;
    }
    /**
     * Configuration for how special handling insurances should be processed in Ready To Send
     * Returns: "electronic" | "paper" | null
     */
    getReadyToSendProcessingType(insuranceName) {
        const nameLower = insuranceName.toLowerCase().trim();
        // Define processing type for each special handling insurance
        const specialHandlingConfig = {
            "community health group": "paper", // Download PDF (not electronic)
            "partnership health plan of ca": "electronic", // Send electronically (Type of Bill 327)
            "senior whole health (bid)": "electronic", // Send electronically (after SN visit validation)
            "united health care ma": "electronic", // Send electronically (after UD modifier + SN check)
            "commonwealth care alliance": "electronic", // Send electronically (after UD modifier + Occurrence Code 50)
            "ucsd": "electronic", // Send electronically (after OC50 + Value Codes 61/85)
            "ucsd commercial": "electronic", // Send electronically (after OC50 + Value Codes 61/85)
            "fallon community health plan": "electronic", // Send electronically (after auth code check + SN validation)
            "fallon community health plan mav": "electronic", // Send electronically (after auth code check + SN validation)
            "boston medical center health plan": "electronic", // Send electronically (after T-code check + UD modifier)
            "northcoast pps - anthem": "electronic", // Send electronically (after OC50)
            "northcoast pps – anthem": "electronic", // Send electronically (em dash variant)
            "northcoast - aetna": "electronic", // Send electronically (after OC50)
            "northcoast – aetna": "electronic" // Send electronically (em dash variant)
        };
        return specialHandlingConfig[nameLower] || null;
    }
}
exports.InsuranceHelper = InsuranceHelper;
