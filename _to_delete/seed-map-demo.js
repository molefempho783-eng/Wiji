#!/usr/bin/env node
/**
 * Seed demo activities and municipal reports around Pretoria and Johannesburg.
 *
 *   cd C:\Square\functions
 *   node scripts/seed-map-demo.js --key C:\keys\wiji-admin.json            (add or refresh)
 *   node scripts/seed-map-demo.js --key C:\keys\wiji-admin.json --remove   (delete all demo pins)
 *
 * --key   Service account key (Firebase console → Project settings → Service accounts →
 *         Generate new private key). Keep it OUTSIDE the repo. Or set GOOGLE_APPLICATION_CREDENTIALS.
 * --uid   Who the activities are "by" and who owns the reports. Default: first admin in safetyTeam.
 *
 * Safe to re-run: documents use fixed IDs (demo_*), so running again refreshes the times
 * instead of making duplicates. Activities start over the next few days, so re-run before a demo.
 */
const path = require("path");
const admin = require("firebase-admin");

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const REMOVE = args.includes("--remove");
const keyPath = arg("key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;

admin.initializeApp(
  keyPath
    ? { credential: admin.credential.cert(require(path.resolve(keyPath))), projectId: "communitychat-f3fb0" }
    : { projectId: "communitychat-f3fb0" }
);
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const HOUR = 3600e3;
const DAY = 24 * HOUR;
/** A start time `days` from today at `hour`:`min` South African time (UTC+2), never in the past */
function at(days, hour, min = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour - 2, min));
  return d.getTime() < Date.now() ? new Date(Date.now() + 10 * 60e3) : d;
}

/* ---------- activities (days from today, SA hour, duration hours) ---------- */
const ACTIVITIES = [
  // Pretoria
  ["pta_coffee", "food-and-drinks", "Grab a coffee and co-work", "Bring a laptop, we'll be at the big table by the window.", -25.7487, 28.2380, "Hatfield Plaza, Burnett St, Hatfield", 0, 10, 4],
  ["pta_run", "fitness", "Morning run around the Union Buildings", "Easy 5 km pace, everyone welcome.", -25.7400, 28.2122, "Union Buildings, Arcadia, Pretoria", 1, 6, 1.5],
  ["pta_braai", "food-and-drinks", "Sunday braai", "Bring your own meat, we've got the fire and the music.", -25.7709, 28.2365, "Brooklyn, Pretoria", 4, 13, 5],
  ["pta_study", "social", "Exam study session", "Final-year IT students, let's grind through past papers together.", -25.7546, 28.2314, "University of Pretoria, Hatfield", 0, 14, 4],
  ["pta_hike", "outdoor", "Groenkloof sunset walk", "Short trail, bring water and a torch.", -25.7810, 28.2080, "Groenkloof Nature Reserve, Pretoria", 2, 16, 2.5],
  ["pta_menlyn", "shopping", "Menlyn thrift and mall trip", "Window shopping, then food court.", -25.7826, 28.2770, "Menlyn Park, Pretoria", 3, 11, 3],
  ["pta_live", "night-life", "Live music night", "Local band, R50 at the door.", -25.7530, 28.2050, "Esselen St, Sunnyside, Pretoria", 1, 19, 4],
  ["pta_centurion", "entertainment", "Movie night", "Whatever's new, popcorn on me.", -25.8580, 28.1890, "Centurion Mall, Centurion", 2, 18, 3],
  // Johannesburg
  ["jhb_melville", "night-life", "Drinks on 7th Street", "After-work drinks, come say hi.", -26.1760, 28.0080, "7th Street, Melville, Johannesburg", 0, 18, 4],
  ["jhb_market", "food-and-drinks", "Neighbourgoods market", "Food, coffee and a walk around Braam.", -26.1930, 28.0340, "Juta St, Braamfontein, Johannesburg", 4, 10, 3],
  ["jhb_zoolake", "outdoor", "Picnic at Zoo Lake", "Blankets, snacks, frisbee.", -26.1590, 28.0300, "Zoo Lake, Parkview, Johannesburg", 3, 12, 4],
  ["jhb_emmarentia", "fitness", "Saturday parkrun warm-up", "Meet at the dam, jog and stretch together.", -26.1600, 28.0080, "Emmarentia Dam, Johannesburg", 4, 7, 1.5],
  ["jhb_maboneng", "sightseeing", "Maboneng photo walk", "Street art and rooftops, bring a camera or phone.", -26.2045, 28.0590, "Fox St, Maboneng, Johannesburg", 2, 15, 3],
  ["jhb_sandton", "social", "Founders meetup", "Startup people, let's talk ideas and funding.", -26.1080, 28.0530, "Sandton City, Sandton", 1, 17, 3],
  ["jhb_rosebank", "wellness", "Rooftop yoga", "Beginners welcome, bring a mat.", -26.1460, 28.0420, "Rosebank, Johannesburg", 1, 7, 1],
  ["jhb_midrand", "entertainment", "Gaming session", "FIFA and Tekken tournament, winner gets lunch.", -25.9990, 28.1070, "Mall of Africa, Midrand", 3, 14, 4],
];

/* ---------- municipal reports (hours ago, status, how many people affected) ---------- */
const REPORTS = [
  // Pretoria
  ["pta_power_hatfield", "power", "No power in the area", "Whole block has been off since last night, way past the load shedding schedule.", -25.7505, 28.2355, "Hilda St, Hatfield, Pretoria", 14, "open", 12],
  ["pta_pothole_lynnwood", "pothole", "Big pothole", "Deep pothole in the left lane, cars are swerving into oncoming traffic.", -25.7600, 28.2600, "Lynnwood Rd, Lynnwood, Pretoria", 72, "in_progress", 8, "City of Tshwane reference 2026-118734. Road crew booked for this week."],
  ["pta_water_sunnyside", "water", "Burst pipe", "Clean water pouring down the street for two days.", -25.7555, 28.2010, "Walker St, Sunnyside, Pretoria", 40, "open", 6],
  ["pta_robot_cbd", "traffic-light", "Robot not working", "All four directions dead, no pointsman.", -25.7461, 28.1881, "Church Square, Pretoria CBD", 5, "open", 4],
  ["pta_streetlight_brooklyn", "streetlight", "Streetlight out", "Three lights out in a row, very dark walking home.", -25.7690, 28.2400, "Fehrsen St, Brooklyn, Pretoria", 120, "open", 3],
  ["pta_dumping_arcadia", "dumping", "Rubbish dumped", "Building rubble and black bags dumped on the corner.", -25.7450, 28.2200, "Arcadia, Pretoria", 30, "fixed", 2],
  // Johannesburg
  ["jhb_power_melville", "power", "Transformer blew", "Loud bang then everything went off. Several streets affected.", -26.1745, 28.0050, "4th Ave, Melville, Johannesburg", 9, "open", 15],
  ["jhb_pothole_braam", "pothole", "Road falling apart", "Potholes all along this stretch, taxis damaging tyres.", -26.1935, 28.0365, "Jorissen St, Braamfontein, Johannesburg", 96, "open", 9],
  ["jhb_sewage_maboneng", "sewage", "Sewage overflowing", "Manhole overflowing onto the pavement, strong smell.", -26.2050, 28.0560, "Main St, Maboneng, Johannesburg", 20, "open", 5],
  ["jhb_manhole_rosebank", "infrastructure", "Missing manhole cover", "Open hole on the pavement, someone could fall in. Marked it with a branch for now.", -26.1470, 28.0400, "Oxford Rd, Rosebank, Johannesburg", 3, "open", 2],
  ["jhb_water_sandton", "water", "No water", "No water since this morning, no notice from the city.", -26.1100, 28.0560, "Rivonia Rd, Sandton", 7, "in_progress", 11, "Johannesburg Water says a valve is being replaced. Supply expected back tonight."],
  ["jhb_robot_midrand", "traffic-light", "Robot stuck on red", "Stuck on red for the turning lane, long queues at peak hour.", -25.9970, 28.1300, "New Rd, Midrand", 26, "open", 7],
];

async function adminUid() {
  const given = arg("uid");
  if (given) return given;
  const s = await db.collection("safetyTeam").where("role", "==", "admin").limit(1).get();
  if (s.empty) throw new Error("No admin found in safetyTeam. Pass --uid <your user id>.");
  return s.docs[0].id;
}

async function main() {
  const batch = db.batch();
  if (REMOVE) {
    ACTIVITIES.forEach(([id]) => {
      batch.delete(db.doc(`activities/demo_${id}`));
      batch.delete(db.doc(`activityChats/demo_${id}`));
    });
    REPORTS.forEach(([id]) => {
      batch.delete(db.doc(`municipalReports/demo_${id}`));
      batch.delete(db.doc(`municipalReportOwners/demo_${id}`));
    });
    await batch.commit();
    console.log(`Removed ${ACTIVITIES.length} demo activities and ${REPORTS.length} demo reports.`);
    return;
  }

  const uid = await adminUid();
  const u = await db.doc(`users/${uid}`).get();
  const name = (u.exists && (u.data().username || u.data().displayName)) || "Wiji";

  for (const [id, type, title, description, lat, lng, location, days, hour, hours] of ACTIVITIES) {
    const start = at(days, hour);
    const end = new Date(start.getTime() + hours * HOUR);
    const docId = `demo_${id}`;
    batch.set(db.doc(`activities/${docId}`), {
      title, description, activityType: type,
      latitude: lat, longitude: lng, location,
      createdBy: uid, createdByName: name,
      createdAt: Timestamp.fromDate(new Date(Date.now() - Math.random() * 6 * HOUR)),
      participants: [uid],
      startTime: Timestamp.fromDate(start),
      endTime: Timestamp.fromDate(end),
      visibility: "everyone",
      requiresApproval: false,
      demo: true,
    });
    batch.set(db.doc(`activityChats/${docId}`), { activityId: docId, activityTitle: title, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  for (const [id, category, title, description, lat, lng, location, hoursAgo, status, affected, staffNote] of REPORTS) {
    const docId = `demo_${id}`;
    const created = new Date(Date.now() - hoursAgo * HOUR);
    batch.set(db.doc(`municipalReports/${docId}`), {
      category, title, description,
      latitude: lat, longitude: lng, location,
      anonymous: true,
      status,
      affectedBy: Array.from({ length: affected }, (_, i) => `demo_neighbour_${i + 1}`),
      fixedVotes: status === "fixed" ? ["demo_neighbour_1", "demo_neighbour_2", "demo_neighbour_3"] : [],
      ...(staffNote ? { staffNote } : {}),
      ...(status === "fixed" ? { fixedAt: Timestamp.fromDate(new Date(Date.now() - 2 * HOUR)) } : {}),
      createdAt: Timestamp.fromDate(created),
      updatedAt: Timestamp.fromDate(created),
      demo: true,
    });
    // You own the demo reports, so you can mark them fixed or delete them from the app
    batch.set(db.doc(`municipalReportOwners/${docId}`), { uid, createdAt: Timestamp.fromDate(created) });
  }

  await batch.commit();
  console.log(`Done: ${ACTIVITIES.length} activities and ${REPORTS.length} reports around Pretoria and Johannesburg, by ${name} (${uid}).`);
  console.log("Activities run over the next 4 days; re-run this script before a demo to refresh them.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message || e);
  if (/credential|default credentials|permission/i.test(String(e.message))) {
    console.error("\nPass a service account key with --key (Firebase console → Project settings → Service accounts → Generate new private key).");
  }
  process.exit(1);
});
