import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import pairRoute from './routes/pair.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Ensure the temporary sessions directory exists
fs.ensureDirSync(join(__dirname, 'sessions'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount the pairing code route
app.use('/pair', pairRoute);

// Homepage with a form to enter the phone number
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Pairing Code Generator</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #111B21; color: #E4E6EB; }
            .container { text-align: center; background: #202C33; padding: 40px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
            h1 { color: #00A884; margin-bottom: 20px; }
            input { width: 80%; padding: 12px; border-radius: 5px; border: 1px solid #374045; background: #2A3942; color: white; margin-bottom: 20px; font-size: 16px; }
            .btn { display: inline-block; background-color: #00A884; color: #111B21; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; border: none; cursor: pointer; }
            p { color: #AEBAC1; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Generate Session</h1>
            <p>Enter your WhatsApp phone number with the country code, without '+' or spaces.</p>
            <form action="/pair" method="get">
                <input type="text" name="phone" placeholder="e.g., 1234567890" required>
                <br>
                <button type="submit" class="btn">Get Pairing Code</button>
            </form>
        </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
