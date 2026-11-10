// functions/scripts/seed-jhb-activities.js: adds demo activities around Johannesburg.
//
// Run from the functions folder (same key as seed-demo.js):
//   PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\wiji-admin.json"; node scripts/seed-jhb-activities.js
//
// Needs seed-demo.js to have been run once (it uses the demo creator account and demo users).
// Every document has demo: true and a fixed ID, so it is safe to run again (dates refresh),
// and `node scripts/seed-demo.js --clean` removes these too.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "communitychat-f3fb0" });
const auth = getAuth();
const db = getFirestore();

const DAY = 24 * 3600e3;
const ts = (d) => Timestamp.fromDate(d);
const bgUid = (i) => `demo_user_${String(i).padStart(2, "0")}`;
/** `days` from today at `hour`:00 local time on this machine (South Africa) */
const soon = (days, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const SERIES_END = new Date(Date.now() + 50 * DAY);

// [id, title, description, type, lat, lng, location, start, extra people, series end?]
const ACTIVITIES = [
  ["demo_act_jhb_market", "Neighbourgoods market (every Saturday)", "Food, coffee and craft stalls. Come hungry.", "food-and-drinks", -26.1930, 28.0340, "Juta St, Braamfontein, Johannesburg", soon(0, 9), 8, SERIES_END],
  ["demo_act_jhb_run", "Emmarentia Dam run club (every Saturday)", "Easy 5 km social run around the dam, all paces welcome.", "fitness", -26.1600, 28.0080, "Emmarentia Dam, Johannesburg", soon(0, 7), 6, SERIES_END],
  ["demo_act_jhb_founders", "Sandton founders meetup", "Startup people talking ideas, funding and customers. Bring your pitch.", "social", -26.1080, 28.0530, "Sandton City, Sandton", soon(1, 17), 9],
  ["demo_act_jhb_yoga", "Rooftop yoga in Rosebank", "Beginner-friendly, bring a mat.", "wellness", -26.1460, 28.0420, "Rosebank, Johannesburg", soon(1, 7), 5],
  ["demo_act_jhb_maboneng", "Maboneng street art photo walk", "Murals and rooftops. A phone camera is enough.", "sightseeing", -26.2045, 28.0590, "Fox St, Maboneng, Johannesburg", soon(2, 15), 7],
  ["demo_act_jhb_zoolake", "Zoo Lake picnic", "Blankets, snacks and frisbee by the water.", "outdoor", -26.1590, 28.0300, "Zoo Lake, Parkview, Johannesburg", soon(3, 12), 10],
  ["demo_act_jhb_gaming", "Gaming tournament in Midrand", "FIFA and Tekken. Winner gets lunch.", "entertainment", -25.9990, 28.1070, "Mall of Africa, Midrand", soon(3, 14), 8],
  ["demo_act_jhb_study", "Wits study group", "Quiet group study with coffee breaks. IT and commerce students.", "social", -26.1929, 28.0305, "Wits University, Braamfontein", soon(0, 14), 6, SERIES_END],
  ["demo_act_jhb_soweto", "Vilakazi Street food walk", "Kota, kasi bites and a bit of history. Safe rides back with Wiji.", "food-and-drinks", -26.2380, 27.9070, "Vilakazi St, Orlando West, Soweto", soon(5, 11), 9],
  ["demo_act_jhb_hike", "Melville Koppies sunset walk", "Short hike with city views. Bring water and a torch.", "outdoor", -26.1740, 28.0120, "Melville Koppies, Johannesburg", soon(4, 16), 5],
  ["demo_act_jhb_comedy", "Comedy night in Newtown", "Local comedians, arrive early for good seats.", "entertainment", -26.2050, 28.0330, "Newtown, Johannesburg", soon(6, 19), 11],
  ["demo_act_jhb_rooftop", "Rooftop sundowners in Parktown", "After-work drinks and good music.", "night-life", -26.1830, 28.0430, "Parktown, Johannesburg", soon(2, 18), 8],
];

const creator = (await auth.getUserByEmail("creator@wiji-demo.app")).uid;
const batch = db.batch();
for (const [id, title, description, activityType, latitude, longitude, location, start, extra, until] of ACTIVITIES) {
  const participants = [creator, ...Array.from({ length: extra }, (_, i) => bgUid(i + 10))];
  batch.set(db.doc(`activities/${id}`), {
    demo: true, title, description, activityType, latitude, longitude, location,
    createdBy: creator, createdByName: "Thando Nkosi", createdAt: ts(new Date(Date.now() - DAY)), participants,
    startTime: ts(start), endTime: ts(until || new Date(start.getTime() + 3 * 3600e3)), visibility: "everyone", requiresApproval: false,
  });
  batch.set(db.doc(`activityChats/${id}`), { demo: true, activityId: id, activityTitle: title, createdAt: ts(new Date(Date.now() - DAY)) });
}
await batch.commit();
console.log(`Added ${ACTIVITIES.length} Johannesburg activities (Braamfontein, Sandton, Rosebank, Maboneng, Soweto, Midrand and more).`);
process.exit(0);
