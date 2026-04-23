# Square (Bitcoin / Crypto)

Expo (React Native) app with Firebase backend (Firestore, Storage, Cloud Functions).

## Prerequisites

- **Node.js** 18+ (functions expect Node 22; Node 24 works)
- **npm** (comes with Node)
- **Expo CLI** (optional; `npx expo` is enough)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. **Environment**
   - Root app: copy `.env.example` to `.env` and set any keys (e.g. `EXPO_PUBLIC_KLIPY_API_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`). Many features have in-app fallbacks.
   - Firebase Functions: copy `functions/.env.example` to `functions/.env` and set secrets if you deploy or run emulators.

3. **Firebase**
   - Create a project at [Firebase Console](https://console.firebase.google.com) and add your app (iOS/Android/Web).
   - Put `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) in the project if you use native Firebase.
   - The app uses `firebaseConfig.ts`; update it with your project’s config if this is a new project.

## Run

- **Expo (dev)**  
  ```bash
  npm start
  ```
  Then press `w` for web, or scan QR for Expo Go (iOS/Android).

- **Web only**  
  ```bash
  npm run web
  ```

- **Android**  
  ```bash
  npm run android
  ```
  (Requires Android Studio / SDK.)

  **If the build fails with "Filename longer than 260 characters"** on Windows:
  - **Option 1:** Run `.\enable-long-paths.ps1` **as Administrator**, reboot, then run `.\clean-android-build.ps1` and `npm run android:short-path` again.
  - **Option 2:** If the project is a **junction** at `C:\sq-bitcoin`, it must be **moved** so it really lives there. See **MOVE-PROJECT-TO-C-SQ-BITCOIN.md** for step-by-step instructions.

- **iOS**  
  ```bash
  npm run ios
  ```
  (Requires Xcode on macOS.)

## Firebase Functions

- **Build**  
  ```bash
  cd functions && npm run build
  ```

- **Local emulator**  
  ```bash
  cd functions && npm run serve
  ```
  (Requires Firebase CLI and a service account or default project.)

- **Deploy**  
  ```bash
  firebase deploy --only functions
  ```

## Project layout

- `App.tsx`, `index.ts` – app entry
- `Screens/` – main UI screens
- `components/`, `hooks/`, `services/`, `utils/` – shared code
- `firebaseConfig.ts` – Firebase client config
- `functions/` – Firebase Cloud Functions (Node/TypeScript)
- `app.json` – Expo config
- `firebase.json` – Firebase config (Firestore, Storage, Functions)
