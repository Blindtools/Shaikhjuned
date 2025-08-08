const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
    downloadMediaMessage,
} = require("@whiskeysockets/baileys");

// Import custom modules
const { generateResponse, getModelInfo } = require("./gemini-config");
const { processAudio, getTranscriptionStatus } = require("./audio-transcription");
const { extractPdfText, processImage, analyzePdfContent, getMediaProcessingStatus } = require("./media-processor");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

/**
 * Main chat response function using modular approach
 * @param {string} text - The user's question.
 * @param {Array} [imageParts] - Optional image parts for vision API.
 * @returns {Promise<string>} - The response from the API.
 */
async function getChatResponse(text, imageParts = null) {
    try {
        return await generateResponse(text, imageParts);
    } catch (error) {
        console.error("Chat response error:", error);
        return "❌ Sorry, I'm experiencing technical difficulties. Please try again later.";
    }
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
    // Using simple file-based authentication
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
    const { version } = await fetchLatestBaileysVersion();

    // Stable socket configuration
    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        qrTimeout: 30000,
        defaultQueryTimeoutMs: 0,
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
                setTimeout(() => startWhatsApp(), 5000);
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
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            let replyText = "";
            let audioResponse = null;

            // Handle PDF attachments
            if (msg.message.documentMessage && msg.message.documentMessage.mimetype === "application/pdf") {
                console.log("Processing PDF document...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const pdfResult = await extractPdfText(buffer);
                
                if (pdfResult.success && pdfResult.text.length > 0) {
                    const analysis = analyzePdfContent(pdfResult.text, pdfResult.metadata);
                    const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                    replyText = await getChatResponse(prompt);
                } else {
                    replyText = pdfResult.summary || "❌ I couldn't extract text from this PDF. Please make sure it contains readable text.";
                }
            }
            // Handle image attachments
            else if (msg.message.imageMessage) {
                console.log("Processing image...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const imageResult = await processImage(buffer, msg.message.imageMessage.mimetype);
                
                if (imageResult.success) {
                    const prompt = incomingText || "Please analyze this image in detail and provide insights about what you see.";
                    replyText = await getChatResponse(prompt, [imageResult.imagePart]);
                } else {
                    replyText = imageResult.summary || "❌ I couldn't process this image. Please try with a different image format.";
                }
            }
            // Handle audio/voice messages with TTS response
            else if (msg.message.audioMessage || msg.message.pttMessage) {
                console.log("Processing audio message...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const mimeType = msg.message.audioMessage?.mimetype || msg.message.pttMessage?.mimetype || "audio/ogg";
                
                // Process audio with Gemini (transcribe + respond + TTS)
                const audioResult = await processAudio(buffer, mimeType, 'female');
                
                if (audioResult.success) {
                    replyText = audioResult.textResponse;
                    audioResponse = audioResult.audioResponse;
                } else {
                    replyText = audioResult.textResponse;
                }
            }
            // Handle text messages
            else if (incomingText) {
                console.log("Processing text message...");
                replyText = await getChatResponse(incomingText);
            }
            else {
                replyText = "Hello! I'm an AI assistant created by Shaikh Juned (shaikhjuned.co.in). I can help you with text messages, analyze images, extract text from PDFs, and transcribe audio messages with voice responses. How can I assist you today?";
            }

            // Send text response
            if (replyText) {
                await sock.sendMessage(remoteJid, { text: replyText });
            }

            // Send audio response if available
            if (audioResponse) {
                console.log("Sending voice response...");
                await sock.sendMessage(remoteJid, {
                    audio: audioResponse,
                    mimetype: 'audio/mp3',
                    ptt: true // Send as voice message
                });
            }
            
            await sock.sendPresenceUpdate("paused", remoteJid);

        } catch (err) {
            console.error("❌ An error occurred in message handler:", err);
            await sock.sendMessage(remoteJid, { 
                text: "❌ Sorry, an unexpected error occurred. Please try again later." 
            });
            await sock.sendPresenceUpdate("paused", remoteJid);
        }
    });
}

// --- Express Server Setup ---
startWhatsApp();

// Middleware for parsing JSON
app.use(express.json());
app.use(express.static('public'));

// Route to display the QR code
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`
            <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h2>✅ WhatsApp is Connected Successfully!</h2>
                <p>Your AI bot is ready to receive messages.</p>
                <div style="background-color: #2a2a2a; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>🎯 Features Active:</h3>
                    <p>✅ Text Chat with AI</p>
                    <p>✅ Image Analysis</p>
                    <p>✅ PDF Processing</p>
                    <p>✅ Voice Message Transcription</p>
                    <p>✅ Voice Response (TTS)</p>
                </div>
                <p style="color: #4CAF50;">Created by Shaikh Juned - shaikhjuned.co.in</p>
            </div>
        `);
    } else if (qrCodeImage) {
        res.send(`
            <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                <h2>Scan this QR Code to Connect WhatsApp</h2>
                <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px; border: 2px solid #4CAF50;"/>
                <p style="margin-top: 20px;">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <p style="color: #4CAF50;">Created by Shaikh Juned - shaikhjuned.co.in</p>
            </div>
        `);
    } else {
        res.send(`
            <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h3>🔄 Generating QR code...</h3>
                <p>Please wait and refresh the page.</p>
                <script>setTimeout(() => location.reload(), 3000);</script>
            </div>
        `);
    }
});

// Route for server status
app.get("/", (req, res) => {    
    res.send(`
        <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; padding: 30px;">
            <h1>🤖 WhatsApp AI Bot Server</h1>
            <h3>Status: ${isConnected ? '✅ Connected' : '❌ Disconnected'}</h3>
            <div style="background-color: #2a2a2a; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <h3>🚀 Features:</h3>
                <ul style="text-align: left; max-width: 600px; margin: 0 auto;">
                    <li>💬 Text chat with Gemini AI</li>
                    <li>🖼️ Image analysis and description</li>
                    <li>📄 PDF text extraction and analysis</li>
                    <li>🎵 Voice message transcription</li>
                    <li>🔊 Voice responses (Text-to-Speech)</li>
                    <li>🎯 Multiple voice options (male/female)</li>
                </ul>
            </div>
            <p>To get the QR code for WhatsApp connection, go to <a href="/qr" style="color: #4CAF50;">/qr</a></p>
            <hr style="margin: 30px 0; border-color: #444;">
            <p style="color: #4CAF50;">Created by <strong>Shaikh Juned</strong> - <a href="https://shaikhjuned.co.in" style="color: #4CAF50;">shaikhjuned.co.in</a></p>
            <p style="color: #888; font-size: 14px;">IMO Professional Web Developer</p>
        </div>
    `);    
});

// API endpoint for testing Gemini AI
app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }
        
        const response = await getChatResponse(message);
        res.json({ response });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// API endpoint for service status
app.get("/api/status", (req, res) => {
    try {
        const status = {
            server: {
                status: "✅ Running",
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: "2.0.0"
            },
            whatsapp: {
                connected: isConnected ? "✅ Connected" : "❌ Disconnected",
                qrAvailable: qrCodeImage ? "✅ Available" : "❌ Not Available"
            },
            ai: getModelInfo(),
            transcription: getTranscriptionStatus(),
            mediaProcessing: getMediaProcessingStatus(),
            attribution: {
                creator: "Shaikh Juned",
                website: "shaikhjuned.co.in",
                role: "IMO Professional Web Developer"
            }
        };
        
        res.json(status);
    } catch (error) {
        console.error("Status API Error:", error);
        res.status(500).json({ error: "Failed to get status" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📱 WhatsApp QR Code: http://localhost:${PORT}/qr`);
    console.log(`🌐 Server Status: http://localhost:${PORT}/`);
    console.log(`💡 Created by Shaikh Juned - shaikhjuned.co.in`);
});
