const express = require('express');
const mongoose = require('mongoose');

require('dotenv').config({ quiet: true });

const app = express();
const port = process.env.PORT || 3000;

app.use(function allowCrossDomain(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    return next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

require('./routes')(app);

async function start() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is not configured');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    app.listen(port, function () {
        console.log(`Server running on port ${port}`);
    });
}

if (require.main === module) {
    start().catch(function (error) {
        console.error('Unable to start the server:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { app, start };
