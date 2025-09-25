
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

// Function to encode session files into a single base64 string
async function encodeSession(sessionId) {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  try {
    const files = await fs.readdir(sessionDir);
    const sessionData = {};
    for (const file of files) {
      const content = await fs.readFile(join(sessionDir, file));
      sessionData[file] = content.toString('base64');
    }
    // Format: botname~:BASE64_ENCODED_JSON_STRING
    const fullSessionString = `botname~:${Buffer.from(JSON.stringify(sessionData)).toString('base64')}`;
    return fullSessionString;
  } catch (error) {
    console.error('Error encoding session:', error);
    return null;
  }
}

// Main pairing route
router.get('/', async (req, res) => {
  // Use 'number' from query to match your example
  let phoneNumber = req.query.number || req.query.phone;
  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required. Use '?number=1234567890'." });
  }
  phoneNumber = phoneNumber.replace(/[^0-9]/g, ''); // Sanitize the number

  const sessionId = `session-${randomBytes(8).toString('hex')}`;
  const sessionPath = join(SESSIONS_DIR, sessionId);

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    let sock;

    try {
      sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS("Safari"),
        logger: { info: () => {}, warn: () => {}, error: () => {} } // Suppress verbose logging
      });

      // Handle pairing code request
      if (!sock.authState.creds.registered) {
        console.log(`Requesting pairing code for: ${phoneNumber}`);
        await delay(1500); // Small delay to ensure the socket is ready
        const code = await sock.requestPairingCode(phoneNumber);
        // Send code back to the client as JSON
        if (!res.headersSent) {
          res.status(200).json({ code });
        }
        console.log(`Pairing Code: ${code}`);
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log(`Connection opened for ${phoneNumber}. Generating session...`);
          await delay(5000); // Wait for 5 seconds to ensure all credentials are saved

          const sessionString = await encodeSession(sessionId);
          if (!sessionString) {
              console.error("Failed to generate session string.");
              return;
          }

          console.log(`Session ID Generated: ${sessionString.substring(0, 30)}...`);

          const welcomeMessage = `
🎉 *Welcome to Your WhatsApp Bot!* 🚀  

🔒 *Your Session ID is ready!*
⚠️ _Keep it private and secure — do not share it with anyone._

🔑 *Copy the SESSION_ID below* and add it to your bot's environment variables.

⭐ *Show Some Love!* Give a ⭐ on GitHub to support the developer.

🚀 _Thanks for using our service — Let the automation begin!_ ✨`;

          await sock.sendMessage(sock.user.id, { text: sessionString });
          await sock.sendMessage(sock.user.id, { text: welcomeMessage });
          
          console.log('Session ID and welcome message sent to user.');

          await delay(2000);
          await sock.logout();
        } else if (connection === "close") {
            const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log('Connection closed due to an error. Reconnecting...');
                connect(); // Reconnect on non-logout errors
            } else {
                console.log('Connection closed. Cleaning up...');
            }
            // Always clean up the session directory on close
            await fs.remove(sessionPath);
        }
      });
    } catch (err) {
      console.error("An error occurred during the pairing process:", err);
      await fs.remove(sessionPath); // Clean up on failure
      if (!res.headersSent) {
        res.status(500).json({ error: "Service is unavailable or an error occurred." });
      }
    }
  };

  await connect();
});

export default router;
