"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAYSTAR_ACCOUNTS = void 0;
exports.getWaystarAccountForState = getWaystarAccountForState;
exports.getWaystarAccountForOffice = getWaystarAccountForOffice;
/**
 * Maps a Kinnser office (by stateCode) to its Waystar / ZirMed account.
 *
 * The Waystar account selector is an autocomplete <input> that displays the
 * account as "<Account Name> (<id>)". We store both the exact display text (so
 * we can type/match it in the autocomplete) and the numeric account id.
 *
 * NOTE on stateCode values: these come from office-config.js and are NOT always
 * real USPS state codes (e.g. "SD" is used for Aspire - San Diego, "YC" for
 * Yuba City). We key off whatever office-config uses so the two stay in sync.
 */
exports.WAYSTAR_ACCOUNTS = [
    {
        stateCode: "MA",
        officeName: "Nightingale - Taunton",
        accountId: "47929",
        accountName: "Nightingale Home Healthcare of Massachusetts",
        displayText: "Nightingale Home Healthcare of Massachusetts (47929)"
    },
    {
        stateCode: "OH",
        officeName: "Aspire - Dublin",
        accountId: "55711",
        accountName: "Nightingale Home Health of Ohio",
        displayText: "Nightingale Home Health of Ohio (55711)"
    },
    {
        stateCode: "SD",
        officeName: "Aspire - San Diego",
        accountId: "47924",
        accountName: "Aspire Home Healthcare",
        displayText: "Aspire Home Healthcare (47924)"
    },
    {
        stateCode: "AZ",
        officeName: "Aspire - Scottsdale",
        accountId: "56503",
        accountName: "Aspire Home Health Care of AZ",
        displayText: "Aspire Home Health Care of AZ (56503)"
    },
    {
        stateCode: "YC",
        officeName: "Aspire - Yuba City",
        accountId: "128587",
        accountName: "Aspire Home Health Care of Northern CA. Inc.",
        displayText: "Aspire Home Health Care of Northern CA. Inc. (128587)"
    },
    {
        stateCode: "NV",
        officeName: "Nightingale - Las Vegas",
        accountId: "47927",
        accountName: "Nightingale Home Healthcare of Nevada",
        displayText: "Nightingale Home Healthcare of Nevada (47927)"
    },
    {
        stateCode: "MN",
        officeName: "Nightingale - Minnetonka",
        accountId: "47926",
        accountName: "Nightingale Home Healthcare of Minnesota",
        displayText: "Nightingale Home Healthcare of Minnesota (47926)"
    },
    {
        stateCode: "FL",
        officeName: "Nightingale - Pompano Beach",
        accountId: "47933",
        accountName: "Nightingale Home Healthcare of Florida",
        displayText: "Nightingale Home Healthcare of Florida (47933)"
    },
    {
        stateCode: "IL",
        officeName: "Nightingale - Willowbrook",
        accountId: "47925",
        accountName: "Nightingale Home Healthcare of Illinois",
        displayText: "Nightingale Home Healthcare of Illinois (47925)"
    }
    // NOTE: Nightingale - Stamford (CT) has no Waystar account in the provided
    // list. It is intentionally omitted; Waystar processing is skipped for CT
    // with a warning. Add an entry here if/when a CT account exists.
];
/** Look up the Waystar account by office stateCode (case-insensitive). */
function getWaystarAccountForState(stateCode) {
    if (!stateCode)
        return null;
    const sc = String(stateCode).trim().toUpperCase();
    return exports.WAYSTAR_ACCOUNTS.find(a => a.stateCode.toUpperCase() === sc) || null;
}
/** Look up the Waystar account by exact office name. */
function getWaystarAccountForOffice(officeName) {
    if (!officeName)
        return null;
    const name = String(officeName).trim().toLowerCase();
    return exports.WAYSTAR_ACCOUNTS.find(a => a.officeName.toLowerCase() === name) || null;
}
