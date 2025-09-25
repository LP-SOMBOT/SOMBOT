import { Router } from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  delay,
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore // KEY CHANGE #1: Import the correct key store
} from '@whiskeysockets/baileys';
import { join } from 'path';
import fs from 'fs-extra';
import { randomBytes } from 'crypto';
import { Boom } from '@hapi/boom';
import pino from 'pino';

const router = Router();
const SESSIONS_DIR = join(process.cwd(), 'sessions');
const activeSockets = new Map();

// KEY CHANGE #2: This function now ONLY encodes creds.json, just like the working example.
async function encodeSession(sessionId) {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  const credsFile = join(sessionDir, 'creds.json');
  console.log(`[Step 3] Encoding session from file: ${credsFile}`);
  try {
    const credsContent = await fs.readFile(credsFile);
    const base64Creds = credsContent.toString('base64');
    // Using the same format "botname~:" for compatibility.
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
    // KEY CHANGE #3: Replicate the exact logger structure.
    const logger = pino({ level: 'fatal' }).child({ level: 'fatal' });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        // KEY CHANGE #1 (Implementation): Use the stable key store method.
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
        // KEY CHANGE #4: Re-introduce the long delay to ensure file is written.
        console.log('[Step 2] Connection successful. Waiting 5s for creds.json to sync...');
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

export default router;
