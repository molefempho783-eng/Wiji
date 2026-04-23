import { Buffer } from "buffer";
// React Native doesn't provide Node's `Buffer` globally. Some crypto libs expect it.
// This is safe as a polyfill; we still never handle private keys outside the device.
// Hermes/React Native typically relies on `globalThis`, but some libs check `global.*`.
(globalThis as any).Buffer = Buffer;
(globalThis as any).global = globalThis;
(globalThis as any).global.Buffer = Buffer;

// Polyfill WebCrypto's `crypto.getRandomValues` (required by bip39 on RN).
import { getRandomValues as expoGetRandomValues } from "expo-crypto";
(globalThis as any).crypto = (globalThis as any).crypto ?? {};
if (typeof (globalThis as any).crypto.getRandomValues !== "function") {
  (globalThis as any).crypto.getRandomValues = expoGetRandomValues;
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
