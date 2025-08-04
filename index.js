// Developed by Shaikh Juned
const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
} = require("@whiskeysockets/baileys");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

/**
 * Sends the user's message to the specified API and returns the response.
 */
async function getChatResponse(text) {
    const apiUrl = `https://api.ashlynn-repo.tech/chat/?question=${encodeURIComponent(text)}&model=meta-ai`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data && data.result) {
            return data.result;
        } else {
            console.error("API Error: Invalid response", data);
            return "Sorry, I am unable to provide a response at this moment.";
        }
    } catch (error) {
        console.error("Error fetching from API:", error);
        return "Sorry, an error occurred. Please try again.";
    }
}

// --- WhatsApp Bot Logic ---
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
    });

    // Connection updates
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeImage = await qrcode.toDataURL(qr);
            console.log("📲 QR Code generated. Please scan to connect.");
        }

        if (connection === "open") {
            isConnected = true;
            qrCodeImage = "";
            console.log("✅ WhatsApp Connected Successfully!");
        } else if (connection === "close") {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("⚠️ Connection closed due to an error, reconnecting...");
                startWhatsApp();
            } else {
                console.log("❌ You have been logged out.");
                qrCodeImage = "";
            }
        }
    });

    // Save credentials
    sock.ev.on("creds.update", saveCreds);

    // Message handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) return;

        const remoteJid = msg.key.remoteJid;
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!incomingText) return;

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            const replyText = await getChatResponse(incomingText);
            await sock.sendMessage(remoteJid, { text: replyText });

            await sock.sendPresenceUpdate("paused", remoteJid);
        } catch (err) {
            console.error("❌ Message handler error:", err);
            await sock.sendMessage(remoteJid, { text: "❌ Sorry, an error occurred." });
        }
    });
}

// Start WhatsApp socket
startWhatsApp();

// --- Express Web Server ---
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`<body style="background-color: black; color: lime; display: flex; justify-content: center; align-items: center; height: 100vh;"><h2>✅ WhatsApp is already connected!</h2></body>`);
    } else if (qrCodeImage) {
        res.send(`
            <html>
                <head>
                    <meta http-equiv="refresh" content="30">
                    <title>WhatsApp QR Code</title>
                </head>
                <body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                    <div style="text-align: center;">
                        <h2 style="color: white;">📲 Scan this QR Code to Connect</h2>
                        <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px;"/>
                        <p style="color: gray;">Auto-refreshes every 30 seconds</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send(`<body style="background-color: black; color: white; display: flex; justify-content: center; align-items: center; height: 100vh;"><h3>⏳ Generating QR code... Please wait and refresh.</h3></body>`);
    }
});

app.get("/", (req, res) => {
    res.send(`
        <body style="background-color: black; color: white; font-family: sans-serif; padding: 20px;">
            <h2>🤖 WhatsApp Bot Server - Shaikh Juned</h2>
            <p>Status: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
            <p>Go to <a href="/qr" style="color: lime;">/qr</a> to scan the WhatsApp QR code</p>
        </body>
    `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running at http://localhost:${PORT}`));

