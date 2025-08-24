const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

// Gemini AI Configuration
const GEMINI_API_KEY = "AIzaSyCEC9a7xdopEXnHsT3yyIovl-luuIxIEIM";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

// System instruction for all models
const SYSTEM_INSTRUCTION = `You are an IMO professional web developer created by the Shaikh Juned website (domain: shaikhjuned.co.in). 

Key Information:
- You are developed by Shaikh Juned, an IMO (International Mathematical Olympiad) professional web developer
- Website: shaikhjuned.co.in
- You provide professional, helpful, and accurate responses
- You have expertise in web development, programming, and technical solutions
- Always maintain a professional and friendly tone
- When discussing technical topics, provide clear explanations suitable for the user's level

Capabilities:
- Text conversation and assistance
- Image analysis and description
- PDF document analysis
- Audio transcription and response
- Technical guidance and web development advice

Please provide helpful, accurate, and professional responses while representing the quality and expertise of Shaikh Juned's work.`;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Text model for regular conversations
const textModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
    },
});

// Vision model for image analysis
const visionModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION + "\n\nFor image analysis, provide detailed, accurate descriptions and relevant insights about the visual content.",
    generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.5,
        topP: 0.8,
        topK: 40,
    },
});

/**
 * Transcribe audio using Gemini API
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - Audio MIME type
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudioWithGemini(audioBuffer, mimeType) {
    try {
        const audioBase64 = audioBuffer.toString('base64');
        
        const audioPart = {
            inlineData: {
                data: audioBase64,
                mimeType: mimeType
            }
        };

        const prompt = "Please transcribe this audio message accurately and respond to what the user is saying.";
        
        const result = await textModel.generateContent([prompt, audioPart]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini audio transcription error:", error);
        throw error;
    }
}

/**
 * Generate speech from text using Google Cloud TTS
 * @param {string} text - Text to convert to speech
 * @param {string} voiceType - Voice type (male/female)
 * @returns {Promise<Buffer>} - Audio buffer
 */
async function generateSpeech(text, voiceType = 'female') {
    try {
        const voices = {
            male: {
                languageCode: 'en-US',
                name: 'en-US-Standard-D',
                ssmlGender: 'MALE'
            },
            female: {
                languageCode: 'en-US',
                name: 'en-US-Standard-C', 
                ssmlGender: 'FEMALE'
            }
        };

        const voice = voices[voiceType] || voices.female;
        
        const requestBody = {
            input: { text: text },
            voice: voice,
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: 1.0,
                pitch: 0.0
            }
        };

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        
        if (data.audioContent) {
            return Buffer.from(data.audioContent, 'base64');
        } else {
            throw new Error('No audio content received from TTS API');
        }
    } catch (error) {
        console.error("TTS Error:", error);
        throw error;
    }
}

/**
 * Generate text response using Gemini AI
 * @param {string} prompt - The user's message or prompt
 * @param {Array} imageParts - Optional image parts for vision API
 * @returns {Promise<string>} - The AI response
 */
async function generateResponse(prompt, imageParts = null) {
    try {
        let result;
        
        if (imageParts && imageParts.length > 0) {
            console.log("Using Gemini Vision API for image analysis...");
            result = await visionModel.generateContent([prompt, ...imageParts]);
        } else {
            console.log("Using Gemini Flash API for text generation...");
            result = await textModel.generateContent(prompt);
        }
        
        const response = await result.response;
        const text = response.text();
        
        // Add attribution footer for longer responses
        if (text.length > 200) {
            return text + "\n\n---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in";
        }
        
        return text;
    } catch (error) {
        console.error("Gemini AI Error:", error);
        
        // Handle specific error types
        if (error.message.includes("API key")) {
            return "❌ API configuration error. Please check the Gemini API key.";
        } else if (error.message.includes("quota")) {
            return "⚠️ API quota exceeded. Please try again later.";
        } else if (error.message.includes("safety")) {
            return "⚠️ Content filtered for safety. Please rephrase your message.";
        } else {
            return "❌ Sorry, I'm experiencing technical difficulties. Please try again later.\n\n🔧 If this persists, contact support at shaikhjuned.co.in";
        }
    }
}

/**
 * Process audio message (transcribe and respond)
 * @param {Buffer} audioBuffer - Audio buffer
 * @param {string} mimeType - Audio MIME type
 * @param {string} voiceType - Voice type for response
 * @returns {Promise<Object>} - Response object with text and audio
 */
async function processAudioMessage(audioBuffer, mimeType, voiceType = 'female') {
    try {
        console.log("Processing audio message with Gemini...");
        
        // Transcribe and get response from Gemini
        const textResponse = await transcribeAudioWithGemini(audioBuffer, mimeType);
        
        // Generate speech from response
        const audioResponse = await generateSpeech(textResponse, voiceType);
        
        return {
            success: true,
            textResponse: textResponse,
            audioResponse: audioResponse,
            voiceType: voiceType
        };
    } catch (error) {
        console.error("Audio processing error:", error);
        return {
            success: false,
            textResponse: "❌ Sorry, I couldn't process your audio message. Please try again or send a text message.",
            audioResponse: null,
            error: error.message
        };
    }
}

/**
 * Generate streaming response (for future implementation)
 * @param {string} prompt - The user's message or prompt
 * @returns {Promise<AsyncGenerator>} - Streaming response
 */
async function* generateStreamingResponse(prompt) {
    try {
        const result = await textModel.generateContentStream(prompt);
        
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            yield chunkText;
        }
    } catch (error) {
        console.error("Streaming Error:", error);
        yield "❌ Streaming error occurred.";
    }
}

/**
 * Validate and prepare image parts for Gemini Vision API
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} mimeType - Image MIME type
 * @returns {Object} - Formatted image part for Gemini API
 */
function prepareImagePart(imageBuffer, mimeType) {
    // Validate MIME type
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!supportedTypes.includes(mimeType)) {
        throw new Error(`Unsupported image type: ${mimeType}`);
    }
    
    return {
        inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: mimeType,
        },
    };
}

/**
 * Get model information and status
 * @returns {Object} - Model configuration and status
 */
function getModelInfo() {
    return {
        apiKey: GEMINI_API_KEY ? "✅ Configured" : "❌ Missing",
        baseUrl: GEMINI_BASE_URL,
        textModel: "gemini-1.5-flash",
        visionModel: "gemini-1.5-flash",
        systemInstruction: "✅ Configured with Shaikh Juned attribution",
        features: {
            textChat: "✅ Available",
            imageAnalysis: "✅ Available",
            audioTranscription: "✅ Available",
            textToSpeech: "✅ Available",
            streaming: "🔄 Planned"
        },
        voices: {
            male: "✅ Available",
            female: "✅ Available"
        }
    };
}

module.exports = {
    generateResponse,
    generateStreamingResponse,
    prepareImagePart,
    getModelInfo,
    textModel,
    visionModel,
    SYSTEM_INSTRUCTION,
    transcribeAudioWithGemini,
    generateSpeech,
    processAudioMessage
};

