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
const { generateResponse, getModelInfo } = require("./gemini-config.js");
const { processAudio, getTranscriptionStatus } = require("./audio-transcription.js");
const { extractPdfText, processImage, analyzePdfContent, getMediaProcessingStatus } = require("./media-processor.js");
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

        // Do not reply to own messages, messages in groups, or to non-standard JIDs (e.g., +1 numbers, hidden channel numbers)
        const remoteJid = msg.key.remoteJid;
        if (!msg.message || msg.key.fromMe || isJidGroup(remoteJid) || remoteJid.startsWith("1") || remoteJid.length > 18) {
            return;
        }
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            let replyText = "";
            let audioResponse = null;

            // Handle menu commands
            if (incomingText.toLowerCase() === 'menu' || incomingText.toLowerCase() === '/menu') {
                const buttons = [
                    { buttonId: 'contact_us', buttonText: { displayText: '📞 Contact Us' }, type: 1 },
                    { buttonId: 'about_us', buttonText: { displayText: 'ℹ️ About Us' }, type: 1 },
                    { buttonId: 'stop_service', buttonText: { displayText: '🛑 Stop Service' }, type: 1 }
                ];
                await sendButtonMessage(remoteJid, `🤖 *AI Assistant Menu*\n\nPlease select an option:`, buttons);
                return;
            }
            // Handle button responses
            else if (msg.message.buttonsResponseMessage) {
                const selectedButtonId = msg.message.buttonsResponseMessage.selectedButtonId;
                switch (selectedButtonId) {
                    case 'contact_us':
                        replyText = `📞 *Contact Information*\n\n` +
                                  `🌐 Website: https://shaikhjuned.co.in\n` +
                                  `📧 Email: support@shaikhjuned.co.in\n` +
                                  `💼 Developer: Shaikh Juned\n` +
                                  `🏆 Expertise: IMO Professional Web Developer\n\n` +
                                  `📱 WhatsApp Support: Available 24/7\n` +
                                  `🔧 Technical Support: AI, Web Development, Bot Services\n\n` +
                                  `Type *menu* to return to main menu.\n\n` +
                                  `---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in`;
                        break;
                    case 'about_us':
                        replyText = `ℹ️ *About Our AI Assistant*\n\n` +
                                  `🤖 *Advanced AI Bot* powered by Google Gemini\n` +
                                  `👨‍💻 Created by *Shaikh Juned* - IMO Professional Web Developer\n\n` +
                                  `🚀 *Features:*\n` +
                                  `• 💬 Intelligent text conversations\n` +
                                  `• 🖼️ Image analysis and description\n` +
                                  `• 📄 PDF document processing\n` +
                                  `• 🎵 Voice message transcription\n` +
                                  `• 🔊 Voice responses (Text-to-Speech)\n` +
                                  `• 🎯 Multi-language support\n\n` +
                                  `🌐 Visit: https://shaikhjuned.co.in\n` +
                                  `📱 Available 24/7 for assistance\n\n` +
                                  `Type *menu* to return to main menu.\n\n` +
                                  `---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in`;
                        break;
                    case 'stop_service':
                        replyText = `🛑 *Service Paused*\n\n` +
                                  `The AI assistant has been temporarily paused for this chat.\n\n` +
                                  `To resume service, simply type:\n` +
                                  `• *start* or *resume*\n` +
                                  `• *menu* for options\n` +
                                  `• Any message to continue\n\n` +
                                  `Thank you for using our AI assistant!\n\n` +
                                  `---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in`;
                        break;
                    default:
                        replyText = "I didn't understand that button. Please type *menu* to see available options.";
                        break;
                }
            }
            // Handle Resume Service
            else if (incomingText.toLowerCase().includes('start') || incomingText.toLowerCase().includes('resume')) {
                replyText = `✅ *Service Resumed*\n\n` +
                          `Welcome back! The AI assistant is now active.\n\n` +
                          `🤖 I can help you with:\n` +
                          `• Text conversations\n` +
                          `• Image analysis\n` +
                          `• PDF processing\n` +
                          `• Voice messages\n\n` +
                          `Type *menu* to see all options.\n\n` +
                          `---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in`;
            }
            // Handle PDF attachments
            else if (msg.message.documentMessage && msg.message.documentMessage.mimetype === "application/pdf") {
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
                
                // Add menu option to response
                replyText += "\n\n📋 Type *menu* for more options.";
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
                
                // Add menu option to response
                replyText += "\n\n📋 Type *menu* for more options.";
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
                
                // Add menu option to response
                replyText += "\n\n📋 Type *menu* for more options.";
            }
            // Handle text messages
            else if (incomingText) {
                console.log("Processing text message...");
                replyText = await getChatResponse(incomingText);
                
                // Add menu option to response
                replyText += "\n\n📋 Type *menu* for more options.";
            }
            else {
                replyText = "Hello! I'm an AI assistant created by Shaikh Juned (shaikhjuned.co.in). I can help you with text messages, analyze images, extract text from PDFs, and transcribe audio messages with voice responses.\n\n📋 Type *menu* to see all available options.\n\nHow can I assist you today?";
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
                text: "❌ Sorry, an unexpected error occurred. Please try again later.\n\n📋 Type *menu* for more options." 
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


/**
 * Sends a message with interactive buttons.
 * @param {string} jid - The recipient JID.
 * @param {string} text - The message text.
 * @param {Array<Object>} buttons - An array of button objects.
 */
async function sendButtonMessage(jid, text, buttons) {
    const buttonMessage = {
        text: text,
        buttons: buttons,
        headerType: 1
    };
    await sock.sendMessage(jid, buttonMessage);
}


