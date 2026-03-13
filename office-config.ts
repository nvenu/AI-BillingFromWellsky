export interface Office {
  value: string;
  name: string;
  stateCode: string;
}

export const OFFICES: Office[] = [
  { value: "1407132,Clinic", name: "Nightingale - Taunton", stateCode: "MA" },
  { value: "1407125,Clinic", name: "Aspire - Dublin", stateCode: "OH" },
  { value: "1407126,Clinic", name: "Aspire - San Diego", stateCode: "SD" },
  { value: "1407127,Clinic", name: "Aspire - Scottsdale", stateCode: "AZ" },
  { value: "1407128,Clinic", name: "Aspire - Yuba City", stateCode: "YC" },
  { value: "1407129,Clinic", name: "Nightingale - Las Vegas", stateCode: "NV" },
  { value: "1407130,Clinic", name: "Nightingale - Minnetonka", stateCode: "MN" },
  { value: "1407131,Clinic", name: "Nightingale - Pompano Beach", stateCode: "FL" },
  { value: "1417923,Clinic", name: "Nightingale - Stamford", stateCode: "CT" },
  { value: "1407133,Clinic", name: "Nightingale - Willowbrook", stateCode: "IL" }
];

// Skip Corporation level
// { value: "75945,Corporation", name: "Homecare Providers", stateCode: "ALL" }
