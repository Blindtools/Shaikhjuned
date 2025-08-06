const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const pino = require("pino");
const pdf = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
    downloadContentFromMessage,
} = require("@whiskeysockets/baileys");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

// Gemini AI API configuration
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";
const GEMINI_API_KEY = "AIzaSyC06sdH7LasR3HS_yDntQWsWr2oHu0DJjA";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Sends the user's message to the Gemini AI API and returns the response.
 * @param {string} text - The user's question.
 * @returns {Promise<string>} - The response from the API.
 */
async function getChatResponse(text) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent(text);
        const response = await result.response;
        const replyText = response.text();
        return replyText;
    } catch (error) {
        console.error("Error fetching from Gemini API:", error.message);
        return "Sorry, an error occurred while connecting to Gemini AI. Please try again.";
    }
}

/**
 * Transcribes audio using Gemini AI.
 * @param {Buffer} audioBuffer - The audio data as a Buffer.
 * @returns {Promise<string>} - The transcribed text.
 */
async function transcribeAudio(audioBuffer) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent([
            { inlineData: { data: audioBuffer.toString('base64'), mimeType: 'audio/wav' } },
            "Transcribe this audio."
        ]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error transcribing audio with Gemini AI:", error.message);
        return "Sorry, I couldn't transcribe the audio.";
    }
}

/**
 * Extracts text from a PDF using OCR with Gemini AI.
 * @param {Buffer} pdfBuffer - The PDF data as a Buffer.
 * @returns {Promise<string>} - The extracted text.
 */
async function extractTextFromPdf(pdfBuffer) {
    try {
        const data = await pdf(pdfBuffer);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent([
            { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
            "Extract all text from this PDF and perform OCR if necessary."
        ]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error extracting text from PDF with Gemini AI:", error.message);
        return "Sorry, I couldn't extract text from the PDF.";
    }
}

/**
 * Describes a video using Gemini AI.
 * @param {Buffer} videoBuffer - The video data as a Buffer.
 * @returns {Promise<string>} - The video description.
 */
async function describeVideo(videoBuffer) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent([
            { inlineData: { data: videoBuffer.toString('base64'), mimeType: 'video/mp4' } },
            "Describe this video in detail."
        ]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error describing video with Gemini AI:", error.message);
        return "Sorry, I couldn't describe the video.";
    }
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
    // Using simple file-based authentication
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
    const { version } = await fetchLatestBaileysVersion();

    // Stable socket configuration from your advanced bot
    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        qrTimeout: 30000,
    });

    // Connection and Reconnection Logic
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
            
            // Reconnect on all errors except when logged out intentionally
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("Connection closed due to an error, reconnecting...");
                startWhatsApp();
            } else {
                console.log("Connection closed. You have been logged out.");
                qrCodeImage = ""; 
            }
        }
    });

    // Save credentials
    sock.ev.on("creds.update", saveCreds);

    // --- Main Message Handling Logic ---
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        // Do not reply to own messages or messages in groups
        if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
            return;
        }

        const remoteJid = msg.key.remoteJid;
        let replyText = "";

        if (msg.message.audioMessage) {
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            replyText = await transcribeAudio(buffer);
        } else if (msg.message.documentMessage && msg.message.documentMessage.mimetype === 'application/pdf') {
            const stream = await downloadContentFromMessage(msg.message.documentMessage, 'document');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            replyText = await extractTextFromPdf(buffer);
        } else if (msg.message.videoMessage) {
            const stream = await downloadContentFromMessage(msg.message.videoMessage, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            replyText = await describeVideo(buffer);
        } else {
            const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!incomingText) {
                return;
            }
            replyText = await getChatResponse(incomingText);
        }

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate('composing', remoteJid); // Show "typing..."

            await sock.sendMessage(remoteJid, { text: replyText });
            
            await sock.sendPresenceUpdate('paused', remoteJid); // Stop "typing..."

        } catch (err) {
            console.error("❌ An error occurred in message handler:", err);
            await sock.sendMessage(remoteJid, { text: "❌ Sorry, an unexpected error occurred." });
            await sock.sendPresenceUpdate('paused', remoteJid);
        }
    });
}

// --- Express Server Setup ---
startWhatsApp();

// Route to display the QR code
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send("<h2>WhatsApp is already connected ✅</h2>");
    } else if (qrCodeImage) {
        res.send(`<body style="background-color: black; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h2 style="color: white;">Scan this QR Code to Connect</h2><img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px;"/></div></body>`);
    } else {
        res.send("<h3 style=\'color: white;\'>Generating QR code... Please wait and refresh.</h3>");
    }
});

// Route for server status
app.get("/", (req, res) => {    
    res.send(`<h2>WhatsApp Bot Server is running</h2><p>Status: ${isConnected ? 'Connected ✅' : 'Disconnected ❌'}</p><p>To get the QR code, go to <a href="/qr">/qr</a></p>`);    
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));


