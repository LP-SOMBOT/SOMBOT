const { Router } = require('express');
const {
  default: makeWASocket, // This is the correct way to import with require
  useMultiFileAuthState,
  delay,
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { join } = require('path');
const fs = require('fs-extra');
const { randomBytes } = require('crypto');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

const router = Router();
const SESSIONS_DIR = join(process.cwd(), 'sessions');
const activeSockets = new Map();

async function encodeSession(sessionId) {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  const credsFile = join(sessionDir, 'creds.json');
  console.log(`[Step 3] Encoding session from file: ${credsFile}`);
  try {
    const credsContent = await fs.readFile(credsFile);
    const base64Creds = credsContent.toString('base64');
    return `botname~:${base64Creds}`;
  } catch (error) {
    console.error('Error encoding session:', error);
    return null;
  }
}

router.get('/', async (req, res) => {
  const phoneNumber = req.query.number || req.query.phone;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const sanitizedNumber = phoneNumber.replace(/[^0-9]/g, '');
  const sessionId = `session-${randomBytes(8).toString('hex')}`;
  const sessionPath = join(SESSIONS_DIR, sessionId);

  if (activeSockets.has(sanitizedNumber)) {
    console.log(`[Info] Terminating old pairing process for ${sanitizedNumber}.`);
    try {
      await activeSockets.get(sanitizedNumber).logout();
    } catch (e) {
      console.log("Old socket was already closed.");
    }
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' }).child({ level: 'fatal' });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: Browsers.macOS("Chrome"),
      logger,
    });
    
    activeSockets.set(sanitizedNumber, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[Connection Update] Number: ${sanitizedNumber}, Status: ${connection}`);

      if (connection === "open") {
        console.log('[Step 2] Connection successful. Waiting 5s...');
        await delay(5000);

        const sessionString = await encodeSession(sessionId);
        if (!sessionString) {
          console.error("[Fatal] Could not generate session string.");
          await sock.logout();
          return;
        }

        await sock.sendMessage(sock.user.id, { text: sessionString });
        await sock.sendMessage(sock.user.id, { text: `✅ *Your Session ID is Ready!*` });
        
        console.log('[Step 5] Session sent. Logging out in 2s...');
        await delay(2000);
        await sock.logout();
      } else if (connection === "close") {
        const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : new Error('Unknown disconnection error');
        console.error(`[Connection Closed] Number: ${sanitizedNumber}, Reason:`, boomError.message);
        activeSockets.delete(sanitizedNumber);
        await fs.remove(sessionPath);
      }
    });

    if (!sock.authState.creds.registered) {
      console.log(`[Step 1.5] Requesting pairing code for: ${sanitizedNumber}...`);
      await delay(1500);
      const code = await sock.requestPairingCode(sanitizedNumber);
      console.log(`[Info] Generated Pairing Code: ${code}`);
      if (!res.headersSent) {
        res.status(200).json({ code });
      }
    }

  } catch (err) {
    console.error("[FATAL ERROR] An uncaught exception occurred:", err);
    activeSockets.delete(sanitizedNumber);
    await fs.remove(sessionPath);
    if (!res.headersSent) {
      res.status(500).json({ error: "Service is unavailable or an error occurred." });
    }
  }
});

// Use module.exports instead of export default
module.exports = router;
