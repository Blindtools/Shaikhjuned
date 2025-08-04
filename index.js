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

// --- Gemini AI Integration ---
async function getChatResponse(text) {
    const apiKey = "AIzaSyC06sdH7LasR3HS_yDntQWsWr2oHu0DJjA";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;

    const body = {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
            temperature: 0.7,
            topK: 1,
            topP: 1,
            maxOutputTokens: 1024
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (reply) {
            return reply.trim();
        } else {
            console.error("Gemini returned invalid response:", JSON.stringify(data, null, 2));
            return "⚠️ Gemini AI returned an empty or invalid response.";
        }
    } catch (error) {
        console.error("Gemini API error:", error);
        return "❌ Error talking to Gemini AI. Please try again later.";
    }
}

// --- Command Handler ---
function handleCommand(command) {
    switch (command.toLowerCase()) {
        case "/menu":
            return "📋 Menu:\n/help\n/contact\n/feedback\n/stop";
        case "/help":
            return "ℹ️ Help:\nSend any message and I’ll answer using Gemini AI.";
        case "/contact":
            return "📞 Contact:\nEmail: nfo@blindtools.in\nWebsite: https://blindtools.in";
        case "/feedback":
            return "📝 Feedback:\nWe appreciate your feedback! 🙏";
        case "/stop":
            return "👋 You have exited the bot. Type any message to continue.";
        default:
            return null;
    }
}

// --- WhatsApp Connection ---
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
            console.log("📲 QR code generated. Please scan it.");
        }

        if (connection === "open") {
            isConnected = true;
            qrCodeImage = "";
            console.log("✅ WhatsApp Connected Successfully!");
        } else if (connection === "close") {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("🔁 Reconnecting...");
                startWhatsApp();
            } else {
                console.log("❌ Disconnected or Logged out.");
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
            await sock.sendMessage(remoteJid, { text: "❌ An error occurred." });
        }
    });
}

startWhatsApp();

// --- Express Web Server ---
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`<body style="background-color: black; color: lime; display: flex; justify-content: center; align-items: center; height: 100vh;"><h2>✅ WhatsApp is already connected!</h2></body>`);
    } else if (qrCodeImage) {
        res.send(`
            <html>
            <head><meta http-equiv="refresh" content="30"><title>Scan QR</title></head>
            <body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh;">
                <div style="text-align: center;">
                    <h2 style="color: white;">📲 Scan QR to Connect</h2>
                    <img src="${qrCodeImage}" alt="QR Code" style="width: 400px; height: 400px;" />
                    <p style="color: gray;">Auto-refresh every 30 seconds</p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`<body style="background-color: black; color: white; display: flex; justify-content: center; align-items: center; height: 100vh;"><h3>⏳ Generating QR code... Please refresh.</h3></body>`);
    }
});

app.get("/", (req, res) => {
    res.send(`
        <body style="background-color: black; color: white; font-family: sans-serif; padding: 20px;">
            <h2>🤖 WhatsApp Gemini Bot - Shaikh Juned</h2>
            <p>Status: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
            <p>Scan WhatsApp QR at <a href="/qr" style="color: lime;">/qr</a></p>
        </body>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));

