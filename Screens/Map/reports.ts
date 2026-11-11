// Municipal problem reports on the map (load shedding, potholes, leaks, broken infrastructure…).
// Public data lives in municipalReports/{id}. Who sent it lives in municipalReportOwners/{id}, which
// only the reporter and the Wiji team can read, so anonymous reports stay anonymous to other users.
import { Ionicons } from "@expo/vector-icons";

export type ReportCategory =
  | "power" | "pothole" | "water" | "sewage" | "streetlight"
  | "traffic-light" | "dumping" | "infrastructure" | "other";

export type ReportStatus = "open" | "in_progress" | "fixed";

export interface MunicipalReport {
  id: string;
  category: ReportCategory;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
  location: string;
  photoUrl?: string;
  anonymous: boolean;
  /** Only present when the reporter chose to show their name */
  reporterUid?: string;
  reporterName?: string;
  status: ReportStatus;
  /** People who say the problem affects them too */
  affectedBy: string[];
  /** People who say it has been fixed; 3 votes mark it fixed */
  fixedVotes: string[];
  staffNote?: string;
  createdAt?: any;
  fixedAt?: any;
  distance?: number;
}

export const FIXED_VOTES_NEEDED = 3;
/** Fixed reports stay on the map (with a green tick) this long, so people can see things getting fixed */
export const SHOW_FIXED_FOR_MS = 2 * 864e5;

export const REPORT_CATEGORIES: {
  key: ReportCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  ideas: string[];
}[] = [
  { key: "power", label: "Power / load shedding", icon: "flash-off", color: "#F5A623", ideas: ["No power in the area", "Load shedding over schedule", "Transformer blew", "Cable theft"] },
  { key: "pothole", label: "Pothole", icon: "warning", color: "#E67E22", ideas: ["Big pothole", "Road falling apart", "Sinkhole"] },
  { key: "water", label: "Water", icon: "water", color: "#2E86DE", ideas: ["Burst pipe", "No water", "Leaking meter", "Dirty tap water"] },
  { key: "sewage", label: "Sewage", icon: "alert-circle", color: "#8D6E63", ideas: ["Sewage overflowing", "Blocked drain", "Bad smell"] },
  { key: "streetlight", label: "Streetlight", icon: "bulb", color: "#8E44AD", ideas: ["Streetlight out", "Light on all day", "Pole fell over"] },
  { key: "traffic-light", label: "Traffic light", icon: "stop-circle", color: "#E74C3C", ideas: ["Robot not working", "Robot stuck on red", "Robot flashing"] },
  { key: "dumping", label: "Illegal dumping", icon: "trash", color: "#27AE60", ideas: ["Rubbish dumped", "Bins not collected", "Building rubble"] },
  { key: "infrastructure", label: "Broken infrastructure", icon: "construct", color: "#607D8B", ideas: ["Broken pavement", "Missing manhole cover", "Damaged bridge", "Broken fence"] },
  { key: "other", label: "Something else", icon: "help-circle", color: "#95A5A6", ideas: [] },
];

export const reportCategory = (k: string) =>
  REPORT_CATEGORIES.find((x) => x.key === k) || REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];

export const REPORT_STATUS: Record<ReportStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  open: { label: "Reported", color: "#E67E22", icon: "megaphone-outline" },
  in_progress: { label: "Being fixed", color: "#2E86DE", icon: "construct-outline" },
  fixed: { label: "Fixed", color: "#27AE60", icon: "checkmark-circle" },
};

export const toMillis = (t: any): number =>
  !t ? 0 : t.toMillis ? t.toMillis() : t.seconds != null ? t.seconds * 1000 : t instanceof Date ? t.getTime() : 0;

/** Open and in-progress reports, plus ones fixed in the last two days */
export const isReportOnMap = (r: MunicipalReport) =>
  r.status !== "fixed" || Date.now() - toMillis(r.fixedAt) < SHOW_FIXED_FOR_MS;

export function timeAgo(t: any) {
  const ms = toMillis(t);
  if (!ms) return "just now";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
