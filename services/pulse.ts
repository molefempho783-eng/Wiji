// services/pulse.ts — Wiji Pulse: income forecast and funding-readiness score for drivers and businesses.
// Pure functions (no Firebase) so the model is easy to test and explain.
//
// Model, in plain words:
// 1. Group the user's paid Wiji payments into weeks (Monday to Sunday).
// 2. Baseline = a weighted average of the last 8 complete weeks (recent weeks count more).
// 3. Trend = least-squares slope over those weeks, capped so one odd week can't run away.
// 4. Month pattern = how payday weeks (around the 25th and 1st, when most South Africans are paid)
//    and mid-month weeks (around the 15th, when money runs low) compare with other weeks.
// 5. Forecast for each of the next 4 weeks = baseline + trend, times that week's month-pattern effect,
//    with a range of ± one standard deviation of past weeks around the trend.
// 6. A week forecast at 85% of the baseline or less is flagged as a slow week.

export type PulsePayment = { amountCents: number; at: Date; payerUid?: string };

export type WeekPoint = { start: Date; totalCents: number; count: number };
export type ForecastWeek = { start: Date; expectedCents: number; lowCents: number; highCents: number; slow: boolean; payday: boolean; midMonth: boolean };
export type ScorePart = { key: string; label: string; points: number; max: number; tip: string };
export type PulseResult = {
  enoughData: boolean;
  weeksOfHistory: number;
  history: WeekPoint[]; // last 12 complete weeks, oldest first
  thisWeek: WeekPoint;
  forecast: ForecastWeek[];
  baselineCents: number;
  trendPctPerWeek: number; // e.g. 0.04 = +4% a week
  paydayLift: number; // 1.0 = no effect
  midMonthLift: number; // below 1.0 = mid-month weeks are quieter
  weekdayAvgCents: number[]; // Mon..Sun average takings
  busiestDay: number; // 0 = Monday
  quietestDay: number;
  avgMonthlyCents: number;
  uniqueCustomers: number;
  score: number; // 0-100
  scoreParts: ScorePart[];
  tips: string[];
};

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Week contains the 25th of a month (SA payday) or the 1st (month-end pay). */
const isPaydayWeek = (start: Date) => {
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i).getDate();
    if (day === 25 || day === 1) return true;
  }
  return false;
};
/** Week contains the 15th (mid-month, furthest from payday) and isn't a payday week. */
const isMidMonthWeek = (start: Date) => {
  if (isPaydayWeek(start)) return false;
  for (let i = 0; i < 7; i++) if (addDays(start, i).getDate() === 15) return true;
  return false;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const rand = (cents: number) => `R${Math.round(cents / 100).toLocaleString("en-ZA").replace(/,/g, " ")}`;
export const shortDate = (d: Date) => d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

export function computePulse(payments: PulsePayment[], now: Date = new Date()): PulseResult {
  const currentWeek = weekStart(now);
  const valid = payments.filter((p) => p.at instanceof Date && !isNaN(p.at.getTime()) && p.amountCents > 0 && p.at < addDays(currentWeek, 7));

  // Weekly totals for the last 12 complete weeks (+ this week so far)
  const history: WeekPoint[] = [];
  for (let i = 12; i >= 1; i--) history.push({ start: new Date(currentWeek.getTime() - i * WEEK), totalCents: 0, count: 0 });
  // use calendar arithmetic so daylight-saving or odd offsets don't shift weeks
  history.forEach((w, idx) => (w.start = addDays(currentWeek, -(12 - idx) * 7)));
  const thisWeek: WeekPoint = { start: currentWeek, totalCents: 0, count: 0 };
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const customers = new Set<string>();
  let first: Date | null = null;

  for (const p of valid) {
    if (!first || p.at < first) first = p.at;
    if (p.payerUid) customers.add(p.payerUid);
    const ws = weekStart(p.at);
    if (ws.getTime() === currentWeek.getTime()) {
      thisWeek.totalCents += p.amountCents;
      thisWeek.count++;
      continue;
    }
    const w = history.find((h) => h.start.getTime() === ws.getTime());
    if (w) {
      w.totalCents += p.amountCents;
      w.count++;
      weekdayTotals[(p.at.getDay() + 6) % 7] += p.amountCents;
    }
  }

  // Weeks since the first payment (capped at 12) = how much history the model has
  const weeksOfHistory = first ? clamp(Math.round((currentWeek.getTime() - weekStart(first).getTime()) / WEEK), 0, 12) : 0;
  const used = history.slice(12 - weeksOfHistory); // only weeks since they started
  const totals = used.map((w) => w.totalCents);
  const enoughData = weeksOfHistory >= 4 && totals.some((t) => t > 0);

  // Baseline: weighted average of up to the last 8 weeks, recent weeks weigh more
  const recent = totals.slice(-8);
  const weights = recent.map((_, i) => i + 1);
  const baselineCents = recent.length ? recent.reduce((a, t, i) => a + t * weights[i], 0) / weights.reduce((a, b) => a + b, 0) : 0;

  // Trend: least-squares slope over recent weeks, as a share of the mean, capped at ±10% a week
  let trendPctPerWeek = 0;
  if (recent.length >= 3) {
    const xs = recent.map((_, i) => i);
    const mx = mean(xs);
    const my = mean(recent);
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (recent[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    trendPctPerWeek = my > 0 ? clamp(slope / my, -0.1, 0.1) : 0;
  }

  // Month pattern: payday and mid-month weeks vs ordinary weeks (needs at least 2 of each to count)
  const payWeeks = used.filter((w) => isPaydayWeek(w.start)).map((w) => w.totalCents);
  const midWeeks = used.filter((w) => isMidMonthWeek(w.start)).map((w) => w.totalCents);
  const plainWeeks = used.filter((w) => !isPaydayWeek(w.start) && !isMidMonthWeek(w.start)).map((w) => w.totalCents);
  const ref = mean(plainWeeks.length >= 2 ? plainWeeks : totals);
  const paydayLift = payWeeks.length >= 2 && ref > 0 ? clamp(mean(payWeeks) / ref, 0.8, 1.6) : 1;
  const midMonthLift = midWeeks.length >= 2 && ref > 0 ? clamp(mean(midWeeks) / ref, 0.6, 1.2) : 1;
  const liftFor = (start: Date) => (isPaydayWeek(start) ? paydayLift : isMidMonthWeek(start) ? midMonthLift : 1);

  // Take the month pattern out of the baseline so it isn't counted twice
  const recentWeeks = used.slice(-8);
  const avgLift = recentWeeks.length ? mean(recentWeeks.map((w) => liftFor(w.start))) : 1;
  const neutralBase = avgLift > 0 ? baselineCents / avgLift : baselineCents;
  const spread = std(totals.map((t, i) => t / liftFor(used[i].start))); // week-to-week noise after the month pattern

  const forecast: ForecastWeek[] = [];
  for (let k = 1; k <= 4; k++) {
    const start = addDays(currentWeek, (k - 1) * 7); // this week + next 3
    const payday = isPaydayWeek(start);
    const midMonth = isMidMonthWeek(start);
    const expected = Math.max(0, neutralBase * (1 + trendPctPerWeek * k) * liftFor(start));
    forecast.push({
      start,
      payday,
      midMonth,
      expectedCents: Math.round(expected),
      lowCents: Math.round(Math.max(0, expected - spread)),
      highCents: Math.round(expected + spread),
      slow: enoughData && expected <= baselineCents * 0.85,
    });
  }

  // Weekday pattern
  const weeksCounted = Math.max(1, used.length);
  const weekdayAvgCents = weekdayTotals.map((t) => t / weeksCounted);
  const busiestDay = weekdayAvgCents.indexOf(Math.max(...weekdayAvgCents));
  const quietestDay = weekdayAvgCents.indexOf(Math.min(...weekdayAvgCents));
  const avgMonthlyCents = mean(totals) * (52 / 12);

  // ---- Funding-readiness score (0-100) ----
  const activeShare = totals.length ? totals.filter((t) => t > 0).length / totals.length : 0;
  const cv = mean(totals) > 0 ? std(totals) / mean(totals) : 1;
  const consistency = Math.round(35 * clamp(1 - cv, 0, 1) * 0.6 + 35 * activeShare * 0.4);
  const trendPts = Math.round(clamp(12 + trendPctPerWeek * 80, 0, 20));
  const historyPts = Math.round(20 * clamp(weeksOfHistory / 12, 0, 1));
  const volumePts = avgMonthlyCents > 0 ? Math.round(15 * clamp(Math.log10(avgMonthlyCents / 100 / 500) / Math.log10(40), 0, 1)) : 0; // R500 → 0, R20 000 → 15
  const customerPts = Math.round(10 * clamp(customers.size / 50, 0, 1));
  const scoreParts: ScorePart[] = [
    { key: "consistency", label: "Steady income", points: consistency, max: 35, tip: "Earn something every week; steady weeks matter more than big ones." },
    { key: "trend", label: "Growth", points: trendPts, max: 20, tip: "Grow week on week: post deals or go online at your busiest times." },
    { key: "history", label: "Track record", points: historyPts, max: 20, tip: "Keep taking payments in Wiji; 12 weeks of history earns full points." },
    { key: "volume", label: "Income size", points: volumePts, max: 15, tip: "Move more of your cash sales into Wiji so all your income counts." },
    { key: "customers", label: "Customer base", points: customerPts, max: 10, tip: "Serve more different customers; 50 or more earns full points." },
  ];
  const score = enoughData ? scoreParts.reduce((a, p) => a + p.points, 0) : 0;

  // ---- Suggestions ----
  const tips: string[] = [];
  if (enoughData) {
    const slow = forecast.find((f) => f.slow);
    if (slow) {
      const gap = Math.max(0, baselineCents - slow.expectedCents);
      tips.push(`The week of ${shortDate(slow.start)} looks slow (about ${rand(slow.expectedCents)}). Set aside ${rand(gap)} before then to cover it.`);
    }
    if (weekdayAvgCents[busiestDay] > 0) {
      tips.push(`${DAY_NAMES[busiestDay]} is your busiest day. Restock or be online before ${DAY_NAMES[busiestDay]}s.`);
    }
    if (weekdayAvgCents[quietestDay] < weekdayAvgCents[busiestDay] * 0.4) {
      tips.push(`${DAY_NAMES[quietestDay]}s are quiet. A Wiji map deal on ${DAY_NAMES[quietestDay]}s could bring customers in.`);
    }
    if (midMonthLift <= 0.9) tips.push(`Mid-month weeks bring in about ${Math.round((1 - midMonthLift) * 100)}% less, when customers wait for payday. Keep stock lean around the 15th.`);
    if (paydayLift >= 1.1) tips.push(`Payday weeks bring in about ${Math.round((paydayLift - 1) * 100)}% more. Plan stock and hours around the 25th.`);
    const weakest = [...scoreParts].sort((a, b) => a.points / a.max - b.points / b.max)[0];
    tips.push(`To raise your score fastest: ${weakest.tip}`);
  }

  return { enoughData, weeksOfHistory, history, thisWeek, forecast, baselineCents, trendPctPerWeek, paydayLift, midMonthLift, weekdayAvgCents, busiestDay, quietestDay, avgMonthlyCents, uniqueCustomers: customers.size, score, scoreParts, tips };
}

/** Clearly labelled sample history so new users and judges can see Pulse working. */
export function samplePayments(now: Date = new Date()): PulsePayment[] {
  const out: PulsePayment[] = [];
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dayWeight = [0.6, 0.7, 0.8, 0.9, 1.4, 1.6, 1.0]; // busy Fri/Sat
  const start = addDays(weekStart(now), -12 * 7);
  for (let d = 0; d < 12 * 7 + ((now.getDay() + 6) % 7); d++) {
    const day = addDays(start, d);
    const growth = 1 + d * 0.004;
    const payday = day.getDate() >= 24 && day.getDate() <= 28 ? 1.35 : day.getDate() >= 11 && day.getDate() <= 19 ? 0.65 : 1;
    const n = Math.round((3 + rnd() * 4) * dayWeight[(day.getDay() + 6) % 7] * payday);
    for (let i = 0; i < n; i++) {
      out.push({ amountCents: Math.round((40 + rnd() * 120) * 100 * growth), at: new Date(day.getTime() + (8 + rnd() * 12) * 3600 * 1000), payerUid: `sample_${Math.floor(rnd() * 70)}` });
    }
  }
  return out;
}

/** Text profile the user can share with a bank or funder. */
export function profileText(name: string, role: string, r: PulseResult, sample: boolean): string {
  const lines = [
    `Wiji Pulse income profile${sample ? " (SAMPLE DATA)" : ""}`,
    `${name} · ${role}`,
    `Generated ${new Date().toLocaleDateString("en-ZA")}`,
    "",
    `Funding-readiness score: ${r.score}/100`,
    ...r.scoreParts.map((p) => `- ${p.label}: ${p.points}/${p.max}`),
    "",
    `Track record: ${r.weeksOfHistory} weeks of payments through Wiji`,
    `Average monthly income: ${rand(r.avgMonthlyCents)}`,
    `Different customers: ${r.uniqueCustomers}`,
    `Trend: ${r.trendPctPerWeek >= 0 ? "+" : ""}${(r.trendPctPerWeek * 100).toFixed(1)}% a week`,
    "",
    "Weekly income (last 12 weeks):",
    ...r.history.map((w) => `${shortDate(w.start)}: ${rand(w.totalCents)}`),
    "",
    "Forecast (next 4 weeks):",
    ...r.forecast.map((f) => `${shortDate(f.start)}: ${rand(f.expectedCents)} (${rand(f.lowCents)}–${rand(f.highCents)})${f.slow ? " – slow week" : ""}`),
    "",
    "Based on card payments received through Wiji (processed by Paystack).",
  ];
  return lines.join("\n");
}
