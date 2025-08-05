// Developed by Shaikh Juned
const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
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

// --- Gemini API Key ---
const GEMINI_API_KEY = "AIzaSyC06sdH7LasR3HS_yDntQWsWr2oHu0DJjA";

// --- Get AI response ---
async function getChatResponse(text) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: { temperature: 0.7, topK: 1, topP: 1, maxOutputTokens: 1024 }
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "⚠️ No valid response.";
  } catch (e) {
    console.error("Gemini error:", e);
    return "❌ Gemini AI error.";
  }
}

// --- Generate image from prompt ---
async function generateImageFromPrompt(prompt) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GEMINI_API_KEY}`;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json();
    const base64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) return null;
    const file = path.join(__dirname, "generated.jpg");
    fs.writeFileSync(file, Buffer.from(base64, "base64"));
    return file;
  } catch (err) {
    console.error("Image error:", err);
    return null;
  }
}

// --- Handle slash commands ---
function handleCommand(cmd) {
  switch (cmd.toLowerCase()) {
    case "/menu":
      return "📋 Menu:\n/help\n/contact\n/feedback\n/image <prompt>\n/reset\n/stop";
    case "/help":
      return "ℹ️ Help:\nSend a message or use /image <prompt>";
    case "/contact":
      return "📞 Contact:\nEmail: nfo@blindtools.in\nWebsite: https://blindtools.in";
    case "/feedback":
      return "📝 Feedback: We value your input!";
    case "/stop":
      return "👋 Bot session ended. Send a message to restart.";
    case "/reset":
      return "🔄 Session has been reset!";
    default:
      return null;
  }
}

// --- Start WhatsApp bot ---
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCodeImage = await qrcode.toDataURL(qr);
      console.log("📲 Scan QR to connect.");
    }
    if (connection === "open") {
      isConnected = true;
      qrCodeImage = "";
      console.log("✅ WhatsApp connected.");
    } else if (connection === "close") {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code && code !== DisconnectReason.loggedOut) {
        console.log("🔁 Reconnecting...");
        startWhatsApp();
      } else {
        console.log("❌ Disconnected.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) return;

    const remoteJid = msg.key.remoteJid;
    const incoming = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!incoming) return;

    // ⛔ Block unwanted messages
    const blockedMessages = ["+1", "👍", "ok", "k", "okay", "👌", "hi", "hello"];
    if (blockedMessages.includes(incoming.trim().toLowerCase())) {
      console.log("⛔ Ignored blocked message:", incoming);
      return;
    }

    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate("composing", remoteJid);

    const trimmed = incoming.trim().toLowerCase();
    let replyText = handleCommand(trimmed);

    if (!replyText && trimmed.startsWith("/image")) {
      const prompt = incoming.slice(6).trim();
      if (!prompt) return await sock.sendMessage(remoteJid, { text: "❌ Use: /image your prompt" });

      await sock.sendMessage(remoteJid, { text: `🎨 Creating image for: "${prompt}"` });
      const img = await generateImageFromPrompt(prompt);
      if (img) {
        await sock.sendMessage(remoteJid, {
          image: fs.readFileSync(img),
          caption: `🖼️ Image: "${prompt}"`,
        });
      } else {
        await sock.sendMessage(remoteJid, { text: "❌ Image generation failed." });
      }
      return;
    }

    if (!replyText) replyText = await getChatResponse(incoming);
    await sock.sendMessage(remoteJid, { text: replyText });
  });
}

startWhatsApp();

// --- Web Server ---
app.get("/qr", (req, res) => {
  if (isConnected) {
    res.send(`<body style="background:black;color:lime;display:flex;justify-content:center;align-items:center;height:100vh;"><h2>✅ WhatsApp is already connected!</h2></body>`);
  } else if (qrCodeImage) {
    res.send(`
      <html><head><meta http-equiv="refresh" content="30"><title>Scan QR</title></head>
      <body style="background:black;display:flex;justify-content:center;align-items:center;height:100vh;">
        <div style="text-align:center;">
          <h2 style="color:white;">📲 Scan QR</h2>
          <img src="${qrCodeImage}" style="width:400px;height:400px;" />
          <p style="color:gray;">Refreshes every 30s</p>
        </div>
      </body></html>
    `);
  } else {
    res.send(`<body style="background:black;color:white;display:flex;justify-content:center;align-items:center;height:100vh;"><h3>⏳ Loading QR code... Please refresh.</h3></body>`);
  }
});

app.get("/", (req, res) => {
  res.send(`<body style="background:black;color:white;padding:20px;"><h2>🤖 WhatsApp Gemini Bot - Shaikh Juned</h2><p>Status: ${isConnected ? "🟢 Connected" : "🔴 Disconnected"}</p><p>Visit <a href="/qr" style="color:lime;">/qr</a> to scan</p></body>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));

