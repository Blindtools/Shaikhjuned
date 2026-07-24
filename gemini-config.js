require("dotenv").config();
const fetch = require("node-fetch");
const apiManager = require("./api-manager.js");

// --- AI Provider: OpenRouter (free tier, no credit card required) ---
// Google's Gemini API now requires a billing/prepay setup for new AI Studio
// accounts (since Mar 2026) even to stay within the free quota, which is why
// this project moved off it. OpenRouter still has real free (:free) models,
// no card needed - https://openrouter.ai/keys to get a key.
//
// Models below are current as of when this was written - OpenRouter's free
// catalog changes often, so if one stops responding, check
// https://openrouter.ai/models?max_price=0 for a replacement and swap the
// name below (or run /status once it's wired in).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
// Backup free models tried in order if the primary one is rate-limited or
// briefly down - free models on OpenRouter get busy at peak times, so a
// fallback chain matters a lot more here than it would on a paid key.
const TEXT_MODEL_FALLBACKS = [
    TEXT_MODEL,
    "qwen/qwen-2.5-72b-instruct:free",
    "google/gemma-2-9b-it:free"
];
// Handles image + audio + text in one model - used whenever media is attached.
const MULTIMODAL_MODEL = process.env.OPENROUTER_VISION_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

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

if (!OPENROUTER_API_KEY) {
    console.error("❌ OPENROUTER_API_KEY is missing. Get a free key (no card) at https://openrouter.ai/keys and put it in .env");
}

/**
 * Convert this project's Gemini-shaped image part ({ inlineData: { data, mimeType } })
 * into OpenRouter/OpenAI-style content blocks.
 */
function imagePartToContentBlock(imagePart) {
    const { data, mimeType } = imagePart.inlineData;
    return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${data}` }
    };
}

/**
 * Low-level call to OpenRouter's chat completions endpoint.
 * @param {string} model
 * @param {Array} messages - full messages array (system + history + user turn)
 */
async function callOpenRouter(model, messages) {
    if (!OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY is not set");
    }

    const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://shaikhjuned.co.in",
            "X-Title": "Shaikh Juned WhatsApp Bot"
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: 1000,
            temperature: 0.7
        }),
        timeout: 30000
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
        throw new Error("OpenRouter returned no content (model may be rate-limited or down - try /status)");
    }
    return text;
}

/**
 * Try each free text model in order until one responds - free models get
 * rate-limited during busy periods, so this keeps the bot answering.
 */
async function callOpenRouterWithFallback(messages) {
    let lastError;
    for (const model of TEXT_MODEL_FALLBACKS) {
        try {
            return await callOpenRouter(model, messages);
        } catch (error) {
            console.error(`Model ${model} failed, trying next:`, error.message);
            lastError = error;
        }
    }
    throw lastError;
}

/**
 * Generate a text (or text+image) response.
 * @param {string} prompt
 * @param {Array} imageParts - optional array of { inlineData: { data, mimeType } }
 * @param {Array} history - optional prior turns [{role:'user'|'assistant', content:string}, ...]
 */
async function generateResponse(prompt, imageParts = null, history = []) {
    try {
        let text;

        if (imageParts && imageParts.length > 0) {
            console.log("Using OpenRouter multimodal model for image analysis...");
            const content = [
                { type: "text", text: prompt },
                ...imageParts.map(imagePartToContentBlock)
            ];
            // History is skipped for image turns - keeps multimodal payloads
            // simple and avoids mixing text-only history with image content.
            text = await callOpenRouter(MULTIMODAL_MODEL, [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content }
            ]);
        } else {
            console.log("Using OpenRouter text model (with fallback chain)...");
            const messages = [
                { role: "system", content: SYSTEM_INSTRUCTION },
                ...history,
                { role: "user", content: prompt }
            ];
            text = await callOpenRouterWithFallback(messages);
        }

        if (text.length > 200) {
            return text + "\n\n---\n💡 Powered by Shaikh Juned - shaikhjuned.co.in";
        }
        return text;
    } catch (error) {
        console.error("AI provider error:", error);

        if (error.message.includes("OPENROUTER_API_KEY")) {
            return "❌ API configuration error. Please set OPENROUTER_API_KEY in .env (free key, no card: https://openrouter.ai/keys).";
        } else if (error.message.includes("429") || error.message.toLowerCase().includes("rate")) {
            return "⚠️ Free-tier rate limit hit. Please try again in a bit.";
        } else {
            return "❌ Sorry, I'm experiencing technical difficulties. Please try again later.\n\n🔧 If this persists, contact support at shaikhjuned.co.in";
        }
    }
}

/**
 * Transcribe + respond to an audio message using the multimodal model.
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 */
async function transcribeAudioWithGemini(audioBuffer, mimeType) {
    // Function name kept for compatibility with audio-transcription.js.
    try {
        const audioBase64 = audioBuffer.toString("base64");
        const format = (mimeType.split("/")[1] || "ogg").split(";")[0];

        const content = [
            { type: "text", text: "Please transcribe this audio message accurately and respond to what the user is saying." },
            { type: "input_audio", input_audio: { data: audioBase64, format } }
        ];

        return await callOpenRouter(MULTIMODAL_MODEL, [
            { role: "system", content: SYSTEM_INSTRUCTION },
            { role: "user", content }
        ]);
    } catch (error) {
        console.error("Audio transcription error:", error);
        throw error;
    }
}

/**
 * Generate speech from text using the free TTS API already wired in
 * api-manager.js (StreamElements) - no Google Cloud billing needed.
 * @param {string} text
 * @param {string} voiceType - 'male' | 'female'
 * @returns {Promise<Buffer>}
 */
async function generateSpeech(text, voiceType = "female") {
    const voice = voiceType === "male" ? "Matthew" : "Salli";
    const result = await apiManager.textToSpeech(text, voice);
    if (!result.success) {
        throw new Error(result.error || "TTS failed");
    }
    return result.audioBuffer;
}

/**
 * Process audio message (transcribe and respond, with optional TTS reply)
 */
async function processAudioMessage(audioBuffer, mimeType, voiceType = "female") {
    try {
        console.log("Processing audio message via OpenRouter...");
        const textResponse = await transcribeAudioWithGemini(audioBuffer, mimeType);

        let audioResponse = null;
        try {
            audioResponse = await generateSpeech(textResponse, voiceType);
        } catch (ttsError) {
            console.error("TTS step failed (continuing with text-only reply):", ttsError.message);
        }

        return { success: true, textResponse, audioResponse, voiceType };
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
 * Prepare image parts (kept for interface compatibility - media-processor.js has its own copy too).
 */
function prepareImagePart(imageBuffer, mimeType) {
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!supportedTypes.includes(mimeType)) {
        throw new Error(`Unsupported image type: ${mimeType}`);
    }
    return { inlineData: { data: imageBuffer.toString("base64"), mimeType } };
}

function getModelInfo() {
    return {
        provider: "OpenRouter (free tier, no card required)",
        apiKey: OPENROUTER_API_KEY ? "✅ Configured" : "❌ Missing - see .env.example",
        textModel: TEXT_MODEL,
        multimodalModel: MULTIMODAL_MODEL,
        features: {
            textChat: "✅ Available",
            imageAnalysis: "✅ Available",
            audioTranscription: "✅ Available (best-effort - verify with a real voice note)",
            textToSpeech: "✅ Available (StreamElements, free)",
        }
    };
}

module.exports = {
    generateResponse,
    prepareImagePart,
    getModelInfo,
    SYSTEM_INSTRUCTION,
    transcribeAudioWithGemini,
    generateSpeech,
    processAudioMessage
};
