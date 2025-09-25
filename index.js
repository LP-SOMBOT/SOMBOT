const express = require('express');
const path = require('path'); // Use the 'path' module for file paths
const fs = require('fs-extra');
const pairRoute = require('./routes/pair.js');

const app = express();
const port = process.env.PORT || 3000;

// In a CommonJS environment (which we are now using), __dirname is a
// global variable that Node.js provides automatically. We don't need to define it.

// Use path.join to safely create paths to your folders.
fs.ensureDirSync(path.join(__dirname, 'sessions'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/pair', pairRoute);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on your Render URL`);
});
