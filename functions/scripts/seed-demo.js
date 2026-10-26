// functions/scripts/seed-demo.js — creates Wiji demo accounts and realistic demo data for judges and testing.
//
// Run from the functions folder with a Firebase service-account key:
//   PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\wiji-admin.json"; node scripts/seed-demo.js
//   Remove it:   node scripts/seed-demo.js --clean
//   Check only:  node scripts/seed-demo.js --dry   (builds everything, writes nothing, needs no key)
//
// Everything it writes has demo: true, uses fixed IDs (safe to run again), and is removed by --clean.
// It does NOT create Paystack payout accounts: sign in as the business, driver and creator in the app
// and use Payouts once each (Paystack test mode) so live test payments to them work.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = "communitychat-f3fb0";
const PASSWORD = "WijiDemo2026!";
const DRY = process.argv.includes("--dry");
const written = [];
let auth, db;
if (DRY) {
  auth = { getUserByEmail: async (e) => ({ uid: `dry_${e.split("@")[0]}` }), updateUser: async () => undefined };
  db = { doc: (path) => ({ path }), batch: () => ({ set: (ref, data) => written.push([ref.path, data]), commit: async () => undefined }) };
} else {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  auth = getAuth();
  db = getFirestore();
}

// ---------- people ----------
const ACCOUNTS = {
  customer: { email: "customer@wiji-demo.app", username: "Sipho Mokoena", note: "Customer: orders food, pays, takes rides, in the paid group" },
  business: { email: "business@wiji-demo.app", username: "Naledi Khumalo", note: "Owner of Kasi Eats Hatfield (verified business, business portal)" },
  driver: { email: "driver@wiji-demo.app", username: "Lerato Dube", note: "Verified driver (driver portal with Wiji Pulse)" },
  creator: { email: "creator@wiji-demo.app", username: "Thando Nkosi", note: "Promoter and community creator (paid group owner)" },
};
const BG_NAMES = ["Kamo", "Ayanda", "Bongani", "Zanele", "Tumi", "Karabo", "Lindiwe", "Mpho", "Nandi", "Sizwe", "Palesa", "Tshepo", "Refilwe", "Kagiso", "Nomsa", "Lwazi", "Dineo", "Themba", "Busi", "Neo", "Jabu", "Khanyi", "Vusi", "Zodwa", "Lebo", "Andile", "Precious", "Mandla", "Yolanda", "Katlego"];
const SURNAMES = ["Mahlangu", "Molefe", "Ndlovu", "Sithole", "Mokoena", "Zulu", "Nkosi", "Dlamini", "Baloyi", "Mabena"];
const bgUid = (i) => `demo_user_${String(i).padStart(2, "0")}`;

// Hatfield, Pretoria
const HATFIELD = { lat: -25.7487, lng: 28.238 };
const BUSINESS = {
  name: "Kasi Eats Hatfield",
  category: "Food and drinks",
  type: "restaurant",
  address: "1110 Burnett Street, Hatfield, Pretoria, 0083",
  location: { lat: -25.7491, lng: 28.2372 },
};
const MENU = [
  ["kota-classic", "Classic Kota", "Quarter loaf with chips, polony, cheese and atchar", "Kotas", 4500],
  ["kota-full-house", "Full House Kota", "Chips, russian, egg, cheese, polony and atchar", "Kotas", 6500],
  ["wings-6", "6 Peri-Peri Wings", "Flame-grilled with our house peri-peri", "Mains", 7500],
  ["pap-wors", "Pap and Wors", "Boerewors, pap and chakalaka", "Mains", 8500],
  ["burger-chips", "Kasi Burger and Chips", "Beef patty, cheese, caramelised onion", "Mains", 8900],
  ["vetkoek-mince", "Vetkoek and Mince", "Two vetkoek with spicy mince", "Light meals", 4000],
  ["iced-tea", "Iced Tea", "Peach, 500 ml", "Drinks", 2500],
  ["coke-500", "Coke 500 ml", "", "Drinks", 2000],
];

// ---------- helpers ----------
let seed = 2026;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const ts = (d) => Timestamp.fromDate(d);
const DAY = 864e5;
const daysAgo = (n, hour = 12) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, Math.floor(rnd() * 60), 0, 0);
  return d;
};
/** Busy Fri/Sat, payday weeks up (25th–1st), mid-month down (11th–19th), slow growth. */
const demand = (d, base) => {
  const dow = [1.1, 0.7, 0.75, 0.85, 0.95, 1.5, 1.6][d.getDay()]; // Sun..Sat
  const dom = d.getDate();
  const month = dom >= 24 || dom <= 1 ? 1.35 : dom >= 11 && dom <= 19 ? 0.65 : 1;
  return base * dow * month;
};

async function batchWrite(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data, { merge: true }));
    await b.commit();
  }
}

async function ensureUser(email, displayName) {
  try {
    const u = await auth.getUserByEmail(email);
    await auth.updateUser(u.uid, { password: PASSWORD, displayName, emailVerified: true });
    return u.uid;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    const u = await auth.createUser({ email, password: PASSWORD, displayName, emailVerified: true });
    return u.uid;
  }
}

// ---------- seed ----------
async function seedAll() {
  const uid = {};
  for (const [key, a] of Object.entries(ACCOUNTS)) uid[key] = await ensureUser(a.email, a.username);
  console.log("Accounts ready:", uid);

  const COMMUNITY_ID = "demo_hatfield_hustlers";
  const FREE_GROUP = "demo_general";
  const PAID_GROUP = "demo_side_hustle_masterclass";
  const now = new Date();
  const w = []; // [ref, data]
  const legal = { termsAcceptedAt: now, privacyAcceptedAt: now, legalPolicyVersion: "2026-04-22" };

  // Users (4 sign-in accounts + 30 background customers without sign-in)
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    w.push([db.doc(`users/${uid[key]}`), { demo: true, uid: uid[key], username: a.username, email: a.email, createdAt: daysAgo(100), joinedCommunities: [COMMUNITY_ID], ...legal }]);
  }
  BG_NAMES.forEach((n, i) => {
    w.push([db.doc(`users/${bgUid(i)}`), { demo: true, uid: bgUid(i), username: `${n} ${pick(SURNAMES)}`, createdAt: daysAgo(90 - i), joinedCommunities: i < 18 ? [COMMUNITY_ID] : [] }]);
  });
  const bgName = (i) => `${BG_NAMES[i]}`;

  // Verified business + menu
  const biz = uid.business;
  w.push([db.doc(`business_verifications/${biz}`), {
    demo: true, uid: biz, status: "verified",
    details: { tradingName: BUSINESS.name, ownerName: ACCOUNTS.business.username, type: BUSINESS.type, category: BUSINESS.category, address: BUSINESS.address, addressVerified: true, location: BUSINESS.location },
    decision: { action: "approved", at: daysAgo(95), by: "demo" }, submittedAt: daysAgo(97),
  }]);
  w.push([db.doc(`businesses/${biz}`), {
    demo: true, ownerId: biz, name: BUSINESS.name, category: BUSINESS.category, type: BUSINESS.type, address: BUSINESS.address,
    location: BUSINESS.location, latitude: BUSINESS.location.lat, longitude: BUSINESS.location.lng,
    description: "Kotas, wings and pap and wors on Burnett Street. Order ahead and skip the queue.",
    coverPath: null, verified: true, active: true, isOpen: true, collectEnabled: true, deliveryEnabled: true, deliveryFeeCents: 1500,
    createdAt: daysAgo(95), updatedAt: now,
  }]);
  for (const [id, name, description, category, priceCents] of MENU) {
    w.push([db.doc(`businesses/${biz}/menu/${id}`), { demo: true, name, description, category, priceCents, available: true, photoUrl: null, updatedAt: now }]);
  }

  // 12 weeks of orders + matching payments to the business
  let n = 0;
  for (let day = 84; day >= 0; day--) {
    const d = daysAgo(day);
    const count = Math.round(demand(d, 4.2) * (1 + (84 - day) * 0.004) * (0.75 + rnd() * 0.5));
    for (let k = 0; k < count; k++) {
      const at = daysAgo(day, 10 + Math.floor(rnd() * 11));
      if (at > now) continue;
      const buyer = rnd() < 0.15 ? { id: uid.customer, name: ACCOUNTS.customer.username } : (() => { const i = Math.floor(rnd() * BG_NAMES.length); return { id: bgUid(i), name: bgName(i) }; })();
      const lines = [];
      const items = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < items; j++) {
        const [mid, mname, , , price] = pick(MENU);
        const qty = 1 + (rnd() < 0.25 ? 1 : 0);
        lines.push({ kind: "menu", id: mid, name: mname, priceCents: price, qty, lineCents: price * qty });
      }
      const delivery = rnd() < 0.3;
      const subtotal = lines.reduce((a, l) => a + l.lineCents, 0);
      const total = subtotal + (delivery ? 1500 : 0);
      const isNew = day === 0 && k >= count - 2; // a couple of fresh orders waiting today
      const orderId = `demo_order_${String(++n).padStart(4, "0")}`;
      const ref = `demo_pay_order_${String(n).padStart(4, "0")}`;
      w.push([db.doc(`orders/${orderId}`), {
        demo: true, businessId: biz, ownerId: biz, businessName: BUSINESS.name, userId: buyer.id, buyerName: buyer.name,
        items: lines, subtotalCents: subtotal, deliveryFeeCents: delivery ? 1500 : 0, totalCents: total, total: total / 100,
        fulfilment: delivery ? "delivery" : "collect", deliveryAddress: delivery ? "Hatfield Square, Burnett Street" : null, deliveryLocation: null, note: "",
        status: isNew ? "paid" : "completed", paymentRef: ref, paidAt: ts(at), createdAt: ts(at), updatedAt: ts(at),
      }]);
      w.push([db.doc(`payments/${ref}`), {
        demo: true, reference: ref, payerUid: buyer.id, payerName: buyer.name, payeeUid: biz, payeeName: BUSINESS.name, payeeRole: "merchant",
        amountCents: total, currency: "ZAR", note: `Order #${orderId.slice(-6).toUpperCase()} · ${BUSINESS.name}`, status: "paid", channel: "card",
        orderId, createdAt: ts(at), paidAt: ts(at), updatedAt: ts(at),
      }]);
    }
  }
  console.log(`Orders and business payments: ${n}`);

  // Verified driver + 12 weeks of paid trips
  const drv = uid.driver;
  let trips = 0;
  for (let day = 84; day >= 0; day--) {
    const count = Math.round(demand(daysAgo(day), 5) * (0.7 + rnd() * 0.6));
    for (let k = 0; k < count; k++) {
      const at = daysAgo(day, 6 + Math.floor(rnd() * 17));
      if (at > now) continue;
      const rider = rnd() < 0.1 ? { id: uid.customer, name: ACCOUNTS.customer.username } : (() => { const i = Math.floor(rnd() * BG_NAMES.length); return { id: bgUid(i), name: bgName(i) }; })();
      const fare = Math.round((45 + rnd() * 140) * 100);
      const rideId = `demo_ride_${String(++trips).padStart(4, "0")}`;
      w.push([db.doc(`payments/demo_pay_${rideId}`), {
        demo: true, reference: `demo_pay_${rideId}`, payerUid: rider.id, payerName: rider.name, payeeUid: drv, payeeName: "Lerato Dube", payeeRole: "driver",
        amountCents: fare, currency: "ZAR", note: "Wiji ride with Lerato", status: "paid", channel: "card", rideId,
        createdAt: ts(at), paidAt: ts(at), updatedAt: ts(at),
      }]);
    }
  }
  w.push([db.doc(`drivers/${drv}`), {
    demo: true, uid: drv, firstName: "Lerato", lastName: "Dube", photoPath: null,
    vehicle: { make: "Toyota", model: "Corolla Quest", colour: "White", plate: "LD 26 WJ GP", year: 2021 },
    status: "active", verified: true, verifiedAt: daysAgo(92), nextCheckDue: new Date(Date.now() + 270 * DAY).toISOString().slice(0, 10),
    trips, ratingAvg: 4.8, ratingCount: Math.round(trips * 0.6),
  }]);
  console.log(`Driver trips: ${trips}`);

  // Community with a free group and a paid group
  const members = [uid.customer, uid.business, uid.driver, uid.creator, ...BG_NAMES.slice(0, 18).map((_, i) => bgUid(i))];
  w.push([db.doc(`communities/${COMMUNITY_ID}`), {
    demo: true, name: "Hatfield Hustlers", description: "Young entrepreneurs, students and creators in Hatfield. Share your hustle, find customers and meet people.",
    location: "Hatfield, Pretoria", categories: ["Business", "Students"], allowMembersToCreateGroups: true, createdBy: uid.creator, createdAt: daysAgo(80),
  }]);
  const chat = [
    [uid.creator, "Welcome to Hatfield Hustlers! Introduce yourself and your hustle 👋"],
    [bgUid(0), "Hey all, I'm Kamo. I sell thrifted streetwear on campus."],
    [uid.business, "Naledi from Kasi Eats on Burnett. Students get a free iced tea with any kota this week!"],
    [bgUid(3), "Anyone selling second-hand textbooks for first-year IT?"],
    [uid.customer, "Kasi Eats' Full House kota is elite, highly recommend."],
    [bgUid(6), "Market day at Hatfield Square on Saturday, who's in?"],
    [uid.creator, "Masterclass group is open: weekly sessions on pricing, marketing and getting paid digitally."],
  ];
  w.push([db.doc(`communities/${COMMUNITY_ID}/groupChats/${FREE_GROUP}`), {
    demo: true, name: "General", description: "Everyone in Hatfield Hustlers", profilePic: null, createdBy: uid.creator, createdAt: daysAgo(80),
    members, hasPassword: false, password: null, subscription: null,
    lastMessageText: chat[chat.length - 1][1], lastMessageSenderId: chat[chat.length - 1][0], lastMessageTimestamp: ts(daysAgo(0, 9)),
  }]);
  chat.forEach(([sender, text], i) => w.push([db.doc(`communities/${COMMUNITY_ID}/groupChats/${FREE_GROUP}/messages/demo_msg_${i}`), {
    demo: true, senderId: sender, text, mediaUrl: null, mediaType: null, fileName: null, timestamp: ts(daysAgo(chat.length - i, 9 + i)),
  }]));

  const subscribers = [uid.customer, ...[1, 2, 4, 5, 7, 8].map(bgUid)];
  w.push([db.doc(`communities/${COMMUNITY_ID}/groupChats/${PAID_GROUP}`), {
    demo: true, name: "Side Hustle Masterclass", description: "Weekly lessons on pricing, marketing and growing your hustle, plus Q&A with Thando.",
    profilePic: null, createdBy: uid.creator, createdAt: daysAgo(60), members: [uid.creator, ...subscribers], hasPassword: false, password: null,
    subscription: { enabled: true, interval: "monthly", priceCents: 5000, currency: "ZAR" },
    lastMessageText: "This week: how to price your products so you actually make profit.", lastMessageSenderId: uid.creator, lastMessageTimestamp: ts(daysAgo(1, 18)),
  }]);
  [
    "Welcome to the Masterclass! Sessions are every Tuesday at 18:00.",
    "This week: how to price your products so you actually make profit.",
  ].forEach((text, i) => w.push([db.doc(`communities/${COMMUNITY_ID}/groupChats/${PAID_GROUP}/messages/demo_msg_${i}`), {
    demo: true, senderId: uid.creator, text, mediaUrl: null, mediaType: null, fileName: null, timestamp: ts(daysAgo(3 - i * 2, 18)),
  }]));
  subscribers.forEach((s, i) => {
    const start = daysAgo(40 - i * 3);
    const end = new Date(start.getTime() + 30 * DAY);
    if (end < now) end.setTime(end.getTime() + 30 * DAY);
    w.push([db.doc(`groupSubscriptions/${COMMUNITY_ID}_${PAID_GROUP}_${s}`), {
      demo: true, uid: s, communityId: COMMUNITY_ID, groupId: PAID_GROUP, groupName: "Side Hustle Masterclass", creatorUid: uid.creator,
      interval: "monthly", priceCents: 5000, currency: "ZAR", status: "active", autoRenew: false, cardId: null,
      currentPeriodEnd: ts(end), nextCheckAt: ts(end), lastPaymentRef: `demo_pay_sub_${i}`, createdAt: ts(start), updatedAt: ts(now),
    }]);
    w.push([db.doc(`payments/demo_pay_sub_${i}`), {
      demo: true, reference: `demo_pay_sub_${i}`, payerUid: s, payerName: s === uid.customer ? ACCOUNTS.customer.username : bgName([1, 2, 4, 5, 7, 8][i - 1] ?? 0),
      payeeUid: uid.creator, payeeName: "Thando Nkosi", payeeRole: "personal", amountCents: 5000, currency: "ZAR",
      note: "Monthly subscription: Side Hustle Masterclass", status: "paid", channel: "card",
      groupSub: { communityId: COMMUNITY_ID, groupId: PAID_GROUP, interval: "monthly" }, createdAt: ts(start), paidAt: ts(start), updatedAt: ts(start),
    }]);
  });

  // Activities in the next few days (people within 50 km get alerts for new ones made in the app)
  const soon = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const ACTIVITIES = [
    ["demo_act_market", "Hatfield Square pop-up market", "Local sellers, food and music. Bring your stall or just come shop.", "social", -25.7479, 28.2368, "Hatfield Square, Burnett Street, Pretoria", soon(5, 10), 5],
    ["demo_act_run", "Saturday morning run: UP to Magnolia Dell", "Easy 7 km social run, all paces welcome.", "fitness", -25.7545, 28.2314, "University of Pretoria main gate, Lynnwood Road", soon(5, 7), 2],
    ["demo_act_study", "Exam prep study session", "Quiet group study with coffee breaks. IT and commerce students.", "social", -25.7522, 28.2295, "Hatfield Plaza, Burnett Street", soon(2, 14), 3],
    ["demo_act_melville", "Live music night in Melville", "Local artists on 7th Street. Meet new people, safe rides home with Wiji.", "night-life", -26.1767, 28.0066, "7th Street, Melville, Johannesburg", soon(4, 19), 4],
  ];
  for (const [id, title, description, activityType, lat, lng, location, start, extra] of ACTIVITIES) {
    const participants = [uid.creator, ...BG_NAMES.slice(0, extra).map((_, i) => bgUid(i + 10))];
    w.push([db.doc(`activities/${id}`), {
      demo: true, title, description, activityType, latitude: lat, longitude: lng, location, createdBy: uid.creator, createdByName: "Thando Nkosi",
      createdAt: ts(daysAgo(1)), participants, startTime: ts(start), endTime: ts(new Date(start.getTime() + 3 * 3600e3)), visibility: "everyone", requiresApproval: false,
    }]);
    w.push([db.doc(`activityChats/${id}`), { demo: true, activityId: id, activityTitle: title, createdAt: ts(daysAgo(1)) }]);
  }

  // Map deals from the business
  [
    ["demo_deal_kota", "Student Kota Special", "Classic Kota + iced tea for students. Show your student card.", 5500],
    ["demo_deal_wings", "Wing Wednesday", "12 peri-peri wings for the price of 9.", 11000],
  ].forEach(([id, title, description, priceCents]) => w.push([db.doc(`mapSpecials/${id}`), {
    demo: true, title, description, location: BUSINESS.address, dealTimeUtc: "10:00", latitude: BUSINESS.location.lat, longitude: BUSINESS.location.lng,
    createdBy: biz, creatorName: BUSINESS.name, businessId: biz, businessName: BUSINESS.name, priceCents, weekdays: [0, 1, 2, 3, 4, 5, 6],
    active: true, createdAt: ts(daysAgo(10)), updatedAt: ts(now),
  }]));

  await batchWrite(w);
  console.log(`Wrote ${w.length} documents.\n`);
  console.log("Demo sign-ins (password for all: " + PASSWORD + ")");
  for (const a of Object.values(ACCOUNTS)) console.log(`  ${a.email.padEnd(26)} ${a.note}`);
  if (DRY) await dryReport(uid);
  console.log("\nNext: sign in as business@, driver@ and creator@ in the app and set up Payouts once each (Paystack test mode).");
}

// ---------- dry run: check the data with the real Pulse model ----------
async function dryReport(uid) {
  const { computePulse, rand, shortDate } = await import("../../admin-web/js/biz/pulseModel.js");
  const ids = new Set();
  for (const [path] of written) {
    if (ids.has(path)) console.log("DUPLICATE WRITE:", path);
    ids.add(path);
  }
  const pays = written.filter(([p]) => p.startsWith("payments/")).map(([, d]) => d);
  for (const [label, who] of [["Business", uid.business], ["Driver", uid.driver]]) {
    const mine = pays.filter((p) => p.payeeUid === who).map((p) => ({ amountCents: p.amountCents, at: p.paidAt.toDate(), payerUid: p.payerUid }));
    const r = computePulse(mine);
    console.log(`\n${label}: ${mine.length} payments, score ${r.score}/100, usual week ${rand(r.baselineCents)}, trend ${(r.trendPctPerWeek * 100).toFixed(1)}%/wk, payday x${r.paydayLift.toFixed(2)}, mid-month x${r.midMonthLift.toFixed(2)}`);
    console.log("  last 6 weeks: " + r.history.slice(-6).map((w) => `${shortDate(w.start)} ${rand(w.totalCents)}`).join(" | "));
    console.log("  forecast:     " + r.forecast.map((f) => `${shortDate(f.start)} ${rand(f.expectedCents)}${f.slow ? " SLOW" : ""}`).join(" | "));
  }
}

// ---------- clean ----------
async function cleanAll() {
  const cols = ["users", "business_verifications", "businesses", "orders", "payments", "drivers", "communities", "groupSubscriptions", "activities", "activityChats", "mapSpecials"];
  let removed = 0;
  for (const c of cols) {
    const snap = await db.collection(c).where("demo", "==", true).get();
    for (const d of snap.docs) {
      await db.recursiveDelete(d.ref); // also removes menu items, group chats and messages
      removed++;
    }
  }
  for (const a of Object.values(ACCOUNTS)) {
    try {
      const u = await auth.getUserByEmail(a.email);
      await db.recursiveDelete(db.doc(`payees/${u.uid}`)).catch(() => undefined);
      await auth.deleteUser(u.uid);
    } catch {}
  }
  console.log(`Removed ${removed} demo documents and the demo sign-in accounts.`);
}

(process.argv.includes("--clean") ? cleanAll() : seedAll())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e.message);
    if (/credential|Could not load the default/i.test(e.message)) console.error("Set GOOGLE_APPLICATION_CREDENTIALS to your service-account key file first (see the top of this file).");
    process.exit(1);
  });
