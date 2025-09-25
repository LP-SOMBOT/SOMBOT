const express = require('express');
const { fileURLToPath } = require('url');
const { dirname, join } = require('path');
const fs = require('fs-extra');
const pairRoute = require('./routes/pair.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

fs.ensureDirSync(join(__dirname, 'sessions'));

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/pair', pairRoute);

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on your Render URL`);
});
