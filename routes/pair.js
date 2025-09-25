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

const router = Router();
const SESSIONS_DIR = join(process.cwd(), 'sessions');

// Function to encode session files
async function encodeSession(sessionId) {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  console.log(`[Step 3] Encoding session from: ${sessionDir}`);
  try {
    const files = await fs.readdir(sessionDir);
    // We only need creds.json for the session string
    if (!files.includes('creds.json')) {
        throw new Error('creds.json not found in session directory');
    }
    const credsContent = await fs.readFile(join(sessionDir, 'creds.json'));
    // Create a simplified session object for encoding
    const sessionData = { 'creds.json': credsContent.toString('base64') };
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

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome")
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`[Connection Update] Status: ${connection}`);

      if (connection === "open") {
        // --- THIS IS THE CRITICAL CHANGE ---
        // Act immediately without any delay to prevent timeouts
        console.log('[Step 2] Connection successful. Immediately processing session...');

        const sessionString = await encodeSession(sessionId);
        if (!sessionString) {
          console.error("[Fatal] Could not generate session string after connection.");
          await sock.logout(); // Logout on failure
          return;
        }

        const welcomeMessage = `✅ *Your Session ID is Ready!*\n\n*Warning:* Do not share this code with anyone.\n\nCopy the text below and paste it into your bot's environment variables (SESSION_ID).`;
        
        await sock.sendMessage(sock.user.id, { text: sessionString });
        await sock.sendMessage(sock.user.id, { text: welcomeMessage });
        
        console.log('[Step 4] Session ID has been sent to the user.');
        
        // Logout after a short delay to ensure messages are sent
        await delay(1000); 
        await sock.logout();
      } else if (connection === "close") {
        const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
        console.log(`[Connection Closed] Reason: ${DisconnectReason[statusCode] || 'Unknown'}, Status Code: ${statusCode}`);
        await fs.remove(sessionPath);
        console.log('[Cleanup] Session directory deleted.');
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
    await fs.remove(sessionPath);
    if (!res.headersSent) {
      res.status(500).json({ error: "Service is unavailable or an error occurred." });
    }
  }
});

export default router;
