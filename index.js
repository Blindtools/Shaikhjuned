const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidGroup,
} = require("@whiskeysockets/baileys");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

/**
 * এই ফাংশনটি ইউজারের পাঠানো মেসেজটি আপনার দেওয়া API-তে পাঠায়
 * এবং সেখান থেকে প্রাপ্ত উত্তর রিটার্ন করে।
 * @param {string} text - ইউজারের পাঠানো প্রশ্ন।
 * @returns {Promise<string>} - API থেকে পাওয়া উত্তর।
 */
async function getChatResponse(text) {
  // আপনার দেওয়া API এন্ডপয়েন্ট
  const apiUrl = `https://chatgpt-4-hridoy.vercel.app/?question=${encodeURIComponent(text)}`;
  
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    // API থেকে পাওয়া JSON অবজেক্ট থেকে 'result' অংশটি বের করে আনা হচ্ছে
    if (data && data.result) {
      return data.result;
    } else {
      // যদি API কোনো কারণে সঠিক উত্তর না দেয়
      console.error("API Error: Invalid response structure", data);
      return "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।";
    }
  } catch (error) {
    console.error("Error fetching from API:", error);
    return "দুঃখিত, একটি সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।";
  }
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, printQRInTerminal: true, auth: state });

  // Connection এবং Reconnection Logic
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
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== 401;
      if (shouldReconnect) {
        console.log("Connection closed due to an error, reconnecting...");
        startWhatsApp();
      } else {
        console.log("Connection closed. You are logged out.");
      }
    }
  });

  // Creds সেভ করার জন্য
  sock.ev.on("creds.update", saveCreds);

  // --- Main Message Handling Logic ---
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];

    // বট নিজের মেসেজে বা গ্রুপের মেসেজে রিপ্লাই দেবে না
    if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
      return;
    }

    const remoteJid = msg.key.remoteJid;
    const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

    // যদি কোনো টেক্সট মেসেজ না থাকে, তাহলে কিছু করবে না
    if (!incomingText) {
      return;
    }

    try {
      await sock.readMessages([msg.key]);
      await sock.sendPresenceUpdate('composing', remoteJid); // "typing..." স্ট্যাটাস দেখানোর জন্য

      // API থেকে উত্তর আনার জন্য ফাংশন কল করা হচ্ছে
      const replyText = await getChatResponse(incomingText);

      // ইউজারের কাছে উত্তর পাঠানো হচ্ছে
      await sock.sendMessage(remoteJid, { text: replyText });
      
      await sock.sendPresenceUpdate('paused', remoteJid); // "typing..." স্ট্যাটাস বন্ধ করার জন্য

    } catch (err) {
      console.error("❌ An error occurred in message handler:", err);
      // কোনো সমস্যা হলে ইউজারকে জানানো হচ্ছে
      await sock.sendMessage(remoteJid, { text: "❌ দুঃখিত, একটি অপ্রত্যাশিত সমস্যা হয়েছে।" });
      await sock.sendPresenceUpdate('paused', remoteJid);
    }
  });
}

// --- Express Server Setup ---
startWhatsApp();

// QR কোড দেখানোর জন্য রুট
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send("<h2>WhatsApp is already connected ✅</h2>");
    } else if (qrCodeImage) {
        res.send(`<body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h2 style="color: white;">Scan this QR Code to Connect</h2><img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px;"/></div></body>`);
    } else {
        res.send("<h3 style='color: white;'>Generating QR code... Please wait and refresh.</h3>");
    }
});

// সার্ভার স্ট্যাটাস দেখার জন্য
app.get("/", (req, res) => { 
    res.send(`<h2>WhatsApp Bot Server is running</h2><p>Status: ${isConnected ? 'Connected ✅' : 'Disconnected ❌'}</p><p>To get the QR code, go to <a href="/qr">/qr</a></p>`); 
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
