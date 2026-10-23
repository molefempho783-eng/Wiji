// Labels shared with the app (keep in sync with services/drivers.ts, services/business.ts and functions).

export const DRIVER_CHECKS = {
  identity: "Identity (ID matches selfie)",
  licence: "Driver's licence",
  prdp: "Professional Driving Permit",
  criminalRecord: "Criminal record check",
  vehicle: "Vehicle (photos, disc, roadworthy)",
  insurance: "Passenger insurance",
  operatingLicence: "Operating licence",
};

export const DRIVER_DOCS = {
  idDocument: "ID document",
  selfie: "Live selfie",
  licence: "Driver's licence",
  prdp: "PrDP",
  proofOfAddress: "Proof of address",
  licenceDisc: "Licence disc",
  roadworthy: "Roadworthy certificate",
  insurance: "Insurance",
  operatingLicence: "Operating licence",
  carFront: "Car: front",
  carBack: "Car: back",
  carLeft: "Car: left",
  carRight: "Car: right",
};
export const EXPIRING = ["licence", "prdp", "licenceDisc", "roadworthy", "insurance", "operatingLicence"];

export const BUSINESS_DOCS = {
  ownerId: "Owner's ID",
  proofOfAddress: "Proof of business address",
  registration: "CIPC registration",
  storefront: "Photo of the business",
};
export const BUSINESS_TYPES = {
  informal: "Informal / spaza",
  sole_proprietor: "Sole proprietor",
  company: "Company (Pty) Ltd",
  nonprofit: "Non-profit / NPC",
};

export const INCIDENT_CATEGORIES = {
  sexual_misconduct: "Sexual harassment or assault",
  threats_violence: "Threats or violence",
  unsafe_driving: "Unsafe or reckless driving",
  driver_mismatch: "Driver or car didn't match",
  route_fare: "Route or fare problem",
  rudeness: "Rude or unprofessional",
  passenger_conduct: "Problem with a passenger",
  other: "Something else",
};

export const STATUS = {
  draft: ["In progress", ""],
  submitted: ["Waiting for review", "warn"],
  in_review: ["In review", "info"],
  approved: ["Approved", "good"],
  verified: ["Verified", "good"],
  declined: ["Declined", "bad"],
  suspended: ["Suspended", "bad"],
  paused: ["Paused", "warn"],
  active: ["Active", "good"],
  open: ["Open", "bad"],
  acknowledged: ["Acknowledged", "warn"],
  investigating: ["Investigating", "warn"],
  resolved: ["Resolved", "good"],
  no_action: ["Closed, no action", ""],
  passed: ["Passed", "good"],
  failed: ["Failed", "bad"],
  pending: ["Pending", ""],
};
