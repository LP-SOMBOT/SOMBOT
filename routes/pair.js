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
import pino from 'pino'; // Import pino for proper logging

const router = Router();
const SESSIONS_DIR = join(process.cwd(), 'sessions');

// This function encodes the entire session directory for maximum compatibility
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
    const fullSessionString = `botname~:${Buffer.from(JSON.stringify(sessionData)).toString('base64')}`;
    console.log('[Step 3] Session encoded successfully.');
    return fullSessionString;
  } catch (error) {
    console.error('Error encoding session:', error);
    return null;
  }
}

// Main pairing route
router.get('/', async (req, res) => {
  console.log('[Request Received] Starting pairing process...');
  const phoneNumber = req.query.number || req.query.phone;

  if (!phoneNumber) {
    console.error('[Error] Phone number missing from URL.');
    return res.status(400).json({ 
      error: "Phone number is required. Format: /pair?number=1234567890" 
    });
  }

  const sanitizedNumber = phoneNumber.replace(/[^0-9]/g, '');
  const sessionId = `session-${randomBytes(8).toString('hex')}`;
  const sessionPath = join(SESSIONS_DIR, sessionId);

  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    console.log(`[Step 1] Initializing socket for session: ${sessionId}`);

    // Use a proper, silent pino logger for stability
    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS("Chrome"), // Use a very standard browser identity
      logger, // Provide the logger to Baileys
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[Connection Update] Status: ${connection}`);

      if (connection === "open") {
        console.log('[Step 2] Connection successful. Waiting 2s for files to sync...');
        await delay(2000); // Wait for file system to sync

        const sessionString = await encodeSession(sessionId);
        if (!sessionString) {
          console.error("[Fatal] Could not generate session string after connection.");
          await sock.logout();
          return;
        }

        console.log('[Step 4] Attempting to send session string to user...');
        await sock.sendMessage(sock.user.id, { text: sessionString });
        
        const welcomeMessage = `✅ *Your Session ID is Ready!*\n\n*Warning:* Do not share this code with anyone.\n\nCopy the text below and paste it into your bot's environment variables (SESSION_ID).`;
        await sock.sendMessage(sock.user.id, { text: welcomeMessage });
        
        console.log('[Step 5] Session sent. Logging out in 3s...');
        await delay(3000); // Wait for messages to deliver
        await sock.logout();

      } else if (connection === "close") {
        const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : new Error('Unknown disconnection error');
        const statusCode = boomError.output?.statusCode;
        
        // Log the detailed error
        console.error(`[Connection Closed] Reason: ${DisconnectReason[statusCode] || 'Unknown'}. Full Error:`, boomError);
        
        await fs.remove(sessionPath);
        console.log('[Cleanup] Session directory deleted.');
      }
    });

    if (!sock.authState.creds.registered) {
      console.log(`[Step 1.5] Requesting pairing code for: ${sanitizedNumber}...`);
      await delay(1500); // Give socket time to be ready
      const code = await sock.requestPairingCode(sanitizedNumber);
      console.log(`[Info] Generated Pairing Code: ${code}`);
      if (!res.headersSent) {
        res.status(200).json({ code });
      }
    }

  } catch (err) {
    console.error("[FATAL ERROR] An uncaught exception occurred in the main block:", err);
    await fs.remove(sessionPath);
    if (!res.headersSent) {
      res.status(500).json({ error: "Service is unavailable or an error occurred." });
    }
  }
});

export default router;
