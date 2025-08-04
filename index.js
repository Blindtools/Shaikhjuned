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

const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

// --- Gemini API Response ---
async function getChatResponse(text) {
    const apiKey = "AIzaSyC06sdH7LasR3HS_yDntQWsWr2oHu0DJjA";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;

    const body = {
        contents: [{ parts: [{ text }] }],
    };

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (reply) return reply;
        else return "❌ Gemini AI did not return a valid response.";
    } catch (error) {
        console.error("Gemini API error:", error);
        return "❌ Unable to reach Gemini AI.";
    }
}

// --- Handle Text Commands ---
function handleCommand(command) {
    const text = command.toLowerCase();
    switch (text) {
        case "/menu":
            return "📋 Menu:\n/help\n/contact\n/feedback\n/stop";
        case "/help":
            return "ℹ️ Help:\nSend any question and I’ll try to answer it using Gemini AI.";
        case "/contact":
            return "📞 Contact:\nEmail: nfo@blindtools.in\nWebsite: https://blindtools.in";
        case "/feedback":
            return "📝 Feedback:\nThanks for your input! We’re always improving.";
        case "/stop":
            return "👋 Goodbye! Type anything to start again.";
        default:
            return null;
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

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeImage = await qrcode.toDataURL(qr);
            console.log("📲 QR code generated. Scan to connect.");
        }

        if (connection === "open") {
            isConnected = true;
            qrCodeImage = "";
            console.log("✅ WhatsApp Connected!");
        } else if (connection === "close") {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("🔁 Reconnecting...");
                startWhatsApp();
            } else {
                console.log("❌ Disconnected.");
                qrCodeImage = "";
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) return;

        const remoteJid = msg.key.remoteJid;
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!incomingText) return;

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            let replyText = handleCommand(incomingText);
            if (!replyText) {
                replyText = await getChatResponse(incomingText);
            }

            await sock.sendMessage(remoteJid, { text: replyText });
            await sock.sendPresenceUpdate("paused", remoteJid);
        } catch (err) {
            console.error("❌ Message error:", err);
            await sock.sendMessage(remoteJid, { text: "⚠️ Something went wrong." });
        }
    });
}

startWhatsApp();

// --- Web UI ---
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`<body style="background-color: black; color: lime; display: flex; justify-content: center; align-items: center; height: 100vh;"><h2>✅ WhatsApp is already connected!</h2></body>`);
    } else if (qrCodeImage) {
        res.send(`
            <html>
                <head><meta http-equiv="refresh" content="30"><title>Scan QR</title></head>
                <body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh;">
                    <div style="text-align: center;">
                        <h2 style="color: white;">📲 Scan this QR to Connect</h2>
                        <img src="${qrCodeImage}" alt="QR Code" style="width: 400px; height: 400px;" />
                        <p style="color: gray;">Auto-refreshes every 30 seconds</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send(`<body style="background-color: black; color: white; display: flex; justify-content: center; align-items: center; height: 100vh;"><h3>⏳ Generating QR... Please refresh soon.</h3></body>`);
    }
});

app.get("/", (req, res) => {
    res.send(`
        <body style="background-color: black; color: white; font-family: sans-serif; padding: 20px;">
            <h2>🤖 WhatsApp Gemini Bot - Shaikh Juned</h2>
            <p>Status: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
            <p>Visit <a href="/qr" style="color: lime;">/qr</a> to scan WhatsApp QR</p>
        </body>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));

