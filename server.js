const express = require("express");
const router = express.Router();
const cors = require("cors");
const bodyParser = require("body-parser");
const { parse, isBefore } = require("date-fns"); // Add this line to import date-fns for date parsing and comparison
const { MongoClient } = require('mongodb');
require('dotenv').config();
const virtualRoutes = require("./routes/virtual");
const app = express();

let db;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('creds');
    // console.log(db);
    
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

connectToMongoDB();

// Debugging middleware
app.use((req, res, next) => {
  console.log(`Received ${req.method} request for ${req.url}`);
  next();
});


app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

require("dotenv").config();

let storedCredentials = {
  flattrade: { usersession: "", userid: "" },
  shoonya: { usersession: "", userid: "" },
};

app.set('case sensitive routing', false);
// app.use("/flattrade", flattradeRoutes(storedCredentials));
// app.use("/shoonya", shoonyaRoutes(storedCredentials));

app.get("/", (req, res) => res.send("Welcome to the Proxy Server"));

const PORT = 3000;
const HOST = "localhost";

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});