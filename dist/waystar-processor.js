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
exports.processWaystarForOffice = processWaystarForOffice;
exports.processWaystarForAllOffices = processWaystarForAllOffices;
exports.parseClaimsCsv = parseClaimsCsv;
exports.enrichSelectedRecordsExcel = enrichSelectedRecordsExcel;
exports.correctAllClaims = correctAllClaims;
require("dotenv/config");
const playwright_1 = require("playwright");
const waystar_config_1 = require("./waystar-config");
const XLSX = __importStar(require("xlsx"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WAYSTAR_LOGIN_URL = "https://login.zirmed.com/UI/Login";
// Landing page that reliably shows the header account selector. Per the manual
// flow we start here (appid=14) before switching accounts.
const CLAIMS_LISTING_URL = "https://claims.zirmed.com/Claims/Listing/Index?appid=14";
// Editor URL template. We swap the editclaimid value for each claim.
const CLAIM_EDITOR_URL_TEMPLATE =
    "https://claims.zirmed.com/Editor/V5010/Institutional/Main.aspx?&sec=0&draft=N&editclaimid={CLAIM_ID}&origin=ClaimListingNew&workgroupName=undefined&status=Rejected%20by%20Waystar";
// "All Rejected" option value from the CStatus <select>
const ALL_REJECTED_STATUS_VALUE = "12345";

// ---------------------------------------------------------------------------
// Logging (console.log is already captured by the server's broadcaster)
// ---------------------------------------------------------------------------
function log(msg) {
    console.log(msg);
}

// Build the claim editor URL for a given claim id.
function buildClaimUrl(claimId) {
    return CLAIM_EDITOR_URL_TEMPLATE.replace("{CLAIM_ID}", encodeURIComponent(String(claimId).trim()));
}

// ---------------------------------------------------------------------------
// Screenshots (best-effort; mirrors the Kinnser automation debug style)
// ---------------------------------------------------------------------------
async function screenshot(page, name) {
    try {
        const dir = path.join(process.cwd(), "downloads", "waystar-debug");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: false });
        log(`  📸 Screenshot: ${file}`);
    } catch (e) {
        // non-fatal
    }
}

// ---------------------------------------------------------------------------
// Step 1: Login
// ---------------------------------------------------------------------------
async function waystarLogin(page) {
    const username = process.env.WAYSTAR_USERNAME;
    const password = process.env.WAYSTAR_PASSWORD;
    if (!username || !password) {
        throw new Error("WAYSTAR_USERNAME / WAYSTAR_PASSWORD not set in .env");
    }
    log(`🔐 Logging into Waystar as ${username}...`);
    await page.goto(WAYSTAR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    // Username field - try several common selectors
    const userSelectors = [
        "#username", "input[name='username']", "input[name='Username']",
        "input[name='UserName']", "input[type='text']", "input[type='email']",
        "input[placeholder*='user' i]"
    ];
    let userFilled = false;
    for (const sel of userSelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                await page.fill(sel, username);
                log(`  ✓ Username filled (${sel})`);
                userFilled = true;
                break;
            }
        } catch (e) { /* try next */ }
    }
    if (!userFilled) {
        await screenshot(page, "ERROR_username_not_found");
        throw new Error("Waystar username field not found");
    }

    // Password field
    const passSelectors = [
        "#password", "input[name='password']", "input[name='Password']",
        "input[type='password']", "input[placeholder*='pass' i]"
    ];
    let passFilled = false;
    for (const sel of passSelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                await page.fill(sel, password);
                log(`  ✓ Password filled (${sel})`);
                passFilled = true;
                break;
            }
        } catch (e) { /* try next */ }
    }
    if (!passFilled) {
        await screenshot(page, "ERROR_password_not_found");
        throw new Error("Waystar password field not found");
    }

    // Submit
    const submitSelectors = [
        "#loginButton", "#btnLogin", "button[type='submit']", "input[type='submit']",
        "button:has-text('Log In')", "button:has-text('Login')", "button:has-text('Sign In')",
        "input[value='Log In']", "input[value='Login']"
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                await Promise.all([
                    page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {}),
                    page.click(sel)
                ]);
                log(`  ✓ Clicked login (${sel})`);
                submitted = true;
                break;
            }
        } catch (e) { /* try next */ }
    }
    if (!submitted) {
        // Fallback: press Enter in password field
        try { await page.keyboard.press("Enter"); submitted = true; } catch (e) {}
    }
    if (!submitted) {
        await screenshot(page, "ERROR_login_button_not_found");
        throw new Error("Waystar login button not found");
    }

    await page.waitForTimeout(5000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await screenshot(page, "01_after_login");

    // A device Waystar doesn't recognize triggers a security-question challenge
    // ("Additional Authentication Required"). Answer it if present. This is NOT
    // a login failure — handle it BEFORE the failure check below.
    await handleSecurityQuestion(page);

    // Detect a TRUE failed login so we never cascade into more attempts (account
    // locks after 5 failures). Only the explicit "invalid combination" message or
    // the Login/Failed URL count — NOT the generic "account will be locked" note,
    // which also appears on the (non-failure) security-question page.
    const curUrl = page.url();
    const failedText = await page.evaluate(() => {
        const t = (document.body ? document.body.innerText : "") || "";
        return /login failed|combination of username and password is invalid/i.test(t);
    }).catch(() => false);
    if (/login\/failed/i.test(curUrl) || failedText) {
        throw new Error(
            "Waystar login FAILED (invalid username/password). " +
            "Not retrying — the account locks after 5 failed attempts. " +
            "Verify WAYSTAR_USERNAME / WAYSTAR_PASSWORD in .env."
        );
    }
    log(`  ✓ Logged in. URL: ${curUrl}`);
}

// Parse WAYSTAR_SECURITY_ANSWERS from .env into [{ match, answer }].
// Format: "question keyword=answer; another keyword=answer".
// Matching is done by checking if the keyword text appears in the question.
function getSecurityAnswers() {
    const raw = process.env.WAYSTAR_SECURITY_ANSWERS || "";
    return raw.split(";").map(pair => {
        const idx = pair.indexOf("=");
        if (idx === -1) return null;
        const match = pair.slice(0, idx).trim().toLowerCase();
        const answer = pair.slice(idx + 1).trim();
        return match && answer ? { match, answer } : null;
    }).filter(Boolean);
}

// If the "Additional Authentication Required" security-question page is shown,
// read the question, find the matching answer, type it, keep "Trust this device"
// checked, and submit. No-op if the page isn't present.
async function handleSecurityQuestion(page) {
    // Detect the challenge page by its heading / prompt text.
    const info = await page.evaluate(() => {
        const t = (document.body ? document.body.innerText : "") || "";
        const isChallenge = /additional authentication required|security question/i.test(t);
        if (!isChallenge) return { present: false };
        // The question is usually a bold line ending with "?".
        const bolds = Array.from(document.querySelectorAll("b, strong, label, p, span"))
            .map(el => (el.textContent || "").replace(/\s+/g, " ").trim())
            .filter(s => s.endsWith("?") && s.length > 8);
        return { present: true, question: bolds[0] || "" };
    }).catch(() => ({ present: false }));

    if (!info.present) return false;

    log(`  🔐 Security question challenge: "${info.question}"`);
    const answers = getSecurityAnswers();
    if (answers.length === 0) {
        await screenshot(page, "ERROR_security_question_no_answers");
        throw new Error(
            `Waystar asked a security question ("${info.question}") but WAYSTAR_SECURITY_ANSWERS ` +
            `is not set in .env. Add e.g. WAYSTAR_SECURITY_ANSWERS="city did your parents meet=carmel"`
        );
    }
    const q = (info.question || "").toLowerCase();
    // IMPORTANT: match by keyword ONLY. Never guess/fallback to a different
    // answer — a wrong answer counts toward the 5-failure account lockout.
    const matched = answers.find(a => q.includes(a.match));
    if (!matched) {
        await screenshot(page, "ERROR_security_question_unmatched");
        throw new Error(
            `Security question "${info.question}" has no matching entry in WAYSTAR_SECURITY_ANSWERS. ` +
            `NOT guessing (wrong answers risk locking the account). ` +
            `Add it, e.g. WAYSTAR_SECURITY_ANSWERS="parents meet=carmel; first job=<answer>".`
        );
    }

    // Fill the answer field (first visible text input on the challenge page).
    const answerSelectors = [
        "input[type='text']", "input[name*='answer' i]", "input[id*='answer' i]", "input:not([type])"
    ];
    let filled = false;
    for (const sel of answerSelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) { await page.fill(sel, matched.answer); filled = true; break; }
        } catch (e) { /* next */ }
    }
    if (!filled) {
        await screenshot(page, "ERROR_security_answer_field");
        throw new Error("Could not find the security-answer input field.");
    }
    log(`  ✓ Answered security question (matched "${matched.match}")`);

    // Ensure "Trust this device for future logins" is checked (usually default).
    try {
        await page.evaluate(() => {
            const cb = document.querySelector("input[type='checkbox']");
            if (cb && !cb.checked) cb.checked = true;
        });
    } catch (e) { /* non-fatal */ }

    // Click Verify / Submit.
    const verifySelectors = [
        "button:has-text('Verify')", "input[value='Verify']",
        "button[type='submit']", "input[type='submit']", "button:has-text('Submit')"
    ];
    let verified = false;
    for (const sel of verifySelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                await Promise.all([
                    page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {}),
                    el.click()
                ]);
                verified = true;
                break;
            }
        } catch (e) { /* next */ }
    }
    if (!verified) { try { await page.keyboard.press("Enter"); verified = true; } catch (e) {} }
    log(`  ✓ Submitted security answer${verified ? "" : " (fallback)"}`);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await screenshot(page, "01b_after_security_question");
    return true;
}

// ---------------------------------------------------------------------------
// Step 2: Switch account via the header autocomplete input
// ---------------------------------------------------------------------------
async function switchAccount(page, account) {
    log(`🏢 Switching to account: ${account.displayText}`);
    // The account search is a ui-autocomplete input in the header. Per the manual
    // flow, ALWAYS land on the claims listing (appid=14) first so the header
    // account selector is reliably present — whether we're fresh after login or
    // deep inside a previous claim editor.
    const inputSelectors = [
        ".header-account-search-text",
        ".header-child-account-search-text",
        "input.ui-autocomplete-input",
        "input[data-search-url*='AccountSearch']"
    ];
    const findInput = async () => {
        for (const sel of inputSelectors) {
            try {
                const el = await page.$(sel);
                if (el) return sel;
            } catch (e) { /* next */ }
        }
        return null;
    };

    // Step 1: go to the appid=14 listing (shows the header account selector).
    log(`  🌐 Navigating to ${CLAIMS_LISTING_URL} for the account selector`);
    try {
        await page.goto(CLAIMS_LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    } catch (e) { log(`  ⚠️  Navigation to claims listing failed: ${e.message}`); }

    let inputSel = await findInput();
    if (!inputSel) {
        await screenshot(page, "ERROR_account_input_not_found");
        throw new Error("Waystar account search input not found");
    }

    // Clear and type the account name to trigger autocomplete suggestions.
    await page.click(inputSel);
    await page.fill(inputSel, "");
    await page.waitForTimeout(500);
    // Type the account id — most reliable unique token for the autocomplete.
    const typedQuery = account.accountName;
    await page.type(inputSel, typedQuery, { delay: 40 });
    log(`  ⌨️  Typed "${typedQuery}" into account search`);
    await page.waitForTimeout(2500);

    // Try to click the matching suggestion in the jQuery UI autocomplete menu.
    let picked = false;
    try {
        // jQuery UI renders suggestions as <li class="ui-menu-item"><a>...</a></li>
        const items = await page.$$(".ui-autocomplete .ui-menu-item, ul.ui-autocomplete li");
        for (const item of items) {
            const text = (await item.textContent() || "").trim();
            if (text.includes(account.accountId) ||
                text.toLowerCase().includes(account.accountName.toLowerCase())) {
                await item.click();
                log(`  ✓ Selected suggestion: "${text}"`);
                picked = true;
                break;
            }
        }
    } catch (e) {
        log(`  ⚠️  Autocomplete menu click failed: ${e.message}`);
    }

    if (!picked) {
        // Fallback: press ArrowDown + Enter to accept the first suggestion.
        log(`  ⚠️  No explicit match clicked; trying keyboard selection`);
        try {
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(500);
            await page.keyboard.press("Enter");
            picked = true;
        } catch (e) {}
    }

    // Selecting an account navigates to the SuccessfulAccountChange confirmation
    // page (mgmt.zirmed.com/ExternalUserManagement/SuccessfulAccountChange/Index).
    await page.waitForTimeout(4000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await screenshot(page, "02_after_account_switch");

    const postSwitchUrl = page.url();
    log(`  ℹ️  After account switch, URL: ${postSwitchUrl}`);
    if (/SuccessfulAccountChange/i.test(postSwitchUrl)) {
        log(`  ✓ Account change confirmed (SuccessfulAccountChange page)`);
    } else {
        // Fall back to reading the header account input value (if still present).
        try {
            const currentVal = await page.$eval(inputSel, (el) => el.value).catch(() => "");
            if (currentVal && (currentVal.includes(account.accountId) ||
                currentVal.toLowerCase().includes(account.accountName.toLowerCase()))) {
                log(`  ✓ Account confirmed: ${currentVal}`);
            } else {
                log(`  ⚠️  Could not confirm account switch (URL "${postSwitchUrl}", input "${currentVal}"). Continuing.`);
            }
        } catch (e) {
            log(`  ⚠️  Could not verify account switch. Continuing.`);
        }
    }
}

// ---------------------------------------------------------------------------
// Step 3: Navigate to Institutional Claims listing
// ---------------------------------------------------------------------------
// Read the listing page's claim-type heading (e.g. "Institutional Claims" vs
// "Professional Claims") so we can tell which listing we are on.
async function readListingType(page) {
    return await page.evaluate(() => {
        const h = document.querySelector("h1, .page-title, .pageHeading");
        const title = (h ? h.textContent : document.title) || "";
        return title.replace(/\s+/g, " ").trim();
    }).catch(() => "");
}

// Click a header anchor by its visible text (case-insensitive, exact-ish match).
// Returns true if an anchor was found and clicked. Waits for any resulting
// navigation/postback to settle.
async function clickAnchorByText(page, text, { waitNav = true } = {}) {
    const handle = await page.evaluateHandle((wanted) => {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const target = norm(wanted);
        const anchors = Array.from(document.querySelectorAll("a"));
        // Prefer an exact text match, then a "starts with" match.
        return anchors.find(a => norm(a.textContent) === target)
            || anchors.find(a => norm(a.textContent).startsWith(target))
            || null;
    }, text);
    const el = handle && handle.asElement && handle.asElement();
    if (!el) { try { await handle.dispose(); } catch (_) {} return false; }
    await el.scrollIntoViewIfNeeded().catch(() => {});
    if (waitNav) {
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
            el.click().catch(() => {})
        ]);
    } else {
        await el.click().catch(() => {});
    }
    await page.waitForTimeout(1000);
    try { await handle.dispose(); } catch (_) {}
    return true;
}

// Locate the "Claims" listing anchor (href=.../Claims/Listing/Index?appid=14).
// Returns the href string if present in the DOM, else "". The CLAIMS PROCESSING
// flyout renders these anchors on hover; call after hovering that menu.
async function findInstitutionalClaimsHref(page) {
    return await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a[href*='/Claims/Listing/Index']"));
        // Prefer the appid=14 (Institutional) listing link.
        const inst14 = anchors.find(a => /appid=14\b/.test(a.getAttribute("href") || ""));
        if (inst14) return inst14.getAttribute("href");
        const exact = anchors.find(a => (a.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "claims");
        return exact ? exact.getAttribute("href") : "";
    });
}

async function navigateToClaims(page) {
    log(`🧭 Navigating to Institutional Claims listing...`);
    // After an account switch we land on the "SuccessfulAccountChange" page, which
    // carries the full header menu. The CLAIMS PROCESSING flyout renders its
    // sub-links (Institutional Claims → Claims) ONLY on hover — a plain click
    // doesn't expose them, which previously left us stranded on the account page.
    // So: HOVER the CLAIMS PROCESSING menu, then read the Institutional "Claims"
    // listing href (appid=14) and navigate to it directly. Hovering Institutional
    // Claims first (if present) helps reveal nested links.

    const hoverByText = async (text) => {
        const handle = await page.evaluateHandle((wanted) => {
            const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
            const t = norm(wanted);
            const els = Array.from(document.querySelectorAll("a, span, li, div"));
            return els.find(e => norm(e.textContent) === t)
                || els.find(e => norm(e.textContent).startsWith(t)) || null;
        }, text);
        const el = handle && handle.asElement && handle.asElement();
        if (el) { await el.hover().catch(() => {}); }
        try { if (handle) await handle.dispose(); } catch (_) {}
        return !!el;
    };

    // 1. Hover CLAIMS PROCESSING to open its flyout.
    if (await hoverByText("Claims Processing")) {
        log(`  ✓ Hovered "Claims Processing" menu`);
    } else {
        log(`  ⚠️  "Claims Processing" menu not found — will still try to read the Claims link`);
    }
    await page.waitForTimeout(1000);

    // 2. Hover Institutional Claims (reveals the nested "Claims" listing link).
    if (await hoverByText("Institutional Claims")) {
        log(`  ✓ Hovered "Institutional Claims"`);
    }
    await page.waitForTimeout(1000);

    // 3. Read the appid=14 Claims listing href and navigate to it.
    let claimsHref = await findInstitutionalClaimsHref(page);
    if (!claimsHref) {
        // Try once more after a short settle — the flyout may still be rendering.
        await page.waitForTimeout(1200);
        claimsHref = await findInstitutionalClaimsHref(page);
    }

    if (claimsHref) {
        const absolute = claimsHref.startsWith("http")
            ? claimsHref
            : new URL(claimsHref, page.url()).toString();
        log(`  ✓ Found Claims listing link: ${absolute}`);
        await page.goto(absolute, { waitUntil: "domcontentloaded", timeout: 60000 });
    } else {
        const fallback = "https://claims.zirmed.com/Claims/Listing/Index?appid=14";
        log(`  ⚠️  Claims listing link not found in the menu — navigating directly to ${fallback}`);
        await page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    await page.waitForTimeout(2500);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    const listingType = await readListingType(page);
    log(`  ℹ️  Listing type: "${listingType}" | URL: ${page.url()}`);
    await screenshot(page, "03_claims_listing");

    // Verify we are on the INSTITUTIONAL listing. If we landed on Professional,
    // fail loudly rather than download the wrong (empty) CSV.
    if (/professional/i.test(listingType)) {
        throw new Error(
            `Landed on "${listingType}" instead of Institutional Claims. ` +
            `Verify the Claims listing link in the CLAIMS PROCESSING menu points to Institutional.`
        );
    }
    if (!/institutional/i.test(listingType)) {
        log(`  ⚠️  Could not confirm "Institutional" in the listing heading ("${listingType}"). Continuing, but the CSV screen-type check will catch a wrong listing.`);
    } else {
        log(`  ✓ On Institutional Claims listing`);
    }
}

// ---------------------------------------------------------------------------
// Step 4: Set CStatus = "All Rejected"
// ---------------------------------------------------------------------------
async function setAllRejectedFilter(page) {
    log(`🔎 Setting status filter to "All Rejected"...`);
    const statusSel = "#SearchCriteria_Status";
    try {
        await page.waitForSelector(statusSel, { timeout: 20000 });
        await page.selectOption(statusSel, ALL_REJECTED_STATUS_VALUE);
        log(`  ✓ Selected "All Rejected" (value ${ALL_REJECTED_STATUS_VALUE})`);
    } catch (e) {
        await screenshot(page, "ERROR_status_select_not_found");
        throw new Error(`Could not set status filter: ${e.message}`);
    }

    // Trigger the search (the page may auto-search on change, but click Search/Apply if present).
    const searchSelectors = [
        "#searchBtn", "#btnSearch", "button:has-text('Search')",
        "input[value='Search']", "button:has-text('Apply')"
    ];
    for (const sel of searchSelectors) {
        try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                await el.click();
                log(`  ✓ Clicked search (${sel})`);
                break;
            }
        } catch (e) { /* try next */ }
    }
    await page.waitForTimeout(4000);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await screenshot(page, "04_all_rejected_applied");
}

// ---------------------------------------------------------------------------
// Step 5: Download the CSV of rejected claims
// ---------------------------------------------------------------------------
async function downloadRejectedCsv(page, account) {
    log(`⬇️  Downloading rejected-claims CSV...`);
    const dir = path.join(process.cwd(), "downloads", "waystar");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const btnSel = "#downloadCsvBtn";
    try {
        await page.waitForSelector(btnSel, { timeout: 20000 });
    } catch (e) {
        await screenshot(page, "ERROR_download_btn_not_found");
        throw new Error("Download CSV button (#downloadCsvBtn) not found");
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    await page.click(btnSel);
    log(`  ✓ Clicked Download CSV`);

    let download;
    try {
        download = await downloadPromise;
    } catch (e) {
        await screenshot(page, "ERROR_csv_download_timeout");
        throw new Error(`CSV download did not start: ${e.message}`);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `waystar-rejected-${account.stateCode}-${account.accountId}-${ts}.csv`;
    const filepath = path.join(dir, filename);
    await download.saveAs(filepath);
    log(`  ✓ CSV saved: ${filepath}`);
    return filepath;
}

// ---------------------------------------------------------------------------
// CSV parsing: build Claim Number -> Claim ID map
// ---------------------------------------------------------------------------
// Minimal CSV line splitter that handles quoted fields and escaped quotes.
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else cur += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ",") { out.push(cur); cur = ""; }
            else cur += ch;
        }
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function normHeader(h) {
    return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Waystar exports wrap text-protected cells as Excel formulas, e.g. ="67096418".
// Strip the leading = and surrounding quotes so we get the raw value.
function stripCsvCell(v) {
    let s = String(v == null ? "" : v).trim();
    if (s.startsWith("=")) s = s.slice(1).trim();
    // remove one layer of surrounding double quotes
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1);
    }
    return s.replace(/""/g, '"').trim();
}

/**
 * Parse a Waystar claims CSV into:
 *   { byClaimNumber: Map<claimNumber, claimId>, headers, rowCount }
 * Header matching is case/space/punctuation-insensitive.
 */
function parseClaimsCsv(filepath) {
    const raw = fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, "");
    const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length === 0) {
        return { byClaimNumber: new Map(), headers: [], rowCount: 0 };
    }

    // Candidate header names for the claim NUMBER and claim ID columns.
    const numberCandidates = ["claimnumber", "claimno", "claimnum", "patientcontrolnumber", "pcn"];
    const idCandidates = ["claimid", "editclaimid", "waystarclaimid", "internalclaimid"];

    const findIdx = (normHeaders, candidates) => {
        for (const c of candidates) {
            const idx = normHeaders.indexOf(c);
            if (idx !== -1) return idx;
        }
        // partial contains match as a fallback
        for (let i = 0; i < normHeaders.length; i++) {
            if (candidates.some(c => normHeaders[i].includes(c))) return i;
        }
        return -1;
    };

    // Waystar CSVs have several preamble lines before the real header row
    // (e.g. "Generated by...", "Account:...", filters). Scan for the first row
    // that contains BOTH a claim-number and a claim-id header.
    let headerLine = -1, headers = [], numIdx = -1, idIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]).map(stripCsvCell);
        const norm = cols.map(normHeader);
        const n = findIdx(norm, numberCandidates);
        const d = findIdx(norm, idCandidates);
        if (n !== -1 && d !== -1) {
            headerLine = i; headers = cols; numIdx = n; idIdx = d;
            break;
        }
    }

    // Detect the claim-screen type from the preamble (e.g. "Institutional Claims
    // Screen" vs "Professional Claims Screen") so we can warn on a mismatch.
    const screenLine = lines.slice(0, Math.max(headerLine, 0) + 1)
        .find(l => /claims screen/i.test(l)) || "";
    const screenType = /institutional/i.test(screenLine) ? "Institutional"
        : /professional/i.test(screenLine) ? "Professional" : "Unknown";

    const byClaimNumber = new Map();
    if (headerLine === -1) {
        log(`  ⚠️  Could not find a header row containing both Claim Number and Claim ID`);
        return { byClaimNumber, headers: [], rowCount: 0, numIdx, idIdx, screenType };
    }
    log(`  📑 Claim screen type: ${screenType}${screenLine ? ` ("${screenLine.trim()}")` : ""}`);

    log(`  📑 Header row at line ${headerLine + 1} (${headers.length} cols)`);
    log(`  📑 Claim Number column: "${headers[numIdx]}" (idx ${numIdx})`);
    log(`  📑 Claim ID column:     "${headers[idIdx]}" (idx ${idIdx})`);

    let rowCount = 0;
    for (let i = headerLine + 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]).map(stripCsvCell);
        const num = (cols[numIdx] || "").trim();
        const id = (cols[idIdx] || "").trim();
        if (num && id) {
            byClaimNumber.set(num, id);
            rowCount++;
        }
    }
    log(`  ✓ Parsed ${rowCount} claim-number → claim-id mappings`);
    return { byClaimNumber, headers, rowCount, numIdx, idIdx, screenType };
}

// ---------------------------------------------------------------------------
// Excel enrichment: add Claim ID + Claim URL to TOB-327 rows
// ---------------------------------------------------------------------------
// Find the newest selected-records Excel file for a given stateCode in cwd.
function findSelectedRecordsFile(stateCode) {
    const cwd = process.cwd();
    const prefix = `selected-records-${stateCode}-`;
    const matches = fs.readdirSync(cwd)
        .filter(f => f.startsWith(prefix) && f.endsWith(".xlsx"))
        .map(f => ({ f, mtime: fs.statSync(path.join(cwd, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return matches.length > 0 ? path.join(cwd, matches[0].f) : null;
}

// Find ALL selected-records Excel files for a given stateCode in cwd.
// A state (e.g. MA/Taunton) can have one file PER INSURANCE, so Waystar must
// process every file, not just the newest. Sorted by name (stable order).
function findAllSelectedRecordsFiles(stateCode) {
    const cwd = process.cwd();
    const prefix = `selected-records-${stateCode}-`;
    return fs.readdirSync(cwd)
        .filter(f => f.startsWith(prefix) && f.endsWith(".xlsx"))
        .sort()
        .map(f => path.join(cwd, f));
}

// Read the primary Insurance value from a selected-records Excel (first data row's
// Insurance column) for labeling the report. Returns "" if not found.
function readInsuranceFromExcel(excelPath) {
    try {
        const wb = XLSX.readFile(excelPath);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        if (rows.length < 2) return "";
        const header = rows[0].map(h => String(h).trim().toLowerCase());
        const ii = header.indexOf("insurance");
        if (ii === -1) return "";
        for (let r = 1; r < rows.length; r++) {
            const v = String(rows[r][ii] || "").trim();
            if (v) return v;
        }
        return "";
    } catch (e) { return ""; }
}

/**
 * Open the selected-records Excel for a state, and for every row where TOB === "327",
 * look up its Claim # in the CSV map, then write two columns: "Claim ID" and "Claim URL".
 * Returns a summary of what was matched.
 */
function enrichSelectedRecordsExcel(excelPath, byClaimNumber) {
    log(`\n📊 Enriching Excel: ${path.basename(excelPath)}`);
    const wb = XLSX.readFile(excelPath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    // Convert to array-of-arrays to work with header indices directly.
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length === 0) {
        log(`  ⚠️  Excel is empty`);
        return { matched: 0, tob327: 0, unmatched: [] };
    }

    const header = rows[0].map(h => String(h));
    const idxTob = header.findIndex(h => h.trim().toLowerCase() === "tob");
    const idxClaimNo = header.findIndex(h => h.trim().toLowerCase() === "claim #" || h.trim().toLowerCase() === "claim#");
    // "327 Reason" tells WHY the claim became 327. Waystar date-correction only
    // applies to DUPLICATE-DATE 327s — NOT TCODE/Partnership/etc. 327s.
    const idx327Reason = header.findIndex(h => h.trim().toLowerCase() === "327 reason");
    // Insurance columns (used to gate the TCODE correction to Senior Whole Health).
    // The Kinnser export has both a short "Insurance" and an "Insurance (Full)" column.
    const idxInsurance = header.findIndex(h => h.trim().toLowerCase() === "insurance");
    const idxInsuranceFull = header.findIndex(h => h.trim().toLowerCase() === "insurance (full)");
    if (idxTob === -1) {
        throw new Error('Excel has no "TOB" column — cannot locate 327 rows');
    }
    if (idxClaimNo === -1) {
        throw new Error('Excel has no "Claim #" column — cannot match claim numbers');
    }
    if (idx327Reason === -1) {
        log(`  ⚠️  No "327 Reason" column found — cannot distinguish duplicate-date 327s from TCODE 327s; NO claims will be corrected.`);
    }

    // Ensure the two new columns exist (append if missing).
    let idxClaimId = header.findIndex(h => h.trim().toLowerCase() === "claim id");
    let idxClaimUrl = header.findIndex(h => h.trim().toLowerCase() === "claim url");
    if (idxClaimId === -1) { idxClaimId = header.length; header.push("Claim ID"); }
    if (idxClaimUrl === -1) { idxClaimUrl = header.length; header.push("Claim URL"); }
    rows[0] = header;

    // A 327 row is eligible for correction in two cases:
    //  1. DUPLICATE-DATE 327 — reason text contains "duplicate" (e.g. "Duplicate
    //     MRN with overlapping dates - changing TOB..."). correctionType = "duplicate".
    //  2. TCODE 327 for SENIOR WHOLE HEALTH / SENIOR WHOLE HEALTH BID — reason text
    //     contains "tcode" AND the insurance is Senior Whole Health. correctionType =
    //     "tcode" (adds an Insurance-tab Prior Auth fix before the same date/TOB flow).
    // All OTHER 327s (TCODE for other payers, Partnership, etc.) are enriched only.
    const isDuplicateReason = (reason) => /duplicate/i.test(String(reason || ""));
    const isTcodeReason = (reason) => /t\s*code/i.test(String(reason || ""));
    const isSeniorWholeHealth = (ins, insFull) => {
        const hay = `${String(ins || "")} ${String(insFull || "")}`.toLowerCase();
        return /senior\s*whole\s*health/.test(hay) || /\bswhma/.test(hay);
    };

    let tob327 = 0, matched = 0, eligibleCount = 0, skippedReasonCount = 0;
    let dupCount = 0, tcodeCount = 0;
    const unmatched = [];
    const enriched = []; // { claimNo, claimId, url, reason, eligible, correctionType } for the correction step

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        // pad row to header length
        while (row.length < header.length) row.push("");
        const tob = String(row[idxTob] || "").trim();
        if (tob !== "327") continue;
        tob327++;
        const reason327 = idx327Reason !== -1 ? String(row[idx327Reason] || "").trim() : "";
        const insurance = idxInsurance !== -1 ? String(row[idxInsurance] || "").trim() : "";
        const insuranceFull = idxInsuranceFull !== -1 ? String(row[idxInsuranceFull] || "").trim() : "";
        // Decide correction type (and eligibility):
        //   • duplicate-date 327  → correctionType "duplicate"
        //   • TCODE 327 for Senior Whole Health (incl. BID) → correctionType "tcode"
        //   • anything else → not eligible (enriched only)
        const swh = isSeniorWholeHealth(insurance, insuranceFull);
        let correctionType = null;
        if (isDuplicateReason(reason327)) correctionType = "duplicate";
        else if (isTcodeReason(reason327) && swh) correctionType = "tcode";
        const eligible = correctionType !== null;
        const claimNo = String(row[idxClaimNo] || "").trim();
        if (!claimNo) {
            unmatched.push({ row: r + 1, claimNo: "(blank)", reason: "no claim # in Excel" });
            continue;
        }
        // Try exact, then trimmed/leading-zero-insensitive match.
        let claimId = byClaimNumber.get(claimNo);
        if (!claimId) {
            // try without leading zeros
            const stripped = claimNo.replace(/^0+/, "");
            for (const [k, v] of byClaimNumber.entries()) {
                if (k === stripped || k.replace(/^0+/, "") === stripped) { claimId = v; break; }
            }
        }
        if (claimId) {
            const url = buildClaimUrl(claimId);
            row[idxClaimId] = claimId;
            row[idxClaimUrl] = url;
            matched++;
            // Enrich (Claim ID + URL) ALL matched 327 rows, but only mark
            // duplicate-date and TCODE/Senior-Whole-Health rows as eligible.
            if (eligible) {
                eligibleCount++;
                if (correctionType === "duplicate") dupCount++; else if (correctionType === "tcode") tcodeCount++;
            } else {
                skippedReasonCount++;
            }
            enriched.push({ claimNo, claimId: String(claimId).trim(), url, reason: reason327, insurance, eligible, correctionType });
        } else {
            unmatched.push({ row: r + 1, claimNo, reason: "claim # not in CSV" });
        }
    }

    // Write back
    const newWs = XLSX.utils.aoa_to_sheet(rows);
    wb.Sheets[sheetName] = newWs;
    XLSX.writeFile(wb, excelPath);

    log(`  ✓ TOB 327 rows: ${tob327}, matched & enriched: ${matched}, unmatched: ${unmatched.length}`);
    log(`  ✓ Eligible for correction: ${eligibleCount} (duplicate-date: ${dupCount}, TCODE/Senior Whole Health: ${tcodeCount}) | not eligible (other 327): ${skippedReasonCount}`);
    if (unmatched.length > 0) {
        unmatched.slice(0, 20).forEach(u =>
            log(`     ⚠️  Row ${u.row}: claim # "${u.claimNo}" — ${u.reason}`));
    }
    log(`  ✓ Saved: ${excelPath}`);
    return { matched, tob327, unmatched, excelPath, enriched, eligibleCount, skippedReasonCount, dupCount, tcodeCount };
}

// ---------------------------------------------------------------------------
// Run report: one row per claim, describing the action taken.
// Built from the per-office results of a Waystar run.
// ---------------------------------------------------------------------------
// Derive a human-readable action/status for one claim result.
function describeClaimAction(c, submitEnabled) {
    if (c.error) return c.verified ? `Error after open: ${c.error}` : `Error: ${c.error}`;
    if (c.skipped && c.confirmDeclined) return "Edited; resubmit DECLINED by user";
    if (c.skipped && c.verified && submitEnabled === false) return "Edited (dry run — NOT resubmitted)";
    if (c.skipped && !c.verified) return "Skipped (claim id mismatch — not edited)";
    if (c.submitted) return "Edited and RESUBMITTED";
    if (c.verified) return "Edited (not resubmitted)";
    return "Not processed";
}

/**
 * Write a consolidated run report (Excel + plain-text summary) describing every
 * claim touched across all offices and the action performed.
 * @param {Array} officeResults  results from processWaystarForAllOffices / single office
 * @returns {{ xlsxPath:string, txtPath:string, totals:object }}
 */
function writeWaystarRunReport(officeResults) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const xlsxPath = path.join(process.cwd(), `waystar-run-report-${ts}.xlsx`);
    const txtPath = path.join(process.cwd(), `waystar-run-report-${ts}.txt`);

    const header = [
        "Office", "State", "Waystar Account", "Insurance", "Claim #", "Claim ID",
        "Service Dates", "HIPPS Applied", "HIPPS From→To",
        "Statement From", "Statement To", "Admission Date",
        "Discharge Before", "Discharge After",
        "TOB Before", "TOB After", "Resubmitted", "Action / Status", "Claim URL"
    ];
    const rows = [header];
    const totals = { offices: 0, insuranceFiles: 0, claims: 0, edited: 0, resubmitted: 0, skipped: 0, errored: 0, unmatched327: 0, notCorrected: 0 };

    const txt = [];
    txt.push(`WAYSTAR RUN REPORT — ${new Date().toLocaleString()}`);
    txt.push("=".repeat(70));

    for (const office of (officeResults || [])) {
        totals.offices++;
        const officeName = (office.account || office.stateCode || "").replace(/\s*\(\d+\)\s*$/, "").trim();
        const submitEnabled = office.submitEnabled === true;
        txt.push("");
        txt.push(`OFFICE: ${office.account || office.stateCode}  [${office.stateCode || ""}]`);

        if (office.skipped) {
            txt.push(`  (skipped: ${office.reason || "no reason"})`);
            rows.push([officeName, office.stateCode || "", office.account || "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", `Office skipped: ${office.reason || ""}`, ""]);
            continue;
        }
        if (office.error && !office.files) {
            txt.push(`  (office error: ${office.error})`);
            rows.push([officeName, office.stateCode || "", office.account || "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", `Office error: ${office.error}`, ""]);
            totals.errored++;
            continue;
        }

        // Each office has one "file" per insurance.
        const files = office.files || [];
        for (const file of files) {
            totals.insuranceFiles++;
            const insurance = file.insurance || "";
            txt.push(`  INSURANCE: ${insurance || "(unknown)"}`);

            // Unmatched 327 rows (had no claim id in the CSV) — report them too.
            for (const u of (file.unmatched || [])) {
                totals.unmatched327++;
                rows.push([officeName, office.stateCode || "", office.account || "", insurance, u.claimNo || "", "", "", "", "", "", "", "", "", "", "327", "", "No", `Not matched in Waystar CSV (${u.reason || ""})`, ""]);
                txt.push(`    • Claim #${u.claimNo}: NOT matched in Waystar CSV (${u.reason || ""})`);
            }

            // 327 claims enriched (Claim ID/URL) but intentionally NOT corrected
            // because the 327 reason is not "duplicate dates" (TCODE/Partnership/etc.).
            for (const n of (file.notCorrected || [])) {
                totals.notCorrected = (totals.notCorrected || 0) + 1;
                rows.push([officeName, office.stateCode || "", office.account || "", insurance, n.claimNo || "", n.claimId || "", "", "", "", "", "", "", "", "", "327", "327", "No", `Enriched only — not a duplicate-date 327 (${n.reason || ""})`, n.url || ""]);
                txt.push(`    • Claim #${n.claimNo} (id ${n.claimId}) — enriched only, NOT corrected (${n.reason || ""})`);
            }

            const results = (file.correction && file.correction.results) || [];
            for (const c of results) {
                totals.claims++;
                if (c.submitted) totals.resubmitted++;
                if (c.verified && !c.skipped) totals.edited++;
                if (c.skipped) totals.skipped++;
                if (c.error && !c.skipped) totals.errored++;
                const action = describeClaimAction(c, submitEnabled);
                rows.push([
                    officeName, office.stateCode || "", office.account || "", insurance,
                    c.claimNo || "", c.claimId || "",
                    (c.serviceDates || []).join(", "),
                    c.hipps && c.hipps.applied ? "Yes" : "No",
                    c.hipps && c.hipps.applied ? `${c.hipps.from}→${c.hipps.to}` : "",
                    c.fromDate || "", c.toDate || "", c.admissionDate || "",
                    c.dischargeStatusBefore || "",
                    c.dischargeStatusChanged ? `${c.dischargeStatusAfter || ""} (changed)` : (c.dischargeStatusAfter || c.dischargeStatusBefore || ""),
                    c.tobBefore || "", c.tobAfter || "",
                    c.submitted ? "Yes" : "No",
                    action, c.url || ""
                ]);
                txt.push(`    • Claim #${c.claimNo} (id ${c.claimId}) — ${action}${c.correctionType ? ` [${c.correctionType}]` : ""}`);
                txt.push(`        TOB ${c.tobBefore || "?"}→${c.tobAfter || "?"} | statement ${c.fromDate || "?"}–${c.toDate || "?"}`
                    + (c.hipps && c.hipps.applied ? ` | HIPPS ${c.hipps.from}→${c.hipps.to}` : "")
                    + (c.dischargeStatusBefore || c.dischargeStatusChanged ? ` | discharge ${c.dischargeStatusBefore || "?"}${c.dischargeStatusChanged ? `→${c.dischargeStatusAfter}` : ""}` : "")
                    + (c.tobRule ? ` | rule ${c.tobRule}` : ""));
                if (c.correctionType === "tcode") {
                    txt.push(`        TCODE: prior auth "${c.priorAuthBefore || ""}"${c.priorAuthChanged ? ` → "${c.priorAuthAfter}"` : " (unchanged)"}`
                        + ((c.procRewrites || []).length ? ` | proc rewrites: ${c.procRewrites.map(x => `${x.fromProc}→T1502 @${x.charge}`).join(", ")}` : " | no G0299/G0300 rows")
                        + (c.patientEstimateSet ? ` | patient estimate = ${c.patientEstimateSet} (total charges)` : ""));
                }
            }
            if ((file.unmatched || []).length === 0 && results.length === 0 && (file.notCorrected || []).length === 0) {
                txt.push(`    (no TOB-327 claims to act on)`);
                rows.push([officeName, office.stateCode || "", office.account || "", insurance, "", "", "", "", "", "", "", "", "", "", "", "", "", "No TOB-327 claims", ""]);
            }
        }
    }

    txt.push("");
    txt.push("=".repeat(70));
    txt.push(`TOTALS: offices=${totals.offices}, insuranceFiles=${totals.insuranceFiles}, claims=${totals.claims}, edited=${totals.edited}, `
        + `resubmitted=${totals.resubmitted}, skipped=${totals.skipped}, errored=${totals.errored}, `
        + `enrichedOnly(TCODE/other 327)=${totals.notCorrected}, unmatched327=${totals.unmatched327}`);

    // Write Excel
    try {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Waystar Run Report");
        XLSX.writeFile(wb, xlsxPath);
    } catch (e) { log(`  ⚠️  Could not write report xlsx: ${e.message}`); }
    // Write text summary
    try { fs.writeFileSync(txtPath, txt.join("\n"), "utf8"); }
    catch (e) { log(`  ⚠️  Could not write report txt: ${e.message}`); }

    log(`\n📝 Run report written:`);
    log(`   • ${xlsxPath}`);
    log(`   • ${txtPath}`);
    log(`   TOTALS: ${totals.claims} claims across ${totals.offices} office(s) — `
        + `${totals.edited} edited, ${totals.resubmitted} resubmitted, ${totals.skipped} skipped, ${totals.errored} errored, ${totals.unmatched327} unmatched`);

    return { xlsxPath, txtPath, totals };
}

// ===========================================================================
// CLAIM CORRECTION (editor): fix dates + Type of Bill, then Resubmit.
// Resubmit is IRREVERSIBLE and only happens when submit=true.
// ===========================================================================

// Normalize a MM/DD/YYYY (or similar) date string for comparison/entry.
function normDate(s) {
    return String(s == null ? "" : s).trim();
}

// Ask the user to confirm a resubmit via stdin (when a TTY is attached).
// Returns true to proceed, false to skip. Resolves false if no TTY.
function confirmOnStdin(question) {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY) {
            resolve(false);
            return;
        }
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${question} [y/N]: `, (answer) => {
            rl.close();
            resolve(/^y(es)?$/i.test((answer || "").trim()));
        });
    });
}

// Out-of-band confirmation for non-TTY runs (e.g. launched as a background
// process). The automation PAUSES and polls for a confirmation file; the user
// creates that file to approve the resubmit. Approve: `touch <APPROVE>`.
// Decline / abort: `touch <DECLINE>`. Times out (declines) after timeoutMs.
const WAYSTAR_APPROVE_FILE = "waystar-confirm-submit";
const WAYSTAR_DECLINE_FILE = "waystar-skip-submit";
function confirmViaFile(question, claimNo, timeoutMs = 180000) {
    return new Promise((resolve) => {
        const approve = path.join(process.cwd(), WAYSTAR_APPROVE_FILE);
        const decline = path.join(process.cwd(), WAYSTAR_DECLINE_FILE);
        // Clear any stale confirmation files from a previous claim.
        try { if (fs.existsSync(approve)) fs.unlinkSync(approve); } catch (_) {}
        try { if (fs.existsSync(decline)) fs.unlinkSync(decline); } catch (_) {}
        log(`\n  ⏸️  CONFIRMATION REQUIRED — ${question}`);
        log(`     To APPROVE resubmit:  touch "${approve}"`);
        log(`     To SKIP this claim:   touch "${decline}"`);
        log(`     (waiting up to ${Math.round(timeoutMs / 1000)}s; no action = SKIP)`);
        const start = Date.now();
        const timer = setInterval(() => {
            if (fs.existsSync(approve)) {
                clearInterval(timer);
                try { fs.unlinkSync(approve); } catch (_) {}
                log(`     ✅ Approval file detected — proceeding with resubmit`);
                resolve(true);
            } else if (fs.existsSync(decline)) {
                clearInterval(timer);
                try { fs.unlinkSync(decline); } catch (_) {}
                log(`     🚫 Skip file detected — NOT resubmitting`);
                resolve(false);
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(timer);
                log(`     ⌛ Confirmation timed out — NOT resubmitting`);
                resolve(false);
            }
        }, 1000);
    });
}

// Parse a MM/DD/YYYY string into a comparable number (YYYYMMDD). Returns NaN if unparseable.
function dateKey(s) {
    const m = normDate(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return NaN;
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = "20" + yy;
    return parseInt(yy, 10) * 10000 + parseInt(mm, 10) * 100 + parseInt(dd, 10);
}

// Read the Service Line grid: for each data row return its Rev Code, Service Date
// (from the row's inputs where present, else cell text), and the DOM id of the
// service-date <input> so it can be updated later (HIPPS rule).
async function readServiceLineRows(page) {
    return await page.evaluate(() => {
        const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
        // Locate the grid via the first Rev Code input, then walk up to its table.
        const anyRev = document.querySelector("input[id*='revcode' i], input[name*='revcode' i]");
        let table = anyRev ? anyRev.closest("table") : null;
        // Fallback: find a table that has a header containing "Service Date".
        if (!table) {
            const headerRow = Array.from(document.querySelectorAll("tr.gridViewHeader"))[0];
            table = headerRow ? headerRow.closest("table") : null;
        }
        if (!table) return { error: "service line table not found", rows: [] };

        // Determine the "Service Date" column index from the header (for text fallback).
        let svcIdx = -1;
        const headerRow = table.querySelector("tr.gridViewHeader") ||
            Array.from(table.querySelectorAll("tr")).find(r => r.querySelector("th"));
        if (headerRow) {
            const ths = Array.from(headerRow.querySelectorAll("th"));
            ths.forEach((th, i) => {
                const t = (th.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                if (t.includes("service date")) svcIdx = i;
            });
        }

        const rows = [];
        const trs = Array.from(table.querySelectorAll("tr"));
        for (const tr of trs) {
            if (tr === headerRow) continue;
            if (tr.classList.contains("gridViewHeader")) continue;
            // A data row must contain a Rev Code input (keeps us off spacer/footer rows).
            const revInput = tr.querySelector("input[id*='revcode' i], input[name*='revcode' i]");
            if (!revInput) continue;

            const revCode = (revInput.value || "").trim();

            // Find the service-date input in this row: a text input whose value looks
            // like a date, or whose id/name hints at a date field. Prefer a value match.
            let dateInput = null;
            const inputs = Array.from(tr.querySelectorAll("input[type='text'], input:not([type])"));
            for (const inp of inputs) {
                if (inp === revInput) continue;
                const v = (inp.value || "").trim();
                const idn = ((inp.id || "") + " " + (inp.name || "")).toLowerCase();
                if (DATE_RE.test(v) || /date|dos|service/.test(idn)) { dateInput = inp; break; }
            }
            let serviceDate = "";
            let dateInputId = "";
            if (dateInput) {
                const vm = (dateInput.value || "").match(DATE_RE);
                serviceDate = vm ? vm[0] : (dateInput.value || "").trim();
                dateInputId = dateInput.id || "";
            } else if (svcIdx !== -1) {
                // Fall back to cell text in the Service Date column.
                const cells = tr.querySelectorAll("td");
                if (cells.length > svcIdx) {
                    const cm = (cells[svcIdx].textContent || "").match(DATE_RE);
                    if (cm) serviceDate = cm[0];
                }
            }
            rows.push({ revCode, serviceDate, dateInputId });
        }
        return { error: rows.length ? null : "no service line rows", rows };
    });
}

// Set a text input's value and fire input/change/blur so ASP.NET registers it.
async function setInputValue(page, selector, value) {
    const ok = await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("keyup", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
    }, { sel: selector, val: value });
    return ok;
}

// ---------------------------------------------------------------------------
// Patient Discharge Status (UB-04 FL 17) — read & write.
// CONFIRMED from the Waystar Institutional claim editor DOM: the field is
//   #clt_tc_genTP_gen_FV_patstatus  (value "01"/"30", maxlength 2)
// under the "Admission / Discharge" section.
// IMPORTANT: this is NOT the Type-of-Bill field. The TOB LAST DIGIT (2/3/4)
// lives in #clt_tc_genTP_gen_FV_frequency, next to #..._factype ("32"), under
// the "Type of Bill (Facility & Frequency Code)" label.
// Extra candidates + a label/id heuristic remain as a safety net in case the
// id ever changes.
// ---------------------------------------------------------------------------
async function findDischargeStatusFieldId(page) {
    return await page.evaluate(() => {
        const candidates = [
            "clt_tc_genTP_gen_FV_patstatus",
            "clt_tc_genTP_gen_FV_patientstatus",
            "clt_tc_genTP_gen_FV_patientdischargestatus",
            "clt_tc_genTP_gen_FV_dischargestatus",
            "clt_tc_genTP_gen_FV_patientstat"
        ];
        for (const id of candidates) {
            const el = document.getElementById(id);
            if (el) return id;
        }
        // Heuristic scan: look for a labelled field about patient/discharge status.
        const wanted = /(patient\s*(discharge\s*)?status|discharge\s*status|patient\s*stat)/i;
        // 1) by input/select id or name
        const fields = Array.from(document.querySelectorAll("input, select"));
        for (const f of fields) {
            const idn = ((f.id || "") + " " + (f.name || "")).toLowerCase();
            if (wanted.test(idn) && f.id) return f.id;
        }
        // 2) by associated <label for=...> text
        const labels = Array.from(document.querySelectorAll("label"));
        for (const lab of labels) {
            const txt = (lab.textContent || "").replace(/\s+/g, " ").trim();
            if (wanted.test(txt)) {
                const forId = lab.getAttribute("for");
                if (forId && document.getElementById(forId)) return forId;
                // label wrapping the control
                const inner = lab.querySelector("input, select");
                if (inner && inner.id) return inner.id;
            }
        }
        return "";
    });
}

// Read the current patient-discharge-status value given its field id.
// Returns the raw 2-digit code (e.g. "01", "30") trimmed, or "" if unreadable.
async function readDischargeStatus(page, fieldId) {
    if (!fieldId) return "";
    return await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return "";
        // For a <select>, the UB code is usually the option value (e.g. "01");
        // if the value is non-numeric, try to parse a leading 2-digit code from
        // the selected option's text ("01 - Discharged to home...").
        let v = (el.value || "").trim();
        if (el.tagName === "SELECT") {
            const opt = el.options[el.selectedIndex];
            const txt = opt ? (opt.textContent || "").trim() : "";
            const codeFromText = (txt.match(/^(\d{1,2})\b/) || [])[1];
            if (!/^\d{1,2}$/.test(v) && codeFromText) v = codeFromText;
        }
        const m = v.match(/^(\d{1,2})/);
        return m ? m[1].padStart(2, "0") : v;
    }, fieldId);
}

// Set the patient-discharge-status value. Handles both <select> (match by option
// value or by the leading code in the option text) and text inputs.
async function setDischargeStatus(page, fieldId, code) {
    if (!fieldId) return false;
    return await page.evaluate(({ id, code }) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const fire = (node) => {
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
            node.dispatchEvent(new Event("blur", { bubbles: true }));
        };
        if (el.tagName === "SELECT") {
            const want = String(code).replace(/^0+(?=\d)/, ""); // "01" -> "1" tolerance
            const opts = Array.from(el.options);
            // Prefer exact value match, then value without leading zeros, then
            // an option whose text starts with the code.
            let target =
                opts.find(o => o.value.trim() === String(code)) ||
                opts.find(o => o.value.trim().replace(/^0+(?=\d)/, "") === want) ||
                opts.find(o => new RegExp("^0*" + want + "\\b").test((o.textContent || "").trim()));
            if (!target) return false;
            el.value = target.value;
            el.selectedIndex = target.index;
            fire(el);
            return true;
        }
        // text input
        el.focus();
        el.value = String(code);
        fire(el);
        return true;
    }, { id: fieldId, code });
}

// ---------------------------------------------------------------------------
// TCODE / Senior Whole Health helpers
// ---------------------------------------------------------------------------
// On the Insurance tab, strip the "TCODE"/"T CODE" token from the Prior Auth
// value, keeping the rest (e.g. "TCODE PUM2625 NA" -> "PUM2625 NA").
// Returns { found, before, after, changed }.
async function stripTcodeFromPriorAuth(page) {
    return await page.evaluate(() => {
        const el = document.getElementById("ins_FV2_priorauth");
        if (!el) return { found: false };
        const before = (el.value || "");
        // Remove a leading/standalone "TCODE" or "T CODE" token (case-insensitive),
        // then collapse the whitespace left behind.
        const after = before
            .replace(/\bT\s*CODE\b/ig, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (after === before.trim()) return { found: true, before, after: before.trim(), changed: false };
        el.focus();
        el.value = after;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return { found: true, before, after, changed: true };
    });
}

// On the Service Line tab, for every row whose Proc Code is G0299 or G0300:
//   • change the Proc Code to T1502
//   • set Covered Charges = 139 * Units (formatted to 2 decimals)
// Returns { rewrites: [{ row, fromProc, units, charge }], count }.
// NOTE: Total Charges (#FV_totalCharges) auto-recalculates from the line charges.
async function rewriteSeniorWholeHealthProcCodes(page) {
    return await page.evaluate(() => {
        const RATE = 139;
        const table = document.getElementById("slv_FV_GV");
        if (!table) return { rewrites: [], count: 0, error: "service line grid not found" };
        const fire = (node) => {
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("keyup", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
            node.dispatchEvent(new Event("blur", { bubbles: true }));
        };
        const rewrites = [];
        const procInputs = Array.from(table.querySelectorAll("input[id*='proccode' i]"))
            // exclude the hidden proccodequal inputs
            .filter(inp => /proccode$/i.test(inp.id || "") || /_proccode$/i.test(inp.id || "") || /\$proccode$/i.test(inp.name || ""));
        for (const proc of procInputs) {
            const val = (proc.value || "").trim().toUpperCase();
            if (val !== "G0299" && val !== "G0300") continue;
            // Derive the row prefix (e.g. "slv_FV_GV_ctl02_") from the proc input id.
            const m = (proc.id || "").match(/^(.*_)proccode$/i);
            const prefix = m ? m[1] : null;
            if (!prefix) continue;
            const qtyEl = document.getElementById(prefix + "qty");
            const chgEl = document.getElementById(prefix + "chg");
            const units = qtyEl ? parseFloat((qtyEl.value || "").replace(/[^0-9.]/g, "")) : NaN;
            if (!chgEl || isNaN(units)) continue;
            // Change proc code → T1502
            proc.focus(); proc.value = "T1502"; fire(proc);
            // Set covered charges = 139 * units
            const charge = (RATE * units).toFixed(2);
            chgEl.focus(); chgEl.value = charge; fire(chgEl);
            rewrites.push({ rowPrefix: prefix, fromProc: val, units, charge });
        }
        return { rewrites, count: rewrites.length };
    });
}

// Read the recalculated Total Charges (#FV_totalCharges span, e.g. "$373.00").
// Returns a plain numeric string without "$"/commas (e.g. "373.00"), or "".
async function readTotalCharges(page) {
    return await page.evaluate(() => {
        const el = document.getElementById("FV_totalCharges");
        if (!el) return "";
        const raw = (el.textContent || "").trim();
        const cleaned = raw.replace(/[^0-9.]/g, "");
        return cleaned;
    });
}

// Click a Menu1 tab via its __doPostBack argument ('slv' = Service Line, 'clt' = Claim)
// and wait for the ASP.NET postback to settle.
async function clickMenuTab(page, arg, label) {
    log(`  🧭 Opening "${label}" tab...`);
    // Locate the Menu1 postback anchor by its href argument.
    const linkSel = `a[href*="'${arg}'"]`;
    let handle = await page.$(linkSel);
    // Fallback: some encodings use &#39; — scan anchors for the arg.
    if (!handle) {
        handle = await page.evaluateHandle((a) => {
            const links = Array.from(document.querySelectorAll("a"));
            return links.find(x => (x.getAttribute("href") || "").includes(`'${a}'`)) || null;
        }, arg);
        if (handle && !handle.asElement()) handle = null;
    }

    // Clicking a Menu1 tab triggers a full-page ASP.NET postback (a navigation).
    // Click and wait for the navigation TOGETHER so the execution context isn't
    // torn down mid-evaluate. If no navigation fires (SPA-style), fall through.
    if (handle && handle.asElement && handle.asElement()) {
        const el = handle.asElement();
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
            el.click().catch(() => {})
        ]);
    } else {
        // Last resort: invoke __doPostBack and wait for navigation.
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
            page.evaluate((a) => {
                if (typeof window.__doPostBack === "function") window.__doPostBack("Menu1", a);
            }, arg).catch(() => {})
        ]);
    }

    await page.waitForTimeout(2500);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

/**
 * Correct a single claim: compute From/To from Service Line dates, set the
 * Statement Covers Period, set Type of Bill frequency (2 if admission date is
 * among the service-line dates, else 3), and optionally Resubmit.
 *
 * @returns {Promise<Object>} per-claim result
 */
async function correctClaim(page, claim, submit, confirmFn) {
    const r = {
        claimNo: claim.claimNo, claimId: claim.claimId, url: claim.url,
        opened: false, verified: false,
        serviceDates: [], fromDate: "", toDate: "",
        hipps: { applied: false, revCode: "", from: "", to: "" },
        admissionDate: "", frequencyBefore: "", frequencyAfter: "",
        factype: "", tobBefore: "", tobAfter: "",
        dischargeStatusBefore: "", dischargeStatusAfter: "", dischargeStatusChanged: false,
        lastServiceDate: "", tobRule: "",
        correctionType: claim.correctionType || "duplicate", insurance: claim.insurance || "",
        priorAuthBefore: "", priorAuthAfter: "", priorAuthChanged: false,
        procRewrites: [], totalCharges: "", patientEstimateSet: "",
        submitted: false, skipped: false, error: null
    };
    const isTcode = r.correctionType === "tcode";
    try {
        log(`\n  ── Claim #${claim.claimNo} (id ${claim.claimId}) ──`);
        // Navigating away from a previously-edited claim can raise a beforeunload
        // prompt. Playwright auto-handles it, but guard with a single retry.
        try {
            await page.goto(claim.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        } catch (navErr) {
            log(`     ⚠️  First navigation attempt failed (${navErr.message}); retrying...`);
            await page.waitForTimeout(1500);
            await page.goto(claim.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        }
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        r.opened = true;

        // VERIFY: the editclaimid in the current URL must match the expected id.
        const curUrl = page.url();
        const m = curUrl.match(/editclaimid=(\d+)/i);
        const onPageId = m ? m[1] : "";
        if (onPageId && onPageId === String(claim.claimId)) {
            r.verified = true;
            log(`     ✓ Verified claim id ${onPageId} is open`);
        } else {
            r.skipped = true;
            r.error = `Open claim id "${onPageId}" != expected "${claim.claimId}" — skipping (no edits made)`;
            log(`     ⚠️  ${r.error}`);
            await screenshot(page, `SKIP_verify_${claim.claimNo}`);
            return r;
        }

        // TCODE flow only: STEP 0 — Insurance tab → strip "TCODE" from Prior Auth.
        if (isTcode) {
            await clickMenuTab(page, "ins", "Insurance");
            const pa = await stripTcodeFromPriorAuth(page);
            if (!pa.found) {
                log(`     ⚠️  TCODE: Prior Auth field (#ins_FV2_priorauth) not found — continuing without Prior Auth edit.`);
            } else {
                r.priorAuthBefore = pa.before;
                r.priorAuthAfter = pa.after;
                r.priorAuthChanged = !!pa.changed;
                log(`     ${pa.changed ? "✓" : "ℹ️ "} TCODE Prior Auth: "${pa.before}"${pa.changed ? ` → "${pa.after}"` : " (no TCODE token found — unchanged)"}`);
            }
            await screenshot(page, `TCODE_priorauth_${claim.claimNo}`);
        }

        // STEP: Service Line — read rows (rev code + service date per row).
        await clickMenuTab(page, "slv", "Service Line");
        let svc = await readServiceLineRows(page);
        if (svc.error || svc.rows.length === 0) {
            r.error = `Could not read Service Line rows (${svc.error || "0 rows"})`;
            r.skipped = true;
            log(`     ⚠️  ${r.error} — skipping`);
            await screenshot(page, `SKIP_nosvc_${claim.claimNo}`);
            return r;
        }
        log(`     Service lines (${svc.rows.length}): ` +
            svc.rows.map((x, i) => `#${i + 1} rev=${x.revCode || "-"} date=${x.serviceDate || "-"}`).join(" | "));

        // TCODE flow only: rewrite G0299/G0300 → T1502 and set Covered Charges =
        // 139 * Units for those rows. Total Charges auto-recalculates from lines.
        if (isTcode) {
            const rw = await rewriteSeniorWholeHealthProcCodes(page);
            r.procRewrites = rw.rewrites || [];
            if (rw.error) {
                log(`     ⚠️  TCODE: proc-code rewrite skipped — ${rw.error}`);
            } else if (rw.count > 0) {
                rw.rewrites.forEach(x => log(`     ✓ TCODE: ${x.fromProc} → T1502, charge = 139 × ${x.units} = ${x.charge}`));
                await page.waitForTimeout(500);
                // Re-read rows so the date logic reflects any grid changes.
                svc = await readServiceLineRows(page);
            } else {
                log(`     ℹ️  TCODE: no G0299/G0300 proc codes to rewrite.`);
            }
        }

        // HIPPS rule: ONLY when row 1's Rev Code contains 0023. If row 1's service
        // (from) date is EARLIER than row 2's service (from) date, copy row 2's
        // date into row 1. (Per spec: use the SECOND row's date, not the last row.)
        r.hipps = { applied: false, revCode: svc.rows[0].revCode, from: svc.rows[0].serviceDate, to: "" };
        if (svc.rows.length >= 2 && String(svc.rows[0].revCode || "").includes("0023")) {
            const first = svc.rows[0];
            const second = svc.rows[1];
            const k1 = dateKey(first.serviceDate), k2 = dateKey(second.serviceDate);
            const row1EarlierThanRow2 = !isNaN(k1) && !isNaN(k2) && k1 < k2;
            if (second.serviceDate && row1EarlierThanRow2) {
                if (!first.dateInputId) {
                    log(`     ⚠️  HIPPS: row 1 date input not locatable — cannot update top line date`);
                } else {
                    // ASP.NET ids are [A-Za-z0-9_] only, so an attribute selector is safe.
                    const okFinal = await setInputValue(page, `input[id='${first.dateInputId}']`, second.serviceDate);
                    if (okFinal) {
                        r.hipps.applied = true;
                        r.hipps.to = second.serviceDate;
                        log(`     ✓ HIPPS (Rev 0023): row 1 service date ${first.serviceDate} → ${second.serviceDate} (row 2)`);
                        await page.waitForTimeout(500);
                        // Re-read rows so From/To reflects the corrected top-line date.
                        svc = await readServiceLineRows(page);
                    } else {
                        log(`     ⚠️  HIPPS: failed to set row 1 date input (#${first.dateInputId})`);
                    }
                }
            } else {
                log(`     ℹ️  HIPPS: row 1 Rev 0023 but row 1 date (${first.serviceDate}) is not earlier than row 2 (${second.serviceDate}) — no change`);
            }
        }

        const dates = svc.rows.map(x => x.serviceDate).filter(Boolean);
        if (dates.length === 0) {
            r.error = "No usable service dates after reading rows";
            r.skipped = true;
            log(`     ⚠️  ${r.error} — skipping`);
            await screenshot(page, `SKIP_nodates_${claim.claimNo}`);
            return r;
        }
        r.serviceDates = dates;
        // Statement Covers Period = earliest service date (From) through latest (To).
        // Single row: From = To = that date.
        const sorted = dates.slice().sort((a, b) => {
            const ka = dateKey(a), kb = dateKey(b);
            if (isNaN(ka) || isNaN(kb)) return 0;
            return ka - kb;
        });
        r.fromDate = sorted[0];
        r.toDate = sorted[sorted.length - 1];
        log(`     → From = ${r.fromDate} (earliest), To = ${r.toDate} (latest)`);

        // STEP: Claim — set statement period + read admission date + set TOB.
        await clickMenuTab(page, "clt", "Claim");

        // Read current values first.
        const before = await page.evaluate(() => {
            const g = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
            return {
                admission: g("clt_tc_genTP_gen_FV_admissiondate"),
                factype: g("clt_tc_genTP_gen_FV_factype"),
                frequency: g("clt_tc_genTP_gen_FV_frequency"),
                stmtFrom: g("clt_tc_genTP_gen_FV_statementfromdate"),
                stmtTo: g("clt_tc_genTP_gen_FV_statementtodate")
            };
        });
        if (before.frequency == null || before.factype == null) {
            r.error = "Claim tab fields not found (factype/frequency)";
            r.skipped = true;
            log(`     ⚠️  ${r.error} — skipping`);
            await screenshot(page, `SKIP_noclaimfields_${claim.claimNo}`);
            return r;
        }
        r.admissionDate = normDate(before.admission);
        r.factype = before.factype;
        r.frequencyBefore = before.frequency;
        r.tobBefore = `${before.factype}${before.frequency}`;

        // Read Patient Discharge Status (UB-04 FL 17). Drives the 324/323 rule below.
        const dischargeFieldId = await findDischargeStatusFieldId(page);
        r.dischargeStatusBefore = await readDischargeStatus(page, dischargeFieldId);
        r.dischargeStatusAfter = r.dischargeStatusBefore;
        if (!dischargeFieldId) {
            log(`     ⚠️  Patient Discharge Status field not found — discharge-based TOB rule cannot apply; using admission-date rule.`);
        } else {
            log(`     Patient Discharge Status: ${r.dischargeStatusBefore || "(blank)"} (field #${dischargeFieldId})`);
        }

        // Set Statement Covers Period From/Through.
        await setInputValue(page, "#clt_tc_genTP_gen_FV_statementfromdate", r.fromDate);
        await setInputValue(page, "#clt_tc_genTP_gen_FV_statementtodate", r.toDate);
        log(`     ✓ Statement period set: ${r.fromDate} – ${r.toDate}`);

        // The ACTUAL last Service Line row's date (grid order, after any HIPPS edit),
        // compared against the Statement Covers "To" date for the discharge-01 rule.
        const lastRowDate = (svc.rows[svc.rows.length - 1] || {}).serviceDate || "";
        r.lastServiceDate = lastRowDate;
        const lastRowEqualsTo = !!lastRowDate && dateKey(lastRowDate) === dateKey(r.toDate);

        // Type of Bill (Facility & Frequency) decision:
        //   • Discharge Status == 01 (duplicate-date 327):
        //       - last Service Line date == Statement "To" date → TOB 324 (leave discharge 01)
        //       - last Service Line date != Statement "To" date → TOB 323 AND set Discharge Status = 30
        //   • Otherwise (discharge != 01 / unreadable): admission-date rule —
        //       322 (frequency 2) if admission matches a service-line date, else 323.
        const admKey = dateKey(r.admissionDate);
        const admissionInServiceDates = !isNaN(admKey) &&
            dates.some(d => dateKey(d) === admKey);

        if (r.dischargeStatusBefore === "01") {
            if (lastRowEqualsTo) {
                r.tobRule = "discharge01-lastEqualsTo→324";
                r.frequencyAfter = "4";
                log(`     Discharge 01 + last service date ${lastRowDate} == To ${r.toDate} → TOB ${before.factype}24`);
            } else {
                r.tobRule = "discharge01-lastNotEqualsTo→323+disch30";
                r.frequencyAfter = "3";
                // Change Patient Discharge Status 01 → 30.
                const setOk = await setDischargeStatus(page, dischargeFieldId, "30");
                if (setOk) {
                    r.dischargeStatusAfter = "30";
                    r.dischargeStatusChanged = true;
                    log(`     Discharge 01 + last service date ${lastRowDate || "(none)"} != To ${r.toDate} → TOB ${before.factype}23 AND Discharge Status 01 → 30`);
                } else {
                    log(`     ⚠️  Discharge 01 + last != To: TOB ${before.factype}23, but FAILED to set Discharge Status → 30 (field #${dischargeFieldId || "?"}).`);
                }
            }
        } else {
            r.tobRule = admissionInServiceDates ? "admissionMatches→322" : "admissionNoMatch→323";
            r.frequencyAfter = admissionInServiceDates ? "2" : "3";
            log(`     Admission date: ${r.admissionDate} — ${admissionInServiceDates ? "MATCHES a service date → TOB 322" : "no match → TOB 323"} (discharge status ${r.dischargeStatusBefore || "n/a"})`);
        }

        await setInputValue(page, "#clt_tc_genTP_gen_FV_frequency", r.frequencyAfter);
        r.tobAfter = `${before.factype}${r.frequencyAfter}`;
        log(`     ✓ Type of Bill: ${r.tobBefore} → ${r.tobAfter}${r.dischargeStatusChanged ? ` | Discharge Status: ${r.dischargeStatusBefore} → ${r.dischargeStatusAfter}` : ""}`);

        // TCODE flow only: if any proc code was rewritten to T1502, the line
        // charges changed and Total Charges auto-recalculated. Copy the new Total
        // Charges into Patient Estimated Amount Due (#clt_tc_genTP_gen_FV_patestamt).
        if (isTcode && (r.procRewrites || []).length > 0) {
            r.totalCharges = await readTotalCharges(page);
            if (r.totalCharges) {
                const ok = await setInputValue(page, "#clt_tc_genTP_gen_FV_patestamt", r.totalCharges);
                if (ok) {
                    r.patientEstimateSet = r.totalCharges;
                    log(`     ✓ TCODE: Patient Estimated Amount Due set to Total Charges = ${r.totalCharges}`);
                } else {
                    log(`     ⚠️  TCODE: could not set Patient Estimated Amount Due (#clt_tc_genTP_gen_FV_patestamt).`);
                }
            } else {
                log(`     ⚠️  TCODE: Total Charges (#FV_totalCharges) unreadable — Patient Estimated Amount Due left unchanged.`);
            }
        }

        await screenshot(page, `EDITED_${claim.claimNo}`);

        // RESUBMIT (irreversible) — only when submission is enabled AND confirmed.
        if (!submit) {
            r.skipped = true;
            log(`     ⏸️  Submission disabled (dry run) — edits made but NOT resubmitted.`);
            return r;
        }
        // Ask the user to confirm this specific claim before the irreversible Resubmit.
        let proceed = true;
        if (typeof confirmFn === "function") {
            log(`     ❓ Confirm resubmit: claim #${claim.claimNo} | ${r.tobBefore} → ${r.tobAfter} | statement ${r.fromDate}–${r.toDate}${r.dischargeStatusChanged ? ` | discharge ${r.dischargeStatusBefore}→${r.dischargeStatusAfter}` : ""}`);
            proceed = await confirmFn(r);
        }
        if (!proceed) {
            r.skipped = true;
            r.confirmDeclined = true;
            log(`     🚫 Resubmit declined by user — claim left edited but NOT submitted.`);
            return r;
        }
        const resubmitted = await page.evaluate(() => {
            const btn = document.querySelector("#ResubmitButton");
            if (!btn) return false;
            btn.click();
            return true;
        });
        if (!resubmitted) {
            r.error = "Resubmit button (#ResubmitButton) not found";
            log(`     ⚠️  ${r.error}`);
            await screenshot(page, `NORESUBMIT_${claim.claimNo}`);
            return r;
        }
        // Resubmit may raise a JS confirm() — the page-level dialog handler accepts it.
        await page.waitForTimeout(4000);
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        r.submitted = true;
        log(`     ✅ Resubmitted claim #${claim.claimNo}`);
        await screenshot(page, `RESUBMITTED_${claim.claimNo}`);
        return r;
    } catch (e) {
        r.error = e.message;
        log(`     ❌ Error correcting claim #${claim.claimNo}: ${e.message}`);
        try { await screenshot(page, `ERROR_${claim.claimNo}`); } catch (_) {}
        return r;
    }
}

/**
 * Iterate the enriched TOB-327 claims and correct each one.
 * @param page         logged-in Playwright page (already on the correct account)
 * @param enriched     [{ claimNo, claimId, url }]
 * @param submit       when true, actually clicks Resubmit (irreversible)
 */
async function correctAllClaims(page, enriched, submit, confirmFn) {
    log(`\n${"=".repeat(70)}`);
    log(`CLAIM CORRECTION — ${enriched.length} TOB-327 claim(s) ${submit ? "(RESUBMIT ENABLED — will confirm each)" : "(DRY RUN — no resubmit)"}`);
    log(`${"=".repeat(70)}`);
    const results = [];
    for (let i = 0; i < enriched.length; i++) {
        log(`\n[${i + 1}/${enriched.length}]`);
        let res;
        try {
            res = await correctClaim(page, enriched[i], submit, confirmFn);
        } catch (e) {
            res = { ...enriched[i], error: e.message, opened: false, verified: false, submitted: false, skipped: false };
            log(`     ❌ Unhandled error on claim #${enriched[i].claimNo}: ${e.message}`);
        }
        results.push(res);
        // Guard the inter-claim pause so a dead context doesn't abort the batch.
        try { await page.waitForTimeout(1200); } catch (_) {}
    }
    const submitted = results.filter(x => x.submitted).length;
    const edited = results.filter(x => x.verified && !x.skipped).length;
    const skipped = results.filter(x => x.skipped).length;
    const errored = results.filter(x => x.error && !x.skipped).length;
    log(`\n=== Correction summary: ${edited} edited, ${submitted} resubmitted, ${skipped} skipped, ${errored} errored ===`);
    return { results, submitted, edited, skipped, errored };
}

// ---------------------------------------------------------------------------
// Orchestrator: full Waystar step for one office/state
// ---------------------------------------------------------------------------
/**
 * Runs the Waystar post-processing step for a single office.
 * @param {Object} opts
 * @param {string} opts.stateCode  Office stateCode (e.g. "NV")
 * @param {string} [opts.officeName]
 * @param {import('playwright').Page} [opts.page]   Reuse an existing logged-in page (optional)
 * @returns {Promise<Object>} summary
 */
// Build the per-claim Resubmit confirmation function from the run options.
//  - A caller-supplied opts.confirmFn takes precedence.
//  - opts.autoConfirm === true → resubmit without pausing.
//  - TTY attached (local CLI) → stdin y/N prompt.
//  - Otherwise (server/background) → file-based approve/skip.
function buildConfirmFn(opts) {
    if (opts && typeof opts.confirmFn === "function") return opts.confirmFn;
    // Auto-confirm (no per-claim pause) when explicitly requested OR when the
    // env flag WAYSTAR_AUTO_CONFIRM=true is set (used on the server for an
    // unattended run alongside WAYSTAR_SUBMIT=true).
    if ((opts && opts.autoConfirm === true) || process.env.WAYSTAR_AUTO_CONFIRM === "true") {
        return (r) => { log(`     ✅ Auto-confirm enabled — resubmitting claim #${r.claimNo}`); return Promise.resolve(true); };
    }
    if (process.stdin.isTTY) {
        return (r) => confirmOnStdin(`Resubmit claim #${r.claimNo} (${r.tobBefore}→${r.tobAfter}, ${r.fromDate}–${r.toDate})?`);
    }
    return (r) => confirmViaFile(`Resubmit claim #${r.claimNo} (${r.tobBefore}→${r.tobAfter}, statement ${r.fromDate}–${r.toDate})?`, r.claimNo);
}

// Open a PERSISTENT browser context so the "Trust this device" cookie survives
// between runs — this way the security question is asked once per profile, not
// every run. Returns { context, page }. Caller closes the context.
async function openWaystarContext() {
    const profileDir = path.join(process.cwd(), ".waystar-browser-profile");
    try { if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true }); } catch (_) {}
    const context = await playwright_1.chromium.launchPersistentContext(profileDir, {
        headless: process.env.HEADLESS !== "false",
        acceptDownloads: true
    });
    // Persistent context opens with one about:blank page; reuse it.
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(30000);
    return { context, page };
}

// Attach the standard dialog handler (beforeunload left to Playwright; others accepted).
function attachDialogHandler(page) {
    page.on("dialog", async (dialog) => {
        if (dialog.type() === "beforeunload") {
            log(`  💬 beforeunload dialog — leaving default handling to Playwright`);
            return;
        }
        log(`  💬 Dialog (${dialog.type()}): "${dialog.message()}" → accepting`);
        try { await dialog.accept(); } catch (_) {}
    });
}

// Core per-office work on an ALREADY-LOGGED-IN page: switch account, navigate,
// filter, download CSV, enrich the office's Excel, and correct 327 claims.
// Assumes the caller handled login. Does NOT close the browser.
async function runWaystarOnPage(page, account, opts) {
    const stateCode = account.stateCode;
    const doCorrect = opts && opts.correct === false ? false : true;
    const doSubmit = (opts && opts.submit === true) || process.env.WAYSTAR_SUBMIT === "true";

    log(`\n${"=".repeat(70)}`);
    log(`WAYSTAR PROCESSING: ${account.officeName} (${stateCode}) → ${account.displayText}`);
    log(`${"=".repeat(70)}`);

    // A state can have MANY selected-records files — one per insurance (e.g. MA/
    // Taunton processes each insurance separately). Process ALL of them against
    // the single rejected CSV for this account.
    // opts.excelFiles (optional): an explicit list of Excel paths to process
    // instead of auto-discovering them on disk. Used by the "upload an Excel"
    // endpoint so a user can test the Waystar step with a specific file.
    const excelFiles = (opts && Array.isArray(opts.excelFiles) && opts.excelFiles.length > 0)
        ? opts.excelFiles
        : findAllSelectedRecordsFiles(stateCode);
    if (excelFiles.length === 0) {
        const msg = `No selected-records-${stateCode}-*.xlsx found in ${process.cwd()}. Run the Kinnser step first (or upload an Excel).`;
        log(`⚠️  ${msg}`);
        return { success: false, skipped: true, reason: msg, stateCode, account: account.displayText };
    }
    if (opts && Array.isArray(opts.excelFiles) && opts.excelFiles.length > 0) {
        log(`📎 Using ${excelFiles.length} UPLOADED Excel file(s) instead of on-disk auto-discovery.`);
    }
    log(`📄 ${excelFiles.length} selected-records file(s) for ${stateCode}:`);
    excelFiles.forEach(f => log(`     • ${path.basename(f)}  [${readInsuranceFromExcel(f) || "?"}]`));

    // One CSV download per account covers all insurances for the office.
    await switchAccount(page, account);
    await navigateToClaims(page);
    await setAllRejectedFilter(page);
    const csvPath = await downloadRejectedCsv(page, account);

    const { byClaimNumber, rowCount, screenType } = parseClaimsCsv(csvPath);
    if (screenType === "Professional") {
        log(`  ⚠️  Downloaded a PROFESSIONAL claims CSV — expected INSTITUTIONAL.`);
    }

    const submitEnabled = doSubmit;
    const confirmFn = buildConfirmFn(opts);
    const files = []; // per-insurance (per-file) results

    // Aggregate office-level counters for the summary.
    let totMatched = 0, totTob327 = 0, allUnmatched = [];

    for (const excelPath of excelFiles) {
        const insurance = readInsuranceFromExcel(excelPath) || "";
        log(`\n${"-".repeat(70)}`);
        log(`INSURANCE FILE: ${path.basename(excelPath)}  [${insurance || "unknown insurance"}]`);
        log(`${"-".repeat(70)}`);

        if (rowCount === 0) {
            log(`  ⚠️  CSV produced 0 claim-number→id mappings. Nothing to enrich.`);
            files.push({ excelPath, insurance, matched: 0, tob327: 0, unmatched: [], correction: null });
            continue;
        }

        const result = enrichSelectedRecordsExcel(excelPath, byClaimNumber);
        totMatched += result.matched; totTob327 += result.tob327;
        (result.unmatched || []).forEach(u => allUnmatched.push({ ...u, insurance }));

        // Correct eligible 327 claims: duplicate-date 327s AND TCODE 327s for
        // Senior Whole Health (incl. BID). Other 327s (TCODE for other payers,
        // Partnership, etc.) are enriched with Claim ID/URL but NOT corrected.
        const correctable = (result.enriched || []).filter(e => e.eligible).map(e => ({ ...e, insurance: e.insurance || insurance }));
        const skippedByReason = (result.enriched || []).filter(e => !e.eligible).map(e => ({ ...e, insurance: e.insurance || insurance }));

        let correction = null;
        if (doCorrect && correctable.length > 0) {
            correction = await correctAllClaims(page, correctable, doSubmit, confirmFn);
        } else if (doCorrect) {
            log(`\n  ℹ️  No eligible (duplicate-date or TCODE/Senior Whole Health) TOB-327 claims to correct in this file` +
                (skippedByReason.length ? ` (${skippedByReason.length} other 327 enriched but not corrected).` : `.`));
        } else {
            log(`\n  ⏭️  Claim correction disabled (correct=false).`);
        }

        files.push({
            excelPath, insurance,
            matched: result.matched, tob327: result.tob327,
            eligibleCount: result.eligibleCount || 0,
            skippedReasonCount: result.skippedReasonCount || 0,
            // 327s enriched (Claim ID/URL) but NOT corrected because the 327 reason
            // is not "duplicate dates" (TCODE/Partnership/etc.).
            notCorrected: skippedByReason.map(e => ({ claimNo: e.claimNo, claimId: e.claimId, url: e.url, reason: e.reason, insurance })),
            unmatched: (result.unmatched || []).map(u => ({ ...u, insurance })),
            correction: correction ? {
                edited: correction.edited, submitted: correction.submitted,
                skipped: correction.skipped, errored: correction.errored, results: correction.results
            } : null
        });
    }

    log(`\n✅ Waystar step complete for ${account.officeName} (${excelFiles.length} insurance file(s))`);
    return {
        success: true, stateCode, account: account.displayText, csvPath,
        csvMappings: rowCount, matched: totMatched, tob327: totTob327,
        unmatched: allUnmatched, submitEnabled, files
    };
}

// Single-office entry point: launches its own browser, logs in, runs one office.
async function processWaystarForOffice(opts) {
    const { stateCode, officeName } = opts || {};
    const account = waystar_config_1.getWaystarAccountForState(stateCode) ||
        (officeName ? waystar_config_1.getWaystarAccountForOffice(officeName) : null);

    if (!account) {
        const msg = `No Waystar account mapped for state "${stateCode}"${officeName ? ` / office "${officeName}"` : ""} — skipping Waystar step.`;
        log(`⚠️  ${msg}`);
        return { success: false, skipped: true, reason: msg, stateCode };
    }

    let context = null;
    try {
        const opened = await openWaystarContext();
        context = opened.context;
        const page = opened.page;
        attachDialogHandler(page);

        await waystarLogin(page);
        const officeResult = await runWaystarOnPage(page, account, opts || {});
        // Single-office run report (per-claim actions).
        try { officeResult.report = writeWaystarRunReport([officeResult]); } catch (e) { log(`⚠️  Report generation failed: ${e.message}`); }
        return officeResult;
    } catch (error) {
        log(`❌ Waystar step failed for ${account.officeName}: ${error.message}`);
        throw error;
    } finally {
        if (context) {
            await context.close().catch(() => {});
            log(`🔒 Waystar browser closed`);
        }
    }
}

/**
 * All-offices entry point: ONE browser + ONE login, processes each office in the
 * given order (switching Waystar account per office). Offices without a Waystar
 * account mapping (e.g. CT) are skipped.
 *
 * @param {Array} officesInOrder  [{ stateCode, name }] in the order to process.
 * @param {Object} opts           { submit, correct, autoConfirm, confirmFn }
 * @returns {Promise<Object>}     { success, offices: [perOfficeResult] }
 */
async function processWaystarForAllOffices(officesInOrder, opts = {}) {
    // Resolve each requested office to a Waystar account; skip unmapped ones.
    const planned = [];
    for (const o of (officesInOrder || [])) {
        const acct = waystar_config_1.getWaystarAccountForState(o.stateCode) ||
            (o.name ? waystar_config_1.getWaystarAccountForOffice(o.name) : null);
        if (acct) planned.push(acct);
        else log(`⚠️  Skipping "${o.name || o.stateCode}" — no Waystar account mapped.`);
    }
    if (planned.length === 0) {
        return { success: false, skipped: true, reason: "No Waystar-mapped offices to process.", offices: [] };
    }

    log(`\n${"#".repeat(70)}`);
    log(`WAYSTAR — ALL OFFICES (${planned.length}) in order: ${planned.map(a => `${a.officeName} (${a.stateCode})`).join(" → ")}`);
    log(`${"#".repeat(70)}`);

    let context = null;
    const offices = [];
    try {
        const opened = await openWaystarContext();
        context = opened.context;
        const page = opened.page;
        attachDialogHandler(page);

        await waystarLogin(page);

        for (let i = 0; i < planned.length; i++) {
            const account = planned[i];
            log(`\n>>> [${i + 1}/${planned.length}] ${account.officeName} (${account.stateCode})`);
            try {
                const res = await runWaystarOnPage(page, account, opts);
                offices.push(res);
            } catch (e) {
                log(`❌ Office ${account.officeName} failed: ${e.message}`);
                offices.push({ success: false, stateCode: account.stateCode, account: account.displayText, error: e.message });
                // Continue with the next office rather than aborting the whole batch.
            }
            try { await page.waitForTimeout(2000); } catch (_) {}
        }

        const okCount = offices.filter(o => o.success).length;
        log(`\n${"#".repeat(70)}`);
        log(`WAYSTAR ALL-OFFICES DONE — ${okCount}/${planned.length} succeeded`);
        log(`${"#".repeat(70)}`);
        // Consolidated run report (per-claim actions across all offices).
        let report = null;
        try { report = writeWaystarRunReport(offices); } catch (e) { log(`⚠️  Report generation failed: ${e.message}`); }
        return { success: true, offices, report };
    } catch (error) {
        log(`❌ Waystar all-offices run failed: ${error.message}`);
        // Still try to emit a report for whatever completed before the failure.
        let report = null;
        try { report = writeWaystarRunReport(offices); } catch (e) {}
        return { success: false, error: error.message, offices, report };
    } finally {
        if (context) {
            await context.close().catch(() => {});
            log(`🔒 Waystar browser closed`);
        }
    }
}

// Allow running standalone:
//   node dist/waystar-processor.js <stateCode> [--submit] [--no-correct]
// By default runs a DRY RUN (edits made, no Resubmit). Pass --submit to resubmit.
if (require.main === module) {
    const arg = process.argv[2];
    if (!arg) {
        console.error("Usage: node dist/waystar-processor.js <stateCode|ALL> [--submit] [--no-correct] [--auto-confirm]");
        process.exit(1);
    }
    const submit = process.argv.includes("--submit");
    const correct = !process.argv.includes("--no-correct");
    // --auto-confirm (alias --yes): resubmit without the per-claim confirmation pause.
    const autoConfirm = process.argv.includes("--auto-confirm") || process.argv.includes("--yes");

    const run = arg.toUpperCase() === "ALL"
        // ALL: process every Waystar-mapped office in office-config order.
        ? processWaystarForAllOffices(
            waystar_config_1.WAYSTAR_ACCOUNTS.map(a => ({ stateCode: a.stateCode, name: a.officeName })),
            { submit, correct, autoConfirm })
        : processWaystarForOffice({ stateCode: arg, submit, correct, autoConfirm });

    run.then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch((e) => { console.error(e); process.exit(1); });
}
