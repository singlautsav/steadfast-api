const express = require("express");
const router = express.Router();
const { createProxyMiddleware } = require("http-proxy-middleware");
const axios = require("axios");
const NodeCache = require('node-cache');
const fs = require("fs");
const csv = require("fast-csv");
const path = require("path");
const { parse, isBefore } = require("date-fns"); 

const symbolCache = new NodeCache({ stdTTL: 4 * 60 * 60 });

module.exports = (storedCredentials) => {
    router.use(
        "/flattradeApi",
        createProxyMiddleware({
            target: "https://authapi.flattrade.in",
            changeOrigin: true,
            pathRewrite: {
            "^/flattradeApi": "",
            },
        })
    );

// ===> NON-TRADING API CALLS  <===

    // ===> Endpoint to store the credentials
    router.post("/setCredentials", (req, res) => {
        console.log("Received POST request to set credentials");
        const { usersession, userid } = req.body;
    
        // Store the credentials
        storedCredentials.flattrade = {
        usersession,
        userid,
        };
    
        res.json({ message: "Flattrade Credentials updated successfully" });
        console.log(
        `${new Date().toLocaleTimeString()}  Updated Flattrade credentials`
        );
    });

    // ===> Endpoint to use the stored credentials
    router.get("/websocketData", (req, res) => {
        // console.log("Received GET request for flattrade websocket data");
      
        // Use the stored credentials
        const websocketData = {
          usersession: storedCredentials.flattrade.usersession,
          userid: storedCredentials.flattrade.userid,
        };
      
        res.json(websocketData);
        console.log(
          `${new Date().toLocaleTimeString()}  Sending Flattrade websocket data`
        );
    });

    // ===> Get Flattrade Funds
    router.post("/fundLimit", async (req, res) => {
        const jKey = req.query.FLATTRADE_API_TOKEN;
        const clientId = req.query.FLATTRADE_CLIENT_ID;
    
        if (!jKey || !clientId) {
        return res
            .status(400)
            .json({ message: "API token or Client ID is missing." });
        }
    
        const jData = JSON.stringify({
        uid: clientId,
        actid: clientId,
        });
        const payload = `jKey=${jKey}&jData=${jData}`;
    
        try {
        const response = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/Limits",
            payload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
        res.json(response.data);
        } catch (error) {
        res.status(500).json({
            message: "Error fetching Flattrade fund limits",
            error: error.message,
        });
        console.error("Error fetching Flattrade fund limits:", error);
        }
    });

    // ===> Get Flattrade Symbols
    router.get("/symbols", (req, res) => {
        const { exchangeSymbol, masterSymbol } = req.query;

        const cacheKey = `${exchangeSymbol}_${masterSymbol}`;

        const cachedData = symbolCache.get(cacheKey);
        if (cachedData) {
        return res.json(cachedData);
        }

        const callStrikes = [];
        const putStrikes = [];
        const expiryDates = new Set();
    
        const csvFilePath =
        exchangeSymbol === "BFO"
            ? "./symbols/Bfo_Index_Derivatives.csv"
            : "./symbols/Nfo_Index_Derivatives.csv";
    
        fs.createReadStream(csvFilePath)
        .pipe(csv.parse({ headers: true }))
        .on("data", (row) => {
            if (
            row["Symbol"] === masterSymbol &&
            row["Exchange"] === exchangeSymbol
            ) {
            const strikeData = {
                tradingSymbol: row["Tradingsymbol"],
                securityId: row["Token"],
                expiryDate: row["Expiry"], // Send expiry date without parsing or formatting
                strikePrice: row["Strike"],
            };
            if (row["Optiontype"] === "CE") {
                callStrikes.push(strikeData);
            } else if (row["Optiontype"] === "PE") {
                putStrikes.push(strikeData);
            }
            expiryDates.add(row["Expiry"]);
            }
        })
        .on("end", () => {
            console.log("\nFinished processing file");
            console.log(`Call Strikes: ${callStrikes.length}`);
            console.log(`Put Strikes: ${putStrikes.length}`);
            console.log(`Expiry Dates: ${expiryDates.size}`);
    
            callStrikes.sort((a, b) => a.strikePrice - b.strikePrice);
            putStrikes.sort((a, b) => a.strikePrice - b.strikePrice);
            // Filter out past dates and sort the remaining expiry dates
            const today = new Date();
            const sortedExpiryDates = Array.from(expiryDates)
            .filter(
                (dateStr) =>
                !isBefore(parse(dateStr, "dd-MMM-yyyy", new Date()), today) ||
                parse(dateStr, "dd-MMM-yyyy", new Date()).toDateString() ===
                    today.toDateString()
            )
            .sort((a, b) => {
                const dateA = parse(a, "dd-MMM-yyyy", new Date());
                const dateB = parse(b, "dd-MMM-yyyy", new Date());
                return dateA - dateB;
            });
    
            const result = {
              callStrikes,
              putStrikes,
              expiryDates: sortedExpiryDates,
            };
            symbolCache.set(cacheKey, result);

            res.json(result);
        })
        .on("error", (error) => {
            res.status(500).json({ message: "Failed to process Flattrade CSV file" });
            console.error("Error processing Flattrade CSV file:", error);
        });
    });

    // ===> Get Flattrade Orders and Trades
    router.get("/getOrdersAndTrades", async (req, res) => {
        const jKey = req.query.FLATTRADE_API_TOKEN;
        const clientId = req.query.FLATTRADE_CLIENT_ID;
    
        if (!jKey || !clientId) {
        return res.status(400).json({ message: "Token or Client ID is missing." });
        }
    
        const orderBookPayload = `jKey=${jKey}&jData=${JSON.stringify({
        uid: clientId,
        prd: "M",
        })}`;
        const tradeBookPayload = `jKey=${jKey}&jData=${JSON.stringify({
        uid: clientId,
        actid: clientId,
        })}`;
    
        try {
        // Fetch Order Book
        const orderBookRes = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/OrderBook",
            orderBookPayload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
    
        // Fetch Trade Book
        const tradeBookRes = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/TradeBook",
            tradeBookPayload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
    
        res.json({
            orderBook: orderBookRes.data,
            tradeBook: tradeBookRes.data,
        });
        } catch (error) {
        res.status(500).json({
            message: "Error fetching Flattrade orders and trades",
            error: error.message,
        });
        console.error("Error fetching Flattrade orders and trades:", error);
        }
    });

    // ===> Get Flattrade Order Margin
    router.post("/getOrderMargin", async (req, res) => {
        const jKey = req.headers.authorization?.split(" ")[1];
        const jData = req.body.jData;
    
        if (!jKey) {
        return res
            .status(400)
            .json({ message: "Token is missing. Please generate a token first." });
        }
    
        const payload = `jKey=${jKey}&jData=${jData}`;
    
        try {
        const response = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/GetOrderMargin",
            payload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
        res.json(response.data);
        console.log(`\nFlattrade Get Order Margin details:`, response.data);
        } catch (error) {
        res.status(500).json({
            message: "Error getting Flattrade order margin",
            error: error.message,
        });
        console.error("Error getting Flattrade order margin:", error);
        }
    });


//===> TRADING API CALLS <===


    // ===> Place Flattrade Order
    router.post("/placeOrder", async (req, res) => {
        const { uid, actid, exch, tsym, qty, prc, prd, trantype, prctyp, ret } =
        req.body;
    
        const jKey = req.headers.authorization?.split(" ")[1];
    
        if (!jKey) {
        return res
            .status(400)
            .json({ message: "Token is missing. Please generate a token first." });
        }
    
        const jData = JSON.stringify({
        uid,
        actid,
        exch,
        tsym,
        qty,
        prc,
        prd,
        trantype,
        prctyp,
        ret,
        });
    
        // const payload = `jKey=${jKey}&jData=${encodeURIComponent(jData)}`; // Not sure if we need this version, so keep it.
        const payload = `jKey=${jKey}&jData=${jData}`;
    
        try {
        const response = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/PlaceOrder",
            payload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
        res.json(response.data);
        console.log(
            `\nFlattrade Order Place details:`,
            { exch, tsym, qty, prc, prd, trantype, prctyp, ret },
            response.data
        );
        } catch (error) {
        res.status(500).json({
            message: "Error placing Flattrade Place order",
            error: error.message,
        });
        console.error("Error placing Flattrade Place order:", error);
        }
    });

    // ===> Cancel Flattrade Order
    router.post("/cancelOrder", async (req, res) => {
        const { norenordno, uid } = req.body;
        const jKey = req.query.FLATTRADE_API_TOKEN;
    
        if (!jKey) {
        return res
            .status(400)
            .json({ message: "Token is missing. Please generate a token first." });
        }
    
        const jData = JSON.stringify({ norenordno, uid });
        const payload = `jKey=${jKey}&jData=${jData}`;
    
        try {
        const response = await axios.post(
            "https://piconnect.flattrade.in/PiConnectTP/CancelOrder",
            payload,
            {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            }
        );
        res.json(response.data);
        console.log(`\n Flattrade Cancel Order:`, { norenordno }, response.data);
        } catch (error) {
        res.status(500).json({
            message: "Error cancelling Flattrade order",
            error: error.message,
        });
        console.error("Error cancelling Flattrade order:", error);
        }
    });


return router;
};