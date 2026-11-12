# Wiji

Wiji is a South African super app: community chat, a live map of what is happening nearby, safe e-hailing, shopping from local businesses and card payments, in one place.

- **Mobile app** – Expo (React Native, TypeScript), Android first
- **Backend** – Firebase: Auth, Firestore, Storage, Cloud Functions, Cloud Messaging
- **Payments** – Paystack (cards, payouts to drivers, businesses and promoters)
- **Website and portals** – Firebase Hosting at <https://communitychat-f3fb0.web.app>

## What is in the app

The app has four tabs: **Communities**, **Chats**, **Map** and **Wallet**.

| Area | What it does |
| --- | --- |
| Communities and groups | Create and join communities, group chats, GIFs and stickers. A group's creator can make it a paid group with a monthly or yearly subscription. |
| Direct messages and calls | One-to-one chat with unread badges, and voice calls over WebRTC. |
| Map | Activities people can join (each with its own chat), specials and nearby deals from businesses, and municipal reports (potholes, outages, broken infrastructure) that can be posted anonymously. |
| Wiji Rides | Request a ride, live trip tracking and trip ratings. Safety comes first: verified drivers, trusted contacts, trip sharing, an emergency button, incident reports and a safety team that reviews cases. |
| Shop | Verified businesses list a menu or catalogue; customers order and pay in the app, and the business manages orders from its dashboard. |
| Wallet | Pay drivers and businesses by card, scan a QR code to pay, save cards, set up payouts, and see recent payments. |
| Promoters | An affiliate programme: promoters share a code or link and earn commission, paid out through Paystack. |

## Website and portals

Everything in `website/` is served by Firebase Hosting.

- `/` – home page, with the Android download
- `/terms/`, `/privacy/`, `/delete-account/` – legal pages
- `/promoters/` – promoter programme and its terms; `/r/<code>` – referral links
- `/admin/` – one sign-in for four portals:
  - **Staff** – overview, alerts, safety reports, business and driver verification, affiliates, team
  - **Business** – orders, menu, deals, customers, settings and **Wiji Pulse** (income forecast and funding-readiness score)
  - **Driver** – earnings and Wiji Pulse
  - **Promoter** – referrals and payouts

## Prerequisites

- Node.js 22 (Cloud Functions target Node 22)
- Android Studio with an emulator or a device, for Android builds
- Firebase CLI (`npm i -g firebase-tools`), for the backend and website
- Python 3, only to rebuild the legal pages

Wiji uses native modules (WebRTC, Firebase Messaging, Maps), so it runs as a **development build**, not in Expo Go.

## Setup

1. Install dependencies

   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. App environment – copy `.env.example` to `.env`

   | Variable | Purpose |
   | --- | --- |
   | `EXPO_PUBLIC_SAFETY_ADMIN_EMAILS` | Safety team admin emails (same list as in `functions/.env`) |
   | `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps, Places and Directions |
   | `EXPO_PUBLIC_KLIPY_API_KEY` | GIF search (optional) |
   | `EXPO_PUBLIC_TURN_URLS`, `EXPO_PUBLIC_TURN_USERNAME`, `EXPO_PUBLIC_TURN_CREDENTIAL` | TURN relay so calls work on mobile data (optional, recommended) |

3. Functions environment – copy `functions/.env.example` to `functions/.env`

   | Variable | Purpose |
   | --- | --- |
   | `PAYSTACK_SECRET_KEY` | Paystack secret key (use the test key while building) |
   | `PAYSTACK_PLATFORM_FEE_PERCENT` | Wiji's commission on each payment |
   | `SAFETY_ADMIN_EMAILS` | Emails allowed to grant safety-team roles |
   | `RIDES_BASE_FARE_CENTS`, `RIDES_PER_KM_CENTS`, `RIDES_MIN_FARE_CENTS` | Ride fares |
   | `AFFILIATE_AUTO_PAYOUTS` | Promoter payouts: `off`, `dry` (preview) or `live` |
   | `AFFILIATE_MIN_PAYOUT_RAND`, `AFFILIATE_MAX_PAYOUT_RAND`, `AFFILIATE_RUN_CAP_RAND` | Promoter payout limits |

4. Firebase – the project is `communitychat-f3fb0` (see `.firebaserc`). The client config is in `firebaseConfig.ts`; Android also needs `google-services.json`.

Never commit `.env`, `functions/.env`, keystores or service-account files; `.gitignore` already excludes them.

## Run

```bash
npm run android     # build and run the development build on Android
npm start           # start Metro for an installed development build
npm run web         # run in the browser
npm run ios         # macOS with Xcode only
```

**Windows:** keep the project in a short path such as `C:\Square`. Deeper folders fail the Android build with "Filename longer than 260 characters".

## Backend

```bash
cd functions
npm run build       # compile TypeScript
npm run serve       # build and start the Functions emulator
npm run logs        # read production logs
```

Deploy from the repo root:

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
firebase deploy --only hosting
```

Cloud Functions are grouped by feature in `functions/src/`:

| File | Covers |
| --- | --- |
| `index.ts` | Push notifications for messages, calls, activities and daily specials; GIF search |
| `paystack.ts` | Payments, saved cards, payee registration, refunds and the Paystack webhook |
| `rides.ts` | Ride requests and offers, trip updates, ratings, trip sharing, emergencies and incidents |
| `drivers.ts` | Driver applications, reviews, document expiry checks and safety roles |
| `business.ts` | Business verification |
| `shop.ts` | Orders and order status |
| `groupSubscriptions.ts` | Paid group subscriptions and renewals |
| `affiliates.ts`, `affiliatePayouts.ts` | Promoter codes, referrals, commission and payouts |
| `admin.ts`, `staff.ts` | Staff portal data and staff roles |

## Website

- The home page (`website/index.html`) and the promoter pages are edited by hand.
- The legal pages and the matching in-app screens are generated from `website-src/content.py`:

  ```bash
  python website-src/build.py .
  ```

- The portals are plain JavaScript in `website/admin/` (no build step). `admin-web/` holds the same portal source; keep the two in sync.
- The Android APK offered on the home page lives at `website/download/wiji.apk`. It is not in Git, so put a current build there before deploying hosting.

## Builds

EAS profiles are in `eas.json`:

```bash
eas build --profile preview --platform android      # installable APK
eas build --profile production --platform android   # store build
```

## Project layout

```
App.tsx, index.ts     app entry and navigation
Screens/              screens by feature: Community, Users, Map, Rides, Shop, Wallet, Calls, Legal
components/           shared UI
services/             client calls to Firebase and Cloud Functions, by feature
hooks/, utils/        push-token registration, call service, constants
functions/            Cloud Functions (TypeScript)
website/              hosted site and portals
website-src/          source for the generated legal pages
admin-web/            portal source
firestore.rules       Firestore security rules
storage.rules         Storage security rules
app.json, eas.json    Expo and EAS config
firebase.json         Firebase config (rules, functions, hosting)
```
