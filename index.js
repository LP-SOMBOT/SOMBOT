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

// Middleware to serve static files from the 'public' folder
app.use(express.static('public'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount the pairing code API route
app.use('/pair', pairRoute);

// Serve the main HTML file for the root URL
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
