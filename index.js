const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const pino = require("pino");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const mimeTypes = require("mime-types");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
    downloadMediaMessage,
    getContentType,
} = require("@whiskeysockets/baileys");

// --- Configuration ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

// Environment variables (set these in your environment or Render dashboard)
const GEMINI_API_KEY = "AIzaSyC06sdH7LasR3HS_yDntQWsWr2oHu0DJjA";
const FIREBASE_CONFIG = process.env.FIREBASE_CONFIG; // JSON string of Firebase config
const FIREBASE_DATABASE_URL = "https://blind-tools-b6aa1-default-rtdb.firebaseio.com/";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Initialize Firebase
let db;
try {
    if (FIREBASE_CONFIG) {
        const firebaseConfig = JSON.parse(FIREBASE_CONFIG);
        admin.initializeApp(firebaseConfig);
        db = admin.firestore();
    }
} catch (error) {
    console.error("Firebase initialization error:", error);
}

// Voice settings for different voices
const VOICE_MODELS = {
    'male1': 'en-US-Journey-D',
    'female1': 'en-US-Journey-F', 
    'male2': 'en-US-Studio-M',
    'female2': 'en-US-Studio-O',
    'neutral': 'en-US-Neural2-C'
};

/**
 * Save user data and chat history to Firebase
 */
async function saveUserData(userId, messageData) {
    if (!db) return;
    
    try {
        const userRef = db.collection('users').doc(userId);
        const chatRef = userRef.collection('chats').doc();
        
        await chatRef.set({
            ...messageData,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update user's last activity
        await userRef.set({
            lastActive: admin.firestore.FieldValue.serverTimestamp(),
            totalMessages: admin.firestore.FieldValue.increment(1)
        }, { merge: true });

    } catch (error) {
        console.error("Error saving user data:", error);
    }
}

/**
 * Get user's chat history from Firebase
 */
async function getUserHistory(userId, limit = 10) {
    if (!db) return [];
    
    try {
        const chatRef = db.collection('users').doc(userId).collection('chats');
        const snapshot = await chatRef.orderBy('timestamp', 'desc').limit(limit).get();
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })).reverse();
        
    } catch (error) {
        console.error("Error getting user history:", error);
        return [];
    }
}

/**
 * Get user preferences (like voice setting)
 */
async function getUserPreferences(userId) {
    if (!db) return { voice: 'neutral' };
    
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        return {
            voice: userData?.preferences?.voice || 'neutral',
            ...userData?.preferences
        };
    } catch (error) {
        console.error("Error getting user preferences:", error);
        return { voice: 'neutral' };
    }
}

/**
 * Update user preferences
 */
async function updateUserPreferences(userId, preferences) {
    if (!db) return;
    
    try {
        await db.collection('users').doc(userId).set({
            preferences: preferences,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Error updating user preferences:", error);
    }
}

/**
 * Generate response using Gemini AI with context
 */
async function getChatResponse(text, userId, context = []) {
    try {
        // Get user history for context
        const history = await getUserHistory(userId, 5);
        
        let contextPrompt = "You are a helpful AI assistant. ";
        
        if (history.length > 0) {
            contextPrompt += "Previous conversation context:\n";
            history.forEach(item => {
                if (item.userMessage) contextPrompt += `User: ${item.userMessage}\n`;
                if (item.botResponse) contextPrompt += `Assistant: ${item.botResponse}\n`;
            });
            contextPrompt += "\nNow respond to the current message:\n";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(contextPrompt + text);
        const response = result.response;
        const responseText = response.text();

        // Save conversation to Firebase
        await saveUserData(userId, {
            userMessage: text,
            botResponse: responseText,
            type: 'text'
        });

        return responseText;
    } catch (error) {
        console.error("Error with Gemini API:", error);
        return "I apologize, but I'm experiencing some technical difficulties. Please try again later.";
    }
}

/**
 * Transcribe audio using Gemini AI
 */
async function transcribeAudio(audioBuffer, mimeType) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const audioPart = {
            inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([
            "Please transcribe the following audio accurately:", 
            audioPart
        ]);
        
        return result.response.text();
    } catch (error) {
        console.error("Error transcribing audio:", error);
        return "Sorry, I couldn't transcribe the audio. Please try again.";
    }
}

/**
 * Analyze image/document using Gemini Vision
 */
async function analyzeMedia(mediaBuffer, mimeType, prompt = "Describe what you see in this image/document") {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const mediaPart = {
            inlineData: {
                data: mediaBuffer.toString('base64'),
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, mediaPart]);
        return result.response.text();
    } catch (error) {
        console.error("Error analyzing media:", error);
        return "Sorry, I couldn't analyze the media. Please try again.";
    }
}

/**
 * Convert text to speech using Google Cloud Text-to-Speech API
 */
async function textToSpeech(text, userId) {
    try {
        const userPrefs = await getUserPreferences(userId);
        const voiceModel = VOICE_MODELS[userPrefs.voice] || VOICE_MODELS.neutral;
        
        // Using Google Cloud Text-to-Speech API
        const response = await axios.post(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`,
            {
                input: { text: text },
                voice: {
                    languageCode: 'en-US',
                    name: voiceModel
                },
                audioConfig: {
                    audioEncoding: 'MP3'
                }
            }
        );

        return Buffer.from(response.data.audioContent, 'base64');
    } catch (error) {
        console.error("Error with text-to-speech:", error);
        return null;
    }
}

/**
 * Process different types of media messages
 */
async function processMediaMessage(msg, mediaType) {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const mimeType = getContentType(msg.message);
        
        let response = "";
        
        if (mediaType === 'image') {
            response = await analyzeMedia(buffer, mimeType, "Analyze this image and describe what you see. If there's text, please transcribe it.");
        } else if (mediaType === 'document') {
            response = await analyzeMedia(buffer, mimeType, "Extract and summarize the content of this document.");
        } else if (mediaType === 'audio') {
            response = await transcribeAudio(buffer, mimeType);
        } else if (mediaType === 'video') {
            response = await analyzeMedia(buffer, mimeType, "Describe what happens in this video.");
        }

        return response;
    } catch (error) {
        console.error(`Error processing ${mediaType}:`, error);
        return `Sorry, I couldn't process the ${mediaType}. Please try again.`;
    }
}

/**
 * Handle special commands
 */
async function handleCommand(command, userId, sock, remoteJid) {
    const cmd = command.toLowerCase();
    
    if (cmd.startsWith('/voice ')) {
        const voiceType = cmd.split(' ')[1];
        if (VOICE_MODELS[voiceType]) {
            await updateUserPreferences(userId, { voice: voiceType });
            return `Voice changed to ${voiceType}. Your next text-to-speech will use this voice.`;
        } else {
            return `Available voices: ${Object.keys(VOICE_MODELS).join(', ')}`;
        }
    } else if (cmd === '/voices') {
        return `Available voices: ${Object.keys(VOICE_MODELS).join(', ')}\nUse /voice [voice_name] to change your voice.`;
    } else if (cmd === '/tts' || cmd === '/speak') {
        return "Please send me text after this command, like: /tts Hello, how are you?";
    } else if (cmd.startsWith('/tts ') || cmd.startsWith('/speak ')) {
        const textToSpeak = command.substring(cmd.startsWith('/tts') ? 5 : 7);
        const audioBuffer = await textToSpeech(textToSpeak, userId);
        
        if (audioBuffer) {
            await sock.sendMessage(remoteJid, {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                ptt: true // Send as voice message
            });
            return null; // No text response needed
        } else {
            return "Sorry, I couldn't generate the voice message. Please try again.";
        }
    } else if (cmd === '/clear' || cmd === '/reset') {
        // Clear user's chat history
        if (db) {
            try {
                const chatRef = db.collection('users').doc(userId).collection('chats');
                const snapshot = await chatRef.get();
                
                const batch = db.batch();
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                
                return "Your chat history has been cleared. Starting fresh!";
            } catch (error) {
                console.error("Error clearing history:", error);
                return "Sorry, I couldn't clear your history. Please try again.";
            }
        }
        return "Chat history cleared (local session only).";
    }
    
    return null; // Command not recognized
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            qrTimeout: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            generateHighQualityLinkPreview: true,
        });

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    qrCodeImage = await qrcode.toDataURL(qr);
                    console.log("🔗 New QR Code generated - Visit http://localhost:3000/qr to scan");
                } catch (error) {
                    console.error("Error generating QR code:", error);
                }
            }
            
            if (connection === "open") {
                isConnected = true;
                console.log("✅ WhatsApp Connected Successfully!");
            } else if (connection === "close") {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log("Connection status:", statusCode);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log("🔄 Reconnecting...");
                    setTimeout(startWhatsApp, 5000);
                } else {
                    console.log("⚠️ Logged out, scan QR again");
                    qrCodeImage = "";
                }
            }
        });

        sock.ev.on("creds.update", saveCreds);

        // --- Enhanced Message Handling ---
        sock.ev.on("messages.upsert", async ({ messages }) => {
            for (const msg of messages) {
                // Skip own messages, group messages, and empty messages
                if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
                    continue;
                }

                const remoteJid = msg.key.remoteJid;
                const userId = remoteJid.replace('@s.whatsapp.net', '');
                
                try {
                    await sock.readMessages([msg.key]);
                    await sock.sendPresenceUpdate('composing', remoteJid);

                    let responseText = "";
                    let mediaProcessed = false;

                    // Handle different message types
                    if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
                        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
                        
                        if (incomingText.startsWith('/')) {
                            // Handle commands
                            const commandResponse = await handleCommand(incomingText, userId, sock, remoteJid);
                            if (commandResponse) {
                                responseText = commandResponse;
                            } else {
                                continue; // Command handled without text response
                            }
                        } else {
                            // Regular chat
                            responseText = await getChatResponse(incomingText, userId);
                        }
                    } else if (msg.message.imageMessage) {
                        responseText = await processMediaMessage(msg, 'image');
                        mediaProcessed = true;
                    } else if (msg.message.documentMessage) {
                        responseText = await processMediaMessage(msg, 'document');
                        mediaProcessed = true;
                    } else if (msg.message.audioMessage) {
                        responseText = await processMediaMessage(msg, 'audio');
                        mediaProcessed = true;
                    } else if (msg.message.videoMessage) {
                        responseText = await processMediaMessage(msg, 'video');
                        mediaProcessed = true;
                    }

                    // Save media processing to Firebase
                    if (mediaProcessed) {
                        await saveUserData(userId, {
                            userMessage: '[Media Message]',
                            botResponse: responseText,
                            type: 'media'
                        });
                    }

                    // Send response
                    if (responseText) {
                        await sock.sendMessage(remoteJid, { text: responseText });
                    }

                    await sock.sendPresenceUpdate('paused', remoteJid);

                } catch (err) {
                    console.error("❌ Message handling error:", err);
                    try {
                        await sock.sendMessage(remoteJid, { 
                            text: "❌ Sorry, I encountered an error. Please try again." 
                        });
                        await sock.sendPresenceUpdate('paused', remoteJid);
                    } catch (sendError) {
                        console.error("Error sending error message:", sendError);
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error starting WhatsApp:", error);
        setTimeout(startWhatsApp, 10000); // Retry after 10 seconds
    }
}

// --- Express Server Routes ---
app.use(express.json());

app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; background: #0d1117; color: white;">
                <h1 style="color: #28a745;">✅ WhatsApp Bot Connected!</h1>
                <p>Your bot is now active and connected to WhatsApp.</p>
                <div style="margin-top: 30px; text-align: left;">
                    <h3>Available Commands:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li style="margin: 10px 0;">📢 /voices - Show available voice options</li>
                        <li style="margin: 10px 0;">🎤 /voice [voice_name] - Change bot's voice</li>
                        <li style="margin: 10px 0;">🔊 /tts [text] - Convert text to speech</li>
                        <li style="margin: 10px 0;">🗑️ /clear or /reset - Clear chat history</li>
                    </ul>
                </div>
                <p style="margin-top: 30px; color: #ccc;">You can close this page now.</p>
            </div>
        `);
    } else if (qrCodeImage) {
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; background: #0d1117; color: white;">
                <h1>📱 Scan QR Code to Connect</h1>
                <img src="${qrCodeImage}" alt="QR Code" style="max-width: 300px; margin: 20px auto; border: 5px solid #28a745; border-radius: 10px; background: white; padding: 10px;">
                <p style="font-size: 1.1em; text-align: center;">1. Open WhatsApp on your phone</p>
                <p style="font-size: 1.1em; text-align: center;">2. Go to Settings → Linked Devices</p>
                <p style="font-size: 1.1em; text-align: center;">3. Tap "Link a Device" and scan this QR code</p>
                <p style="font-size: 0.9em; color: #ccc; margin-top: 20px;">This QR code will refresh every 60 seconds if not scanned.</p>
                <script>
                    setTimeout(() => window.location.reload(), 30000);
                </script>
            </div>
        `);
    } else {
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; background: #0d1117; color: white;">
                <h1>⏳ Loading...</h1>
                <p>Please wait while the QR code is being generated.</p>
                <div style="margin-top: 20px;">
                    <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </div>
        `);
    }
});

app.get("/", (req, res) => {
    const status = isConnected ? '✅ Connected' : '❌ Disconnected';
    res.send(`
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; background: #0d1117; color: white;">
            <h1>🤖 WhatsApp AI Bot</h1>
            <h2>Status: ${status}</h2>
            <p>Powered by Gemini AI</p>
            <div style="margin-top: 30px;">
                <a href="/qr" style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 1.1em;">
                    ${isConnected ? 'View Bot Status' : 'Scan QR Code'}
                </a>
            </div>
            <div style="margin-top: 30px; text-align: center; max-width: 600px;">
                <h3>Features:</h3>
                <ul style="list-style: none; padding: 0; text-align: left;">
                    <li style="margin: 10px 0;">💬 AI-powered conversations with context memory</li>
                    <li style="margin: 10px 0;">🖼️ Image analysis and text extraction</li>
                    <li style="margin: 10px 0;">🎵 Audio transcription</li>
                    <li style="margin: 10px 0;">📄 Document processing</li>
                    <li style="margin: 10px 0;">🎤 Text-to-speech with multiple voices</li>
                    <li style="margin: 10px 0;">🎥 Video analysis</li>
                </ul>
            </div>
        </div>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📱 Visit http://localhost:${PORT}/qr to scan QR code`);
    console.log(`🌐 Visit http://localhost:${PORT} for bot status`);
    startWhatsApp();
});

