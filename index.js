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

// Import new enhanced modules
const configManager = require("./config-manager.js");
const apiManager = require("./api-manager.js");
const responseHandler = require("./response-handler.js");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

/**
 * Enhanced chat response function using the new response handler
 */
async function getChatResponse(userId, text, imageParts = null) {
    try {
        const result = await responseHandler.handleMessage(userId, text, imageParts);
        return result;
    } catch (error) {
        console.error("Chat response error:", error);
        return {
            textResponse: "❌ Sorry, I'm experiencing technical difficulties. Please try again later.",
            audioResponse: null
        };
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

    // --- Enhanced Message Handling Logic ---
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        // Do not reply to own messages or messages in groups
        if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
            return;
        }

        const remoteJid = msg.key.remoteJid;
        const userId = remoteJid.replace('@s.whatsapp.net', '');
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            let responseData = { textResponse: "", audioResponse: null };

            // Handle PDF attachments
            if (msg.message.documentMessage && msg.message.documentMessage.mimetype === "application/pdf") {
                console.log("Processing PDF document...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const pdfResult = await extractPdfText(buffer);
                
                if (pdfResult.success && pdfResult.text.length > 0) {
                    const analysis = analyzePdfContent(pdfResult.text, pdfResult.metadata);
                    const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                    responseData = await getChatResponse(userId, prompt);
                } else {
                    responseData.textResponse = pdfResult.summary || "❌ I couldn't extract text from this PDF. Please make sure it contains readable text.";
                }
            }
            // Handle image attachments
            else if (msg.message.imageMessage) {
                console.log("Processing image...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const imageResult = await processImage(buffer, msg.message.imageMessage.mimetype);
                
                if (imageResult.success) {
                    const prompt = incomingText || "Please analyze this image in detail and provide insights about what you see.";
                    responseData = await getChatResponse(userId, prompt, [imageResult.imagePart]);
                } else {
                    responseData.textResponse = imageResult.summary || "❌ I couldn't process this image. Please try with a different image format.";
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
                    responseData = await getChatResponse(userId, audioResult.transcription);
                    if (!responseData.audioResponse && audioResult.audioResponse) {
                        responseData.audioResponse = audioResult.audioResponse;
                    }
                } else {
                    responseData.textResponse = audioResult.textResponse;
                }
            }
            // Handle text messages with enhanced routing
            else if (incomingText) {
                console.log("Processing text message with enhanced routing...");
                
                // Check for model selection commands
                if (incomingText.toLowerCase().startsWith('/model ')) {
                    const modelName = incomingText.substring(7).trim();
                    const success = configManager.setUserAIModel(userId, modelName);
                    if (success) {
                        responseData.textResponse = `✅ AI model changed to ${modelName}. Your future messages will use this model.`;
                    } else {
                        const availableModels = Object.keys(configManager.getAIModels());
                        responseData.textResponse = `❌ Model "${modelName}" not found. Available models: ${availableModels.join(', ')}`;
                    }
                } else if (incomingText.toLowerCase() === '/models') {
                    const models = configManager.getAIModels();
                    const currentModel = configManager.getUserAIModel(userId);
                    let response = "🤖 **Available AI Models:**\n\n";
                    
                    for (const [key, model] of Object.entries(models)) {
                        const current = key === currentModel ? " ✅ (current)" : "";
                        response += `• **${model.name}**${current}\n`;
                        response += `  ${model.description}\n`;
                        response += `  Features: ${model.features?.join(', ') || 'text'}\n\n`;
                    }
                    
                    response += `To change model, send: /model <model_name>\nExample: /model chatgpt4`;
                    responseData.textResponse = response;
                } else if (incomingText.toLowerCase() === '/help') {
                    responseData.textResponse = getHelpMessage();
                } else {
                    // Use enhanced response handler
                    responseData = await getChatResponse(userId, incomingText);
                }
            }
            else {
                responseData.textResponse = getWelcomeMessage();
            }

            // Send text response
            if (responseData.textResponse) {
                await sock.sendMessage(remoteJid, { text: responseData.textResponse });
            }

            // Send audio response if available
            if (responseData.audioResponse) {
                console.log("Sending voice response...");
                await sock.sendMessage(remoteJid, {
                    audio: responseData.audioResponse,
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

// --- Helper Functions ---
function getWelcomeMessage() {
    return `🤖 **Welcome to Enhanced AI Assistant!**

I'm an advanced AI assistant created by Shaikh Juned (shaikhjuned.co.in) with powerful new capabilities:

🎯 **Core Features:**
• 💬 Multi-AI model chat (Gemini, ChatGPT-4, Claude, etc.)
• 🖼️ Image analysis and description
• 📄 PDF text extraction and analysis
• 🎵 Voice message transcription & responses
• 🔍 Web search with Google
• 🌤️ Weather information
• 🌐 Text translation
• 📹 YouTube video transcription & summarization
• 📞 Phone number lookup
• 📱 Phone specifications lookup

📋 **Quick Commands:**
• \`/models\` - View available AI models
• \`/model <name>\` - Change AI model
• \`/help\` - Show detailed help

Just send me a message and I'll intelligently route it to the best service! 🚀`;
}

function getHelpMessage() {
    return `🆘 **Enhanced AI Assistant Help**

🤖 **AI Models:**
• Send \`/models\` to see all available AI models
• Send \`/model gemini\` to switch to Google Gemini
• Send \`/model chatgpt4\` to switch to ChatGPT-4

🔍 **Search:**
• "Search for latest AI news"
• "Google quantum computing"
• "Find information about climate change"

🌤️ **Weather:**
• "Weather in New York"
• "Temperature in London"
• "Forecast for Tokyo"

🌐 **Translation:**
• "Translate hello to Spanish"
• "Translate 'How are you?' to French"

📹 **YouTube:**
• Send any YouTube URL to transcribe
• "Summarize [YouTube URL]" for summary

📞 **Phone Lookup:**
• "Phone number +1234567890" (Truecaller)
• "iPhone 15 specs" (Phone specifications)

💡 **Tips:**
• I automatically detect what you want to do
• Send images for AI analysis
• Send PDFs for text extraction
• Send voice messages for transcription
• All responses can include voice replies

Created by **Shaikh Juned** - shaikhjuned.co.in 🌟`;
}

// --- Express Server Setup with Enhanced UI ---
startWhatsApp();

// Middleware for parsing JSON and serving static files
app.use(express.json());
app.use(express.static('public'));

// Enhanced route to display the QR code with profile selection
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(getConnectedHTML());
    } else if (qrCodeImage) {
        res.send(getQRCodeHTML());
    } else {
        res.send(getLoadingHTML());
    }
});

// Enhanced main route with dashboard
app.get("/", (req, res) => {    
    res.send(getDashboardHTML());
});

// New route for configuration management
app.get("/config", (req, res) => {
    res.send(getConfigHTML());
});

// API endpoint for updating user preferences
app.post("/api/user/profile", async (req, res) => {
    try {
        const { userId, preferences } = req.body;
        if (!userId || !preferences) {
            return res.status(400).json({ error: "userId and preferences are required" });
        }
        
        const updatedProfile = configManager.updateUserProfile(userId, preferences);
        res.json({ success: true, profile: updatedProfile });
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// API endpoint for getting user profile
app.get("/api/user/profile/:userId", (req, res) => {
    try {
        const { userId } = req.params;
        const profile = configManager.getUserProfile(userId);
        res.json({ success: true, profile });
    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

// Enhanced API endpoint for testing with model selection
app.post("/api/chat", async (req, res) => {
    try {
        const { message, userId = 'web_user', model } = req.body;
        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }
        
        // Temporarily set model if specified
        if (model) {
            configManager.setUserAIModel(userId, model);
        }
        
        const response = await getChatResponse(userId, message);
        res.json({ 
            success: true, 
            response: response.textResponse,
            hasAudio: !!response.audioResponse,
            model: configManager.getUserAIModel(userId)
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Enhanced API endpoint for service status
app.get("/api/status", async (req, res) => {
    try {
        const apiStatus = await apiManager.getAPIStatus();
        const configSummary = configManager.getConfigSummary();
        
        const status = {
            server: {
                status: "✅ Running",
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: "3.0.0 Enhanced"
            },
            whatsapp: {
                connected: isConnected ? "✅ Connected" : "❌ Disconnected",
                qrAvailable: qrCodeImage ? "✅ Available" : "❌ Not Available"
            },
            ai: getModelInfo(),
            transcription: getTranscriptionStatus(),
            mediaProcessing: getMediaProcessingStatus(),
            apis: apiStatus,
            configuration: configSummary,
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

// --- HTML Templates ---
function getDashboardHTML() {
    const configSummary = configManager.getConfigSummary();
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Enhanced WhatsApp AI Bot Dashboard</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; }
            .header h1 { font-size: 2.5em; margin-bottom: 10px; color: #4CAF50; }
            .status-badge { 
                display: inline-block; 
                padding: 8px 16px; 
                border-radius: 20px; 
                font-weight: bold;
                margin: 5px;
            }
            .status-connected { background: #4CAF50; }
            .status-disconnected { background: #f44336; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .card { 
                background: rgba(255,255,255,0.1); 
                border-radius: 15px; 
                padding: 25px; 
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
                transition: transform 0.3s ease;
            }
            .card:hover { transform: translateY(-5px); }
            .card h3 { color: #4CAF50; margin-bottom: 15px; font-size: 1.3em; }
            .feature-list { list-style: none; }
            .feature-list li { 
                padding: 8px 0; 
                border-bottom: 1px solid rgba(255,255,255,0.1);
                display: flex;
                align-items: center;
            }
            .feature-list li:last-child { border-bottom: none; }
            .feature-icon { margin-right: 10px; font-size: 1.2em; }
            .btn { 
                display: inline-block; 
                padding: 12px 24px; 
                background: #4CAF50; 
                color: white; 
                text-decoration: none; 
                border-radius: 8px; 
                margin: 10px 5px;
                transition: background 0.3s ease;
                border: none;
                cursor: pointer;
                font-size: 16px;
            }
            .btn:hover { background: #45a049; }
            .btn-secondary { background: #2196F3; }
            .btn-secondary:hover { background: #1976D2; }
            .stats { display: flex; justify-content: space-around; text-align: center; margin: 20px 0; }
            .stat { padding: 15px; }
            .stat-number { font-size: 2em; font-weight: bold; color: #4CAF50; }
            .stat-label { font-size: 0.9em; opacity: 0.8; }
            .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2); }
            @media (max-width: 768px) {
                .header h1 { font-size: 2em; }
                .grid { grid-template-columns: 1fr; }
                .stats { flex-direction: column; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 Enhanced WhatsApp AI Bot</h1>
                <div class="status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}">
                    ${isConnected ? '✅ Connected' : '❌ Disconnected'}
                </div>
                <div class="stats">
                    <div class="stat">
                        <div class="stat-number">${configSummary.ai_models}</div>
                        <div class="stat-label">AI Models</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${configSummary.enabled_apis}</div>
                        <div class="stat-label">Active APIs</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${configSummary.total_users}</div>
                        <div class="stat-label">Users</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${configSummary.features_enabled}</div>
                        <div class="stat-label">Features</div>
                    </div>
                </div>
            </div>

            <div class="grid">
                <div class="card">
                    <h3>🚀 Core Features</h3>
                    <ul class="feature-list">
                        <li><span class="feature-icon">🤖</span> Multi-AI Model Support</li>
                        <li><span class="feature-icon">🖼️</span> Image Analysis</li>
                        <li><span class="feature-icon">📄</span> PDF Processing</li>
                        <li><span class="feature-icon">🎵</span> Voice Transcription</li>
                        <li><span class="feature-icon">🔊</span> Voice Responses</li>
                    </ul>
                </div>

                <div class="card">
                    <h3>🌐 API Integrations</h3>
                    <ul class="feature-list">
                        <li><span class="feature-icon">🔍</span> Google Search</li>
                        <li><span class="feature-icon">🌤️</span> Weather Information</li>
                        <li><span class="feature-icon">🌐</span> Text Translation</li>
                        <li><span class="feature-icon">📹</span> YouTube Processing</li>
                        <li><span class="feature-icon">📞</span> Phone Lookup</li>
                    </ul>
                </div>

                <div class="card">
                    <h3>⚙️ Management</h3>
                    <ul class="feature-list">
                        <li><span class="feature-icon">👤</span> User Profiles</li>
                        <li><span class="feature-icon">🎯</span> Smart Routing</li>
                        <li><span class="feature-icon">🔧</span> Configuration</li>
                        <li><span class="feature-icon">📊</span> Analytics</li>
                        <li><span class="feature-icon">🛡️</span> Rate Limiting</li>
                    </ul>
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="/qr" class="btn">📱 WhatsApp QR Code</a>
                <a href="/config" class="btn btn-secondary">⚙️ Configuration</a>
                <button onclick="testAPI()" class="btn btn-secondary">🧪 Test API</button>
                <button onclick="checkStatus()" class="btn btn-secondary">📊 Check Status</button>
            </div>

            <div class="footer">
                <p style="color: #4CAF50; font-size: 1.2em;">Created by <strong>Shaikh Juned</strong></p>
                <p style="color: #888; margin-top: 5px;">
                    <a href="https://shaikhjuned.co.in" style="color: #4CAF50; text-decoration: none;">shaikhjuned.co.in</a> | 
                    IMO Professional Web Developer
                </p>
                <p style="color: #666; margin-top: 10px; font-size: 0.9em;">Enhanced Version 3.0.0</p>
            </div>
        </div>

        <script>
            async function testAPI() {
                const message = prompt("Enter a test message:");
                if (!message) return;
                
                try {
                    const response = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message, userId: 'web_test' })
                    });
                    const data = await response.json();
                    alert('Response: ' + data.response);
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }

            async function checkStatus() {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    console.log('Status:', data);
                    alert('Status check complete. Check console for details.');
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        </script>
    </body>
    </html>`;
}

function getQRCodeHTML() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp QR Code - Enhanced AI Bot</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container { 
                text-align: center; 
                background: rgba(255,255,255,0.1); 
                border-radius: 20px; 
                padding: 40px; 
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
                max-width: 500px;
                width: 100%;
            }
            h1 { color: #4CAF50; margin-bottom: 20px; font-size: 2em; }
            .qr-container { 
                background: white; 
                padding: 20px; 
                border-radius: 15px; 
                margin: 20px 0;
                display: inline-block;
            }
            .qr-container img { 
                width: 300px; 
                height: 300px; 
                border-radius: 10px;
            }
            .instructions { 
                background: rgba(76, 175, 80, 0.1); 
                border: 1px solid #4CAF50; 
                border-radius: 10px; 
                padding: 20px; 
                margin: 20px 0;
            }
            .btn { 
                display: inline-block; 
                padding: 12px 24px; 
                background: #4CAF50; 
                color: white; 
                text-decoration: none; 
                border-radius: 8px; 
                margin: 10px 5px;
                transition: background 0.3s ease;
            }
            .btn:hover { background: #45a049; }
            @media (max-width: 480px) {
                .qr-container img { width: 250px; height: 250px; }
                h1 { font-size: 1.5em; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📱 Scan QR Code to Connect</h1>
            <div class="qr-container">
                <img src="${qrCodeImage}" alt="WhatsApp QR Code" />
            </div>
            <div class="instructions">
                <h3>📋 How to Connect:</h3>
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Go to Settings → Linked Devices</p>
                <p>3. Tap "Link a Device"</p>
                <p>4. Scan this QR code</p>
            </div>
            <a href="/" class="btn">🏠 Back to Dashboard</a>
            <button onclick="location.reload()" class="btn">🔄 Refresh QR</button>
            <p style="color: #4CAF50; margin-top: 20px;">Created by <strong>Shaikh Juned</strong> - shaikhjuned.co.in</p>
        </div>
    </body>
    </html>`;
}

function getConnectedHTML() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Connected - Enhanced AI Bot</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container { 
                text-align: center; 
                background: rgba(255,255,255,0.1); 
                border-radius: 20px; 
                padding: 40px; 
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
                max-width: 600px;
                width: 100%;
            }
            h1 { color: #4CAF50; margin-bottom: 20px; font-size: 2.5em; }
            .success-icon { font-size: 4em; margin-bottom: 20px; }
            .features { 
                background: rgba(76, 175, 80, 0.1); 
                border: 1px solid #4CAF50; 
                border-radius: 15px; 
                padding: 25px; 
                margin: 25px 0;
                text-align: left;
            }
            .features h3 { color: #4CAF50; margin-bottom: 15px; text-align: center; }
            .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
            .feature { padding: 10px; }
            .btn { 
                display: inline-block; 
                padding: 12px 24px; 
                background: #4CAF50; 
                color: white; 
                text-decoration: none; 
                border-radius: 8px; 
                margin: 10px 5px;
                transition: background 0.3s ease;
            }
            .btn:hover { background: #45a049; }
            .btn-secondary { background: #2196F3; }
            .btn-secondary:hover { background: #1976D2; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✅</div>
            <h1>WhatsApp Connected!</h1>
            <p style="font-size: 1.2em; margin-bottom: 20px;">Your Enhanced AI bot is ready to receive messages.</p>
            
            <div class="features">
                <h3>🎯 Active Features</h3>
                <div class="feature-grid">
                    <div class="feature">✅ Multi-AI Chat</div>
                    <div class="feature">✅ Image Analysis</div>
                    <div class="feature">✅ PDF Processing</div>
                    <div class="feature">✅ Voice Transcription</div>
                    <div class="feature">✅ Voice Responses</div>
                    <div class="feature">✅ Web Search</div>
                    <div class="feature">✅ Weather Info</div>
                    <div class="feature">✅ Translation</div>
                    <div class="feature">✅ YouTube Processing</div>
                    <div class="feature">✅ Phone Lookup</div>
                </div>
            </div>

            <div style="margin: 25px 0; padding: 20px; background: rgba(33, 150, 243, 0.1); border-radius: 10px;">
                <h4>💡 Quick Start Commands:</h4>
                <p>• Send <code>/models</code> to see available AI models</p>
                <p>• Send <code>/help</code> for detailed instructions</p>
                <p>• Just start chatting - I'll understand what you need!</p>
            </div>

            <a href="/" class="btn">🏠 Dashboard</a>
            <a href="/config" class="btn btn-secondary">⚙️ Configuration</a>
            
            <p style="color: #4CAF50; margin-top: 30px; font-size: 1.1em;">
                Created by <strong>Shaikh Juned</strong> - shaikhjuned.co.in
            </p>
        </div>
    </body>
    </html>`;
}

function getLoadingHTML() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Loading QR Code - Enhanced AI Bot</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container { 
                text-align: center; 
                background: rgba(255,255,255,0.1); 
                border-radius: 20px; 
                padding: 40px; 
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
            }
            .spinner { 
                border: 4px solid rgba(255,255,255,0.3);
                border-radius: 50%;
                border-top: 4px solid #4CAF50;
                width: 60px;
                height: 60px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🔄 Generating QR Code...</h2>
            <div class="spinner"></div>
            <p>Please wait and refresh the page.</p>
            <script>setTimeout(() => location.reload(), 3000);</script>
        </div>
    </body>
    </html>`;
}

function getConfigHTML() {
    const models = configManager.getAIModels();
    const apis = configManager.getEnabledAPIs();
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Configuration - Enhanced AI Bot</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: white; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1000px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { color: #4CAF50; font-size: 2.5em; margin-bottom: 10px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
            .card { 
                background: rgba(255,255,255,0.1); 
                border-radius: 15px; 
                padding: 25px; 
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
            }
            .card h3 { color: #4CAF50; margin-bottom: 15px; }
            .model-item, .api-item { 
                background: rgba(255,255,255,0.05); 
                border-radius: 8px; 
                padding: 15px; 
                margin: 10px 0;
                border-left: 4px solid #4CAF50;
            }
            .model-name, .api-name { font-weight: bold; color: #4CAF50; }
            .model-desc, .api-desc { font-size: 0.9em; opacity: 0.8; margin-top: 5px; }
            .btn { 
                display: inline-block; 
                padding: 12px 24px; 
                background: #4CAF50; 
                color: white; 
                text-decoration: none; 
                border-radius: 8px; 
                margin: 10px 5px;
                transition: background 0.3s ease;
            }
            .btn:hover { background: #45a049; }
            .status-online { color: #4CAF50; }
            .status-offline { color: #f44336; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚙️ Configuration Dashboard</h1>
                <p>Manage AI models and API integrations</p>
            </div>

            <div class="grid">
                <div class="card">
                    <h3>🤖 Available AI Models</h3>
                    ${Object.entries(models).map(([key, model]) => `
                        <div class="model-item">
                            <div class="model-name">${model.name}</div>
                            <div class="model-desc">${model.description}</div>
                            <div style="margin-top: 8px; font-size: 0.8em;">
                                Features: ${model.features?.join(', ') || 'text'}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="card">
                    <h3>🌐 Active API Integrations</h3>
                    ${Object.entries(apis).map(([key, api]) => `
                        <div class="api-item">
                            <div class="api-name">${key.replace(/_/g, ' ').toUpperCase()}</div>
                            <div class="api-desc">${api.description}</div>
                            <div style="margin-top: 8px; font-size: 0.8em; color: #4CAF50;">
                                ✅ Enabled
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="/" class="btn">🏠 Back to Dashboard</a>
                <a href="/qr" class="btn">📱 WhatsApp QR</a>
            </div>

            <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2);">
                <p style="color: #4CAF50;">Created by <strong>Shaikh Juned</strong> - shaikhjuned.co.in</p>
            </div>
        </div>
    </body>
    </html>`;
}

const serverConfig = configManager.getServerConfig();
const PORT = process.env.PORT || serverConfig.port;
app.listen(PORT, serverConfig.host, () => {
    console.log(`🚀 Enhanced Server is running on port ${PORT}`);
    console.log(`📱 WhatsApp QR Code: http://localhost:${PORT}/qr`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/`);
    console.log(`⚙️ Configuration: http://localhost:${PORT}/config`);
    console.log(`💡 Created by Shaikh Juned - shaikhjuned.co.in`);
    console.log(`🎯 Enhanced Version 3.0.0 with ${configManager.getConfigSummary().ai_models} AI models and ${configManager.getConfigSummary().enabled_apis} APIs`);
});

