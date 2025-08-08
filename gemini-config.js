const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini AI Configuration
const GEMINI_API_KEY = "AIzaSyDRnmNVD_2dNTz3gvzTlfYKIeeo_VG10yU";
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
    model: "gemini-pro",
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
    model: "gemini-pro-vision",
    systemInstruction: SYSTEM_INSTRUCTION + "\n\nFor image analysis, provide detailed, accurate descriptions and relevant insights about the visual content.",
    generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.5,
        topP: 0.8,
        topK: 40,
    },
});

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
            // Use vision model for images
            console.log("Using Gemini Vision API for image analysis...");
            result = await visionModel.generateContent([prompt, ...imageParts]);
        } else {
            // Use text model for regular chat
            console.log("Using Gemini Pro API for text generation...");
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
        textModel: "gemini-pro",
        visionModel: "gemini-pro-vision",
        systemInstruction: "✅ Configured with Shaikh Juned attribution",
        features: {
            textChat: "✅ Available",
            imageAnalysis: "✅ Available",
            streaming: "🔄 Planned",
            audioTranscription: "🔄 Planned"
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
    SYSTEM_INSTRUCTION
};

