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

async function getChatResponse(text) {
    const apiUrl = `https://chatgpt-4-hridoy.vercel.app/?question=${encodeURIComponent(text)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data && data.result) {
            return data.result;
        } else {
            console.error("API Error: Invalid response structure", data);
            return "Sorry, I am unable to provide a response at this moment.";
        }
    } catch (error) {
        console.error("Error fetching from API:", error);
        return "Sorry, an error occurred. Please try again.";
    }
}

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        qrTimeout: 30000,
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeImage = await qrcode.toDataURL(qr);
        }
        if (connection === "open") {
            isConnected = true;
            console.log("✅ WhatsApp Connected Successfully!");
        } else if (connection === "close") {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("Connection closed due to an error, reconnecting...");
                startWhatsApp();
            } else {
                console.log("Connection closed. You have been logged out.");
                qrCodeImage = "";
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        if (!msg || !msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) return;

        const remoteJid = msg.key.remoteJid;

        const textContent = msg.message.conversation ||
                            msg.message.extendedTextMessage?.text ||
                            msg.message.imageMessage?.caption ||
                            msg.message.videoMessage?.caption ||
                            "";

        const incomingText = textContent.trim();

        if (!incomingText) return;

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);

            const replyText = await getChatResponse(incomingText);

            await sock.sendMessage(remoteJid, { text: replyText });
            await sock.sendPresenceUpdate('paused', remoteJid);

        } catch (err) {
            console.error("❌ An error occurred in message handler:", err);
            await sock.sendMessage(remoteJid, { text: "❌ Sorry, an unexpected error occurred." });
            await sock.sendPresenceUpdate('paused', remoteJid);
        }
    });
}

startWhatsApp();

app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send("<h2>WhatsApp is already connected ✅</h2>");
    } else if (qrCodeImage) {
        res.send(`<body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h2 style="color: white;">Scan this QR Code to Connect</h2><img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px;"/></div></body>`);
    } else {
        res.send("<h3 style='color: white;'>Generating QR code... Please wait and refresh.</h3>");
    }
});

app.get("/", (req, res) => {
    res.send(`<h2>WhatsApp Bot Server is running</h2><p>Status: ${isConnected ? 'Connected ✅' : 'Disconnected ❌'}</p><p>To get the QR code, go to <a href="/qr">/qr</a></p>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));

