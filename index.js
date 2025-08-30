const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
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
const { getCurrentWeather } = require("./weather.js");

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
    try {
        console.log("🔄 Initializing WhatsApp connection...");
        
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
                console.log("📱 QR Code generated for WhatsApp connection");
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
                    console.log("🔄 Connection closed, reconnecting in 5 seconds...");
                    setTimeout(() => startWhatsApp(), 5000);
                } else {
                    console.log("❌ Connection closed. Logged out.");
                    qrCodeImage = ""; 
                }
            }
        });

        // Save credentials
        sock.ev.on("creds.update", saveCreds);

        // --- Main Message Handling Logic ---
        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages[0];

            // Do not reply to own messages, messages in groups, or to non-standard JIDs
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
                    replyText = `🤖 *AI Assistant Menu*\n\n` +
                              `Available Commands:\n` +
                              `• Send any text for AI chat\n` +
                              `• Send images for analysis\n` +
                              `• Send PDFs for processing\n` +
                              `• Send voice messages\n` +
                              `• Type "weather in [city]" for weather\n\n` +
                              `📞 Contact: shaikhjuned.co.in\n` +
                              `---\n💡 Powered by Shaikh Juned`;
                }
                // Handle Resume Service
                else if (incomingText.toLowerCase().includes('start') || incomingText.toLowerCase().includes('resume')) {
                    replyText = `✅ *Service Active*\n\n` +
                              `Welcome! The AI assistant is ready.\n\n` +
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
                    console.log("📄 Processing PDF document...");
                    const buffer = await downloadMediaMessage(msg, "buffer");
                    const pdfResult = await extractPdfText(buffer);
                    
                    if (pdfResult.success && pdfResult.text.length > 0) {
                        const analysis = analyzePdfContent(pdfResult.text, pdfResult.metadata);
                        const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                        replyText = await getChatResponse(prompt);
                    } else {
                        replyText = pdfResult.summary || "❌ I couldn't extract text from this PDF. Please make sure it contains readable text.";
                    }
                    
                    replyText += "\n\n📋 Type *menu* for more options.";
                }
                // Handle image attachments
                else if (msg.message.imageMessage) {
                    console.log("🖼️ Processing image...");
                    const buffer = await downloadMediaMessage(msg, "buffer");
                    const imageResult = await processImage(buffer, msg.message.imageMessage.mimetype);
                    
                    if (imageResult.success) {
                        const prompt = incomingText || "Please analyze this image in detail and provide insights about what you see.";
                        replyText = await getChatResponse(prompt, [imageResult.imagePart]);
                    } else {
                        replyText = imageResult.summary || "❌ I couldn't process this image. Please try with a different image format.";
                    }
                    
                    replyText += "\n\n📋 Type *menu* for more options.";
                }
                // Handle audio/voice messages
                else if (msg.message.audioMessage || msg.message.pttMessage) {
                    console.log("🎵 Processing audio message...");
                    const buffer = await downloadMediaMessage(msg, "buffer");
                    const mimeType = msg.message.audioMessage?.mimetype || msg.message.pttMessage?.mimetype || "audio/ogg";
                    
                    const audioResult = await processAudio(buffer, mimeType, 'female');
                    
                    if (audioResult.success) {
                        replyText = audioResult.textResponse;
                        audioResponse = audioResult.audioResponse;
                    } else {
                        replyText = audioResult.textResponse;
                    }
                    
                    replyText += "\n\n📋 Type *menu* for more options.";
                }
                // Handle text messages
                else if (incomingText) {
                    console.log("💬 Processing text message...");
                    if (incomingText.toLowerCase().startsWith("weather in ")) {
                        const city = incomingText.substring(11).trim();
                        replyText = await getCurrentWeather(city);
                    } else {
                        replyText = await getChatResponse(incomingText);
                    }
                    
                    replyText += "\n\n📋 Type *menu* for more options.";
                }
                else {
                    const senderName = msg.pushName || "User";
                    replyText = `Hello ${senderName}! I'm an AI assistant created by Shaikh Juned (shaikhjuned.co.in). I can help you with text messages, analyze images, extract text from PDFs, and transcribe audio messages.\n\n📋 Type *menu* to see all available options.\n\nHow can I assist you today?`;
                }

                // Send text response
                if (replyText) {
                    await sock.sendMessage(remoteJid, { text: replyText });
                }

                // Send audio response if available
                if (audioResponse) {
                    console.log("🔊 Sending voice response...");
                    await sock.sendMessage(remoteJid, {
                        audio: audioResponse,
                        mimetype: 'audio/mp3',
                        ptt: true
                    });
                }
                
                await sock.sendPresenceUpdate("paused", remoteJid);

            } catch (err) {
                console.error("❌ Message handler error:", err);
                await sock.sendMessage(remoteJid, { 
                    text: "❌ Sorry, an unexpected error occurred. Please try again later.\n\n📋 Type *menu* for more options." 
                });
                await sock.sendPresenceUpdate("paused", remoteJid);
            }
        });
    } catch (error) {
        console.error("❌ WhatsApp initialization error:", error);
        console.log("🔄 Retrying in 5 seconds...");
        setTimeout(() => startWhatsApp(), 5000);
    }
}

// --- Express Server Setup ---
console.log("🚀 Starting WhatsApp AI Bot Server...");

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Main route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Download page route
app.get("/download", (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

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
                <a href="/" style="color: #4CAF50; text-decoration: none;">← Back to Dashboard</a>
            </div>
        `);
    } else if (qrCodeImage) {
        res.send(`
            <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                <h2>📱 Scan this QR Code to Connect WhatsApp</h2>
                <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 400px; height: 400px; border: 2px solid #4CAF50;"/>
                <p style="margin-top: 20px;">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <p style="color: #4CAF50;">Created by Shaikh Juned - shaikhjuned.co.in</p>
                <a href="/" style="color: #4CAF50; text-decoration: none;">← Back to Dashboard</a>
            </div>
        `);
    } else {
        res.send(`
            <div style="background-color: #1a1a1a; color: white; font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h3>🔄 Generating QR code...</h3>
                <p>Please wait and refresh the page.</p>
                <script>setTimeout(() => location.reload(), 3000);</script>
                <a href="/" style="color: #4CAF50; text-decoration: none;">← Back to Dashboard</a>
            </div>
        `);
    }
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
                uptime: Math.floor(process.uptime()),
                memory: process.memoryUsage(),
                version: "2.0.0",
                port: PORT
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

// File download endpoints
app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename;
    const allowedFiles = [
        'index.js',
        'gemini-config.js', 
        'weather.js',
        'audio-transcription.js',
        'media-processor.js',
        'package.json',
        'render.yaml',
        'public/index.html'
    ];
    
    if (!allowedFiles.includes(filename)) {
        return res.status(404).json({ error: "File not found" });
    }
    
    const filePath = path.join(__dirname, filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, filename);
    } else {
        res.status(404).json({ error: "File not found" });
    }
});

// Download all files as ZIP
app.get("/download-all", (req, res) => {
    try {
        const archiver = require('archiver');
        const archive = archiver('zip');
        
        res.attachment('whatsapp-ai-bot-complete.zip');
        archive.pipe(res);
        
        // Add all project files
        const files = [
            'index.js',
            'gemini-config.js',
            'weather.js', 
            'audio-transcription.js',
            'media-processor.js',
            'package.json',
            'render.yaml'
        ];
        
        files.forEach(file => {
            if (fs.existsSync(path.join(__dirname, file))) {
                archive.file(path.join(__dirname, file), { name: file });
            }
        });
        
        // Add public folder
        if (fs.existsSync(path.join(__dirname, 'public'))) {
            archive.directory(path.join(__dirname, 'public'), 'public');
        }
        
        archive.finalize();
    } catch (error) {
        console.error("Download error:", error);
        res.status(500).json({ error: "Download failed" });
    }
});

// Find available port
const PORT = process.env.PORT || 3000;

// Start server with error handling
const server = app.listen(PORT, (err) => {
    if (err) {
        console.error("❌ Server failed to start:", err);
        process.exit(1);
    }
    
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📱 WhatsApp QR Code: http://localhost:${PORT}/qr`);
    console.log(`🌐 Server Status: http://localhost:${PORT}/`);
    console.log(`📦 Download Files: http://localhost:${PORT}/download`);
    console.log(`💡 Created by Shaikh Juned - shaikhjuned.co.in`);
    
    // Initialize WhatsApp after server starts
    startWhatsApp();
});

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
        server.listen(PORT + 1);
    } else {
        console.error('❌ Server error:', err);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});