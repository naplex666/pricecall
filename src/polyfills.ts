import { Buffer } from "buffer";

// @solana/web3.js and friends expect a Node-style Buffer in the browser.
// This file must be imported FIRST (before the app) — see main.tsx.
globalThis.Buffer = Buffer;
