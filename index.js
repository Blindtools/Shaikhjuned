require('dotenv').config();
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

// Environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCs__PtmrzJHJMa1VjktCpa76BKzNZ9nLw";
const FIREBASE_CONFIG = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCe-tHLxNX0g3cRDIJM2f2dfGfhvd1BQcc",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "interesting-tech-for-v-i.firebaseapp.com",
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://interesting-tech-for-v-i-default-rtdb.firebaseio.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "interesting-tech-for-v-i",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "interesting-tech-for-v-i.appspot.com",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "984478442998",
    appId: process.env.FIREBASE_APP_ID || "1:984478442998:web:e8a7e99503df1f143b13d7",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-LNBCVYCSDL"
};

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Initialize Firebase
let db;
try {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: FIREBASE_CONFIG.projectId,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        }),
        databaseURL: FIREBASE_CONFIG.databaseURL
    });
    db = admin.firestore();
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
 * Convert text to speech using Google Cloud TTS
 */
async function textToSpeech(text, userId) {
    try {
        const userPrefs = await getUserPreferences(userId);
        const voiceModel = VOICE_MODELS[userPrefs.voice] || VOICE_MODELS.neutral;
        
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
                ptt: true
            });
            return null;
        } else {
            return "Sorry, I couldn't generate the voice message. Please try again.";
        }
    } else if (cmd === '/clear' || cmd === '/reset') {
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
    
    return null;
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
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
            qrCodeImage = await qrcode.toDataURL(qr);
            console.log("🔗 New QR Code generated");
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

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
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

                if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
                    const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
                    
                    if (incomingText.startsWith('/')) {
                        const commandResponse = await handleCommand(incomingText, userId, sock, remoteJid);
                        if (commandResponse) {
                            responseText = commandResponse;
                        } else {
                            continue;
                        }
                    } else {
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

                if (mediaProcessed) {
                    await saveUserData(userId, {
                        userMessage: '[Media Message]',
                        botResponse: responseText,
                        type: 'media'
                    });
                }

                if (responseText) {
                    await sock.sendMessage(remoteJid, { text: responseText });
                }

                await sock.sendPresenceUpdate('paused', remoteJid);
            } catch (err) {
                console.error("❌ Message handling error:", err);
                await sock.sendMessage(remoteJid, {
                    text: "❌ Sorry, I encountered an error. Please try again."
                });
                await sock.sendPresenceUpdate('paused', remoteJid);
            }
        }
    });
}

// --- Express Server Routes ---
app.use(express.json());

app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>✅ WhatsApp Bot Connected</h1>
                <p>Your bot is ready to receive messages!</p>
                <div style="margin-top: 30px;">
                    <h3>Available Commands:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li>/voices - Show available voice options</li>
                        <li>/voice [voice_name] - Change TTS voice</li>
                        <li>/tts [text] - Convert text to speech</li>
                        <li>/speak [text] - Same as /tts</li>
                        <li>/clear - Clear chat history</li>
                    </ul>
                </div>
            </div>
        `);
    } else if (qrCodeImage) {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>📱 Scan QR Code</h1>
                <div style="background: white; padding: 20px; border-radius: 15px; display: inline-block; margin: 20px;">
                    <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 300px; height: 300px;"/>
                </div>
                <p>Scan this QR code with WhatsApp to connect your bot</p>
                <p><small>This page will refresh automatically when connected</small></p>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>⏳ Generating QR Code...</h1>
                <p>Please wait while we generate your QR code...</p>
                <script>
                    setTimeout(() => window.location.reload(), 3000);
                </script>
            </div>
        `);
    }
});

app.get("/", (req, res) => {
    const status = isConnected ? '✅ Connected' : '❌ Disconnected';
    res.send(`
        <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
            <h1>🤖 WhatsApp AI Bot</h1>
            <h2>Status: ${status}</h2>
            <p>Powered by Gemini AI</p>
            <div style="margin: 30px 0;">
                <a href="/qr" style="background: #00d4aa; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                    Get QR Code
                </a>
            </div>
            <div style="margin-top: 40px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                <h3>🌟 Features:</h3>
                <ul>
                    <li>💬 Smart AI chat with context memory</li>
                    <li>🎤 Voice message transcription</li>
                    <li>🔊 Text-to-speech with multiple voices</li>
                    <li>📷 Image analysis and OCR</li>
                    <li>📄 Document processing</li>
                    <li>🎥 Video analysis</li>
                    <li>💾 Chat history storage</li>
                    <li>🔄 Session restoration</li>
                </ul>
            </div>
        </div>
    `);
});

app.get("/health", (req, res) => {
    res.json({ status: "healthy", connected: isConnected });
});

// Start the application
startWhatsApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 QR Code: http://localhost:${PORT}/qr`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/`);
});