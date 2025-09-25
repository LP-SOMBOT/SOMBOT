import { Router } from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  delay,
  Browsers,
  DisconnectReason
} from '@whiskeysockets/baileys';
import { join } from 'path';
import fs from 'fs-extra';
import { randomBytes } from 'crypto';
import { Boom } from '@hapi/boom';
import pino from 'pino';

const router = Router();
const SESSIONS_DIR = join(process.cwd(), 'sessions');

// --- NEW: A Map to store active pairing sockets ---
const activeSockets = new Map();

async function encodeSession(sessionId) {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  console.log(`[Step 3] Encoding all session files from: ${sessionDir}`);
  try {
    const files = await fs.readdir(sessionDir);
    const sessionData = {};
    for (const file of files) {
      const content = await fs.readFile(join(sessionDir, file));
      sessionData[file] = content.toString('base64');
    }
    return `botname~:${Buffer.from(JSON.stringify(sessionData)).toString('base64')}`;
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

  // --- NEW: Logic to handle existing sockets ---
  if (activeSockets.has(sanitizedNumber)) {
    console.log(`[Info] A pairing process for ${sanitizedNumber} already exists. Terminating the old one.`);
    try {
      const oldSocket = activeSockets.get(sanitizedNumber);
      await oldSocket.logout();
    } catch (e) {
      console.log("Old socket was already closed or failed to logout.");
    }
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS("Chrome"),
      logger,
    });
    
    // Store the new socket in our active sessions map
    activeSockets.set(sanitizedNumber, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[Connection Update] Number: ${sanitizedNumber}, Status: ${connection}`);

      if (connection === "open") {
        console.log('[Step 2] Connection successful. Waiting 2s for files to sync...');
        await delay(2000);

        const sessionString = await encodeSession(sessionId);
        if (!sessionString) {
          console.error("[Fatal] Could not generate session string.");
          await sock.logout();
          return;
        }

        await sock.sendMessage(sock.user.id, { text: sessionString });
        await sock.sendMessage(sock.user.id, { text: `✅ *Your Session ID is Ready!*` });
        
        console.log('[Step 5] Session sent. Logging out in 3s...');
        await delay(3000);
        await sock.logout();
      } else if (connection === "close") {
        const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : new Error('Unknown disconnection error');
        console.error(`[Connection Closed] Number: ${sanitizedNumber}, Reason:`, boomError.message);
        
        // --- CRITICAL: Clean up on close ---
        activeSockets.delete(sanitizedNumber);
        await fs.remove(sessionPath);
        console.log('[Cleanup] Active socket and session directory deleted.');
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
    
    // --- CRITICAL: Clean up on failure ---
    activeSockets.delete(sanitizedNumber);
    await fs.remove(sessionPath);
    
    if (!res.headersSent) {
      res.status(500).json({ error: "Service is unavailable or an error occurred." });
    }
  }
});

export default router;
